-- ============================================================================
-- Ticketify — fix NULL category_id on purchase_items
--
-- Line items that carry `category_id IS NULL` were silently dropped by
-- `monthly_category_totals` (the INNER JOIN on `categories` in
-- 0002_auth_fixes.sql L123), so the analytics breakdown and budget spent
-- understated real spend. Client surfaces (Home / History / receipt detail)
-- already bucket that money under 'otros', so the RPC was the only read
-- that disagreed.
--
-- NULL originates in parse-ticket (Gemini emits a null/unknown slug) and
-- persists via saveReceipt when neither the user's pick nor the AI
-- suggestion resolve. Defense in depth, four moves:
--
--   1. Re-assert the 'otros' row (0001_initial_schema.sql L226: slug
--      'otros', kind 'need') with `on conflict (slug) do nothing` — an
--      environment where the seed row is missing would otherwise leave the
--      RPC emitting a row with NULL category_name/slug and crash
--      CategoryBreakdownList's `category_slug.toUpperCase()` (reliability
--      review #2). Idempotent, so the backfill below can never point at
--      nothing and the RPC's fallback_otros CTE always resolves.
--
--   2. Backfill: point every NULL category_id at the seeded 'otros' row,
--      resolved by slug the same way 0006_seed_demo_data.sql resolves
--      categories. The UPDATE...FROM join form no-ops if 'otros' is ever
--      missing, instead of re-nulling the column (a scalar subquery would
--      set category_id to NULL when the lookup misses).
--
--   3. Harden the RPC: LEFT JOIN `categories` and COALESCE the category to
--      the 'otros' row when `purchase_items.category_id IS NULL`, so any
--      future NULL (the FK is ON DELETE SET NULL, 0001 L86) still lands in
--      the breakdown instead of vanishing. `security invoker` +
--      `auth.uid()` scoping preserved exactly; return shape unchanged, so
--      no client change is needed for the RPC surface.
--
--   4. (client, src/features/tickets/api.ts) saveReceipt falls back to the
--      'otros' id when a slug resolves to nothing, so new writes never
--      persist NULL category_id in the first place.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Re-assert the 'otros' row BEFORE the backfill
--
-- Same shape as the 0001 seed (slug 'otros', kind 'need', icon
-- 'square.grid.2x2', color '#6B7280', sort_order 99) — every NOT NULL
-- column without a default is provided, `id` comes from the table default
-- (gen_random_uuid(), 0001 L31). `on conflict (slug) do nothing` makes the
-- re-assert idempotent against a row that already exists, and self-healing
-- for an environment where the seed is missing.
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name, kind, icon, color, sort_order)
values ('otros', 'Otros', 'need', 'square.grid.2x2', '#6B7280', 99)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing NULLs to the 'otros' category (slug-resolved uuid)
-- ---------------------------------------------------------------------------
update public.purchase_items pi
set category_id = c.id
from public.categories c
where c.slug = 'otros'
  and pi.category_id is null;

-- ---------------------------------------------------------------------------
-- 3. Harden monthly_category_totals: LEFT JOIN + COALESCE to 'otros'
--
-- Same return shape as 0002 (category_id, category_name, category_slug,
-- total, item_count, percent_of_total) and the same security posture
-- (security invoker, stable, set search_path = public, auth.uid()-scoped).
-- Only the join semantics changed: items without a category now aggregate
-- under the 'otros' row instead of being dropped, so the windowed
-- percent_of_total denominator covers ALL of the month's item money.
-- ---------------------------------------------------------------------------
create or replace function public.monthly_category_totals(p_year_month text)
returns table (category_id uuid, category_name text, category_slug text,
               total numeric, item_count bigint, percent_of_total numeric)
language sql security invoker stable set search_path = public as $$
  with fallback_otros as (
    select id, name, slug
    from public.categories
    where slug = 'otros'
  )
  select coalesce(c.id, o.id), coalesce(c.name, o.name), coalesce(c.slug, o.slug),
         sum(pi.total_price)::numeric(12,2), count(*)::bigint,
         round(100.0 * sum(pi.total_price) / nullif(sum(sum(pi.total_price)) over (), 0), 1)
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  left join public.categories c on c.id = pi.category_id
  left join fallback_otros o on pi.category_id is null
  where p.user_id = auth.uid() and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  group by coalesce(c.id, o.id), coalesce(c.name, o.name), coalesce(c.slug, o.slug)
$$;
