-- ============================================================================
-- Ticketify — Subscription & Free Trial (PR 1: DB Schema + RPCs)
--
-- Extends the binary Pro/Free model to a 4-state subscription lifecycle:
-- none → trial → active/expired → active. Adds DB-authoritative state
-- with RevenueCat webhook sync via RPCs.
--
-- What this migration does
-- ------------------------
--   §1  Schema: add subscription_status + trial_ends_at to profiles;
--        backfill existing Pro users to 'active'.
--   §2  start_free_trial() RPC — user-activated 5-day trial.
--   §3  sync_subscription_status() RPC — RevenueCat webhook endpoint.
--   §4  set_profile_tier() update — sync subscription_status on tier change.
--   §5  protect_profile_tier() update — extend trigger to guard new columns.
--
-- What this migration does NOT do
-- --------------------------------
--   - No client-side code changes
--   - No edge function or webhook handler code
--   - No UI or navigation changes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. Schema — subscription_status + trial_ends_at on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column subscription_status text not null default 'none'
    check (subscription_status in ('none', 'trial', 'active', 'expired')),
  add column trial_ends_at timestamptz default null;

comment on column public.profiles.subscription_status is
  'Business lifecycle of the subscription: none, trial, active, expired. Tier is the access-control primitive; this tracks the lifecycle.';
comment on column public.profiles.trial_ends_at is
  'Trial expiry timestamp. Set on trial start, null otherwise. Used for client-side offline expiry checks.';

-- Backfill existing Pro users: they have an active paid subscription.
update public.profiles
   set subscription_status = 'active'
 where tier = 'pro'
   and subscription_status = 'none';

-- Backfill existing free users: explicitly 'none' (already the default,
-- but explicit is clearer for audit).
update public.profiles
   set subscription_status = 'none'
 where tier = 'free'
   and subscription_status is distinct from 'none';

-- ---------------------------------------------------------------------------
-- §2. start_free_trial() RPC
--
-- User-activated 5-day free trial. Validates one-trial-per-user:
-- trial_ends_at IS NULL (no prior trial started).
-- On success: sets trial_ends_at, subscription_status, and tier.
-- ---------------------------------------------------------------------------

create or replace function public.start_free_trial()
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_profile record;
begin
  -- Fetch current profile state.
  select id, tier, subscription_status, trial_ends_at
    into v_profile
    from public.profiles
   where id = auth.uid();

  if v_profile is null then
    raise exception 'profile not found';
  end if;

  -- Reject if a prior trial exists (trial_ends_at IS NOT NULL).
  if v_profile.trial_ends_at is not null then
    raise exception 'free trial already used';
  end if;

  -- Reject if subscription is already active (paid subscriber).
  if v_profile.subscription_status = 'active' then
    raise exception 'active subscription exists';
  end if;

  -- Activate trial: 5-day window from now.
  update public.profiles
     set trial_ends_at = now() + interval '5 days',
         subscription_status = 'trial',
         tier = 'pro'
   where id = auth.uid();

  -- Normalize scan_usage to Pro (unlimited scans).
  update public.scan_usage
     set scans_limit = null
   where user_id = auth.uid()
     and scans_limit is not null;
end;
$$;

-- Grant to authenticated (user-initiated via client SDK).
grant execute on function public.start_free_trial() to authenticated;

comment on function public.start_free_trial() is
  'Activates a 5-day free trial for the authenticated user. One trial per user. Sets tier=pro, subscription_status=trial, normalizes scan_usage to unlimited. SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- §3. sync_subscription_status() RPC
--
-- For RevenueCat webhook to call. Updates subscription_status and optionally
-- trial_ends_at. SECURITY DEFINER so it can bypass the protect_profile_tier
-- trigger.
-- ---------------------------------------------------------------------------

create or replace function public.sync_subscription_status(
  p_user_id uuid,
  p_status text,
  p_trial_ends_at timestamptz default null
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  -- Validate the status value.
  if p_status not in ('none', 'trial', 'active', 'expired') then
    raise exception 'invalid subscription status: %', p_status;
  end if;

  -- Update subscription_status and optionally trial_ends_at.
  -- SECURITY DEFINER: bypasses protect_profile_tier trigger.
  update public.profiles
     set subscription_status = p_status,
         trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at)
   where id = p_user_id;

  if not found then
    raise exception 'profile not found: %', p_user_id using errcode = 'P0002';
  end if;
end;
$$;

