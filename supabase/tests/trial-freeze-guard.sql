-- ============================================================================
-- Ticketify — trial-freeze-guard SQL smoke test (migration 0035)
--
-- A fail-closed schema + behavior smoke test for the trial-freeze security
-- fix (0035). It runs against a SCRATCH database (e.g. `supabase db reset`
-- output or a CI-local Postgres) -- never against production. It does NOT
-- apply migrations; it seeds a minimal fixture and exercises the two fixed
-- RPCs as the app surfaces them:
--
--   1. Catalog: `sync_client_subscription(text)` and
--      `expire_overdue_trials()` exist, are SECURITY DEFINER, owned by
--      postgres, anon/public have NO EXECUTE, authenticated has it (least
--      privilege, 0031 §3 style).
--   2. Guard A -- sync_client_subscription: a profile in an ACTIVE trial
--      (subscription_status='trial', trial_ends_at in the future,
--      tier='pro') cannot move off 'trial'. Claims of 'none' and 'expired'
--      are REJECTED with 'cannot change subscription status during active
--      trial' and mutate nothing; self-claiming 'trial' stays allowed
--      (harmless no-op). The expiry materializer is the single authority
--      for trial to 'expired'.
--   3. Guard A no-regression: a user NOT in a trial (no trial_ends_at) can
--      still claim 'none'/'expired' freely -- the free lifecycle is
--      preserved, and tier/trial_ends_at are never touched.
--   4. Guard B -- expire_overdue_trials is status-INDEPENDENT: a row frozen
--      before the fix (subscription_status='none', tier='pro',
--      trial_ends_at in the PAST) is healed to expired/free; a normal
--      overdue trial (status='trial') still expires (0020 behavior kept).
--   5. Guard B cannot downgrade a REAL paid subscriber: a profile with
--      status='active', tier='pro', ever_paid=true and a stale PAST
--      trial_ends_at survives expire_overdue_trials untouched.
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as
-- household-totals.sql / household-gate-tier.sql -- `supabase db query
-- --local --file` prepares the file as one statement). A failing `assert`
-- aborts the block and fails the query (exit != 0).
--
-- Fixture notes: none of the seeded rows exist in the fresh chain
-- (0001-0035 seeds no auth.users/profiles), and every insert is idempotent
-- (`on conflict (...) do nothing` with fixed UUIDs), so the file is safe
-- to re-run. Test identities use the e0000000-...-f* range, disjoint from
-- the other smoke tests (...-e1/e2/e3 in household-gate-tier.sql). Inserts run
-- as postgres (the `supabase db query` session role), which the
-- protect_profile_tier trigger sanctions (current_user='postgres').
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, never collide with real rows or
  -- the other smoke tests).
  v_user_trial  uuid := 'e0000000-0000-0000-0000-0000000000f1'; -- active trial (guard A targets)
  v_user_free   uuid := 'e0000000-0000-0000-0000-0000000000f2'; -- no trial (guard A no-regression)
  v_user_frozen uuid := 'e0000000-0000-0000-0000-0000000000f3'; -- pre-fix frozen row (guard B heals)
  v_user_paid   uuid := 'e0000000-0000-0000-0000-0000000000f4'; -- real payer, stale past trial_ends_at (B must NOT downgrade)
  v_user_due    uuid := 'e0000000-0000-0000-0000-0000000000f5'; -- normal overdue trial, status='trial' (0020 behavior kept)

  -- §1 catalog vars.
  v_scs_secdef boolean;
  v_scs_owner  text;
  v_eot_secdef boolean;
  v_eot_owner  text;

  -- §3/§4 behavior vars.
  v_status      text;
  v_tier        text;
  v_trial_ends  timestamptz;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog -- migration 0035 contract
  -- -------------------------------------------------------------------------
  assert to_regprocedure('public.sync_client_subscription(text)') is not null,
    'sync_client_subscription(text) is missing (expected since 0018)';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_scs_secdef, v_scs_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sync_client_subscription'
     and p.pronargs = 1;

  assert v_scs_secdef, 'sync_client_subscription must be SECURITY DEFINER (0018 + 0035)';
  assert v_scs_owner = 'postgres', 'sync_client_subscription must be owned by postgres';

  assert to_regprocedure('public.expire_overdue_trials()') is not null,
    'expire_overdue_trials() is missing (expected since 0020)';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_eot_secdef, v_eot_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'expire_overdue_trials'
     and p.pronargs = 0;

  assert v_eot_secdef, 'expire_overdue_trials must be SECURITY DEFINER (0020 + 0035)';
  assert v_eot_owner = 'postgres', 'expire_overdue_trials must be owned by postgres';

  -- Least privilege (0031 §3): create-or-replace resets EXECUTE to PUBLIC --
  -- anon must NOT be able to execute either definer RPC.
  assert not has_function_privilege('anon', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'anon must NOT be able to execute sync_client_subscription (least privilege)';
  assert not has_function_privilege('public', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'public must NOT be able to execute sync_client_subscription (least privilege)';
  assert has_function_privilege('authenticated', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'authenticated must be able to execute sync_client_subscription';

  assert not has_function_privilege('anon', 'public.expire_overdue_trials()', 'EXECUTE'),
    'anon must NOT be able to execute expire_overdue_trials (least privilege)';
  assert not has_function_privilege('public', 'public.expire_overdue_trials()', 'EXECUTE'),
    'public must NOT be able to execute expire_overdue_trials (least privilege)';
  assert has_function_privilege('authenticated', 'public.expire_overdue_trials()', 'EXECUTE'),
    'authenticated must be able to execute expire_overdue_trials';

  -- -------------------------------------------------------------------------
  -- 2. Fixture -- active-trialing, free, frozen, paid, and overdue identities
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_trial,  'authenticated', 'authenticated', 'freeze-trial@test.local',  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_free,   'authenticated', 'authenticated', 'freeze-free@test.local',   '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_frozen, 'authenticated', 'authenticated', 'freeze-frozen@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_paid,   'authenticated', 'authenticated', 'freeze-paid@test.local',   '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_due,    'authenticated', 'authenticated', 'freeze-due@test.local',    '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  -- The active trial state start_free_trial produces (0016 §2 / 0021 §5).
  insert into public.profiles (id, full_name, monthly_budget, currency, tier, subscription_status, created_at)
  values
    (v_user_trial,  'Active Trial User', 0, 'USD', 'pro',  'trial',  now()),
    (v_user_free,   'Free User',         0, 'USD', 'free', 'none',   now()),
    (v_user_frozen, 'Frozen User',       0, 'USD', 'pro',  'none',   now()),
    -- Real paid subscriber: webhook-asserted active + ever_paid (0021).
    (v_user_paid,   'Paid User',         0, 'USD', 'pro',  'active', now()),
    (v_user_due,    'Overdue Trial User', 0, 'USD', 'pro', 'trial',  now())
  on conflict (id) do nothing;

  -- v_user_trial: in-window trial (5 days out -- same as start_free_trial).
  update public.profiles
     set trial_ends_at = now() + interval '5 days'
   where id = v_user_trial;

  -- v_user_frozen: the pre-fix corruption -- a client claimed 'none' during
  -- the trial (the 0035 vector) and the materializer never ran: status
  -- left 'trial', tier stayed 'pro', trial_ends_at now in the PAST.
  update public.profiles
     set trial_ends_at = now() - interval '2 days'
   where id = v_user_frozen;

  -- v_user_paid: REAL payer carrying a stale PAST trial_ends_at (e.g. a
  -- RevenueCat-synced timestamp on the trial to 'active' transition). Guard
  -- B must NEVER downgrade this row.
  update public.profiles
     set trial_ends_at = now() - interval '2 days',
         ever_paid = true
   where id = v_user_paid;

  -- v_user_due: a normal overdue trial still marked 'trial' -- the classic
  -- 0020 case, must keep expiring (no regression from the 0035 rewrite).
  update public.profiles
     set trial_ends_at = now() - interval '2 days'
   where id = v_user_due;

  -- -------------------------------------------------------------------------
  -- 3. Guard A -- sync_client_subscription during an ACTIVE trial
  --    (simulated via the Supabase JWT claim GUC, household-totals
  --    convention: set_config('request.jwt.claims', ...) feeds auth.uid()).
  -- -------------------------------------------------------------------------

  -- 3a. Claiming 'none' off an active trial is REJECTED with the exact
  --     message -- a bare swallowed exception (e.g. RLS 42501) must not pass.
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000f1"}', true);

  begin
    perform public.sync_client_subscription('none');
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      assert sqlerrm = 'cannot change subscription status during active trial',
        'active-trialing user claiming none must be rejected, got: ' || sqlerrm;
  end;

  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_trial;
  assert v_status = 'trial', 'rejected none claim must not change subscription_status';
  assert v_tier = 'pro', 'rejected none claim must not change tier';
  assert v_trial_ends is not null, 'rejected none claim must not clear trial_ends_at';

  -- 3b. Claiming 'expired' off an active trial is REJECTED too -- only the
  --     materializer (expire_overdue_trials) transitions trial to 'expired'.
  begin
    perform public.sync_client_subscription('expired');
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      assert sqlerrm = 'cannot change subscription status during active trial',
        'active-trialing user claiming expired must be rejected, got: ' || sqlerrm;
  end;

  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_trial;
  assert v_status = 'trial', 'rejected expired claim must not change subscription_status';
  assert v_tier = 'pro', 'rejected expired claim must not change tier';
  assert v_trial_ends is not null, 'rejected expired claim must not clear trial_ends_at';

  -- 3c. Self-claiming 'trial' while in a trial stays ALLOWED (harmless
  --     no-op -- the row is already in that state).
  perform public.sync_client_subscription('trial');

  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_trial;
  assert v_status = 'trial', 'self-claiming trial must leave subscription_status as trial';
  assert v_tier = 'pro', 'self-claiming trial must not change tier';
  assert v_trial_ends is not null, 'self-claiming trial must not clear trial_ends_at';

  -- 3d. NO-regression: a user NOT in a trial (no trial_ends_at) can still
  --     claim 'none' and 'expired' freely -- the free lifecycle is intact,
  --     and neither claim touches tier or trial_ends_at.
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000f2"}', true);

  perform public.sync_client_subscription('none');
  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_free;
  assert v_status = 'none', 'non-trial user claiming none must set subscription_status';
  assert v_tier = 'free', 'non-trial user claiming none must not change tier';
  assert v_trial_ends is null, 'sync_client_subscription must never write trial_ends_at';

  perform public.sync_client_subscription('expired');
  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_free;
  assert v_status = 'expired', 'non-trial user claiming expired must set subscription_status';
  assert v_tier = 'free', 'non-trial user claiming expired must not change tier';
  assert v_trial_ends is null, 'non-trial expired claim must not write trial_ends_at';

  -- -------------------------------------------------------------------------
  -- 4. Guard B -- expire_overdue_trials is status-independent (0035 §2)
  -- -------------------------------------------------------------------------

  -- Run the materializer ONCE; all §4/§5 assertions check the outcome for
  -- each seeded identity.
  perform public.expire_overdue_trials();

  -- 4a. The pre-fix FROZEN row (status='none', tier='pro', past
  --     trial_ends_at) self-heals: expired + free + window cleared.
  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_frozen;
  assert v_status = 'expired', 'frozen row must be materialized to expired';
  assert v_tier = 'free', 'frozen row must be downgraded to free';
  assert v_trial_ends is null, 'frozen row must have trial_ends_at cleared';

  -- 4b. The classic overdue trial (status='trial') still expires -- the
  --     0020 transition is preserved under the 0035 rewrite.
  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_due;
  assert v_status = 'expired', 'overdue trial row must still materialize to expired';
  assert v_tier = 'free', 'overdue trial row must still be downgraded to free';
  assert v_trial_ends is null, 'overdue trial row must have trial_ends_at cleared';

  -- -------------------------------------------------------------------------
  -- 5. Guard B never downgrades a REAL paid subscriber
  -- -------------------------------------------------------------------------
  select subscription_status, tier, trial_ends_at
    into v_status, v_tier, v_trial_ends
    from public.profiles where id = v_user_paid;
  assert v_status = 'active', 'expire_overdue_trials must not touch a real paid subscriber (status)';
  assert v_tier = 'pro', 'expire_overdue_trials must not downgrade a real paid subscriber (tier)';
  assert v_trial_ends is not null, 'paid subscriber stale trial_ends_at must be left untouched';

  -- The still-in-window trial user is untouched too (not overdue): the
  -- materializer must not expire an active trial.
  select subscription_status, tier
    into v_status, v_tier
    from public.profiles where id = v_user_trial;
  assert v_status = 'trial', 'in-window trial must not be expired by the materializer';
  assert v_tier = 'pro', 'in-window trial must keep pro tier';

  -- -------------------------------------------------------------------------
  -- Summary -- only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'trial-freeze-guard.sql smoke: active-trial claim guard + status-independent expiry + paid-subscriber protection passed';
end $$;