-- ============================================================================
-- Ticketify — household-gate-tier SQL smoke test (migration 0034, post-cutover
-- for 0039 revenuecat-trial-migration slice A).
--
-- A fail-closed schema + behavior smoke test for the household gate security
-- fix (0034). It runs against a SCRATCH database (e.g. `supabase db reset`
-- output or a CI-local Postgres) — never against production. It does NOT
-- apply migrations; it seeds a minimal fixture and exercises the two fixed
-- RPCs as the app surfaces them:
--
--   1. Catalog: `create_household(text)` and `sync_client_subscription(text)`
--      exist, are SECURITY DEFINER, owned by postgres, anon/public have NO
--      EXECUTE, authenticated has it (least privilege, 0031 §3 style).
--   2. create_household gate (the integrity hole): a free user whose
--      subscription_status was spoofed to 'active' (the old exploit path via
--      sync_client_subscription) is REJECTED — tier is the only gate.
--   3. create_household still works for a Pro user — tier='pro' is the
--      sole authority on create_household. Post-cutover (0039) there is
--      no distinct 'trial' subscription state; a Pro user is a Pro user
--      regardless of how the entitlement was obtained (the previous
--      trial-regression check is gone with the trial surface).
--   4. sync_client_subscription no longer accepts 'active' — the claim is
--      reserved for the RevenueCat webhook (sync_subscription_status,
--      service-role). Rejected calls do NOT mutate subscription_status.
--   5. The remaining client-claimable value ('none' only — post-cutover
--      'trial' and 'expired' are no longer representable per 0039 §5/§6)
--      is accepted but NEVER changes tier — it cannot grant Pro capability.
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as
-- household-totals.sql — `supabase db query --local --file` prepares the file
-- as one statement). A failing `assert` aborts the block and fails the query
-- (exit != 0).
--
-- Fixture notes: none of the seeded rows exist in the fresh chain (0001-0039
-- seeds no auth.users/profiles), and every insert is idempotent
-- (`on conflict (...) do nothing` with fixed UUIDs), so the file is safe
-- to re-run. `auth.users` inserts use the common minimal column set; a future
-- GoTrue schema drift fails loudly here (fail-closed is intended).
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, never collide with real rows).
  -- The v_user_trial identity from the pre-0039 version was REMOVED — there
  -- is no trialing subscription_status post-cutover (0039 §5/§6). The
  -- trial-regression assertion in §3c is gone with it; §3b covers the
  -- Pro-tier create_household contract that the trial case used to exercise.
  v_user_free  uuid := 'e0000000-0000-0000-0000-0000000000e1';
  v_user_pro   uuid := 'e0000000-0000-0000-0000-0000000000e2';

  -- §1 catalog vars.
  v_ch_secdef  boolean;
  v_ch_owner   text;
  v_scs_secdef boolean;
  v_scs_owner  text;

  -- §3 behavior vars.
  v_created_hid uuid;
  v_spoofed_hh  int;
  v_pro_hh      int;
  v_pro_members int;
  v_pro_hid     uuid;
  v_status      text;
  v_tier        text;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog — migration 0034 contract
  -- -------------------------------------------------------------------------
  assert to_regprocedure('public.create_household(text)') is not null,
    'create_household(text) is missing (expected since 0014/0017/0025)';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_ch_secdef, v_ch_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'create_household'
     and p.pronargs = 1;

  assert v_ch_secdef, 'create_household must be SECURITY DEFINER (0025 + 0034)';
  assert v_ch_owner = 'postgres', 'create_household must be owned by postgres';

  assert to_regprocedure('public.sync_client_subscription(text)') is not null,
    'sync_client_subscription(text) is missing (expected since 0018)';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_scs_secdef, v_scs_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sync_client_subscription'
     and p.pronargs = 1;

  assert v_scs_secdef, 'sync_client_subscription must be SECURITY DEFINER (0018 + 0034)';
  assert v_scs_owner = 'postgres', 'sync_client_subscription must be owned by postgres';

  -- Least privilege (0031 §3): create-or-replace resets EXECUTE to PUBLIC —
  -- anon must NOT be able to execute either definer RPC.
  assert not has_function_privilege('anon', 'public.create_household(text)', 'EXECUTE'),
    'anon must NOT be able to execute create_household (least privilege)';
  assert not has_function_privilege('public', 'public.create_household(text)', 'EXECUTE'),
    'public must NOT be able to execute create_household (least privilege)';
  assert has_function_privilege('authenticated', 'public.create_household(text)', 'EXECUTE'),
    'authenticated must be able to execute create_household';

  assert not has_function_privilege('anon', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'anon must NOT be able to execute sync_client_subscription (least privilege)';
  assert not has_function_privilege('public', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'public must NOT be able to execute sync_client_subscription (least privilege)';
  assert has_function_privilege('authenticated', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'authenticated must be able to execute sync_client_subscription';

  -- -------------------------------------------------------------------------
  -- 2. Fixture — free/spoofed and Pro identities (post-cutover 0039: no
  --    distinct trial identity — there is no 'trial' subscription_status).
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_free,  'authenticated', 'authenticated', 'gate-free@test.local',  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_pro,   'authenticated', 'authenticated', 'gate-pro@test.local',   '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  -- The spoof state from the adversarial finding: tier='free' but
  -- subscription_status='active' (achievable pre-0034 via
  -- sync_client_subscription('active') — a client-asserted claim with no
  -- server verification). Post-0034 this state must be powerless.
  insert into public.profiles (id, full_name, monthly_budget, currency, tier, subscription_status, created_at)
  values
    (v_user_free,  'Free Spoofed User', 0, 'USD', 'free', 'active', now()),
    (v_user_pro,   'Pro User',          0, 'USD', 'pro',  'active', now())
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- 3. Behavior — simulated via the Supabase JWT claim GUC (household-totals
  --    convention: set_config('request.jwt.claims', ...) feeds auth.uid()).
  -- -------------------------------------------------------------------------

  -- 3a. Free user with spoofed 'active' status CANNOT create a household.
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000e1"}', true);

  begin
    perform public.create_household('Spoofed Household');
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      assert sqlerrm = 'Pro subscription required to create a household',
        'free/spoofed user must hit the tier gate, got: ' || sqlerrm;
  end;

  -- Nothing was written: no household row, household_id still null.
  select count(*) into v_spoofed_hh
    from public.households where created_by = v_user_free;
  assert v_spoofed_hh = 0, 'rejected create_household must not leave a household row';

  select household_id into v_pro_hid from public.profiles where id = v_user_free;
  assert v_pro_hid is null, 'rejected create_household must not set profiles.household_id';

  -- 3b. A Pro user CAN create a household (gate passes on tier='pro').
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000e2"}', true);

  select public.create_household('Pro Household') into v_created_hid;
  assert v_created_hid is not null, 'pro create_household must return a household id';

  select count(*) into v_pro_hh
    from public.households
   where id = v_created_hid and created_by = v_user_pro and name = 'Pro Household';
  assert v_pro_hh = 1, 'household row must exist owned by the pro caller';

  select count(*) into v_pro_members
    from public.household_members
   where household_id = v_created_hid and user_id = v_user_pro and role = 'owner';
  assert v_pro_members = 1, 'pro caller must be the household owner member';

  select household_id into v_pro_hid from public.profiles where id = v_user_pro;
  assert v_pro_hid = v_created_hid, 'profiles.household_id must point at the created household';

  -- 3c. sync_client_subscription('active') is REJECTED for everyone — paid
  --     status is asserted only by the RevenueCat webhook. The expensive
  --     assertion is the message: a bare swallowed exception (e.g. a random
  --     RLS 42501) must NOT pass.
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000e1"}', true);

  begin
    perform public.sync_client_subscription('active');
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      assert sqlerrm = 'invalid subscription status: active',
        'free user claiming active must be rejected, got: ' || sqlerrm;
  end;

  -- The rejected claim must not have mutated anything.
  select subscription_status into v_status from public.profiles where id = v_user_free;
  assert v_status = 'active', 'rejected active claim must not mutate subscription_status';

  -- Same rejection for an actually-Pro user: no client can self-assert.
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000e2"}', true);

  begin
    perform public.sync_client_subscription('active');
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      assert sqlerrm = 'invalid subscription status: active',
        'pro user claiming active must be rejected, got: ' || sqlerrm;
  end;

  select subscription_status into v_status from public.profiles where id = v_user_pro;
  assert v_status = 'active', 'pro rejected active claim must not mutate subscription_status';

  -- 3e. Remaining client-claimable value ('none' — post-cutover 'trial'
  --     and 'expired' are no longer representable per 0039 §5/§6) is
  --     accepted but NEVER changes tier — it cannot grant Pro capability.
  perform set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000e1"}', true);

  perform public.sync_client_subscription('none');
  select subscription_status, tier into v_status, v_tier from public.profiles where id = v_user_free;
  assert v_status = 'none', 'claiming none must set subscription_status';
  assert v_tier = 'free', 'sync_client_subscription must never change tier';

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'household-gate-tier.sql smoke: tier-only gate + active-claim rejection + none-claim never changes tier + least-privilege assertions passed';
end $$;