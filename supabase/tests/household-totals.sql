-- ============================================================================
-- Ticketify — household-totals consistency SQL smoke test (migration 0031)
--
-- A fail-closed schema + behavior smoke test for the household totals
-- consistency change. It runs against a SCRATCH database (e.g. `supabase db
-- reset` output or a CI-local Postgres) — never against production. It does
-- NOT apply migrations; it seeds a minimal fixture and runs the two RPCs the
-- app surfaces, asserting the confirmed-only + net-paid contract:
--
--   1. Catalog: `monthly_category_totals(text, uuid)` exists with SECURITY
--      DEFINER, owner postgres, a 7-column return, NO single-arg overload
--      (the anon-trap §0029/0031), anon has no EXECUTE, authenticated has it.
--   2. Behavior (as a household member): non-confirmed receipts are excluded
--      from `monthly_category_totals`; the net headline
--      (`monthly_purchases_total`) equals Σ confirmed `purchases.total` on a
--      discounted receipt (final paid, not gross); Personal == Household to
--      the cent for a single-contributor month; per-category rows stay gross
--      line-item sums (discounts are not attributed per category — 0029 §3).
--   3. Non-member: zero rows (not an error).
--   4. Anon: EXECUTE denied (insufficient_privilege).
--
-- Structure: the whole file is a SINGLE `DO` block (the same constraint as
-- pro-subscription.sql — `supabase db query --local --file` prepares the
-- file as one statement). Failing `assert` aborts the block and fails the
-- query (exit != 0).
--
-- Fixture notes: NONE of the seeded rows exist in the fresh chain
-- (0001-0031 seeds no auth.users/profiles/households), and every insert is
-- idempotent (`on conflict (...) do nothing` with fixed UUIDs), so the file
-- is safe to re-run. `auth.users` inserts use the common minimal column set;
-- a future GoTrue schema drift fails loudly here (fail-closed is intended).
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, never collide with real rows).
  v_user_a      uuid := 'a0000000-0000-0000-0000-00000000000a';
  v_user_b      uuid := 'b0000000-0000-0000-0000-00000000000b';
  v_stranger    uuid := 'f0000000-0000-0000-0000-00000000000f';
  v_hid         uuid := 'h0000000-0000-0000-0000-00000000000h';
  v_store       uuid := 'c0000000-0000-0000-0000-0000000000aa';

  -- §1 catalog vars.
  v_secdef      boolean;
  v_owner       text;
  v_cols        int;

  -- §2 fixture + behavior vars.
  v_cat_lacteos   uuid;
  v_cat_panaderia uuid;
  v_total_net     numeric;
  v_total_personal numeric;
  v_cat_gross     numeric;
  v_cat_items     bigint;
  v_cat_rows      int;
  v_lacteos_total numeric;
  v_nonmember_rows int;
  v_nonmember_total numeric;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog — migration 0031 contract
  -- -------------------------------------------------------------------------
  -- The (text, uuid) signature must exist and no stray single-arg overload
  -- may (a single-arg variant would make 0031 CREATE a NEW function with
  -- fresh PUBLIC EXECUTE — the anon-trap).
  assert to_regprocedure('public.monthly_category_totals(text, uuid)') is not null,
    'monthly_category_totals(text, uuid) is missing (expected from 0014/0026/0031)';
  assert to_regprocedure('public.monthly_category_totals(text)') is null,
    'stray single-arg monthly_category_totals(text) overload would open the anon-execute trap';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_secdef, v_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'monthly_category_totals'
     and p.pronargs = 2;

  assert v_secdef, 'monthly_category_totals must be SECURITY DEFINER (0026 + 0031)';
  assert v_owner = 'postgres', 'monthly_category_totals must be owned by postgres';

  -- 7-column return: count the OUT/TABLE columns (proargmodes 'o'/'t').
  select count(*) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join lateral unnest(p.proargmodes) as m(mode) on true
   where n.nspname = 'public'
     and p.proname = 'monthly_category_totals'
     and p.pronargs = 2
     and m.mode in ('o', 't');

  assert v_cols = 7, 'monthly_category_totals must return exactly 7 columns (42P13-safe replace contract)';

  -- Least privilege: anon/public no EXECUTE, authenticated yes (0026 §5,
  -- re-applied by 0031 §3 because create-or-replace resets EXECUTE).
  assert not has_function_privilege('anon', 'public.monthly_category_totals(text, uuid)', 'EXECUTE'),
    'anon must NOT be able to execute monthly_category_totals (least privilege)';
  assert not has_function_privilege('public', 'public.monthly_category_totals(text, uuid)', 'EXECUTE'),
    'public must NOT be able to execute monthly_category_totals (least privilege)';
  assert has_function_privilege('authenticated', 'public.monthly_category_totals(text, uuid)', 'EXECUTE'),
    'authenticated must be able to execute monthly_category_totals';

  -- -------------------------------------------------------------------------
  -- 2. Fixture — 2-member household; A: 2 confirmed receipts (one with a
  --    payment-method discount) + 1 pending receipt; B: no purchases.
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated', 'hh-a@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_b, 'authenticated', 'authenticated', 'hh-b@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, created_at)
  values
    (v_user_a, 'Member A', 0, 'USD', now()),
    (v_user_b, 'Member B', 0, 'USD', now())
  on conflict (id) do nothing;

  insert into public.households (id, name, created_by, created_at)
  values (v_hid, 'Totals Consistency Test', v_user_a, now())
  on conflict (id) do nothing;

  insert into public.household_members (household_id, user_id, role, joined_at)
  values
    (v_hid, v_user_a, 'member', now()),
    (v_hid, v_user_b, 'member', now())
  on conflict (household_id, user_id) do nothing;

  insert into public.stores (id, user_id, name)
  values (v_store, v_user_a, 'Test Store')
  on conflict (id) do nothing;

  select id into v_cat_lacteos from public.categories where slug = 'lacteos';
  assert found, 'seed category lacteos (migration 0001) must exist';
  select id into v_cat_panaderia from public.categories where slug = 'panaderia';
  assert found, 'seed category panaderia (migration 0001) must exist';

  -- R1 confirmed: 2 line items summing 100.00 (net = gross, no discount).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values ('a1000000-0000-0000-0000-000000000001', v_user_a, v_store, date '2026-08-03', 100.00, 'card', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values
    ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Leche',    1, 40.00, 40.00, v_cat_lacteos,   false, 0),
    ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Pan',      1, 60.00, 60.00, v_cat_panaderia, false, 1)
  on conflict (id) do nothing;

  -- R2 confirmed DISCOUNTED: line items sum 200.00, final paid 199.60
  -- (0.40 payment-method discount — NOT a line item, 0023 comment).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values ('a1000000-0000-0000-0000-000000000002', v_user_a, v_store, date '2026-08-10', 199.60, 'card', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values
    ('b1000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000002', 'Queso',    2, 100.00, 200.00, v_cat_lacteos,   false, 0)
  on conflict (id) do nothing;

  -- R3 PENDING: must NEVER enter any household total surface (the 0031 fix).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values ('a1000000-0000-0000-0000-000000000003', v_user_a, v_store, date '2026-08-18', 300.00, 'cash', 'pending', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values
    ('b1000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000003', 'Yogur',    3, 100.00, 300.00, v_cat_lacteos,   false, 0)
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- 3. Behavior — as member A (simulated via the Supabase JWT claim GUC)
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a"}', true);

  -- 3a. Confirmed-only category totals: gross 300.00 (line-item sums),
  --      3 items — the pending 300.00 receipt is absent.
  select count(*), coalesce(sum(x.total), 0), coalesce(sum(x.item_count), 0)
    into v_cat_rows, v_cat_gross, v_cat_items
    from public.monthly_category_totals('2026-08', v_hid) x;

  assert v_cat_rows = 2, 'household category rows must be confirmed-only (2 rows, pending excluded)';
  assert v_cat_gross = 300.00, 'household category gross must be 300.00';
  assert v_cat_items = 3, 'household item_count must be 3 (pending receipt items excluded)';

  -- The pending receipt would have added exactly one 300.00 lacteos row.
  select coalesce(sum(x.total), 0) into v_lacteos_total
    from public.monthly_category_totals('2026-08', v_hid) x
   where x.category_slug = 'lacteos';

  assert v_lacteos_total = 240.00,
    'lacteos total must be 240.00 (40 + 200 confirmed line items; the 300 pending item is excluded)';

  -- 3b. Net headline: Σ confirmed purchases.total — the discounted receipt
  --     counts 199.60 (final paid), NOT 200.00 (gross line-item sum).
  select x.total into v_total_net from public.monthly_purchases_total('2026-08', v_hid) x;
  assert v_total_net = 299.60,
    'household net headline must be 299.60 (100.00 + 199.60 final paid; discount excluded)';

  -- 3c. Personal == Household to the cent (single-contributor month).
  select x.total into v_total_personal from public.monthly_purchases_total('2026-08') x;
  assert v_total_personal = v_total_net,
    'personal and household headlines must reconcile to the cent on a single-contributor month';

  -- -------------------------------------------------------------------------
  -- 4. Non-member: zero rows, not an error (is_household_member gate).
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-00000000000f"}', true);

  select count(*) into v_nonmember_rows from public.monthly_category_totals('2026-08', v_hid);
  select x.total into v_nonmember_total from public.monthly_purchases_total('2026-08', v_hid) x;

  assert v_nonmember_rows = 0, 'non-member must get zero category rows (not an error)';
  assert v_nonmember_total is null, 'non-member net total must be NULL (empty aggregate)';

  -- -------------------------------------------------------------------------
  -- 5. Anon denial (LAST: SET ROLE persists for the rest of the transaction).
  -- -------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  begin
    perform count(*) from public.monthly_category_totals('2026-08', v_hid);
    raise exception 'anon must NOT be able to execute monthly_category_totals';
  exception
    when insufficient_privilege then
      null; -- expected: no EXECUTE for anon (least privilege)
  end;

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'household-totals.sql smoke: catalog + confirmed-only + net reconcile assertions passed';
end $$;