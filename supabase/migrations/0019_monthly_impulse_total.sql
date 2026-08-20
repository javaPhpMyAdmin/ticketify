-- 0019. monthly_impulse_total(p_year_month, p_household_id)
-- Total impulse ("microgastos" / snacks) spend for a month.
-- Sums purchase_items.total_price WHERE is_impulse = true across confirmed
-- purchases. Optional p_household_id sums across all household members.
-- Follows 0018_client_subscription_sync.sql.

create or replace function public.monthly_impulse_total(
  p_year_month text,
  p_household_id uuid default null
)
returns table (total numeric)
language sql
security invoker
stable
set search_path = public
as $$
  with target_users as (
    select auth.uid() as uid
    where p_household_id is null
    union
    select hm.user_id as uid
    from public.household_members hm
    where hm.household_id = p_household_id
      and public.is_household_member(auth.uid(), p_household_id)
  )
  select sum(pi.total_price)::numeric(12, 2)
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  join target_users tu on tu.uid = p.user_id
  where p.status = 'confirmed'
    and pi.is_impulse = true
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
$$;

comment on function public.monthly_impulse_total(text, uuid) is
  'Total impulse (snacks/microgastos) spend for a month. Optional p_household_id sums across all household members.';
