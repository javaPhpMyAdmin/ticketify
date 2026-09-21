-- ============================================================================
-- 0040_rc_trial_rollback.sql
-- Ticketify — RevenueCat trial cutover ROLLBACK (DB plumbing restore).
--
-- Change: revenuecat-trial-migration (SDD change id)
-- Phase:  Slice D (PR 4: rollback runbook — <1h restore)
-- Cross-refs:
--   - REQ-DATA-TRIAL-CUTOVER (data-access): idempotency (forward migration
--       is idempotent, this rollback is also idempotent).
--   - REQ-DATA-PROFILES-TRIAL-COLS (data-access): column + CHECK
--       restoration (the inverse of Slice A §6 + §7).
--   - REQ-DATA-RPC-TRIAL-REMOVAL (data-access): the INVERSE — restore
--       the dropped RPCs with their pre-cutover bodies + grants.
--   - REQ-DATA-CRONS-TRIAL-REMOVAL (data-access): the INVERSE — re-
--       schedule the pg_cron 'trial-expiry' job.
--   - Spec REQ-PRO-1..5 (pro-subscription): restore set_profile_tier's
--       'trial → expired' branch + protect_profile_tier's trial_ends_at
--       guards + sync_client_subscription's active-trial guard.
--   - Spec REQ-LEGAL-1..2 (subscription-trial): restore the DB-driven
--       trial lifecycle so the pre-cutover client code can be reinstated
--       via `git revert <merge-sha>`.
--   - Design §"Rollback Runbook (<1h)" + ADR-2 (backfill semantics).
--   - The smoke `supabase/tests/trial-rollback.sql` (paired with
--       0039_rc_trial_cutover.sql) asserts the pre-cutover catalog
--       state is restored.
--
-- Why this migration exists
-- --------------------------
-- The forward migration 0039 cuts the app from a custom DB-driven trial
-- to RevenueCat's native intro offers. The cutover is reversible per the
-- design §"Rollback Runbook", but the DB state alone can't be undone
-- with a `git revert` (schema changes don't roll back via code). This
-- migration is the manual <1h restore path:
--
--   1. Apply this migration to production (or a fork of it).
--   2. `git revert <merge-sha>` the merged code (the dashed trial CTA,
--      the trial banner, the `'frozen'` gate state come back).
--   3. Restart the app process (the webhook slim also reverts).
--   4. Disable intro offers in Play Console + App Store Connect +
--      RevenueCat dashboard.
--   5. Existing paid users unaffected (their `subscription_status` was
--      'active' before AND after the cutover).
--
-- Idempotency
-- -----------
-- Every section is `CREATE OR REPLACE` + conditional DROP IF EXISTS +
-- `IF NOT EXISTS` for DDL. Running this migration twice in a row leaves
-- the DB in the same state. Running 0039 → 0040 in sequence on a fresh
-- `supabase db reset --local` returns the catalog to the pre-0039 state
-- (verified by `supabase/tests/trial-rollback.sql`).
--
-- What this migration does
-- ------------------------
-- In reverse order of 0039's 9 steps (so partial execution is safe —
-- earlier sections don't break later sections):
--
--   §9 reverse. Restore the pre-cutover bodies of sync_subscription_status
--            (3-arg signature), set_profile_tier (with `'trial' →
--            'expired'` branch), protect_profile_tier (with
--            trial_ends_at INSERT/UPDATE guards), sync_client_subscription
--            (with active-trial guard + wider allow-list).
--   §8 reverse. Re-schedule the pg_cron 'trial-expiry' job (every 6h).
--   §7 reverse. Re-add the `trial_ends_at` column (nullable).
--   §6 reverse. Widen the `subscription_status` CHECK to the pre-cutover
--            set `('none','trial','active','expired')`. Existing rows are
--            either 'none' or 'active' (post-cutover backfill) — widening
--            is safe (no row violates the wider set).
--   §5 reverse. Recreate `expire_overdue_trials()` RPC (pre-cutover body
--            from 0020).
--   §4 reverse. Recreate `start_free_trial()` RPC (pre-cutover body from
--            0016).
--   §3 reverse. Re-grant EXECUTE to `authenticated` on start_free_trial
--            + `service_role` on sync_subscription_status (pre-cutover
--            grants). The REVOKE in 0039 §9a/§9b/§9c/§9d re-establishes
--            PUBLIC-by-default; this section restores the explicit
--            grants.
--
-- Notes
-- -----
--   - The pre-cutover sync_subscription_status had a 3-arg signature
--     `(uuid, text, timestamptz)`. 0039 §9a DROPPED it and CREATED a 2-arg
--     function. This rollback DROPs the 2-arg and recreates the 3-arg.
--   - The pre-cutover protect_profile_tier used `set search_path = public`
--     (not `''`). This rollback matches the original.
--   - The pre-cutover sync_client_subscription used `set search_path = public`.
--   - The pre-cutover set_profile_tier used `set search_path = public`.
--   - The pre-cutover start_free_trial used `set search_path = public`.
--   - The pre-cutover expire_overdue_trials used `set search_path = public`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §9 reverse. Restore pre-cutover function bodies.
-- ---------------------------------------------------------------------------

-- §9a reverse. sync_subscription_status: drop the 2-arg form, recreate
-- the 3-arg form (pre-cutover signature).
drop function if exists public.sync_subscription_status(uuid, text);

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
  -- Validate the status value (pre-cutover allow-list — REQ-LEGAL-1).
  if p_status not in ('none', 'trial', 'active', 'expired') then
    raise exception 'invalid subscription status: %', p_status using errcode = 'P0001';
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

alter function public.sync_subscription_status(uuid, text, timestamptz) owner to postgres;

-- Least privilege (matches 0016 §3).
revoke all on function public.sync_subscription_status(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_subscription_status(uuid, text, timestamptz) to service_role;

comment on function public.sync_subscription_status(uuid, text, timestamptz) is
  'RevenueCat webhook endpoint: syncs subscription_status and trial_ends_at. SECURITY DEFINER, service-role only.';

-- §9b reverse. set_profile_tier: restore the 'trial → expired' branch.
drop function if exists public.set_profile_tier(uuid, text);

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
    raise exception 'invalid tier: %', p_tier using errcode = 'P0001';
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

alter function public.set_profile_tier(uuid, text) owner to postgres;

revoke all on function public.set_profile_tier(uuid, text) from public, anon, authenticated;
grant execute on function public.set_profile_tier(uuid, text) to service_role;

comment on function public.set_profile_tier(uuid, text) is
  'Atomically transitions a profile to free|pro and normalizes subscription_status + scans_limit. SECURITY DEFINER, owned by postgres; protect_profile_tier trigger allows this write. Service-role only. Pre-cutover behavior (REQ-LEGAL-1..2): on grant subscription_status=''active''+trial_ends_at=null; on revoke if v_curr_status was ''trial'' → ''expired'', else ''none''.';

-- §9c reverse. protect_profile_tier: restore the trial_ends_at guards
-- (the trigger would otherwise fail to compile after §7 reverse re-adds
-- the column, because §9c forward already removed the guards).
--
-- Note: we DO NOT drop the function first — the `profiles_protect_tier`
-- trigger (created in 0002) depends on it, and Postgres refuses to
-- DROP a function that an active trigger references (SQLSTATE 2BP01).
-- `CREATE OR REPLACE FUNCTION` replaces the function body + attributes
-- in place; the trigger automatically fires the new body (triggers
-- attach to functions by name, not by body snapshot).
create or replace function public.protect_profile_tier() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Sanctioned writers: set_profile_tier, sync_subscription_status,
  -- mark_ever_paid (SECURITY DEFINER, owner postgres) run this trigger
  -- with current_user = 'postgres'. No client role and no raw
  -- service_role UPDATE ever executes as postgres.
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
    -- Block non-null trial_ends_at on client INSERT (trial lifecycle is
    -- server-managed via start_free_trial).
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
    -- Reject any trial_ends_at change from the client (start_free_trial
    -- is the only writer).
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

alter function public.protect_profile_tier() owner to postgres;

revoke all on function public.protect_profile_tier() from public, anon, authenticated;

comment on function public.protect_profile_tier() is
  'Trigger function that blocks any client-driven write to server-managed columns (tier, subscription_status, trial_ends_at, ever_paid). SECURITY DEFINER writers (set_profile_tier, sync_subscription_status, mark_ever_paid) bypass this check by running as postgres. Pre-cutover behavior restored in 0040.';

-- §9d reverse. sync_client_subscription: restore the active-trial guard
-- and the wider allow-list.
drop function if exists public.sync_client_subscription(text);

create or replace function public.sync_client_subscription(
  p_status text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_profile record;
begin
  -- Validate the status value. 'active' is intentionally rejected: paid
  -- status is asserted only by the RevenueCat webhook via
  -- sync_subscription_status (service-role).
  if p_status not in ('none', 'trial', 'expired') then
    raise exception 'invalid subscription status: %', p_status using errcode = 'P0001';
  end if;

  -- Read the caller's current profile state BEFORE any write, so the
  -- active-trial guard below evaluates the pre-move row.
  select subscription_status, tier, trial_ends_at
    into v_profile
    from public.profiles
   where id = auth.uid();

  if v_profile is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- Active-trial guard (0035 §1). start_free_trial is the only writer of
  -- trial_ends_at, so `trial_ends_at IS NOT NULL` identifies a real trial;
  -- tier='pro' confirms the trial is still granting access. Moving such a
  -- row off 'trial' — to 'none' or 'expired' — strands tier='pro' past
  -- trial_ends_at: the expiry materializer (0020/0035 §2) would no longer
  -- find the row, freezing unpaid Pro access forever. The materializer is
  -- the SINGLE authority for trial→expired; a client whose trial window
  -- is still active must wait for the materializer or call
  -- sync_subscription_status directly (service-role only).
  if v_profile.subscription_status = 'trial'
     and v_profile.trial_ends_at is not null
     and v_profile.tier = 'pro'
     and p_status <> 'trial' then
    raise exception 'cannot change subscription status during active trial' using errcode = 'P0001';
  end if;

  -- Update the caller's own profile. SECURITY DEFINER bypasses the
  -- protect_profile_tier trigger. auth.uid() ensures callers cannot
  -- target other users.
  update public.profiles
     set subscription_status = p_status
   where id = auth.uid();
end;
$$;

alter function public.sync_client_subscription(text) owner to postgres;

revoke all on function public.sync_client_subscription(text) from public, anon;
grant execute on function public.sync_client_subscription(text) to authenticated;

comment on function public.sync_client_subscription(text) is
  'Client-side subscription_status sync (auth.uid()-scoped). SECURITY DEFINER. Allow-list (''none'',''trial'',''expired'') — ''active'' is webhook-reserved. Pre-cutover active-trial guard (0035 §1) restored in 0040: a profile in an active trial (status=''trial'' AND trial_ends_at IS NOT NULL AND tier=''pro'') may only self-claim ''trial''.';

-- ---------------------------------------------------------------------------
-- §7 reverse. Re-add trial_ends_at column.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column trial_ends_at timestamptz default null;

comment on column public.profiles.trial_ends_at is
  'Trial expiry timestamp. Set on trial start, null otherwise. Used for client-side offline expiry checks. Restored in 0040 (the cutover dropped it in 0039 §7).';

-- ---------------------------------------------------------------------------
-- §6 reverse. Widen subscription_status CHECK back to the pre-cutover set.
-- Existing rows are either 'none' or 'active' (post-cutover backfill) —
-- widening the CHECK to include 'trial' and 'expired' is safe (no row
-- violates the wider set).
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_subscription_status_check;

alter table public.profiles
  add constraint profiles_subscription_status_check
  check (subscription_status in ('none', 'trial', 'active', 'expired'));

-- ---------------------------------------------------------------------------
-- §5 reverse. Recreate expire_overdue_trials RPC (pre-cutover body
-- from 0020).
-- ---------------------------------------------------------------------------

create or replace function public.expire_overdue_trials()
returns int
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_now_month text := to_char(now(), 'YYYY-MM');
  v_affected  int;
begin
  -- 1) Materialize the lifecycle transition for overdue trials still marked
  --    'trial': trial has passed trial_ends_at → expired + free + clear.
  update public.profiles
     set subscription_status = 'expired',
         tier = 'free',
         trial_ends_at = null
   where subscription_status = 'trial'
     and trial_ends_at <= now();

  -- 2) Normalize ANY profile already in the 'expired' lifecycle state so the
  --    access tier, trial timestamp, and per-month scan quota reflect that
  --    they are no longer Pro. This repairs rows that reached 'expired'
  --    through an older/mixed path.
  update public.profiles
     set tier = 'free',
         trial_ends_at = null
   where subscription_status = 'expired'
     and (tier is distinct from 'free' or trial_ends_at is not null);

  -- 3) Reset the current-month scan quota to the free cap for every expired
  --    (now free) user, so their Pro-era scans do not eat into the fresh
  --    monthly allowance.
  update public.scan_usage su
     set scans_used  = 0,
         scans_limit = 15
    from public.profiles p
   where su.user_id = p.id
     and p.subscription_status = 'expired'
     and su.year_month = v_now_month;

  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;

