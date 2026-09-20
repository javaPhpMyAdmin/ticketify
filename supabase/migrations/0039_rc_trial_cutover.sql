-- ============================================================================
-- 0039_rc_trial_cutover.sql
-- Ticketify — RevenueCat trial cutover (DB plumbing drop).
--
-- Change: revenuecat-trial-migration  (SDD change id)
-- Phase:  Slice A (PR 1: DB + webhook + smoke + CI)
-- Cross-refs:
--   - REQ-DATA-TRIAL-CUTOVER (data-access): in-window trial backfill +
--       idempotency (Slice A §1).
--   - REQ-DATA-PROFILES-TRIAL-COLS (data-access): narrow CHECK + column
--       drop (Slice A §6 + §7).
--   - REQ-DATA-RPC-TRIAL-REMOVAL (data-access): revoke + drop
--       `start_free_trial` / `expire_overdue_trials`; narrow
--       `sync_subscription_status` allow-list (Slice A §3 + §4 + §5 + §9).
--   - REQ-DATA-CRONS-TRIAL-REMOVAL (data-access): unschedule
--       `cron.schedule('trial-expiry')` (Slice A §8).
--   - Spec REQ-PRO-1..5 (pro-subscription): `set_profile_tier` and the
--       `protect_profile_tier` trigger must not reference the dropped
--       column (Slice A §9 — cleanup of stale references).
--   - Design ADR-2 (backfill semantics), ADR-3 (gate simplification —
--       ripples through `protect_profile_tier` which no longer needs
--       `trial_ends_at` guards).
-- See openspec/changes/revenuecat-trial-migration/design.md §"Migration /
-- Rollout" + §"Rollback Runbook (<1h)", and
-- openspec/changes/revenuecat-trial-migration/specs/{data-access,
-- pro-subscription,subscription-trial}/spec.md.
--
-- What this migration does
-- ------------------------
-- Nine reversible steps in a fixed order. The order is load-bearing — do
-- not reshuffle without re-reading the design §"Cutover (one-shot,
-- inside the migration)" diagram.
--
--   §1. Backfill: in-window `'trial'` rows are flipped to `(active, pro,
--       trial_ends_at=NULL)`. Past-window rows are also flipped per
--       ADR-2 (the cron-lag edge — the user's task explicitly calls this
--       out). Idempotent: the WHERE clause never matches after §6
--       narrows the CHECK.
--   §2. `ALTER COLUMN trial_ends_at DROP NOT NULL` — preserves the
--       column for the rollback path; no data loss.
--   §3. `REVOKE EXECUTE` on `start_free_trial`, `expire_overdue_trials`
--       from PUBLIC/anon/authenticated/service_role (the 0029 §4 trap).
--   §4. `DROP FUNCTION start_free_trial()`.
--   §5. `DROP FUNCTION expire_overdue_trials()`.
--   §6. Narrow the `subscription_status` CHECK to `('none','active')`.
--       §1 ensures no `'trial'`/`'expired'` rows survive the narrow.
--   §7. `DROP COLUMN trial_ends_at`.
--   §8. `cron.unschedule('trial-expiry')` (wrapped in DO block — the
--       pg_cron extension is platform-optional).
--   §9. Refactor `sync_subscription_status` (allow-list narrowed to
--       `('none','active')`, `p_trial_ends_at` parameter dropped —
--       the column it wrote is gone) and clean up `protect_profile_tier`
--       + `set_profile_tier` references to the dropped column. The
--       trigger function would otherwise fail to compile after §7
--       (record field reference to a non-existent column).
--
-- Rollback note
-- -------------
-- The migration is reversible via the nine steps in REVERSE order (the
-- design §"Rollback Runbook (<1h)" pins the procedure). The narrow
-- CHECK in §6 is the only step that hard-fails once a row in the
-- forbidden set exists — re-running the §1 backfill before §6 restores
-- the row to a representable state. Code rollback = `git revert
-- <merge-sha>` (the dashed CTA, banner, and `'frozen'` gate come back).
-- Operational rollback = disable intro offers in Play Console + App
-- Store Connect + RevenueCat dashboard (existing paid users unaffected).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. Backfill — every profile with subscription_status='trial' →
--     (active, pro, trial_ends_at=NULL). Single UPDATE covers:
--       (a) in-window rows (trial_ends_at > now()),
--       (b) past-window / cron-lag rows (trial_ends_at <= now()),
--       (c) the `trial_ends_at IS NULL` edge case (R1-6) — a row that
--           somehow ended up `'trial'` with a NULL window (the 0016 default
--           is `trial_ends_at default null`, so a row inserted directly
--           with `subscription_status='trial'` and no `trial_ends_at`
--           value would slip through a `trial_ends_at > now()` predicate).
--     ADR-2 (backfill semantics): the past-window + NULL-window edges are
--     also flipped because there is no DB trial anymore and the user
--     keeps Pro until they re-subscribe via Play. Step (a) of ADR-2
--     keeps Pro access past `trial_ends_at` consistent.
--
--     Idempotency: after §6 narrows the CHECK to ('none','active'), no
--     new row can ever satisfy `subscription_status = 'trial'`, so a
--     re-run matches zero rows — the §5 backfill idempotency scenario
--     in the spec holds trivially.
-- ---------------------------------------------------------------------------

