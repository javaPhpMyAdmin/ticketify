-- ============================================================================
-- Ticketify — household totals consistency: confirmed-only category totals
--
-- Two household-analytics defects made Personal and Household totals for the
-- same month irreconcilable even with a 1-contributor household:
--
--   1. `monthly_category_totals` (0026 §3) is the ONLY analytics RPC missing
--      `p.status = 'confirmed'`. Every other surface filters it:
--      `monthly_purchases_total` (0010/0026), `get_household_feed`
--      (0026 §4), `get_household_category_items` (0028) and the personal
--      `monthly_user_totals` cache (0015). Non-confirmed purchases leaked
--      into every household total surface (observed Δ = 275,17 on a
--      personal 23.694,01 vs household 23.969,18 month).
--   2. The household headline was computed client-side as a gross SUM of
--      these category rows (`purchase_items.total_price`), while the
--      personal headline uses `purchases.total` (net, post-discount).
--      End-of-receipt discounts are NOT line items (0023 comment), so
--      gross > final per receipt (observed Δ = 0,40).
--
-- This migration fixes defect 1 at the truth layer: the RPC itself. It
-- recreates `monthly_category_totals(text, uuid)` with the SAME signature
-- and the SAME 7-column return type as 0014 §6a / 0026 §3 (verified
-- identical) — so the `create or replace` is an in-place swap (42P13-safe,
-- no `drop function` needed, forward-only).
--
-- 42P13 guard (#1022 lesson): same signature + same return type → no error.
-- Defaults do not participate in function identity, so `p_household_id uuid
-- default null` stays compatible with the existing `(text, uuid)` catalog
-- entry.
--
-- Grant trap (0029 §4): `create or replace function` resets EXECUTE to
-- PUBLIC, which would turn this SECURITY DEFINER RPC into an
-- unauthenticated oracle. §2 re-pins the owner and §3 re-applies the 0026 §5
-- least-privilege grants verbatim (belt-and-braces — idempotent even though
-- same-signature replacement preserves the object OID).
--
-- The `percent_of_total` window in `category_spend` shrinks naturally: it
-- divides by the window SUM over the already-filtered set, so it stays the
-- share of confirmed spend.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. monthly_category_totals — confirmed-only (body = 0026 §3 + filter)
-- ---------------------------------------------------------------------------

create or replace function public.monthly_category_totals(
  p_year_month text,
  p_household_id uuid default null
)
returns table (
  category_id uuid,
  category_name text,
  category_slug text,
  total numeric,
  item_count bigint,
  percent_of_total numeric,
  budget_limit numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with fallback_otros as (
    select id, name, slug
    from public.categories
    where slug = 'otros'
  ),
  -- Determine which user IDs to include.
  household_users as (
    select p_household_id as hid
    where p_household_id is not null
      and public.is_household_member(auth.uid(), p_household_id)
    union all
    select null as hid
    where p_household_id is null
  ),
  -- Resolve the set of user_ids to aggregate.
  target_users as (
    select auth.uid() as uid
    where p_household_id is null
    union
    select hm.user_id as uid
    from public.household_members hm
    where hm.household_id = p_household_id
      and exists (
        select 1 from household_users hu where hu.hid = p_household_id
      )
  ),
  category_spend as (
    select coalesce(c.id, o.id) as category_id,
           coalesce(c.name, o.name) as category_name,
           coalesce(c.slug, o.slug) as category_slug,
           sum(pi.total_price)::numeric(12,2) as total,
           count(*)::bigint as item_count,
           round(
             100.0 * sum(pi.total_price)
               / nullif(sum(sum(pi.total_price)) over (), 0),
             1
           ) as percent_of_total
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    join target_users tu on tu.uid = p.user_id
    left join public.categories c on c.id = pi.category_id
    left join fallback_otros o on pi.category_id is null
    where to_char(p.purchase_date, 'YYYY-MM') = p_year_month
      and p.status = 'confirmed'
    group by coalesce(c.id, o.id), coalesce(c.name, o.name), coalesce(c.slug, o.slug)
  )
  select cs.category_id,
         cs.category_name,
         cs.category_slug,
         cs.total,
         cs.item_count,
         cs.percent_of_total,
         case
           when p_household_id is not null then null
           else cb.amount
         end as budget_limit
  from category_spend cs
  left join public.category_budgets cb
    on cb.user_id = auth.uid()
    and cb.category_slug = cs.category_slug
    and cb.month = p_year_month
$$;

comment on function public.monthly_category_totals(text, uuid) is
  'Per-category monthly spend totals (confirmed purchases only). Optional p_household_id aggregates across all household members. Budget_limit is only shown for single-user mode. SECURITY DEFINER: household mode must bypass purchases_select_own.';

-- ---------------------------------------------------------------------------
-- §2. Definer owner — pin back to postgres
-- ---------------------------------------------------------------------------

alter function public.monthly_category_totals(text, uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- §3. Least-privilege execution (0026 §5 for this function, verbatim)
--
-- create-or-replace resets EXECUTE to PUBLIC (the 0029 §4 trap): an
-- unauthenticated caller could otherwise execute the definer RPC as the
-- owner and use it as an unauthenticated oracle. Revoke from public/anon and
-- grant to authenticated only.
-- ---------------------------------------------------------------------------

revoke all on function public.monthly_category_totals(text, uuid) from public, anon;

grant execute on function public.monthly_category_totals(text, uuid) to authenticated;