alter function public.expire_overdue_trials() owner to postgres;

revoke all on function public.expire_overdue_trials() from public, anon;
grant execute on function public.expire_overdue_trials() to authenticated;

comment on function public.expire_overdue_trials() is
  'Materializes and normalizes the trial→expired lifecycle: overdue trials are flipped to expired+free, any existing expired profile is normalized to tier=free with trial_ends_at cleared, and the current-month scan quota is reset to a fresh 15-cap. SECURITY DEFINER, idempotent. Restored in 0040.';

-- ---------------------------------------------------------------------------
-- §4 reverse. Recreate start_free_trial RPC (pre-cutover body from 0016).
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

alter function public.start_free_trial() owner to postgres;

grant execute on function public.start_free_trial() to authenticated;

comment on function public.start_free_trial() is
  'Activates a 5-day free trial for the authenticated user. One trial per user. Sets tier=pro, subscription_status=trial, normalizes scan_usage to unlimited. SECURITY DEFINER. Restored in 0040.';

-- ---------------------------------------------------------------------------
-- §8 reverse. Re-schedule the pg_cron 'trial-expiry' job.
-- Wrapped in DO block — the pg_cron extension is platform-optional
-- (the rollback is a no-op if the extension isn't installed).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'trial-expiry'::text,
      '0 */6 * * *'::text,
      'select public.expire_overdue_trials();'::text
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- §3 reverse. Re-grant EXECUTE on the recreated RPCs. (Most grants were
-- applied inline above during function recreation; this section is a
-- belt-and-braces pass for any role that might have been missed during
-- the 0039 REVOKE.)
-- ---------------------------------------------------------------------------

-- start_free_trial: EXECUTE to authenticated (client-initiated).
grant execute on function public.start_free_trial() to authenticated;

-- expire_overdue_trials: EXECUTE to authenticated (self-heal on app open).
-- (Already granted inline above; idempotent.)
grant execute on function public.expire_overdue_trials() to authenticated;

-- sync_subscription_status: EXECUTE to service_role only (webhook).
grant execute on function public.sync_subscription_status(uuid, text, timestamptz) to service_role;

-- set_profile_tier: EXECUTE to service_role only.
grant execute on function public.set_profile_tier(uuid, text) to service_role;

-- sync_client_subscription: EXECUTE to authenticated (caller derives user_id).
grant execute on function public.sync_client_subscription(text) to authenticated;

-- protect_profile_tier: NO grant — it's a trigger function called by
-- the system, not by users (matches the pre-cutover 0002 posture).

comment on table public.profiles is
  'User profile. Server-managed columns: tier (free|pro), subscription_status (none|trial|active|expired — full lifecycle restored in 0040), trial_ends_at (timestamp, null otherwise — restored in 0040), ever_paid (monotonic paid-once flag). protect_profile_tier trigger guards writes from non-SECURITY DEFINER roles; set_profile_tier is the canonical tier writer.';
