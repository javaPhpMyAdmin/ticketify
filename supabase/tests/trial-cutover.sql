-- ============================================================================
-- Ticketify — trial-cutover SQL smoke test (migration 0039)
--
-- A fail-closed schema + behavior smoke test for the RevenueCat trial
-- cutover (SDD change `revenuecat-trial-migration`, slice A). It runs against
-- a SCRATCH database (e.g. `supabase db reset` output or a CI-local Postgres)
-- — never against production. It does NOT apply migrations; the catalog is
-- whatever 0001-0039 declare, then the file seeds a minimal fixture and
-- exercises the post-cutover contract end-to-end:
--
--   §1. Catalog — migration 0039 contract:
--        a) `profiles.trial_ends_at` is DROPPED (REQ-DATA-PROFILES-TRIAL-COLS)
--        b) `public.start_free_trial()` is DROPPED
--        c) `public.expire_overdue_trials()` is DROPPED
--        d) `cron.job` has NO row named `trial-expiry` (best-effort: the
--           pg_cron extension is platform-optional, so the assertion is
--           skipped — NOT failed — when the extension is not installed)
--   §2. CHECK — the narrowed `subscription_status` CHECK rejects every
--        value outside `('none','active')` with SQLSTATE 23514:
--        - 'trial'   → REJECTED (was allowed pre-cutover; REQ-DATA-PROFILES-TRIAL-COLS)
--        - 'frozen'  → REJECTED (forward-looking — was never allowed but
--                       the spec pins the contract)
--        - 'expired' → REJECTED (was allowed pre-cutover)
--        - 'none'    → ACCEPTED (sanity)
--        - 'active'  → ACCEPTED (sanity)
--   §3. RPC — `public.sync_subscription_status(uuid, text)` accepts only
--        `('none','active')` post-cutover (REQ-DATA-RPC-TRIAL-REMOVAL):
--        - 'trial'   → RAISES (was accepted pre-cutover)
--        - 'expired' → RAISES (was accepted pre-cutover)
--        - 'active'  → accepted and applied
--        - 'none'    → accepted and applied
--   §4. Backfill idempotency — the post-cutover `WHERE subscription_status
--        = 'trial'` clause matches ZERO rows on a re-run (the CHECK rejects
--        'trial', so no row can ever satisfy the WHERE — REQ-DATA-TRIAL-CUTOVER).
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as the
-- rest of supabase/tests/*.sql — `supabase db query --local --file` prepares
-- the file as one statement). A failing `assert` aborts the block and fails
-- the query (exit != 0).
--
-- Fixture notes: NONE of the seeded rows exist in the fresh chain
-- (0001-0039 seeds no auth.users/profiles rows with these fixed UUIDs), and
-- every insert is idempotent (`on conflict (...) do nothing` with fixed
-- UUIDs), so the file is safe to re-run. Inserts run as postgres (the
-- `supabase db query` session role), which the `protect_profile_tier`
-- trigger sanctions (current_user='postgres') — direct INSERT/UPDATE on
-- `profiles.subscription_status` exercises the CHECK constraint (23514)
-- without hitting the trigger's INSERT/UPDATE server-managed guards.
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, disjoint from the other smoke
  -- tests: da...-d* (delete-account), e0...-f* (trial-freeze-guard),
  -- da...-a*/b*/c* (delete-account sub-fixtures)).
  v_user_active  uuid := 'e0000000-0000-0000-0000-0000000000a1'; -- pre-cutover 'active' row (CHECK accept sanity + backfill target)
  v_user_none    uuid := 'e0000000-0000-0000-0000-0000000000a2'; -- pre-cutover 'none' row (CHECK accept sanity)
  v_user_trial   uuid := 'e0000000-0000-0000-0000-0000000000a3'; -- CHECK-rejection target (UPDATE → 'trial')
  v_user_frozen  uuid := 'e0000000-0000-0000-0000-0000000000a4'; -- CHECK-rejection target (UPDATE → 'frozen')
  v_user_expired uuid := 'e0000000-0000-0000-0000-0000000000a5'; -- CHECK-rejection target (UPDATE → 'expired')
  v_user_rpc     uuid := 'e0000000-0000-0000-0000-0000000000a6'; -- sync_subscription_status RPC gating target

  v_active_email  text := 'cutover-active@trial.test.local';
  v_none_email    text := 'cutover-none@trial.test.local';
  v_trial_email   text := 'cutover-trial@trial.test.local';
  v_frozen_email  text := 'cutover-frozen@trial.test.local';
  v_expired_email text := 'cutover-expired@trial.test.local';
  v_rpc_email     text := 'cutover-rpc@trial.test.local';

  -- Behavior vars.
  v_status   text;
  v_sqlstate text;
  v_errmsg   text;
  v_xcount   int;