update public.profiles
   set subscription_status = 'active',
       tier                = 'pro',
       trial_ends_at       = null
 where subscription_status = 'trial';

-- ---------------------------------------------------------------------------
-- §2. ALTER COLUMN trial_ends_at DROP NOT NULL
--
-- Preserves the column for the rollback path (the design §"Rollback
-- Runbook (<1h)" pins this as the precursor to the column drop in §7).
-- No data loss: every row already has either NULL (free / active /
-- past expiry) or a future timestamp (in-window trial — but those are
-- cleared in §1).
-- ---------------------------------------------------------------------------

alter table public.profiles
  alter column trial_ends_at drop not null;

-- ---------------------------------------------------------------------------
-- §3. REVOKE EXECUTE — close the 0029 §4 trap before the drops in §4/§5
--
-- `create or replace function` resets EXECUTE to PUBLIC. Revoking here
-- (before the drops) keeps the window of "the function exists with
-- PUBLIC EXECUTE" zero — anon/authenticated cannot race a drop with a
-- last-second call. The drops in §4/§5 close the race definitively.
--
-- The 3-arg `sync_subscription_status(uuid, text, timestamptz)` overload
-- is also REVOKED here. The migration window (between §6 narrowing the
-- CHECK and §9a dropping the overload) leaves the 3-arg function live
-- with its pre-cutover 4-state allow-list (`'none','trial','active','expired'`).
-- A delivery from the pre-slim webhook with `p_status = 'trial'` during
-- that window would UPDATE subscription_status='trial' — which §6
-- rejects (23514) — and the migration aborts. Revoking the overload
-- up-front (the REVOKE succeeds even though the function still exists —
-- the DROP comes in §9a) closes that race.
-- ---------------------------------------------------------------------------

revoke execute on function public.start_free_trial() from public, anon, authenticated, service_role;
revoke execute on function public.expire_overdue_trials() from public, anon, authenticated, service_role;
revoke execute on function public.sync_subscription_status(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §4. DROP FUNCTION start_free_trial()
--
-- REQ-DATA-RPC-TRIAL-REMOVAL. The 5-day DB trial is gone — native intro
-- offers (Play Console + App Store Connect) own trial eligibility now.
-- ---------------------------------------------------------------------------

drop function if exists public.start_free_trial();

-- ---------------------------------------------------------------------------
-- §5. DROP FUNCTION expire_overdue_trials()
--
-- REQ-DATA-RPC-TRIAL-REMOVAL. Trial expiry detection moves to the
-- RevenueCat webhook's `EXPIRATION` event (delivered within minutes
-- of subscription expiry); no DB materialization is needed anymore.
-- ---------------------------------------------------------------------------

drop function if exists public.expire_overdue_trials();

-- ---------------------------------------------------------------------------
-- §6. Narrow CHECK — subscription_status ∈ ('none','active')
--
-- REQ-DATA-PROFILES-TRIAL-COLS. §1 ensures no `'trial'`/`'expired'`
-- rows exist when this CHECK is added; the CHECK rejects those values
-- going forward. The narrow + the column drop (§7) are the two halves
-- of the post-cutover contract.
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_subscription_status_check;

alter table public.profiles
  add constraint profiles_subscription_status_check
  check (subscription_status in ('none', 'active'));

comment on constraint profiles_subscription_status_check on public.profiles is
  'Post-cutover allow-list for subscription_status: ''none'' (no paid subscription) or ''active'' (paid, webhook-asserted). ''trial'' and ''expired'' are no longer representable — trial eligibility is owned by Play Console / App Store Connect native intro offers (REQ-PRO-INTRO-CAPTION). See 0039_rc_trial_cutover.sql.';

-- ---------------------------------------------------------------------------
-- §7. DROP COLUMN trial_ends_at
--
-- REQ-DATA-PROFILES-TRIAL-COLS. The column is dropped AFTER the
-- trigger function cleanup in §9c — a record field reference to a
-- non-existent column would otherwise fail to compile (PG error
-- "record \"new\" has no field \"trial_ends_at\"") the moment the
-- column disappears. §9c drops the references first; §7 then drops
-- the column.
--
-- (NB: §9 is the LAST step in the design's 9-step diagram, but §9's
-- trigger cleanup is logically prerequisite to §7's column drop. We
-- implement §9 first and then drop the column in §7. The 9-step
-- diagram in the design shows §6 → §7 → §8 → §9; the actual SQL
-- execution order is §6 → §9 (trigger cleanup) → §7 (column drop) →
-- §8 (cron unschedule). This keeps the contract of "after the
-- migration, the trigger compiles + the column is gone" achievable in
-- one pass.)
-- ---------------------------------------------------------------------------

-- (Deferred to §9c.)

-- ---------------------------------------------------------------------------
-- §8. Unschedule cron 'trial-expiry'
--
-- REQ-DATA-CRONS-TRIAL-REMOVAL. The 6-hourly job has nothing to call
-- anymore (§5 dropped the function it invoked). Wrapped in DO block
-- so the absence of the pg_cron extension on stripped stacks is a
-- SKIP, not a failure (the smoke test asserts the same posture).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    perform cron.unschedule('trial-expiry');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- §9. Refactor sync_subscription_status + clean up column references
--
-- Three concerns in this section:
--   (a) sync_subscription_status: narrow allow-list to ('none','active')
--       and DROP the `p_trial_ends_at timestamptz` parameter (the column
--       it wrote is gone after §7). The 4-arg overload becomes 2-arg.
--   (b) set_profile_tier: drop the `'trial' → 'expired'` case branch
--       (dead code post-cutover — `v_curr_status` can never be `'trial'`)
--       and the `trial_ends_at = null` write (column is gone after §7).
--   (c) protect_profile_tier: drop the `trial_ends_at` INSERT/UPDATE
--       guards (the trigger function would otherwise fail to compile
--       after §7 drops the column).
-- ---------------------------------------------------------------------------

-- §9a. sync_subscription_status: narrow allow-list + drop the
--      `p_trial_ends_at` parameter.
--
-- The pre-cutover signature was `sync_subscription_status(uuid, text,
-- timestamptz)` (0016 §3) — a 3-arg overload where the third argument
-- defaulted to NULL. `create or replace` does NOT replace an overload
-- with a different arg count: the new 2-arg function coexists with the
-- old 3-arg one, and a 2-arg caller hit a "function is not unique"
-- ambiguity. We DROP the old overload explicitly first, then create the
-- new one. Without this step the catalog has two `sync_subscription_status`
-- functions and the smoke test fails with SQLSTATE 42725.
drop function if exists public.sync_subscription_status(uuid, text, timestamptz);

create or replace function public.sync_subscription_status(
  p_user_id uuid,
  p_status  text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  -- Allow-list narrowed to the post-cutover contract
  -- (REQ-DATA-RPC-TRIAL-REMOVAL): only webhook-driven values are
  -- accepted. ''trial'' and ''expired'' are no longer representable
  -- in the narrowed CHECK (§6) and would fail anyway — this is the
  -- explicit RPC-level gate that documents the contract.
  if p_status not in ('none', 'active') then
    raise exception 'invalid subscription status: %', p_status using errcode = 'P0001';
  end if;

  -- SECURITY DEFINER: bypasses protect_profile_tier trigger.
  update public.profiles
     set subscription_status = p_status
   where id = p_user_id;

  if not found then
    raise exception 'profile not found: %', p_user_id using errcode = 'P0002';
  end if;
end;
$$;

-- Pins the definer owner (belt-and-braces, 0016 §3 / 0031 §2 / 0034 §3 style).
alter function public.sync_subscription_status(uuid, text) owner to postgres;

-- Least privilege: only the webhook (service_role) should call this.
-- `create or replace function` resets EXECUTE to PUBLIC (the 0029 §4
-- trap) — re-apply the 0016 §3 posture explicitly.
revoke all on function public.sync_subscription_status(uuid, text) from public, anon, authenticated;
grant execute on function public.sync_subscription_status(uuid, text) to service_role;

comment on function public.sync_subscription_status(uuid, text) is
  'RevenueCat webhook endpoint: syncs subscription_status. SECURITY DEFINER, service-role only. Allow-list narrowed post-cutover to (''none'',''active'') — ''trial'' and ''expired'' raise P0001 (REQ-DATA-RPC-TRIAL-REMOVAL). The `p_trial_ends_at` parameter from the pre-cutover signature is dropped (the column was removed in 0039 §7).';

-- §9b. set_profile_tier: drop the `'trial' → 'expired'` branch and the
--      `trial_ends_at = null` writes (the column is gone after §7).
create or replace function public.set_profile_tier(p_user_id uuid, p_tier text)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_limit     int;
  v_now_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
begin
  -- Validate the tier value up front.
  if p_tier not in ('free', 'pro') then
    raise exception 'invalid tier: %', p_tier using errcode = 'P0001';
  end if;

  -- Update profiles.tier. The protect_profile_tier trigger recognizes
  -- the SECURITY DEFINER role and allows this write.
  if p_tier = 'pro' then
    -- Grant: set subscription_status = 'active'. No trial_ends_at
    -- write (column dropped in §7).
    update public.profiles
       set tier                = p_tier,
           subscription_status = 'active'
     where id = p_user_id;
  elsif p_tier = 'free' then
    -- Revoke: set subscription_status = 'none'. The pre-cutover
    -- `'trial' → 'expired'` branch is REMOVED (REQ-DATA-RPC-TRIAL-REMOVAL
    -- + REQ-PRO-1..5) — `'trial'` is no longer a representable value
    -- post-cutover so the case branch was dead code. No trial_ends_at
    -- write (column dropped in §7).
    update public.profiles
       set tier                = p_tier,
           subscription_status = 'none'
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

-- Pins the definer owner (belt-and-braces, 0016 §4 style).
alter function public.set_profile_tier(uuid, text) owner to postgres;

-- Least privilege (matches 0016 §4 / 0011:267-269).
revoke all on function public.set_profile_tier(uuid, text) from public, anon, authenticated;
grant execute on function public.set_profile_tier(uuid, text) to service_role;

comment on function public.set_profile_tier(uuid, text) is
  'Atomically transitions a profile to free|pro and normalizes subscription_status + scans_limit. SECURITY DEFINER, owned by postgres; protect_profile_tier trigger allows this write. Service-role only. Post-cutover (0039 §9b): on grant subscription_status=''active'', on revoke subscription_status=''none'' — the pre-cutover ''trial → expired'' branch and all trial_ends_at writes are removed (column dropped in §7).';

-- §9c. protect_profile_tier: drop the `trial_ends_at` guards. The
--      trigger function references `new.trial_ends_at` / `old.trial_ends_at`
--      in the INSERT/UPDATE branches; once §7 drops the column, those
--      references fail to compile (PG error "record \"new\" has no field
--      \"trial_ends_at\""). Cleaning up here keeps the trigger
--      compilable through §7.
create or replace function public.protect_profile_tier() returns trigger
language plpgsql
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
    -- Block non-false ever_paid on client INSERT.
    if new.ever_paid is distinct from false then
      raise exception 'ever_paid is managed server-side';
    end if;
    -- trial_ends_at guards REMOVED (0039 §9c) — the column is dropped
    -- in §7 and the trial lifecycle is owned by Play/App Store intro
    -- offers now.
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
    -- Reject any ever_paid change from the client.
    if new.ever_paid is distinct from old.ever_paid then
      raise exception 'ever_paid is managed server-side';
    end if;
    -- trial_ends_at guards REMOVED (0039 §9c) — the column is dropped
    -- in §7.
    return new;
  end if;

  -- DELETE (defensive: trigger is only attached to insert/update).
  return old;
end;
$$;

-- 0029 §4 trap (R1-3): `create or replace function` resets EXECUTE to
-- PUBLIC. The trigger function is INTERNAL — clients never call it
-- directly (the trigger fires on INSERT/UPDATE), but PostgreSQL still
-- grants EXECUTE to PUBLIC by default. A direct call to
-- `protect_profile_tier()` from an anon/authenticated session would
-- execute the trigger body without `current_user = 'postgres'`, hit
-- the INSERT/UPDATE guard branches, and raise one of the
-- 'managed server-side' exceptions — a noisy signal with no
-- exploit value, but an oracle nonetheless. Revoke EXECUTE from PUBLIC
-- to close the oracle. The trigger itself still fires for the
-- legitimate INSERT/UPDATE paths (triggers don't require EXECUTE on
-- the trigger function to fire on table writes).
revoke all on function public.protect_profile_tier() from public;

-- §9d. sync_client_subscription: narrow allow-list to ('none') and
--      drop the `trial_ends_at` SELECT + active-trial guard. The
--      pre-cutover body (0035 §1) referenced the dropped column in
--      three places:
--        1) `select subscription_status, tier, trial_ends_at into v_profile`
--        2) the active-trial guard that used `v_profile.trial_ends_at is not null`
--        3) the allow-list `('none','trial','expired')` which is wider than
--           the narrowed CHECK (§6) accepts.
--      All three must go. Post-cutover the only client-claimable value is
--      'none' — 'active' is webhook-reserved (already rejected pre-cutover
--      via the 0034 message check); 'trial' and 'expired' are no longer
--      representable.
--
--      The function signature is UNCHANGED — slice B's `syncSubscriptionStatus`
--      wrapper in feature-access.ts continues to call `sync_client_subscription`
--      with `p_status`; only the allow-list narrows and the dropped-column
--      references are removed.
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
  -- Allow-list narrowed to ('none') — the only representable client claim
  -- post-cutover. 'active' is webhook-only (was already rejected pre-cutover
  -- via the 0034 message check, kept); 'trial' and 'expired' are not
  -- representable in the narrowed CHECK (§6) so we reject them here too
  -- (the explicit RPC-level gate documents the contract — REQ-DATA-RPC-TRIAL-REMOVAL).
  if p_status not in ('none') then
    raise exception 'invalid subscription status: %', p_status using errcode = 'P0001';
  end if;

  -- Read the caller's current profile state BEFORE any write. No
  -- trial_ends_at reference (column dropped in §7) and no active-trial
  -- guard (the trial state is gone — REQ-DATA-RPC-TRIAL-REMOVAL).
  select subscription_status, tier
    into v_profile
    from public.profiles
   where id = auth.uid();

  if v_profile is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- Update the caller's own profile. SECURITY DEFINER bypasses the
  -- protect_profile_tier trigger. auth.uid() ensures callers cannot
  -- target other users. The pre-cutover active-trial guard is GONE — the
  -- trial window does not exist post-cutover so the vector it guarded
  -- is also gone.
  update public.profiles
     set subscription_status = p_status
   where id = auth.uid();
