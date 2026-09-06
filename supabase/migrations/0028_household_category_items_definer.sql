-- 0028_household_category_items_definer.sql
-- ---------------------------------------------------------------------------
-- Fix: the household category drill-down always shows personal-scope items.
--
-- Root cause (Level B limitation, present since 0014/0026):
-- The History/Analytics tabs in household mode show RPC-backed category
-- totals (`monthly_category_totals`), but when the user taps a category
-- card, the drill-down screen (`/categories/[key]`) always renders
-- personal scope: `useCategoryDetail` reads `useReceiptsStore` +
-- `readPurchaseListByMonth(userId, monthKey)` and aggregates with
-- `aggregateItemsByCategory`. This uses `purchases_select_own` (RLS),
-- so the caller only sees their OWN items — not the household's. If the
-- caller has no spend in that category, the screen shows
-- "Sin gastos en esta categoría este mes." even though the household
-- category card showed a real total.
--
-- The existing `get_household_feed` does NOT help: it returns per-receipt
-- `category_totals` (a `{slug: total}` jsonb per purchase) — Level B, no
-- individual line items. The drill-down needs actual `purchase_items` rows.
--
-- Data surface / trust boundary: this RPC exposes Level-A item detail —
-- individual line items with store and member names for EVERY household
-- member's purchases in the category, not just the Level-B totals
-- `get_household_feed`/`monthly_category_totals` expose. That is safe only
-- because the household is the trust boundary: membership is enforced
-- (is_household_member) inside the body BEFORE any row is produced, and
-- every member already sees the household's full receipt list in
-- History/Analytics. `quantity` passes through as numeric (no integer
-- coercion): the column is numeric(10,3) and fractional quantities (e.g.
-- 2.5 kg) must survive the round trip to the drill-down's item rows.
--
-- Fix: a SECURITY DEFINER RPC that returns raw line items for one
-- category across all household members. The client aggregates them
-- client-side with `normalizeItemName` (accent-insensitive grouping
-- that is not worth replicating in SQL).
--
-- Pattern follows 0025/0026/0027: SECURITY DEFINER, `set search_path
-- = public`, qualified names, authorization via `is_household_member`
-- inside the body, owner pinned to postgres, execution revoked from
-- public/anon (least privilege).
-- ---------------------------------------------------------------------------

create or replace function public.get_household_category_items(
  p_household_id uuid,
  p_year_month text default null,
  p_category_slug text default 'otros'
)
returns table (
  id uuid,
  name text,
  amount numeric,
  quantity numeric,
  purchase_date date,
  store_name text,
  member_name text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  -- Authorization: the caller must be a member of this household before
  -- any rows are exposed. Without this, the definer query would let any
  -- authenticated user enumerate a household's purchase items.
  if not public.is_household_member(auth.uid(), p_household_id) then
    raise exception 'Not a household member';
  end if;

  return query
  select
    pi.id,
    pi.name,
    pi.total_price,
    pi.quantity,
    p.purchase_date,
    s.name AS store_name,
    pr.full_name AS member_name
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  left join public.categories c on c.id = pi.category_id
  left join public.stores s on s.id = p.store_id
  left join public.profiles pr on pr.id = p.user_id
  where p.user_id in (
    select hm.user_id from public.household_members hm
    where hm.household_id = p_household_id
  )
  and p.status = 'confirmed'
  -- Items with null category_id are treated as 'otros' (mirrors 0026 §3
  -- fallback_otros pattern). coalesce picks the joined category slug or
  -- falls back to 'otros' when category_id is null.
  and coalesce(c.slug, 'otros') = p_category_slug
  and (p_year_month is null or to_char(p.purchase_date, 'YYYY-MM') = p_year_month)
  order by p.purchase_date desc;
end;
$$;

-- SECURITY DEFINER runs as the function owner; pin to postgres so a
-- non-postgres migration runner cannot leave it owned by a lesser role
-- (which would re-apply RLS and silently reintroduce the bug).
alter function public.get_household_category_items(uuid, text, text) owner to postgres;

-- Least privilege: this is a definer RPC — anon must not execute it.
-- Without this, an unauthenticated caller could enumerate a household's
-- purchase items as postgres and get internal schema error text.
revoke all on function public.get_household_category_items(uuid, text, text) from public, anon;
grant execute on function public.get_household_category_items(uuid, text, text) to authenticated;

comment on function public.get_household_category_items(uuid, text, text) is
  'Raw purchase_items rows for one category across a household. Returns id, name, amount (total_price), quantity, purchase_date, store_name, member_name. SECURITY DEFINER: membership checked inside via is_household_member; bypasses purchases_select_own so all household members'' items are returned.';