begin
  -- -------------------------------------------------------------------------
  -- §1. Catalog — migration 0039 contract
  -- -------------------------------------------------------------------------

  -- §1a. trial_ends_at column is DROPPED.
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'trial_ends_at'
  ), 'profiles.trial_ends_at column must be DROPPED (REQ-DATA-PROFILES-TRIAL-COLS, 0039 §6)';

  -- §1b. start_free_trial() RPC is DROPPED.
  assert to_regprocedure('public.start_free_trial()') is null,
    'public.start_free_trial() must be DROPPED (REQ-DATA-RPC-TRIAL-REMOVAL, 0039 §4)';

  -- §1c. expire_overdue_trials() RPC is DROPPED.
  assert to_regprocedure('public.expire_overdue_trials()') is null,
    'public.expire_overdue_trials() must be DROPPED (REQ-DATA-RPC-TRIAL-REMOVAL, 0039 §5)';

  -- §1e. sync_subscription_status(uuid, text, timestamptz) 3-arg overload
  --      is DROPPED. Without this, the 2-arg version created in §9a coexists
  --      with the 3-arg version and a 2-arg call hits SQLSTATE 42725
  --      "function ... is not unique". The overload drop is the first line
  --      of §9a; this assertion pins it.
  assert to_regprocedure('public.sync_subscription_status(uuid, text, timestamptz)') is null,
    'sync_subscription_status(uuid, text, timestamptz) 3-arg overload must be DROPPED (0039 §9a — overload ambiguity trap, R3-2)';

  -- §1f. REVOKE enforcement on PUBLIC/anon/authenticated (R1-3 + R1-4).
  --      ADAPTATION NOTE: the review-fix R1-4 snippet used
  --      `perform public.start_free_trial()` to exercise the REVOKE
  --      pattern via `set role anon` + `when insufficient_privilege`.
  --      That snippet assumes the function EXISTS but with EXECUTE
  --      REVOKED — a transient state between §3 (REVOKE) and §4 (DROP)
  --      of the migration. Once the migration completes, §4 has dropped
  --      the function, so the snippet cannot run post-cutover
  --      (`perform start_free_trial()` would raise `function does not
  --      exist` SQLSTATE 42883, not `insufficient_privilege`).
  --
  --      The ONLY REVOKE that survives the migration is the
  --      REVOKE ALL on PUBLIC for `protect_profile_tier` (R1-3). The
  --      catalog-query form below pins that contract using the same
  --      `has_function_privilege` idiom the other smokes use
  --      (delete-account.sql §1, household-gate-tier.sql §1). Pre-cutover
  --      the trigger function has EXECUTE granted to PUBLIC (the
  --      0029 §4 trap), so this assertion is RED before the migration
  --      applies and GREEN after — the strict-TDD RED→GREEN signal
  --      for R1-3 + R1-4.
  assert not has_function_privilege('public', 'public.protect_profile_tier()', 'EXECUTE'),
    'public must NOT be able to execute protect_profile_tier (REVOKE ALL on PUBLIC, R1-3 + R1-4, 0029 §4 trap)';
  assert not has_function_privilege('anon', 'public.protect_profile_tier()', 'EXECUTE'),
    'anon must NOT be able to execute protect_profile_tier (REVOKE ALL on PUBLIC, R1-3 + R1-4)';
  assert not has_function_privilege('authenticated', 'public.protect_profile_tier()', 'EXECUTE'),
    'authenticated must NOT be able to execute protect_profile_tier (REVOKE ALL on PUBLIC, R1-3 + R1-4)';

  -- §1d. cron.job 'trial-expiry' entry is REMOVED (best-effort: the pg_cron
  -- extension is platform-optional, so the assertion is SKIPPED — not
  -- failed — when the extension is not installed on this stack).
  --
  -- The DO block protects against two failure modes that would mask the
  -- actual contract:
  --   - undefined_table:  cron extension not installed (e.g. a stripped stack)
  --   - insufficient_privilege: cron schema is private to the extension owner
  -- In both cases the RPC-drop assertions above are the authoritative
  -- contract (REQ-DATA-CRONS-TRIAL-REMOVAL is satisfied if the function is
  -- gone — the cron entry has no executable to call).
  begin
    assert not exists (
      select 1 from cron.job where jobname = 'trial-expiry'
    ), 'cron.job ''trial-expiry'' must be UNSCHEDULED (REQ-DATA-CRONS-TRIAL-REMOVAL, 0039 §8)';
  exception
    when undefined_table or insufficient_privilege then
      raise notice 'cron.job unavailable on this stack — skipping pg_cron assertion (RPC drop above is authoritative)';
  end;

  -- -------------------------------------------------------------------------
  -- §2. Fixtures — seed users + profiles (postgres bypasses
  --     protect_profile_tier; direct INSERT/UPDATE exercises CHECK 23514)
  -- -------------------------------------------------------------------------

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_active,  'authenticated', 'authenticated', v_active_email,  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_none,    'authenticated', 'authenticated', v_none_email,    '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_trial,   'authenticated', 'authenticated', v_trial_email,   '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_frozen,  'authenticated', 'authenticated', v_frozen_email,  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_expired, 'authenticated', 'authenticated', v_expired_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_rpc,     'authenticated', 'authenticated', v_rpc_email,     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, tier, subscription_status, created_at)
  values
    (v_user_active,  'Active User',  0, 'USD', 'pro',  'active', now()),
    (v_user_none,    'None User',    0, 'USD', 'free', 'none',   now()),
    (v_user_trial,   'Trial User',   0, 'USD', 'free', 'none',   now()),
    (v_user_frozen,  'Frozen User',  0, 'USD', 'free', 'none',   now()),
    (v_user_expired, 'Expired User', 0, 'USD', 'free', 'none',   now()),
    (v_user_rpc,     'RPC User',     0, 'USD', 'free', 'none',   now())
  on conflict (id) do nothing;

  -- Pre-condition: 'active' and 'none' rows seeded correctly.
  select subscription_status into v_status from public.profiles where id = v_user_active;
  assert v_status = 'active', 'pre-condition: active user must seed with subscription_status=active';
  select subscription_status into v_status from public.profiles where id = v_user_none;
  assert v_status = 'none', 'pre-condition: none user must seed with subscription_status=none';

  -- -------------------------------------------------------------------------
  -- §3. CHECK — narrowed subscription_status CHECK (0039 §5)
  -- -------------------------------------------------------------------------

  -- §3a. CHECK rejects 'trial' (was ALLOWED pre-cutover; the narrowed
  --      CHECK rejects with SQLSTATE 23514). This is the primary
  --      RED→GREEN signal: pre-cutover the UPDATE succeeds (no raise),
  --      post-cutover the UPDATE raises 23514.
  v_sqlstate := null;
  begin
    update public.profiles set subscription_status = 'trial' where id = v_user_trial;
  exception
    when check_violation then
      v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = '23514',
    format('CHECK must reject subscription_status=''trial'' (SQLSTATE 23514), got: %s',
      coalesce(v_sqlstate, 'no-raise'));

  -- §3b. CHECK rejects 'frozen' (was never allowed in any prior migration,
  --      but the spec pins the contract post-cutover).
  v_sqlstate := null;
  begin
    update public.profiles set subscription_status = 'frozen' where id = v_user_frozen;
  exception
    when check_violation then
      v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = '23514',
    format('CHECK must reject subscription_status=''frozen'' (SQLSTATE 23514), got: %s',
      coalesce(v_sqlstate, 'no-raise'));

  -- §3c. CHECK rejects 'expired' (was ALLOWED pre-cutover; the narrowed
  --      CHECK rejects with 23514 — same RED→GREEN signal as §3a).
  v_sqlstate := null;
  begin
    update public.profiles set subscription_status = 'expired' where id = v_user_expired;
  exception
    when check_violation then
      v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = '23514',
    format('CHECK must reject subscription_status=''expired'' (SQLSTATE 23514), got: %s',
      coalesce(v_sqlstate, 'no-raise'));

  -- §3d. CHECK accepts 'none' and 'active' (sanity — these are the only
  --      legal values post-cutover; an UPDATE that re-applies the same
  --      value must succeed).
  update public.profiles set subscription_status = 'none' where id = v_user_none;
  select subscription_status into v_status from public.profiles where id = v_user_none;
  assert v_status = 'none', 'CHECK must ACCEPT subscription_status=''none'' post-cutover';

  update public.profiles set subscription_status = 'active' where id = v_user_active;
  select subscription_status into v_status from public.profiles where id = v_user_active;
  assert v_status = 'active', 'CHECK must ACCEPT subscription_status=''active'' post-cutover';

  -- -------------------------------------------------------------------------
  -- §4. RPC — sync_subscription_status (0039 §9)
  --
  -- The RPC narrows its allow-list to ('none','active'). Pre-cutover the
  -- allow-list was ('none','trial','active','expired') — the §4a/§4b
  -- assertions are the primary RED→GREEN signal for the RPC rewrite.
  --
  -- The smoke runs as postgres (superuser); the RPC body validates the
  -- status value BEFORE touching profiles, so the exception is raised
  -- cleanly (the SECURITY DEFINER + auth.uid() scoping is bypassed by the
  -- superuser session but the validation runs first).
  -- -------------------------------------------------------------------------

  -- §4a. sync_subscription_status('trial') RAISES post-cutover (was a no-op
  --      success pre-cutover — primary RED→GREEN signal for §9 of 0039).
  --      Tightened (R3-3): the assertion pins the exact SQLSTATE P0001
  --      that the §9a-narrowed RPC raises (errcode = 'P0001' in the
  --      validation branch). A bare 'any exception' check could pass on
  --      SQLSTATE 23514 (CHECK violation, which would mean the allow-list
  --      was somehow bypassed) — that's a regression, not a pass.
  v_sqlstate := null;
  v_errmsg   := null;
  begin
    perform public.sync_subscription_status(v_user_rpc, 'trial');
  exception
    when others then
      v_sqlstate := sqlstate;
      v_errmsg   := sqlerrm;
  end;
  assert v_sqlstate = 'P0001',
    format('sync_subscription_status(''trial'') must RAISE P0001 (RPC allow-list), got: %s',
      coalesce(v_sqlstate, 'null'));

  -- §4b. sync_subscription_status('expired') RAISES post-cutover (was
  --      accepted pre-cutover). Same R3-3 P0001 pin.
  v_sqlstate := null;
  v_errmsg   := null;
  begin
    perform public.sync_subscription_status(v_user_rpc, 'expired');
  exception
    when others then
      v_sqlstate := sqlstate;
      v_errmsg   := sqlerrm;
  end;
  assert v_sqlstate = 'P0001',
    format('sync_subscription_status(''expired'') must RAISE P0001 (RPC allow-list), got: %s',
      coalesce(v_sqlstate, 'null'));

  -- §4c. sync_subscription_status('active') accepted and applied (sanity).
  perform public.sync_subscription_status(v_user_rpc, 'active');
  select subscription_status into v_status from public.profiles where id = v_user_rpc;
  assert v_status = 'active', 'sync_subscription_status(''active'') must APPLY post-cutover';

  -- §4d. sync_subscription_status('none') accepted and applied (sanity).
  perform public.sync_subscription_status(v_user_rpc, 'none');
  select subscription_status into v_status from public.profiles where id = v_user_rpc;
  assert v_status = 'none', 'sync_subscription_status(''none'') must APPLY post-cutover';

  -- §4e. sync_client_subscription('trial') RAISES post-cutover. The
  --      §9d-narrowed allow-list is `('none')`; 'trial' is no longer
  --      representable in the narrowed CHECK (§6) so the RPC-level gate
  --      rejects it explicitly with P0001 (REQ-DATA-RPC-TRIAL-REMOVAL).
  --      Pin: the RPC body raises P0001 (errcode = 'P0001' in the
  --      validation branch), not 23514 (CHECK) — the RPC validates
  --      BEFORE the UPDATE runs.
  v_sqlstate := null;
  begin
    perform public.sync_client_subscription('trial');
  exception
    when others then
      v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = 'P0001',
    format('sync_client_subscription(''trial'') must RAISE P0001 (§9d allow-list narrowing), got: %s',
      coalesce(v_sqlstate, 'null'));

  -- §4f. sync_client_subscription('expired') RAISES post-cutover. Same
  --      P0001 pin as §4e — the allow-list is `('none')`, so 'expired'
  --      is rejected at the RPC validation gate.
  v_sqlstate := null;
  begin
    perform public.sync_client_subscription('expired');
  exception
    when others then
      v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = 'P0001',
    format('sync_client_subscription(''expired'') must RAISE P0001 (§9d allow-list narrowing), got: %s',
      coalesce(v_sqlstate, 'null'));

  -- -------------------------------------------------------------------------
  -- §5. Backfill idempotency (REQ-DATA-TRIAL-CUTOVER) — the post-cutover
  --     state means the step-1 WHERE `subscription_status = 'trial'` is
  --     unsatisfiable on a re-run: no row can ever match because the CHECK
  --     rejects 'trial' as a value. The CTE captures the UPDATE's row count
  --     so we can assert it directly.
  --
  --     Note: this uses the post-cutover schema (no trial_ends_at reference
  --     — the column is gone). The original step-1 UPDATE included
  --     `trial_ends_at > now()` in the WHERE; the post-cutover WHERE drops
  --     that predicate because the column is gone and the CHECK alone is
  --     sufficient to prove idempotency.
  -- -------------------------------------------------------------------------
  with backfill as (
    update public.profiles
       set subscription_status = 'active',
           tier                = 'pro'
     where subscription_status = 'trial'
     returning 1
  )
  select count(*) into v_xcount from backfill;

  assert v_xcount = 0,
    format('backfill-equivalent UPDATE must match ZERO rows post-cutover (idempotency), got: %s', v_xcount);

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'trial-cutover.sql smoke: column drop + RPC drops + cron unschedule + narrowed CHECK (23514 on trial/frozen/expired) + RPC allow-list narrow (rejects trial/expired) + backfill idempotency all passed';
end $$;