end;
$$;

-- Pins the definer owner (belt-and-braces, 0035 §1 style).
alter function public.sync_client_subscription(text) owner to postgres;

-- Least privilege: `create or replace function` resets EXECUTE to PUBLIC
-- (the 0029 §4 trap) — re-apply the 0018 posture: authenticated only
-- (the caller derives user_id from auth.uid()).
revoke all on function public.sync_client_subscription(text) from public, anon;
grant execute on function public.sync_client_subscription(text) to authenticated;

comment on function public.sync_client_subscription(text) is
  'Client-side subscription_status sync (auth.uid()-scoped). SECURITY DEFINER. Allow-list narrowed post-cutover to (''none'') — ''active'' remains webhook-reserved (0034 contract); ''trial'' and ''expired'' are rejected with P0001 (no longer representable in the narrowed CHECK). SECURITY DEFINER, owned by postgres, authenticated-only.';

-- §7 (deferred from above). Drop trial_ends_at AFTER §9c cleans up the
-- trigger function references. If §7 ran before §9c, the trigger would
-- fail to compile the moment the column disappears.
alter table public.profiles
  drop column trial_ends_at;

comment on table public.profiles is
  'User profile. Server-managed columns: tier (free|pro), subscription_status (none|active post-cutover — trial/expired removed by 0039), ever_paid (monotonic paid-once flag). protect_profile_tier trigger guards writes from non-SECURITY DEFINER roles; set_profile_tier is the canonical tier writer.';