-- Least privilege: only the webhook (service_role) should call this.
revoke all on function public.sync_subscription_status(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_subscription_status(uuid, text, timestamptz) to service_role;

comment on function public.sync_subscription_status(uuid, text, timestamptz) is
  'RevenueCat webhook endpoint: syncs subscription_status and trial_ends_at. SECURITY DEFINER, service-role only.';

-- ---------------------------------------------------------------------------
-- §4. set_profile_tier() update — sync subscription_status on tier change
--
-- Extend the existing set_profile_tier RPC to also set subscription_status
-- when tier transitions occur:
--   pro → free: subscription_status = 'expired' (when current is 'trial')
--               subscription_status = 'none' (when current is 'none' or 'expired')
--   free → pro: subscription_status = 'active', trial_ends_at = null
-- ---------------------------------------------------------------------------

-- W3 fix: ensure the function is owned by postgres. Removed the pre-create
-- `alter` (failed with SQLSTATE 42883 on a fresh DB because the function
-- does not exist yet); Supabase runs migrations as `postgres`, so the
-- `create or replace` already yields a postgres-owned function.

create or replace function public.set_profile_tier(p_user_id uuid, p_tier text)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_limit       int;
  v_now_month   text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_curr_status text;
begin
  -- Validate the tier value up front.
  if p_tier not in ('free', 'pro') then
    raise exception 'invalid tier: %', p_tier;
  end if;

  -- Read current subscription_status for lifecycle transitions.
  select subscription_status into v_curr_status
    from public.profiles
   where id = p_user_id;

  -- Update profiles.tier. The protect_profile_tier trigger recognizes
  -- the SECURITY DEFINER role and allows this write.
  if p_tier = 'pro' then
    -- Grant: set subscription_status = 'active', clear trial_ends_at.
    update public.profiles
       set tier = p_tier,
           subscription_status = 'active',
           trial_ends_at = null
     where id = p_user_id;
  elsif p_tier = 'free' then
    -- Revoke: set subscription_status based on current state.
    -- trial → expired (trial was active, now downgraded)
    -- active → none (paid subscriber canceled)
    -- none/expired → none (already free, no-op for status)
    update public.profiles
       set tier = p_tier,
           subscription_status = case
             when v_curr_status = 'trial' then 'expired'
             else 'none'
           end,
           trial_ends_at = null
     where id = p_user_id;
  end if;

  if not found then
    raise exception 'profile not found: %', p_user_id using errcode = 'P0002';
  end if;

  -- Atomic scans_limit normalization.
  --   grant  (p_tier = 'pro')  → scans_limit = null  (unlimited marker)
  --   revoke (p_tier = 'free') → scans_limit = 15    (free cap)
  v_limit := case when p_tier = 'pro' then null else 15 end;

  update public.scan_usage
     set scans_limit = v_limit
   where user_id = p_user_id
     and (year_month = v_now_month or year_month > v_now_month);
end;
$$;

-- Least privilege (matches 0003:74-75, 0011:267-269).
revoke all on function public.set_profile_tier(uuid, text) from public, anon, authenticated;
grant execute on function public.set_profile_tier(uuid, text) to service_role;

comment on function public.set_profile_tier(uuid, text) is
  'Atomically transitions a profile to free|pro and normalizes subscription_status + scans_limit. SECURITY DEFINER, owned by postgres; protect_profile_tier trigger allows this write. Service-role only.';

-- ---------------------------------------------------------------------------
-- §5. protect_profile_tier() update — extend trigger to guard new columns
--
-- Extend the existing trigger function to also block direct writes to
-- subscription_status and trial_ends_at from non-SECURITY DEFINER paths.
-- The existing trigger (0002, recreated via 0011) keeps firing the same
-- function OID — no trigger reattachment needed.
-- ---------------------------------------------------------------------------

create or replace function public.protect_profile_tier() returns trigger
language plpgsql
as $$
begin
  -- Sanctioned writers: set_profile_tier and sync_subscription_status
  -- (SECURITY DEFINER, owner postgres) run this trigger with
  -- current_user = 'postgres'. No client role and no raw service_role
  -- UPDATE ever executes as postgres.
  if TG_OP in ('INSERT', 'UPDATE') and current_user = 'postgres' then
    return new;
  end if;

  -- INSERT guards
  if TG_OP = 'INSERT' then
    -- 0001's default is tier = 'free'; allow only the default tier.
    if new.tier is distinct from 'free' then
      raise exception 'tier is managed server-side';
    end if;
    -- Block non-default subscription_status on client INSERT.
    if new.subscription_status is distinct from 'none' then
      raise exception 'subscription_status is managed server-side';
    end if;
    -- Block non-null trial_ends_at on client INSERT.
    if new.trial_ends_at is not null then
      raise exception 'trial_ends_at is managed server-side';
    end if;
    return new;
  end if;

  -- UPDATE guards
  if TG_OP = 'UPDATE' then
    -- Reject any tier change from the client.
    if new.tier is distinct from old.tier then
      raise exception 'tier is managed server-side';
    end if;
    -- Reject any subscription_status change from the client.
    if new.subscription_status is distinct from old.subscription_status then
      raise exception 'subscription_status is managed server-side';
    end if;
    -- Reject any trial_ends_at change from the client.
    if new.trial_ends_at is distinct from old.trial_ends_at then
      raise exception 'trial_ends_at is managed server-side';
    end if;
    return new;
  end if;

  -- DELETE (defensive: trigger is only attached to insert/update).
  return old;
end;
$$;
