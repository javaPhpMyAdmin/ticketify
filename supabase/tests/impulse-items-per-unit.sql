-- ============================================================================
-- Ticketify — impulse-items-per-unit SQL smoke test (migration 0045)
--
-- A fail-closed schema + behavior smoke test for the money-integrity
-- cross-unit follow-up (issue #166, PR2). It runs against a SCRATCH database
-- (the `supabase db reset` output) — never production. It does NOT apply
-- migrations; it seeds a minimal mixed-unit fixture and runs the RPC the
-- snacks breakdown modal surfaces, asserting the per-recorded-unit contract:
--
--   1. Catalog: `monthly_impulse_items(text)` exists, is SECURITY INVOKER
--      (personal scope), owned by postgres, returns exactly 3 columns
--      (name, amount, currency), anon/public have no EXECUTE, authenticated
--      does.
--   2. Mixed-unit month (as the owner via the Supabase JWT claim GUC): the same
--      product recorded in UYU and in CLP stays TWO rows, each labelled with
--      ITS recorded unit — it is never summed into one figure (100 + 70, not
--      170). A legacy unit-less receipt falls back to the RECORDER profile
--      currency, never a hardcoded 'USD'. Non-impulse items, pending receipts
--      and other months are all excluded.
--   3. Empty month: zero rows (no impulse purchases).
--   4. Anon: EXECUTE denied (insufficient_privilege).
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as
-- household-totals.sql — `supabase db query --local --file` prepares the file
-- as one statement). A failing `assert` aborts the block and fails the query
-- (exit != 0). Section 4 SET ROLEs to anon and therefore runs LAST.
--
-- Fixture notes: none of the seeded rows exist in the fresh chain, and every
-- insert is idempotent (`on conflict (...) do nothing` with fixed UUIDs), so the
-- file is safe to re-run. Fixed UUIDs are disjoint from every other smoke file.
-- ============================================================================

