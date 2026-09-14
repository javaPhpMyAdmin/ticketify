-- ============================================================================
-- Ticketify — recalculate-on-purchase-items-update SQL smoke test (migration 0033)
--
-- A fail-closed schema + behavior smoke test for the trigger that keeps the
-- materialized `monthly_user_totals` cache fresh when a purchase item's
-- category is re-pointed (the reassign/delete picker seam). It runs against a
-- SCRATCH database (e.g. `supabase db reset` output or a CI-local Postgres) —
-- never against production. It does NOT apply migrations; the catalog is
-- whatever the migrations declare, then the file seeds a minimal fixture and
-- pins the NEW contract:
--
--   1. Catalog: `trigger_recalculate_monthly_totals_on_item()` exists as an
--      AFTER UPDATE trigger function, and
--      `trg_monthly_totals_recalculate_on_item` is bound to `purchase_items`
--      FOR EACH ROW.
--   2. Behavior: `monthly_user_totals` is otherwise maintained ONLY by the
--      0015 purchases trigger; an UPDATE on `purchase_items` that re-points
--      `category_id` (the reassign/delete seam — purchases is never touched)
--      must recalculate the affected month SERVER-SIDE so the client
--      invalidation refetches a genuinely fresh row. The moved category
--      disappears from category_totals, the target category reflects the
--      move, and the month totals/items_count stay unchanged (the purchase
--      itself did not change).
--
-- Structure: the whole file is a SINGLE `DO` block (the same constraint as
-- pro-subscription.sql / household-totals.sql / user-categories.sql — `supabase
-- db query --local --file` prepares the file as one statement). Failing
-- `assert` aborts the block and fails the query (exit != 0).
--
-- Fixture notes: NONE of the seeded rows exist in the fresh chain, and every
-- insert is idempotent (`on conflict (...) do nothing` with fixed UUIDs), so
-- the file is safe to re-run. All identities/asserts are scoped to THIS
-- file's user + month (v_user_m3 / 2026-09) — other smoke files on the same
-- sequential stack keep their own fixtures and are never asserted against
-- globally by this file.
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identity + fixture (deterministic, private to this file).
  v_user_m3  uuid := 'e3000000-0000-0000-0000-000000000003';
  v_purchase uuid := 'e3000000-0000-0000-0000-0000000000a3';
  v_item_a   uuid := 'e3000000-0000-0000-0000-0000000000b3';
  v_item_b   uuid := 'e3000000-0000-0000-0000-0000000000c3';

  v_cat_lacteos   uuid;
  v_cat_panaderia uuid;

  v_row_exists boolean;
  v_lacteos_after numeric;
  v_target_total  numeric;
  v_headline      numeric;
  v_items_count   int;
  v_day_total     numeric;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog — migration 0033 contract
  -- -------------------------------------------------------------------------
  assert to_regprocedure('public.trigger_recalculate_monthly_totals_on_item()') is not null,
    'trigger_recalculate_monthly_totals_on_item() is missing (expected from 0033)';

  -- Introspect the trigger through the server's own canonical DDL string
  -- (pg_get_triggerdef) instead of the tgtype bitmask: the documented bit
  -- layout (ROW=1, AFTER=4, UPDATE=64) does not hold on every deployment,
  -- while the rendered definition is authoritative everywhere.
  select exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'purchase_items'
       and t.tgname = 'trg_monthly_totals_recalculate_on_item'
       and pg_get_triggerdef(t.oid) like 'CREATE TRIGGER trg_monthly_totals_recalculate_on_item AFTER UPDATE ON public.purchase_items FOR EACH ROW%'
  ) into v_row_exists;

  assert v_row_exists,
    'trg_monthly_totals_recalculate_on_item must be an AFTER ... FOR EACH ROW trigger on purchase_items';

  -- -------------------------------------------------------------------------
  -- 2. Fixture — one confirmed receipt, two line items (2026-09, private user)
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_m3, 'authenticated', 'authenticated', 'm3@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, created_at)
  values (v_user_m3, 'Migration 0033 Test', 0, 'USD', now())
  on conflict (id) do nothing;

  select id into v_cat_lacteos from public.categories where slug = 'lacteos';
  assert found, 'seed category lacteos (migration 0001) must exist';
  select id into v_cat_panaderia from public.categories where slug = 'panaderia';
  assert found, 'seed category panaderia (migration 0001) must exist';

  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values (v_purchase, v_user_m3, null, date '2026-09-12', 100.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values
    (v_item_a, v_purchase, 'Leche', 1, 40.00, 40.00, v_cat_lacteos,   false, 0),
    (v_item_b, v_purchase, 'Pan',   1, 60.00, 60.00, v_cat_panaderia, false, 1)
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- 3. Baseline — app-equivalent materialization for the fixture month.
  --    Direct SQL inserts (unlike the app save flow) do NOT go through the
  --    client's explicit recalculation (`recalculate_monthly_totals` RPC,
  --    feature-access.ts ensureMonthlyTotals on cache miss / after save), so
  --    the 0015 purchases trigger materializes BEFORE the line items exist
  --    and the row would be stale here. Normalize the month the way the app
  --    does: explicitly. The self-heal first returns item_a to the canonical
  --    baseline so a re-run (the item may still point at the post-move
  --    category) always starts from the same state.
  -- -------------------------------------------------------------------------
  update public.purchase_items
     set category_id = v_cat_lacteos
   where id = v_item_a;

  perform public.recalculate_monthly_totals(v_user_m3, '2026-09');

  select (m.category_totals->'lacteos'->>'total')::numeric,
         (m.category_totals->'panaderia'->>'total')::numeric
    into v_lacteos_after, v_target_total
    from public.monthly_user_totals m
   where m.user_id = v_user_m3 and m.year_month = '2026-09';

  assert v_lacteos_after = 40.00, 'baseline: lacteos must total 40.00 in month_user_totals (app-equivalent recalc)';
  assert v_target_total = 60.00, 'baseline: panaderia must total 60.00 in month_user_totals (app-equivalent recalc)';

  -- -------------------------------------------------------------------------
  -- 4. Behavior — re-point the item's category (exactly what the picker
  --    reassign/delete seam does: purchase_items UPDATE, purchases untouched,
  --    NO explicit recalc RPC after it). The 0033 trigger ALONE must
  --    recalculate the month server-side — the asserts below are reached
  --    only because the trigger rebuilt the jsonb.
  -- -------------------------------------------------------------------------
  update public.purchase_items
     set category_id = v_cat_panaderia
   where id = v_item_a;

  -- The moved 40.00 leaves lacteos and lands in panaderia; the purchase-level
  -- headline (total / items_count / daily) is untouched by the recalc.
  select
    (m.category_totals ? 'lacteos'),
    (m.category_totals->'panaderia'->>'total')::numeric,
    m.total,
    m.items_count,
    (m.daily_totals->>'2026-09-12')::numeric
    into v_row_exists, v_target_total, v_headline, v_items_count, v_day_total
    from public.monthly_user_totals m
   where m.user_id = v_user_m3 and m.year_month = '2026-09';

  assert not v_row_exists, 'reassigned slug must be GONE from category_totals (recalc rebuilt the jsonb)';
  assert v_target_total = 100.00, 'target slug must reflect the move: panaderia 100.00 (60 + 40)';
  assert v_headline = 100.00, 'month headline total must stay 100.00 (the purchase row did not change)';
  assert v_items_count = 2, 'items_count must stay 2 (same items, re-pointed)';
  assert v_day_total = 100.00, 'daily_totals must stay unchanged (purchase date/total untouched)';

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'recalculate-on-purchase-items-update.sql smoke: catalog + re-point recalc assertions passed';
end $$;