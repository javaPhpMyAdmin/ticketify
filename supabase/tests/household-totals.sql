-- ============================================================================
-- Ticketify — household-totals consistency SQL smoke test (migration 0031)
--
-- A fail-closed schema + behavior smoke test for the household totals
-- consistency change. It runs against a SCRATCH database (e.g. `supabase db
-- reset` output or a CI-local Postgres) — never against production. It does
-- NOT apply migrations; it seeds a minimal fixture and runs the RPCs the
-- app surfaces, asserting the confirmed-only + net-paid contract plus the
-- entry-time single-currency contract (0043 §entry):
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
--   4. Household entry single-currency check (money-integrity 0043 §entry):
--      create_household seeds households.currency from the creator's profile
--      currency (normalized upper/btrim, edge case included); join_household
--      raises currency_mismatch / SQLSTATE CU001 on a mismatched profile
--      currency and creates NO membership row; the rejected code stays
--      usable once the caller fixes their currency; a NULL household
--      currency skips the check (legacy households keep working); and a
--      post-join profile-currency change revokes nothing — enforcement is
--      entry-only. Also pins join_household's SECDEF/owner/grants.
--   5. Anon: EXECUTE denied (insufficient_privilege).
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
  v_hid         uuid := 'd0000000-0000-0000-0000-00000000000d';
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
  v_lacteos_pct   numeric;
  v_nonmember_rows int;
  v_nonmember_total numeric;

  -- §4b entry-check fixture + scenario vars (money-integrity 0043 §entry).
  -- Dedicated identities: none of these UUIDs appears in any other smoke file
  -- or in section 2's fixture, so the entry scenarios can own their teardown.
  v_e_creator    uuid    := 'ea000000-0000-0000-0000-000000000001';
  v_e_match      uuid    := 'ea000000-0000-0000-0000-000000000002';
  v_e_mismatch   uuid    := 'ea000000-0000-0000-0000-000000000003';
  v_e_joiner     uuid    := 'ea000000-0000-0000-0000-000000000004';
  v_e_legacy_hid uuid    := 'ea000000-0000-0000-0000-0000000000d1';
  v_e_usd_creator uuid   := 'ea000000-0000-0000-0000-000000000005';
  v_e_usd_joiner  uuid   := 'ea000000-0000-0000-0000-000000000006';
  v_e_hid        uuid;   -- household created under test in s1
  v_e_usd_hid    uuid;   -- household created by the ' usd ' creator
  v_e_profile_cur text;
  v_e_hh_cur      text;
  v_e_members_before int;
  v_e_members_after  int;
  v_e_rows        int;
  v_e_joined_hid  uuid;
  v_e_sqlstate    text;  -- captured via get stacked diagnostics (CU001 pin)
  v_e_jh_secdef   boolean;
  v_e_jh_owner    text;

  -- §4c grouped aggregation + cache reshape (money-integrity 0044).
  -- Dedicated identities, disjoint from §2 and §4b, owned teardown.
  v_ag_a         uuid := 'a9000000-0000-0000-0000-000000000001'; -- profile UYU
  v_ag_b         uuid := 'a9000000-0000-0000-0000-000000000002'; -- profile CLP
  v_ag_hid       uuid := 'a9000000-0000-0000-0000-0000000000d9';
  v_ag_store     uuid := 'c9000000-0000-0000-0000-0000000000aa';
  v_ag_secdef    boolean;
  v_ag_owner     text;
  v_ag_purch_cols int;
  v_ag_rows      int;
  v_ag_uyu_total numeric;
  v_ag_clp_total numeric;
  v_ag_lacteos_uyu numeric;
  v_ag_pct_uyu   numeric;
  v_ag_pct_clp   numeric;
  v_ag_null_cur  text;
  v_ag_rec_rows  int;
  v_ag_cache_rows int;
  v_ag_empty_rows int;
  v_ag_empty_cur text;
  v_ag_empty_total numeric;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog — migration 0031 contract
  -- -------------------------------------------------------------------------
  -- The (text, uuid) signature is the SECURITY DEFINER household-mode entry
  -- (0026/0031). The legacy single-arg monthly_category_totals(text) overload
  -- legitimately EXISTS (0013 §3) and is what the client calls in personal
  -- mode (feature-access.ts readCategoryTotals without p_household_id): it
  -- stays `security invoker`, so purchases_select_own RLS keeps scoping it.
  -- What 0031 must NOT have done is turn that single-arg overload into a
  -- definer with fresh PUBLIC EXECUTE (the 0029 §4 trap). Check the contract:
  -- the 2-arg definer exists + least-privileged; the 1-arg is either absent
  -- or (when present, as here) stays `security invoker` — CRITICAL: RLS on
  -- purchases/purchase_items is ACTIVE, so an invoker with default PUBLIC
  -- EXECUTE leaks nothing (anon's auth.uid() is null -> purchases_select_own
  -- matches nothing). A definer would bypass RLS and open the trap.
  assert to_regprocedure('public.monthly_category_totals(text, uuid)') is not null,
    'monthly_category_totals(text, uuid) is missing (expected from 0014/0026/0031)';
  assert not (
    to_regprocedure('public.monthly_category_totals(text)') is not null
    and coalesce((
      select p.prosecdef
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'monthly_category_totals'
         and p.pronargs = 1
       limit 1
    ), false)
  ), 'single-arg overload must stay invoker (definer would bypass RLS = anon-trap)';
  assert (
    select c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'purchases'
  ), 'purchases RLS must be active for the invoker single-arg to be safe';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_secdef, v_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'monthly_category_totals'
     and p.pronargs = 2;

  assert v_secdef, 'monthly_category_totals must be SECURITY DEFINER (0026 + 0031)';
  assert v_owner = 'postgres', 'monthly_category_totals must be owned by postgres';

  -- 8-column return: count the OUT/TABLE columns (proargmodes 'o'/'t').
  -- 0044 (money-integrity) adds the per-row `currency` label so grouped
  -- aggregation can subtotal per recorded unit. This is a legitimate shape
  -- change (drop + recreate), not a pin weakening: the 42P13-safe replace
  -- contract still holds — the column set just grew from 7 to 8.
  select count(*) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join lateral unnest(p.proargmodes) as m(mode) on true
   where n.nspname = 'public'
     and p.proname = 'monthly_category_totals'
     and p.pronargs = 2
     and m.mode in ('o', 't');

  assert v_cols = 8, 'monthly_category_totals must return exactly 8 columns (7 + currency, 42P13-safe replace contract)';

  -- 0044 keeps the definer + owner contract after the DROP/CREATE cycle.
  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_ag_secdef, v_ag_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'monthly_category_totals'
     and p.pronargs = 2;
  assert v_ag_secdef, 'monthly_category_totals must stay SECURITY DEFINER after 0044';
  assert v_ag_owner = 'postgres', 'monthly_category_totals must stay owned by postgres after 0044';

  -- monthly_purchases_total gains a `currency` label too (grouped return).
  -- The legacy 1-arg overload (0010) coexists, so pin the 2-arg shape only.
  select count(*) into v_ag_purch_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join lateral unnest(p.proargmodes) as m(mode) on true
   where n.nspname = 'public'
     and p.proname = 'monthly_purchases_total'
     and p.pronargs = 2
     and m.mode in ('o', 't');
  assert v_ag_purch_cols = 2, 'monthly_purchases_total must return (currency, total) = 2 columns after 0044';

  -- Least privilege: anon/public no EXECUTE, authenticated yes (0026 §5,
  -- re-applied by 0031 §3 because create-or-replace resets EXECUTE).
  assert not has_function_privilege('anon', 'public.monthly_category_totals(text, uuid)', 'EXECUTE'),
    'anon must NOT be able to execute monthly_category_totals (least privilege)';
  assert not has_function_privilege('public', 'public.monthly_category_totals(text, uuid)', 'EXECUTE'),
    'public must NOT be able to execute monthly_category_totals (least privilege)';
  assert has_function_privilege('authenticated', 'public.monthly_category_totals(text, uuid)', 'EXECUTE'),
    'authenticated must be able to execute monthly_category_totals';

  -- 4R fix pass: the rewritten recalc RPC is pinned to the same least-privilege
  -- floor (anon/public denied, authenticated allowed) so the definer cannot be
  -- used as an unauthenticated write oracle. Its caller-identity gate is
  -- behavioral and pinned in §4c.
  assert not has_function_privilege('anon', 'public.recalculate_monthly_totals(uuid, text, uuid)', 'EXECUTE'),
    'anon must NOT be able to execute recalculate_monthly_totals (least privilege)';
  assert not has_function_privilege('public', 'public.recalculate_monthly_totals(uuid, text, uuid)', 'EXECUTE'),
    'public must NOT be able to execute recalculate_monthly_totals (least privilege)';
  assert has_function_privilege('authenticated', 'public.recalculate_monthly_totals(uuid, text, uuid)', 'EXECUTE'),
    'authenticated must be able to execute recalculate_monthly_totals';

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

  -- percent_of_total is windowed over the confirmed-only grouped set: with
  -- lacteos 240.00 / panaderia 60.00 on total 300.00, weights must be 80/20.
  select coalesce(max(x.percent_of_total), 0) into v_lacteos_pct
    from public.monthly_category_totals('2026-08', v_hid) x
   where x.category_slug = 'lacteos';
  assert v_lacteos_pct = 80.0,
    'percent_of_total must be recomputed over the confirmed-only set (lacteos 80.0 = 240/300)';

  -- 3b. Net headline: Σ confirmed purchases.total — the discounted receipt
  --     counts 199.60 (final paid), NOT 200.00 (gross line-item sum).
  select x.total into v_total_net from public.monthly_purchases_total('2026-08', v_hid) x;
  assert v_total_net = 299.60,
    'household net headline must be 299.60 (100.00 + 199.60 final paid; discount excluded)';

  -- 3c. Personal == Household to the cent (single-contributor month).
  -- NB: the 1-arg call would be ambiguous in raw SQL because the legacy
  --     single-arg overload (0010) coexists with the (text, uuid DEFAULT)
  --     overload (0014/0026). The app resolves by param name via PostgREST;
  --     here we force the same 2-arg definer path with NULL household to
  --     compare personal == household on the identical definition.
  select x.total into v_total_personal
    from public.monthly_purchases_total(p_year_month := '2026-08', p_household_id := null::uuid) x;
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
  -- 4b. Household entry single-currency check — money-integrity 0043 §entry
  --     (household-sharing "Household Entry Single-Currency Check" s1-s4 +
  --     the requirement's NULL-household legacy skip).
  --
  --     Position: BEFORE the anon denial in section 5 — that section sets
  --     role anon and the change persists for the rest of the transaction,
  --     while both RPCs under test revoke EXECUTE from anon (least
  --     privilege), so entry scenarios placed after it would fail on
  --     privilege instead of on the contract.
  --
  --     These paths mutate state (household rows, consumed invite codes,
  --     profiles.household_id), so the section tears its OWN fixture down
  --     first and rebuilds it — that teardown is what makes it safe to
  --     re-run. No row or identity from section 2 is touched.
  -- -------------------------------------------------------------------------

  -- Catalog gate: households.currency is the first thing 0043 §entry adds.
  assert exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name  = 'households'
       and column_name = 'currency'
  ), 'households.currency must exist (money-integrity 0043 §entry)';

  -- join_household must satisfy the same SECDEF/owner/privilege pins that
  -- household-gate-tier.sql asserts for create_household (0034 §3 / 0026 §5):
  -- a `create or replace` resets EXECUTE to PUBLIC, and a non-postgres owner
  -- would silently re-apply RLS inside the definer body.
  assert to_regprocedure('public.join_household(text)') is not null,
    'join_household(text) is missing (expected since 0014/0026)';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_e_jh_secdef, v_e_jh_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'join_household'
     and p.pronargs = 1;

  assert v_e_jh_secdef, 'join_household must be SECURITY DEFINER (0026 + 0043 §4)';
  assert v_e_jh_owner = 'postgres', 'join_household must be owned by postgres (0043 §4)';

  assert not has_function_privilege('anon', 'public.join_household(text)', 'EXECUTE'),
    'anon must NOT be able to execute join_household (least privilege)';
  assert not has_function_privilege('public', 'public.join_household(text)', 'EXECUTE'),
    'public must NOT be able to execute join_household (least privilege)';
  assert has_function_privilege('authenticated', 'public.join_household(text)', 'EXECUTE'),
    'authenticated must be able to execute join_household';

  -- Established-at-creation invariant (4R W2), informational only: the
  -- households.currency write path is the definer RPC, pinned by the ABSENCE
  -- of any client write path. 0043 §4 additionally revokes UPDATE (currency)
  -- from authenticated — NOT asserted here on purpose: the smoke runner
  -- re-applies the platform `grant all on all tables` after migrations, and
  -- Postgres ignores a column-level revoke while a table-level UPDATE grant
  -- exists (verified: has_column_privilege stays true after the revoke), so
  -- a grant-level pin would be a lie. The runner's own policy is to assert
  -- at the RLS/routine level, not on raw table grants.

  -- Teardown-first fixture: wipe whatever a previous run of THIS section
  -- left behind (household_members/invite_codes rows die with their
  -- households via FK cascade), then clear the profiles that pointed at them.
  delete from public.household_members
   where user_id in (v_e_creator, v_e_match, v_e_mismatch, v_e_joiner, v_e_usd_creator, v_e_usd_joiner)
      or household_id in (select id from public.households where created_by in (v_e_creator, v_e_usd_creator));
  delete from public.households
   where created_by in (v_e_creator, v_e_usd_creator) or id = v_e_legacy_hid;
  update public.profiles set household_id = null
   where id in (v_e_creator, v_e_match, v_e_mismatch, v_e_joiner, v_e_usd_creator, v_e_usd_joiner);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_e_creator,  'authenticated', 'authenticated', 'entry-creator@test.local',  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_e_match,    'authenticated', 'authenticated', 'entry-match@test.local',    '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_e_mismatch, 'authenticated', 'authenticated', 'entry-mismatch@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_e_joiner,   'authenticated', 'authenticated', 'entry-joiner@test.local',   '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_e_usd_creator, 'authenticated', 'authenticated', 'entry-usd-creator@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_e_usd_joiner,  'authenticated', 'authenticated', 'entry-usd-joiner@test.local',  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  -- Creator is Pro (create_household's 0034 tier gate); the others stay free.
  -- Currencies are re-asserted by the UPDATE below: the do-nothing insert
  -- cannot undo a currency that an earlier scenario changed on a previous run.
  -- The two USD fixtures exercise the normalization edge (4R W3): ' usd '
  -- (lowercase + whitespace) as the seed, 'USD' as the joiner.
  insert into public.profiles (id, full_name, monthly_budget, currency, tier, created_at)
  values
    (v_e_creator,     'Entry Creator',     0, 'UYU',   'pro',  now()),
    (v_e_match,       'Entry Match',       0, 'UYU',   'free', now()),
    (v_e_mismatch,    'Entry Mismatch',    0, 'ARS',   'free', now()),
    (v_e_joiner,      'Entry Joiner',      0, 'CLP',   'free', now()),
    (v_e_usd_creator, 'Entry USD Creator', 0, ' usd ', 'pro',  now()),
    (v_e_usd_joiner,  'Entry USD Joiner',  0, 'USD',   'free', now())
  on conflict (id) do nothing;

  update public.profiles
     set currency = case id
           when v_e_creator     then 'UYU'
           when v_e_match       then 'UYU'
           when v_e_mismatch    then 'ARS'
           when v_e_joiner      then 'CLP'
           when v_e_usd_creator then ' usd '
           when v_e_usd_joiner  then 'USD'
         end
   where id in (v_e_creator, v_e_match, v_e_mismatch, v_e_joiner, v_e_usd_creator, v_e_usd_joiner);

  -- s1 — the creator's profile currency becomes the household currency.
  perform set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000001"}', true);

  -- Setup sanity: UYU is NOT the profiles.currency default ('USD' since 0041),
  -- so a seeded UYU can only have come from this creator's row.
  select currency into v_e_profile_cur from public.profiles where id = v_e_creator;
  assert v_e_profile_cur = 'UYU',
    'fixture creator profile currency must be UYU, got: ' || coalesce(v_e_profile_cur, 'NULL');

  select public.create_household('Entry UYU Household') into v_e_hid;
  assert v_e_hid is not null, 'create_household must succeed for the Pro creator';

  select currency into v_e_hh_cur from public.households where id = v_e_hid;
  assert v_e_hh_cur = 'UYU',
    'create_household must seed households.currency from the creator''s profile currency, got: '
    || coalesce(v_e_hh_cur, 'NULL');

  -- Legacy fixture: a pre-0043-shaped household row (currency never set →
  -- NULL) plus this section's invite codes. Codes are lowercase on purpose —
  -- generate_invite_code only ever emits uppercase, so a fixture code can
  -- never collide with a generated one.
  insert into public.households (id, name, created_by, currency, created_at)
  values (v_e_legacy_hid, 'Legacy Null-Currency Household', v_e_creator, null, now())
  on conflict (id) do nothing;

  insert into public.invite_codes (household_id, code, created_by, expires_at)
  values
    (v_e_hid,        'entrym', v_e_creator, now() + interval '72 hours'),
    (v_e_hid,        'entryx', v_e_creator, now() + interval '72 hours'),
    (v_e_legacy_hid, 'entryl', v_e_creator, now() + interval '72 hours');

  -- s2 — matching currency joins succeed: membership created and
  --      profiles.household_id set.
  perform set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000002"}', true);

  select public.join_household('entrym') into v_e_joined_hid;
  assert v_e_joined_hid = v_e_hid, 'matching-currency join must return the target household';

  select count(*) into v_e_rows
    from public.household_members
   where household_id = v_e_hid and user_id = v_e_match and role = 'member';
  assert v_e_rows = 1, 'matching join must create the membership row';

  select household_id into v_e_joined_hid from public.profiles where id = v_e_match;
  assert v_e_joined_hid = v_e_hid, 'matching join must set profiles.household_id';

  -- s3 — mismatched currency is rejected at entry (currency_mismatch /
  --      SQLSTATE CU001). The SQLSTATE capture pins the NEW structured code:
  --      house precedent is string-only errors (plain messages / P0002); the
  --      dedicated class exists for observability and alert grouping, while
  --      the message text stays exactly 'currency_mismatch' for clients.
  --
  --      Honesty note (4R W1): the join call sits inside this BEGIN…EXCEPTION
  --      block, so the handler's implicit subtransaction rollback is what
  --      guarantees "count unchanged / no membership row / household_id NULL"
  --      below — they are NOT independent proofs of pre-write ordering. The
  --      "check precedes every write" claim is verified by its code position
  --      in 0043 §3 (between the capacity check and the code consumption),
  --      not by these asserts.
  select count(*) into v_e_members_before
    from public.household_members where household_id = v_e_hid;

  perform set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000003"}', true);

  begin
    perform public.join_household('entryx');
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      get stacked diagnostics v_e_sqlstate = returned_sqlstate;
      assert sqlerrm = 'currency_mismatch',
        'mismatched join must raise currency_mismatch, got: ' || sqlerrm;
      assert v_e_sqlstate = 'CU001',
        'mismatched join must raise SQLSTATE CU001 (structured code), got: ' || v_e_sqlstate;
  end;

  select count(*) into v_e_members_after
    from public.household_members where household_id = v_e_hid;
  assert v_e_members_after = v_e_members_before,
    'rejected join must leave the membership count unchanged';

  select count(*) into v_e_rows
    from public.household_members
   where household_id = v_e_hid and user_id = v_e_mismatch;
  assert v_e_rows = 0, 'rejected join must create no membership row for the caller';

  select household_id into v_e_joined_hid from public.profiles where id = v_e_mismatch;
  assert v_e_joined_hid is null, 'rejected join must leave profiles.household_id NULL';

  -- Rejected code stays usable (4R S4): correct the caller's profile currency
  -- and reuse the SAME invite code — the user-visible contract is that a
  -- rejected caller can retry once the mismatch is fixed. Consumption order
  -- (check before consume) is code-position-verified in 0043 §3, same honesty
  -- note as s3: the failure-path rollback masks it from black-box asserts.
  update public.profiles set currency = 'UYU' where id = v_e_mismatch;

  select public.join_household('entryx') into v_e_joined_hid;
  assert v_e_joined_hid = v_e_hid,
    'the rejected invite code must be reusable after the caller currency is corrected';

  select count(*) into v_e_rows
    from public.household_members
   where household_id = v_e_hid and user_id = v_e_mismatch;
  assert v_e_rows = 1, 'retried join must create the membership row';

  select household_id into v_e_joined_hid from public.profiles where id = v_e_mismatch;
  assert v_e_joined_hid = v_e_hid, 'retried join must set profiles.household_id';

  -- s4 — enforced only at entry: flipping the member's profile currency
  --      AFTER a successful join revokes nothing (nothing re-validates).
  update public.profiles set currency = 'CLP' where id = v_e_match;

  select count(*) into v_e_rows
    from public.household_members
   where household_id = v_e_hid and user_id = v_e_match;
  assert v_e_rows = 1, 'post-join profile-currency change must not revoke membership';

  select household_id into v_e_joined_hid from public.profiles where id = v_e_match;
  assert v_e_joined_hid = v_e_hid,
    'post-join profile-currency change must leave profiles.household_id set';

  -- NULL household currency skips the check — legacy households keep working.
  perform set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000004"}', true);

  select public.join_household('entryl') into v_e_joined_hid;
  assert v_e_joined_hid = v_e_legacy_hid,
    'join into a NULL-currency (legacy) household must succeed';

  select count(*) into v_e_rows
    from public.household_members
   where household_id = v_e_legacy_hid and user_id = v_e_joiner;
  assert v_e_rows = 1, 'legacy NULL-currency join must create the membership row';

  select household_id into v_e_joined_hid from public.profiles where id = v_e_joiner;
  assert v_e_joined_hid = v_e_legacy_hid,
    'legacy NULL-currency join must set profiles.household_id';

  -- Normalization edge (4R W3): a household seeded from ' usd ' (lowercase +
  -- surrounding whitespace) must be reachable by a 'USD' caller. Both halves
  -- of upper(btrim(...)) are load-bearing here — drop upper() and the seed
  -- becomes 'usd'; drop btrim() and it becomes ' usd ' (or ' usd ' after
  -- upper) — either way the 'USD' caller is wrongly rejected AND the seed
  -- assert below fails. The lowercase seed matters: a purely uppercase seed
  -- (' USD ') would stay blind to a missing upper(), because the caller side
  -- is already uppercase.
  perform set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000005"}', true);

  select public.create_household('Entry Normalized Household') into v_e_usd_hid;
  assert v_e_usd_hid is not null,
    'create_household must succeed for the Pro '' usd '' creator';

  select currency into v_e_hh_cur from public.households where id = v_e_usd_hid;
  assert v_e_hh_cur = 'USD',
    'households.currency must be seeded via upper(btrim(...)), got: ' || coalesce(v_e_hh_cur, 'NULL');

  insert into public.invite_codes (household_id, code, created_by, expires_at)
  values (v_e_usd_hid, 'entryu', v_e_usd_creator, now() + interval '72 hours');

  perform set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000006"}', true);

  select public.join_household('entryu') into v_e_joined_hid;
  assert v_e_joined_hid = v_e_usd_hid,
    'a ''USD'' caller must join a household seeded from '' usd '' (normalized compare)';

  select count(*) into v_e_rows
    from public.household_members
   where household_id = v_e_usd_hid and user_id = v_e_usd_joiner;
  assert v_e_rows = 1, 'normalization-edge join must create the membership row';

  select household_id into v_e_joined_hid from public.profiles where id = v_e_usd_joiner;
  assert v_e_joined_hid = v_e_usd_hid,
    'normalization-edge join must set profiles.household_id';

  -- -------------------------------------------------------------------------
  -- 4c. Grouped aggregation + cache re-key — money-integrity 0044.
  --
  --     Requirement (household-sharing "Aggregation RPCs" s2/s3/s4/s5,
  --     monthly-totals-cache "Recalculate RPC" s1/s5):
  --       • category totals carry a `currency` label and subtotal PER UNIT;
  --       • percent_of_total is windowed WITHIN each unit;
  --       • the effective unit is coalesce(row.currency, RECORDER profile),
  --         then 'USD' — never the viewer's, never households.currency;
  --       • month total returns one row per unit;
  --       • recalculate re-keys monthly_user_totals by unit, prunes units
  --         with no remaining spend, and leaves exactly one profile-unit
  --         row for an empty month;
  --       • cache rows are relabeled, purchases are NEVER rewritten.
  --
  --     The section owns its fixture (dedicated identities, disjoint from
  --     §2/§4b) and cleans the cache rows it asserts on. Placed BEFORE §5
  --     (which sets `role anon` and persists): both RPCs revoke EXECUTE
  --     from anon.
  -- -------------------------------------------------------------------------

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_ag_a, 'authenticated', 'authenticated', 'ag-a@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ag_b, 'authenticated', 'authenticated', 'ag-b@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, created_at)
  values
    (v_ag_a, 'Agg A (UYU)', 0, 'UYU', now()),
    (v_ag_b, 'Agg B (CLP)', 0, 'CLP', now())
  on conflict (id) do nothing;

  insert into public.households (id, name, created_by, created_at)
  values (v_ag_hid, 'Grouped Aggregation Household', v_ag_a, now())
  on conflict (id) do nothing;

  insert into public.household_members (household_id, user_id, role, joined_at)
  values
    (v_ag_hid, v_ag_a, 'member', now()),
    (v_ag_hid, v_ag_b, 'member', now())
  on conflict (household_id, user_id) do nothing;

  insert into public.stores (id, user_id, name)
  values (v_ag_store, v_ag_a, 'Agg Store')
  on conflict (id) do nothing;

  -- Seed the purchases below with NO JWT: the 0044 recalc identity gate lets
  -- a null auth.uid() (trigger/seed context) recalculate any user's row, while
  -- a non-null caller may only recalc their own. §4b left a JWT in place, so
  -- clear it here; the trigger materializes A's and B's rows cross-user.
  perform set_config('request.jwt.claims', '{}', true);

  -- A: UYU 100 (lacteos) + legacy NULL 50 (panaderia → A profile UYU)
  --    + CLP 70 (lacteos).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values
    ('a9000000-0000-0000-0000-000000000001', v_ag_a, v_ag_store, date '2026-08-05', 100.00, 'UYU', 'card', 'confirmed', now()),
    ('a9000000-0000-0000-0000-000000000003', v_ag_a, v_ag_store, date '2026-08-07',  50.00, null,  'card', 'confirmed', now()),
    ('a9000000-0000-0000-0000-000000000004', v_ag_a, v_ag_store, date '2026-08-08',  70.00, 'CLP', 'card', 'confirmed', now()),
    ('a9000000-0000-0000-0000-000000000005', v_ag_a, v_ag_store, date '2026-09-01', 500.00, 'CLP', 'card', 'confirmed', now())
  on conflict (id) do nothing;

  -- B: CLP 200 (lacteos).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('a9000000-0000-0000-0000-000000000002', v_ag_b, v_ag_store, date '2026-08-06', 200.00, 'CLP', 'card', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values
    ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'Leche', 1, 100.00, 100.00, v_cat_lacteos,   false, 0),
    ('b9000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-000000000003', 'Pan',   1,  50.00,  50.00, v_cat_panaderia, false, 0),
    ('b9000000-0000-0000-0000-000000000004', 'a9000000-0000-0000-0000-000000000004', 'Leche', 1,  70.00,  70.00, v_cat_lacteos,   false, 0),
    ('b9000000-0000-0000-0000-000000000005', 'a9000000-0000-0000-0000-000000000005', 'Leche', 1, 500.00, 500.00, v_cat_lacteos,   false, 0),
    ('b9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', 'Leche', 1, 200.00, 200.00, v_cat_lacteos,   false, 0)
  on conflict (id) do nothing;

  -- Squeeze the trigger-derived cache so the recalc asserts are deterministic.
  delete from public.monthly_user_totals where user_id in (v_ag_a, v_ag_b);

  -- Act as member A (household membership + personal scope).
  perform set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001"}', true);

  -- (a) Household category totals: one row per (category, unit).
  select count(*) into v_ag_rows
    from public.monthly_category_totals('2026-08', v_ag_hid);
  assert v_ag_rows = 3,
    'mixed household must yield one row per (category, unit): lacteos/UYU, panaderia/UYU, lacteos/CLP';

  select coalesce(sum(x.total), 0) into v_ag_uyu_total
    from public.monthly_category_totals('2026-08', v_ag_hid) x
   where x.currency = 'UYU';
  assert v_ag_uyu_total = 150.00,
    'UYU subtotal must be 150.00 (A 100 lacteos + A 50 legacy NULL→UYU)';

  select coalesce(sum(x.total), 0) into v_ag_clp_total
    from public.monthly_category_totals('2026-08', v_ag_hid) x
   where x.currency = 'CLP';
  assert v_ag_clp_total = 270.00,
    'CLP subtotal must be 270.00 (B 200 + A 70, bucketed by the row unit)';

  -- (b) The legacy NULL row is labeled with the RECORDER profile unit (UYU),
  --     not the viewer's currency and not households.currency.
  select coalesce(sum(x.total), 0) into v_ag_lacteos_uyu
    from public.monthly_category_totals('2026-08', v_ag_hid) x
   where x.currency = 'UYU' and x.category_slug = 'panaderia';
  assert v_ag_lacteos_uyu = 50.00,
    'a NULL-currency purchase must be labeled with the RECORDER profile unit (A=UYU)';

  -- (c) percent_of_total is windowed per unit, not across units.
  select max(x.percent_of_total) into v_ag_pct_uyu
    from public.monthly_category_totals('2026-08', v_ag_hid) x
   where x.currency = 'UYU';
  assert v_ag_pct_uyu = 66.7,
    'UYU percent must be windowed within the unit (lacteos 100/150 = 66.7)';

  select max(x.percent_of_total) into v_ag_pct_clp
    from public.monthly_category_totals('2026-08', v_ag_hid) x
   where x.currency = 'CLP';
  assert v_ag_pct_clp = 100.0,
    'CLP percent must be windowed within the unit (single category = 100.0)';

  -- (d) budget_limit is personal-only: never present in household mode.
  select count(*) into v_ag_rows
    from public.monthly_category_totals('2026-08', v_ag_hid) x
   where x.budget_limit is not null;
  assert v_ag_rows = 0, 'household category rows must never carry budget_limit';

  -- (e) Month total: one row per unit.
  select count(*) into v_ag_rows
    from public.monthly_purchases_total('2026-08', v_ag_hid);
  assert v_ag_rows = 2,
    'monthly_purchases_total must return one row per unit (UYU, CLP)';

  select coalesce(sum(x.total), 0) into v_ag_uyu_total
    from public.monthly_purchases_total('2026-08', v_ag_hid) x
   where x.currency = 'UYU';
  assert v_ag_uyu_total = 150.00, 'household net UYU total must be 150.00';

  select coalesce(sum(x.total), 0) into v_ag_clp_total
    from public.monthly_purchases_total('2026-08', v_ag_hid) x
   where x.currency = 'CLP';
  assert v_ag_clp_total = 270.00, 'household net CLP total must be 270.00';

  -- (f) Personal mode groups per unit too (currency switch mid-month).
  select coalesce(sum(x.total), 0) into v_ag_uyu_total
    from public.monthly_category_totals(
      p_year_month := '2026-08', p_household_id := null::uuid
    ) x
   where x.currency = 'UYU';
  assert v_ag_uyu_total = 150.00, 'personal UYU subtotal must be 150.00';

  select coalesce(sum(x.total), 0) into v_ag_clp_total
    from public.monthly_category_totals(
      p_year_month := '2026-08', p_household_id := null::uuid
    ) x
   where x.currency = 'CLP';
  assert v_ag_clp_total = 70.00,
    'a personal month spanning a currency switch must subtotal per unit (CLP 70)';

  -- (f2) Personal NET total groups per unit too: the client's personal
  -- headline (budget/overview single-series binding) reads the viewer-currency
  -- row from this shape. Mixed month → one row per unit, never a cross-unit
  -- sum (UYU 150 = 100 + 50 legacy, CLP 70).
  select count(*) into v_ag_rows
    from public.monthly_purchases_total(
      p_year_month := '2026-08', p_household_id := null::uuid
    );
  assert v_ag_rows = 2,
    'personal monthly_purchases_total must return one row per unit (UYU, CLP)';

  select coalesce(sum(x.total), 0) into v_ag_uyu_total
    from public.monthly_purchases_total(
      p_year_month := '2026-08', p_household_id := null::uuid
    ) x
   where x.currency = 'UYU';
  assert v_ag_uyu_total = 150.00, 'personal net UYU total must be 150.00';

  select coalesce(sum(x.total), 0) into v_ag_clp_total
    from public.monthly_purchases_total(
      p_year_month := '2026-08', p_household_id := null::uuid
    ) x
   where x.currency = 'CLP';
  assert v_ag_clp_total = 70.00, 'personal net CLP total must be 70.00';

  -- (f3) Empty month → ZERO rows, never a fabricated zero. A resolved empty
  -- month is the client's "no data" signal (unlike the cache, which leaves one
  -- zero row). Applies to personal and household scope alike.
  select count(*) into v_ag_rows
    from public.monthly_purchases_total(
      p_year_month := '2025-01', p_household_id := null::uuid
    );
  assert v_ag_rows = 0,
    'an empty personal month must yield ZERO net rows (no fabricated zero)';

  select count(*) into v_ag_rows
    from public.monthly_purchases_total('2025-01', v_ag_hid);
  assert v_ag_rows = 0,
    'an empty household month must yield ZERO net rows (no fabricated zero)';

  -- (g) Recalculate — empty month leaves exactly one profile-unit row.
  perform public.recalculate_monthly_totals(v_ag_a, '2025-01');

  select count(*), min(currency), coalesce(sum(total), 0)
    into v_ag_empty_rows, v_ag_empty_cur, v_ag_empty_total
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2025-01';
  assert v_ag_empty_rows = 1,
    'an empty month must still leave exactly one cache row';
  assert v_ag_empty_cur = 'UYU',
    'the empty-month cache row must be keyed by the profile unit';
  assert v_ag_empty_total = 0, 'the empty-month cache total must be 0';

  -- (h) Recalculate — mixed personal month yields one row per unit.
  perform public.recalculate_monthly_totals(v_ag_a, '2026-08');

  select count(*) into v_ag_cache_rows
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-08';
  assert v_ag_cache_rows = 2,
    'a mixed personal month must produce one cache row per unit';

  select coalesce(sum(total), 0) into v_ag_uyu_total
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-08' and currency = 'UYU';
  assert v_ag_uyu_total = 150.00, 'personal cache UYU row must total 150.00';

  select coalesce(sum(total), 0) into v_ag_clp_total
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-08' and currency = 'CLP';
  assert v_ag_clp_total = 70.00, 'personal cache CLP row must total 70.00';

  -- (i) Recalculate — household scope buckets the caller's row per unit.
  perform public.recalculate_monthly_totals(v_ag_a, '2026-08', v_ag_hid);

  select coalesce(sum(total), 0) into v_ag_clp_total
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-08' and currency = 'CLP';
  assert v_ag_clp_total = 270.00,
    'household recalc must bucket A''s CLP cache row with B''s CLP spend (270)';

  -- (j) Orphan prune — a unit with no remaining spend is deleted.
  delete from public.purchases where id = 'a9000000-0000-0000-0000-000000000004';
  perform public.recalculate_monthly_totals(v_ag_a, '2026-08');

  select count(*) into v_ag_cache_rows
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-08';
  assert v_ag_cache_rows = 1,
    'a unit with no remaining spend must be pruned from the cache (orphan prune)';

  select currency into v_ag_empty_cur
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-08';
  assert v_ag_empty_cur = 'UYU',
    'after pruning, only the surviving unit row must remain';

  -- (k) Relabel, never rewrite: the cache re-keys, but purchases.currency is
  --     never backfilled by the reshape.
  select currency into v_ag_null_cur
    from public.purchases
   where id = 'a9000000-0000-0000-0000-000000000003';
  assert v_ag_null_cur is null,
    'grouping must relabel the cache, never backfill purchases.currency';

  -- (l) Trigger path auto-materializes per unit WITHOUT an explicit recalc
  --     call. A plain purchase INSERT fires the 0015 trigger, which now runs
  --     the grouped recalc; the cache row appears on its own, keyed by the
  --     recorded unit. Uses a dedicated month so no earlier assert changes.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, currency, payment_method, status, created_at)
  values ('a9000000-0000-0000-0000-0000000000f1', v_ag_a, v_ag_store, date '2026-10-04', 42.00, 'EUR', 'card', 'confirmed', now())
  on conflict (id) do nothing;

  select count(*), min(currency), coalesce(sum(total), 0)
    into v_ag_cache_rows, v_ag_empty_cur, v_ag_empty_total
    from public.monthly_user_totals
   where user_id = v_ag_a and year_month = '2026-10';
  assert v_ag_cache_rows = 1,
    'the purchases trigger must auto-materialize one cache row for the new month';
  assert v_ag_empty_cur = 'EUR',
    'the trigger-derived row must be keyed by the recorded unit (EUR)';
  assert v_ag_empty_total = 42.00,
    'the trigger-derived row must carry the purchase total (42.00)';

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
  raise notice 'household-totals.sql smoke: catalog + confirmed-only + net reconcile + entry single-currency assertions passed';
end $$;