-- ============================================================================
-- Ticketify — per-category monthly budgets
--
-- New `category_budgets` table stores per-category monthly budget limits.
-- Each user can set one budget amount per category per month. The existing
-- `monthly_category_totals` RPC is extended with a LEFT JOIN to return
-- nullable `budget_limit` — additive only, all existing fields preserved.
--
-- What this migration does
-- ------------------------
--   1. Create `category_budgets` table (user_id FK, category_slug, month,
--      amount, UNIQUE constraint on the composite key).
--   2. RLS: users can only read/write their own rows.
--   3. Replace `monthly_category_totals` RPC with a LEFT JOIN version that
--      adds nullable `budget_limit` to the return shape.
--
-- What this migration does NOT do
-- --------------------------------
--   - No changes to profiles.monthly_budget (global budget untouched).
--   - No push notifications, auto-reset, or multi-currency.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. category_budgets table
-- ---------------------------------------------------------------------------

create table public.category_budgets (
  user_id       uuid    not null references public.profiles(id) on delete cascade,
  category_slug text    not null,
  month         text    not null,   -- 'YYYY-MM' format
  amount        numeric(12,2) not null,
  primary key (user_id, category_slug, month)
);

comment on table public.category_budgets is
  'Per-category monthly budget limits. One row per (user, category, month). Amount 0 means budget is cleared.';

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.category_budgets enable row level security;

-- Users can read their own budget rows.
drop policy if exists "category_budgets_select_own" on public.category_budgets;
create policy "category_budgets_select_own" on public.category_budgets
  for select to authenticated
  using (auth.uid() = user_id);

-- Users can insert their own budget rows.
drop policy if exists "category_budgets_insert_own" on public.category_budgets;
create policy "category_budgets_insert_own" on public.category_budgets
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Users can update their own budget rows.
drop policy if exists "category_budgets_update_own" on public.category_budgets;
create policy "category_budgets_update_own" on public.category_budgets
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can delete their own budget rows.
drop policy if exists "category_budgets_delete_own" on public.category_budgets;
create policy "category_budgets_delete_own" on public.category_budgets
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Extend monthly_category_totals RPC with LEFT JOIN to category_budgets
--
-- Same return shape plus nullable budget_limit (7th column). All existing
-- fields preserved — additive only. Same security posture (security invoker,
-- stable, set search_path = public, auth.uid()-scoped).
--
-- 42P13 (cannot change return type of existing function): the prior shape of
-- monthly_category_totals(text) was 6 columns (0002/0009). Adding the 7th
-- column (budget_limit) changes the return type, which `create or replace`
-- cannot do. We must drop the old overload first. This `(text)` overload has
-- no grants and no dependent objects anywhere in the migration chain (verified),
-- so the drop is safe — nothing is orphaned by it.
-- ---------------------------------------------------------------------------

drop function if exists public.monthly_category_totals(text);

create or replace function public.monthly_category_totals(p_year_month text)
returns table (
  category_id uuid,
  category_name text,
  category_slug text,
  total numeric,
  item_count bigint,
  percent_of_total numeric,
  budget_limit numeric
)
language sql security invoker stable set search_path = public as $$
  with fallback_otros as (
    select id, name, slug
    from public.categories
    where slug = 'otros'
  ),
  category_spend as (
    select coalesce(c.id, o.id) as category_id,
           coalesce(c.name, o.name) as category_name,
           coalesce(c.slug, o.slug) as category_slug,
           sum(pi.total_price)::numeric(12,2) as total,
           count(*)::bigint as item_count,
           round(100.0 * sum(pi.total_price) / nullif(sum(sum(pi.total_price)) over (), 0), 1) as percent_of_total
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    left join public.categories c on c.id = pi.category_id
    left join fallback_otros o on pi.category_id is null
    where p.user_id = auth.uid() and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
    group by coalesce(c.id, o.id), coalesce(c.name, o.name), coalesce(c.slug, o.slug)
  )
  select cs.category_id,
         cs.category_name,
         cs.category_slug,
         cs.total,
         cs.item_count,
         cs.percent_of_total,
         cb.amount as budget_limit
  from category_spend cs
  left join public.category_budgets cb
    on cb.user_id = auth.uid()
    and cb.category_slug = cs.category_slug
    and cb.month = p_year_month
$$;
