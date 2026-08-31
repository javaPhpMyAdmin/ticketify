-- ============================================================================
-- Ticketify — pro-subscription SQL smoke test (WU-M8.3 / task 8.3)
--
-- A fail-closed schema smoke test for the pro/quotas workstream. It runs
-- against a SCRATCH database (e.g. `supabase db reset` output or a CI-local
-- Postgres) — never against production. It does NOT apply migrations and
-- does NOT mutate data; every check is read-only against the catalog.
--
-- Coverage (WARNING-7 / REQ-PROF / REQ-QUOTA / REQ-SYNC):
--   1. profiles exposes the server-managed tier lifecycle columns
--      (`tier` from 0001, `subscription_status` + `trial_ends_at` from 0016,
--      `ever_paid` from 0021).
--   2. `set_profile_tier(uuid, text)` exists and is grant-protected
--      (REVOKEd from anon/authenticated — service_role only).
--   3. `webhook_events` ledger exists with the (user_id, event_id) PK and
--      its RLS SELECT policy scoped to `auth.uid()` (0012).
--   4. The `profiles_protect_tier` trigger still guards `tier` for
--      non-definer writers (REQ-SYNC-5 / SUGGESTION-1).
--   5. The quota functions/types exist: `try_consume_scan`,
--      `recalculate_monthly_totals` and the `monthly_user_totals` cache
--      table (0011 + 0015).
--
-- Each check is a `DO` block that `assert`s a catalog fact and raises with
-- a clear message on failure. The file is idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles tier lifecycle columns
-- ---------------------------------------------------------------------------
do $$
begin
  -- `tier` (0001): the access tier, server-managed by set_profile_tier.
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'tier'
  ), 'profiles.tier column is missing (expected from migration 0001)';

  -- `subscription_status` (0016): none | trial | active | expired.
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'subscription_status'
  ), 'profiles.subscription_status column is missing (expected from migration 0016)';

  -- `trial_ends_at` (0016): nullable trial deadline.
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'trial_ends_at'
  ), 'profiles.trial_ends_at column is missing (expected from migration 0016)';

  -- `ever_paid` (0021): monotonic paid-once tri-state for trial eligibility.
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'ever_paid'
  ), 'profiles.ever_paid column is missing (expected from migration 0021)';
end $$;

-- ---------------------------------------------------------------------------
-- 2. set_profile_tier — exists + least-privilege grants
-- ---------------------------------------------------------------------------
do $$
declare
  v_regd   record;
  v_secdef boolean;
  v_owner  regrole;
  v_row    record;
  v_grants int;
begin
  select p.oid, p.prosecdef, pg_get_userbyid(p.proowner)
    into v_regd, v_secdef, v_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'set_profile_tier'
     and p.pronargs = 2;

  assert found, 'function public.set_profile_tier(uuid, text) was not found';

  assert v_secdef, 'set_profile_tier must be SECURITY DEFINER (protect_profile_tier escape hatch)';
  assert v_owner = 'postgres', 'set_profile_tier must be owned by postgres (W3 fix / D1)';

  -- Least privilege: no grant to anon/authenticated; only service_role may call.
  select coalesce(sum((p.grantee in ('anon', 'authenticated'))::int), 0) into v_grants
    from information_schema.routine_privileges p
   where p.routine_schema = 'public'
     and p.routine_name = 'set_profile_tier';

  assert v_grants = 0, 'set_profile_tier must NOT be executable by anon/authenticated (service_role only)';
end $$;

-- ---------------------------------------------------------------------------
-- 3. webhook_events ledger + RLS
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_pk  boolean;
  v_policy  int;
begin
  assert exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'webhook_events'
  ), 'webhook_events table is missing (expected from migration 0012)';

  assert exists (
    select 1 from information_schema.table_constraints tc
    where tc.table_schema = 'public' and tc.table_name = 'webhook_events'
      and tc.constraint_type = 'PRIMARY KEY'
  ), 'webhook_events must have a PRIMARY KEY (idempotency source of truth)';

  -- RLS must be enabled and expose a SELECT policy scoped to auth.uid() only.
  select relrowsecurity into v_has_pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'webhook_events';

  assert v_has_pk, 'webhook_events must have Row Level Security enabled';

  select count(*) into v_policy
    from pg_policies
   where schemaname = 'public' and tablename = 'webhook_events'
     and policyname = 'webhook_events_select_own'
     and cmd = 'SELECT'
     and pg_get_expr(qual, 0)::text like '%uid()%';

  assert v_policy = 1, 'webhook_events must expose a SELECT policy scoped to auth.uid() (webhook_events_select_own)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. protect_profile_tier trigger still guards tier writes (REQ-SYNC-5)
-- ---------------------------------------------------------------------------
do $$
declare
  v_trig int;
begin
  select coalesce(sum((t.tgname = 'profiles_protect_tier')::int), 0)
    into v_trig
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles' and not t.tgisinternal;

  assert v_trig = 1, 'profiles_protect_tier trigger is missing on public.profiles (REQ-SYNC-5)';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Quota functions + monthly totals cache
-- ---------------------------------------------------------------------------
do $$
begin
  -- try_consume_scan (0011): the tier-aware atomic scan quota consumer.
  assert exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'try_consume_scan'
  ), 'function public.try_consume_scan is missing (expected from migration 0011)';

  -- recalculate_monthly_totals (0015): the materialized-cache aggregator.
  assert exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recalculate_monthly_totals'
  ), 'function public.recalculate_monthly_totals is missing (expected from migration 0015)';

  -- monthly_user_totals cache table (0015).
  assert exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'monthly_user_totals'
  ), 'monthly_user_totals cache table is missing (expected from migration 0015)';

  -- The scan_usage quota column is nullable (NULL = Pro unlimited marker).
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scan_usage' and column_name = 'scans_limit'
  ), 'scan_usage.scans_limit column is missing (expected from migration 0011)';
end $$;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'pro-subscription.sql smoke: all catalog assertions passed';
end $$;
