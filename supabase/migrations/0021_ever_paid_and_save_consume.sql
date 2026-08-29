-- ============================================================================
-- Ticketify — ever_paid monotonic flag + save-time scan consumption
--
-- Part of the "consume scans at SAVE time" change. Two concerns:
--
--   1. `profiles.ever_paid` — a monotonic flag set ONCE when a user makes a
--      real, paid purchase (INITIAL_PURCHASE / RENEWAL / UNCANCELLATION).
--      It is the basis for the "former paid users cannot start a free trial
--      again" rule: once you have ever paid, you never get a free trial.
--      It is set only by the RevenueCat webhook via `mark_ever_paid`
--      (never by the client) and backfilled below from the ledger.
--
--   2. `consume_scan_on_save()` — the new quota-consumption point. Parsing
--      no longer consumes a scan; the client consumes exactly ONE slot when
--      the user confirms a save (a parsed-but-discarded receipt cost no
--      quota). Tier-aware and atomic (auth.uid()-scoped, own row only).
--
-- What this migration does
-- ------------------------
--   §1  profiles.ever_paid boolean NOT NULL DEFAULT false.
--   §2  Backfill ever_paid = true for (i) currently-active real payers and
--        (ii) any profile with a real-payment ledger (webhook_events) row.
--   §3  consume_scan_on_save() — auth-scoped save-time consumption RPC.
--   §4  mark_ever_paid() — service-role-only, monotonic ever_paid setter.
--   §5  start_free_trial() — re-created to add ever_paid guard (no trial
--        for ever-paid users) + harden the 'expired' lifecycle.
--   §6  protect_profile_tier() — re-created to reject client writes to
--        ever_paid (INSERT must be false; UPDATE must not change).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. profiles.ever_paid
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column ever_paid boolean not null default false;

comment on column public.profiles.ever_paid is
  'Monotonic flag: true once the user has EVER made a real paid purchase (INITIAL_PURCHASE/RENEWAL/UNCANCELLATION). Set only server-side by mark_ever_paid from the RevenueCat webhook; never by the client. Former paid users cannot start a free trial again.';

-- ---------------------------------------------------------------------------
-- §2. Backfill ever_paid from real-payment state + ledger
--
-- A profile is "ever paid" if EITHER:
--   (i)  it is a real active payer right now (subscription_status='active'
--        AND not on a trial window), OR
--   (ii) the webhook ledger (webhook_events) holds a real-payment event
--        for that user (INITIAL_PURCHASE / RENEWAL / UNCANCELLATION).
-- The two conditions overlap by design; the WHERE is combined as a single
-- EXISTS pair so the backfill is idempotent and re-runnable.
-- ---------------------------------------------------------------------------

update public.profiles p
   set ever_paid = true
 where exists (
   select 1 from public.profiles q
    where q.id = p.id
      and q.subscription_status = 'active'
      and q.trial_ends_at is null
 )
    or exists (
   select 1 from public.webhook_events w
    where w.user_id = p.id
      and w.event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION')
 );

-- ---------------------------------------------------------------------------
-- §3. consume_scan_on_save() — save-time quota consumption
--
-- SECURITY DEFINER, auth.uid()-scoped (the caller can only ever consume
-- their OWN slot — no p_user_id leak). Atomic guarded UPDATE against the
-- tier-aware cap; ok=false (never raises) when the free cap is reached.
-- Mirrors the try_consume_scan RPC body (0011 §2) but keyed off auth.uid()
-- and hoisted to the SAVE boundary instead of parse.
-- ---------------------------------------------------------------------------

create or replace function public.consume_scan_on_save()
returns table (ok boolean, scans_used int, scans_limit int)
language plpgsql security definer volatile set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_tier  text;
  v_used  int;
  v_limit int;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  select tier into v_tier from public.profiles where id = v_user;
  v_tier := coalesce(v_tier, 'free');
  insert into public.scan_usage (user_id, year_month, scans_used, scans_limit)
  values (v_user, v_month, 0, case when v_tier='pro' then null else 15 end)
  on conflict (user_id, year_month) do nothing;
  -- The upfront `v_tier` read above is used ONLY to seed the INSERT's
  -- scans_limit (null for Pro, 15 for free). The cap decision itself is
  -- re-derived inside this UPDATE from the profile row via the `from`
  -- subselect, so the tier read and the increment happen atomically
  -- together — a tier change between the upfront read and the write can
  -- no longer split the decision from the increment (bounded TOCTOU).
  update public.scan_usage su
     set scans_used = su.scans_used + 1
    from public.profiles pr
   where su.user_id = v_user
     and su.year_month = v_month
     and pr.id = v_user
     and (pr.tier = 'pro' or su.scans_used < coalesce(su.scans_limit, 15))
   returning su.scans_used, su.scans_limit into v_used, v_limit;
  if found then return query select true, v_used, v_limit; return; end if;
  select su.scans_used, su.scans_limit into v_used, v_limit
    from public.scan_usage su where su.user_id=v_user and su.year_month=v_month;
  return query select false, coalesce(v_used,0), coalesce(v_limit,15);
