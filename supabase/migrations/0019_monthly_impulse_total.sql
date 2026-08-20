-- 0019. monthly_impulse_total + monthly_impulse_items
-- Server-side snacks/microgastos: total and per-item breakdown.
-- Follows 0018_client_subscription_sync.sql.

-- §1: Total impulse spend for a month
create or replace function public.monthly_impulse_total(
  p_year_month text
)
returns table (total numeric)
language sql
security invoker
stable
set search_path = public
as $$
  select sum(pi.total_price)::numeric(12, 2)
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  where p.user_id = auth.uid()
    and p.status = 'confirmed'
    and pi.is_impulse = true
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
$$;

comment on function public.monthly_impulse_total(text) is
  'Total impulse (snacks/microgastos) spend for a month.';

-- §2: Per-item impulse breakdown for a month
-- Grouped by normalized name so the same product from different receipts
-- collapses into one row (mirrors the client-side aggregateImpulseItemsByMonth).
create or replace function public.monthly_impulse_items(
  p_year_month text
)
returns table (name text, amount numeric)
language sql
security invoker
stable
set search_path = public
as $$
  select
    lower(trim(pi.name)) as name,
    sum(pi.total_price)::numeric(12, 2) as amount
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  where p.user_id = auth.uid()
    and p.status = 'confirmed'
    and pi.is_impulse = true
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  group by lower(trim(pi.name))
  order by amount desc
$$;

comment on function public.monthly_impulse_items(text) is
  'Per-item impulse breakdown for a month, grouped by name.';