do $$
declare
  -- Fixed test identity (deterministic, never collides with real rows).
  v_user  uuid := 'c5000000-0000-0000-0000-0000000000c5';
  v_store uuid := 'c5100000-0000-0000-0000-0000000000c5';

  -- Catalog vars.
  v_secdef boolean;
  v_owner  text;
  v_cols   int;

  -- Behavior vars.
  v_cat          uuid;
  v_rows         int;
  v_papas_rows   int;
  v_papas_uyu    numeric;
  v_papas_clp    numeric;
  v_papas_total  numeric;
  v_choco_unit   text;
  v_choco_amount numeric;
  v_usd_rows     int;
  v_pan_rows     int;
  v_pending_rows int;
  v_empty_rows   int;
  v_jun_rows     int;
  v_jun_unit     text;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog
  -- -------------------------------------------------------------------------
  select p.prosecdef,
         pg_get_userbyid(p.proowner),
         count(m.mode)
    into v_secdef, v_owner, v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join lateral unnest(p.proargmodes) as m(mode) on true
   where n.nspname = 'public'
     and p.proname = 'monthly_impulse_items'
     and p.pronargs = 1
     and m.mode in ('o', 't')
   group by p.prosecdef, pg_get_userbyid(p.proowner);

  assert not v_secdef,
    'monthly_impulse_items must stay SECURITY INVOKER (personal scope, 0019)';
  assert v_owner = 'postgres',
    'monthly_impulse_items must be owned by postgres (re-pinned after the 0045 drop)';
  assert v_cols = 3,
    'monthly_impulse_items must return exactly 3 columns (name, amount, currency) after 0045';

  assert not has_function_privilege('anon', 'public.monthly_impulse_items(text)', 'EXECUTE'),
    'anon must NOT be able to execute monthly_impulse_items (least privilege)';
  assert not has_function_privilege('public', 'public.monthly_impulse_items(text)', 'EXECUTE'),
    'public must NOT be able to execute monthly_impulse_items (least privilege)';
  assert has_function_privilege('authenticated', 'public.monthly_impulse_items(text)', 'EXECUTE'),
    'authenticated must be able to execute monthly_impulse_items';

  -- -------------------------------------------------------------------------
  -- 2. Fixture — one mixed-unit month (2026-05)
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', 'impulse-unit@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  -- Profile currency UYU: this is the RECORDER fallback a legacy (unit-less)
  -- receipt must resolve to — NOT a hardcoded 'USD'.
  insert into public.profiles (id, full_name, monthly_budget, currency, created_at)
  values (v_user, 'Impulse Unit', 0, 'UYU', now())
  on conflict (id) do nothing;

  insert into public.stores (id, user_id, name)
  values (v_store, v_user, 'Impulse Store')
  on conflict (id) do nothing;

  select id into v_cat from public.categories where slug = 'lacteos';
  assert found, 'seed category lacteos (migration 0001) must exist';

  -- P1 UYU: Papas (impulse 100) + Pan (NON-impulse 30 — must be excluded).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('c5200000-0000-0000-0000-000000000001', v_user, v_store, date '2026-05-03', 130.00, 'UYU', 'card', 'confirmed', now())
  on conflict (id) do nothing;
  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values
    ('c5300000-0000-0000-0000-000000000001', 'c5200000-0000-0000-0000-000000000001', 'Papas', 1, 100.00, 100.00, v_cat, true,  0),
    ('c5300000-0000-0000-0000-000000000002', 'c5200000-0000-0000-0000-000000000001', 'Pan',   1,  30.00,  30.00, v_cat, false, 1)
  on conflict (id) do nothing;

  -- P2 CLP: Papas (impulse 70) — the SAME name in another unit.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('c5200000-0000-0000-0000-000000000002', v_user, v_store, date '2026-05-06', 70.00, 'CLP', 'card', 'confirmed', now())
  on conflict (id) do nothing;
  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values ('c5300000-0000-0000-0000-000000000003', 'c5200000-0000-0000-0000-000000000002', 'Papas', 1, 70.00, 70.00, v_cat, true, 0)
  on conflict (id) do nothing;

  -- P3 LEGACY (currency NULL): Chocolate (impulse 50) → recorder profile UYU.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('c5200000-0000-0000-0000-000000000003', v_user, v_store, date '2026-05-08', 50.00, null, 'card', 'confirmed', now())
  on conflict (id) do nothing;
  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values ('c5300000-0000-0000-0000-000000000004', 'c5200000-0000-0000-0000-000000000003', 'Chocolate', 1, 50.00, 50.00, v_cat, true, 0)
  on conflict (id) do nothing;

  -- P4 PENDING: Helado (impulse 999) must NEVER enter the breakdown.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('c5200000-0000-0000-0000-000000000004', v_user, v_store, date '2026-05-10', 999.00, 'UYU', 'card', 'pending', now())
  on conflict (id) do nothing;
  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values ('c5300000-0000-0000-0000-000000000005', 'c5200000-0000-0000-0000-000000000004', 'Helado', 1, 999.00, 999.00, v_cat, true, 0)
  on conflict (id) do nothing;

  -- P5 OTHER MONTH (2026-06): Galletas (impulse 20) → single-unit month.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('c5200000-0000-0000-0000-000000000005', v_user, v_store, date '2026-06-04', 20.00, 'UYU', 'card', 'confirmed', now())
  on conflict (id) do nothing;
  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values ('c5300000-0000-0000-0000-000000000006', 'c5200000-0000-0000-0000-000000000005', 'Galletas', 1, 20.00, 20.00, v_cat, true, 0)
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- 2b. Behavior — as the owner (simulated via the Supabase JWT claim GUC).
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"sub":"c5000000-0000-0000-0000-0000000000c5"}', true);

  -- Exactly three rows: (papas, UYU), (papas, CLP), (chocolate, UYU).
  select count(*) into v_rows
    from public.monthly_impulse_items('2026-05');
  assert v_rows = 3,
    'mixed month must yield one row per (name, unit): papas/UYU, papas/CLP, chocolate/UYU';

  -- The SAME product in two units stays TWO rows — never summed (100 + 70 ≠ 170).
  select count(*) into v_papas_rows
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'papas';
  assert v_papas_rows = 2,
    'papas recorded in UYU and CLP must stay two rows, never summed into one';

  select coalesce(sum(x.amount), 0) into v_papas_uyu
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'papas' and x.currency = 'UYU';
  assert v_papas_uyu = 100.00,
    'papas/UYU subtotal must be 100.00';

  select coalesce(sum(x.amount), 0) into v_papas_clp
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'papas' and x.currency = 'CLP';
  assert v_papas_clp = 70.00,
    'papas/CLP subtotal must be 70.00 (its own unit, not folded into UYU)';

  -- Guard against a cross-unit sum sneaking back through the (name) grouping.
  select coalesce(sum(x.amount), 0) into v_papas_total
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'papas';
  assert v_papas_total = 170.00,
    'the papas rows must sum to 170.00 across units — proving the split, not a merge';

  -- A legacy unit-less receipt resolves to the RECORDER profile unit (UYU),
  -- never a hardcoded 'USD'.
  select x.currency, x.amount into v_choco_unit, v_choco_amount
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'chocolate';
  assert v_choco_unit = 'UYU',
    'a legacy unit-less receipt must fall back to the recorder profile currency (UYU)';
  assert v_choco_amount = 50.00,
    'chocolate amount must be 50.00';

  select count(*) into v_usd_rows
    from public.monthly_impulse_items('2026-05') x
   where x.currency = 'USD';
  assert v_usd_rows = 0,
    'no row may be labelled USD — the fallback is the profile currency, not a hardcoded default';

  -- Non-impulse / pending / other-month rows are all excluded.
  select count(*) into v_pan_rows
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'pan';
  assert v_pan_rows = 0, 'a non-impulse line item must never appear in the breakdown';

  select count(*) into v_pending_rows
    from public.monthly_impulse_items('2026-05') x
   where x.name = 'helado';
  assert v_pending_rows = 0, 'a pending receipt must never appear in the breakdown';

  -- -------------------------------------------------------------------------
  -- 3. Empty + single-unit month
  -- -------------------------------------------------------------------------
  select count(*) into v_empty_rows
    from public.monthly_impulse_items('2026-07');
  assert v_empty_rows = 0, 'a month with no impulse purchases must yield zero rows';

  select count(*), coalesce(max(x.currency), '') into v_jun_rows, v_jun_unit
    from public.monthly_impulse_items('2026-06') x;
  assert v_jun_rows = 1, 'the 2026-06 month must yield exactly one impulse row';
  assert v_jun_unit = 'UYU', 'the single 2026-06 row must carry its recorded unit (UYU)';

  -- -------------------------------------------------------------------------
  -- 4. Anon denial (LAST: SET ROLE persists for the rest of the transaction).
  -- -------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  begin
    perform count(*) from public.monthly_impulse_items('2026-05');
    raise exception 'anon must NOT be able to execute monthly_impulse_items';
  exception
    when insufficient_privilege then
      null; -- expected: no EXECUTE for anon (least privilege)
  end;

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'impulse-items-per-unit.sql smoke: catalog + per-unit split + recorder fallback + empty month + anon denial assertions passed';
end $$;