end; $$;
revoke all on function public.consume_scan_on_save() from public, anon;
grant execute on function public.consume_scan_on_save() to authenticated;
comment on function public.consume_scan_on_save() is 'Atomically consumes one monthly scan slot for auth.uid() at save time. Tier-aware and atomic, scoped to the caller own row only. Returns (ok, scans_used, scans_limit); ok=false when the free cap is reached (never raises). SECURITY DEFINER, authenticated-role callable.';

-- ---------------------------------------------------------------------------
-- §4. mark_ever_paid() — monotonic ever_paid setter
--
-- SECURITY DEFINER, service_role-only. Sets ever_paid = true (monotonic:
-- it can never be unset). Raises P0002 if the profile is missing so the
-- webhook can treat a never-signed-in user exactly like set_profile_tier
-- does (WARNING-2).
-- ---------------------------------------------------------------------------

create or replace function public.mark_ever_paid(p_user_id uuid)
returns void language plpgsql security definer volatile set search_path = public as $$
begin
  update public.profiles set ever_paid = true where id = p_user_id;
  if not found then raise exception 'profile not found: %', p_user_id using errcode = 'P0002'; end if;
end; $$;
revoke all on function public.mark_ever_paid(uuid) from public, anon, authenticated;
grant execute on function public.mark_ever_paid(uuid) to service_role;
comment on function public.mark_ever_paid(uuid) is
  'Monotonic setter for profiles.ever_paid. SECURITY DEFINER, service-role only. Raises P0002 when the profile does not exist.';

-- ---------------------------------------------------------------------------
-- §5. start_free_trial() — harden against ever-paid + expired lifecycle
--
-- Re-creates the 0016 RPC. Keeps every existing guard (trial_ends_at /
-- active-subscription) and the activation logic, and adds TWO new guards:
--   - ever_paid → reject (a former paid user cannot start a free trial)
--   - subscription_status='expired' → reject (the trial was already used)
-- ever_paid is now read into the profile record.
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
  -- Fetch current profile state (new: also fetch ever_paid).
  select id, tier, subscription_status, trial_ends_at, ever_paid
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

  -- Reject if the user has EVER paid (monotonic flag) — a former paid
  -- subscriber can never start a free trial again.
  if v_profile.ever_paid then
    raise exception 'free trial not available after paid subscription';
  end if;

  -- Reject if the lifecycle is 'expired' (trial previously used and
  -- normalized) — the trial was already consumed.
  if v_profile.subscription_status = 'expired' then
    raise exception 'free trial already used';
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
  'Activates a 5-day free trial for the authenticated user. One trial per user AND never for a user who has ever paid (ever_paid) or whose subscription is expired. Sets tier=pro, subscription_status=trial, normalizes scan_usage to unlimited. SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- §6. protect_profile_tier() — extend with ever_paid guards
--
-- Re-creates the 0011/0016 trigger function, keeping ALL existing guards,
-- and adds ever_paid to the server-managed set:
--   INSERT: ever_paid must be false (a client can never create with true).
--   UPDATE: ever_paid must not change (a client can never flip it).
-- SECURITY DEFINER writers (current_user='postgres') bypass the guards.
-- Trigger attachment is unchanged (same function OID, existing trigger).
-- ---------------------------------------------------------------------------

create or replace function public.protect_profile_tier() returns trigger
language plpgsql
as $$
begin
  -- Sanctioned writers: set_profile_tier, sync_subscription_status,
  -- mark_ever_paid and expire_overdue_trials (SECURITY DEFINER, owner
  -- postgres) run this trigger with current_user = 'postgres'. No client
  -- role and no raw service_role UPDATE ever executes as postgres.
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
    -- Block non-false ever_paid on client INSERT.
    if new.ever_paid is distinct from false then
      raise exception 'ever_paid is managed server-side';
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
    -- Reject any ever_paid change from the client.
    if new.ever_paid is distinct from old.ever_paid then
      raise exception 'ever_paid is managed server-side';
    end if;
    return new;
  end if;

  -- DELETE (defensive: trigger is only attached to insert/update).
  return old;
end;
$$;
