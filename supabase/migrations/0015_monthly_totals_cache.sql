-- Migration 0015: Monthly totals cache
--
-- Materialized monthly spend totals maintained by a Postgres trigger on
-- `purchases`. Aggregates from `purchases` + `purchase_items` and upserts
-- the cache row on every INSERT/UPDATE/DELETE. Client reads a single row
-- instead of running expensive aggregation queries.

-- §1. Table
create table public.monthly_user_totals (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  year_month       text not null,  -- 'YYYY-MM'
  total            numeric(12,2) not null default 0,
  category_totals  jsonb not null default '{}',
  store_totals     jsonb not null default '{}',
  daily_totals     jsonb not null default '{}',
  items_count      integer not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (user_id, year_month)
);

comment on table public.monthly_user_totals is
  'Materialized monthly spend totals. Trigger-maintained on purchases write.';

-- §2. RLS
alter table public.monthly_user_totals enable row level security;

create policy "monthly_user_totals_select_own"
  on public.monthly_user_totals for select to authenticated
  using (auth.uid() = user_id);

-- §3. Recalculate RPC
create or replace function public.recalculate_monthly_totals(
  p_user_id uuid,
  p_year_month text,
  p_household_id uuid default null
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_total numeric;
  v_category jsonb;
  v_stores jsonb;
  v_daily jsonb;
  v_items_count integer;
begin
  -- Aggregate from purchases + purchase_items
  with target_users as (
    select p_user_id as uid where p_household_id is null
    union
    select hm.user_id as uid
    from public.household_members hm
    where hm.household_id = p_household_id
      and public.is_household_member(auth.uid(), p_household_id)
  ),
  month_purchases as (
    select p.id, p.total as purchase_total, p.purchase_date, p.store_id
    from public.purchases p
    join target_users tu on tu.uid = p.user_id
    where p.status = 'confirmed'
      and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  ),
  cat_agg as (
    select coalesce(c.slug, 'otros') as slug,
           coalesce(c.name, 'Otros') as name,
           sum(pi.total_price)::numeric(12,2) as total,
           count(*)::int as count
    from public.purchase_items pi
    join month_purchases mp on mp.id = pi.purchase_id
    left join public.categories c on c.id = pi.category_id
    group by c.slug, c.name
  ),
  store_agg as (
    select coalesce(s.name, 'Sin tienda') as store_name,
           sum(mp.purchase_total)::numeric(12,2) as total,
           count(*)::int as count
    from month_purchases mp
    left join public.stores s on s.id = mp.store_id
    group by s.name
  ),
  daily_agg as (
    select to_char(mp.purchase_date, 'YYYY-MM-DD') as day,
           sum(mp.purchase_total)::numeric(12,2) as total
    from month_purchases mp
    group by to_char(mp.purchase_date, 'YYYY-MM-DD')
  )
  select
    coalesce(sum(mp.purchase_total), 0)::numeric(12,2),
    (select coalesce(jsonb_object_agg(slug, jsonb_build_object('total', total, 'count', count, 'name', name)), '{}') from cat_agg),
    (select coalesce(jsonb_object_agg(store_name, jsonb_build_object('total', total, 'count', count)), '{}') from store_agg),
    (select coalesce(jsonb_object_agg(day, total), '{}') from daily_agg),
    coalesce((select count(*) from public.purchase_items pi join month_purchases mp on mp.id = pi.purchase_id), 0)
  into v_total, v_category, v_stores, v_daily, v_items_count
  from month_purchases mp;

  -- Upsert cache row
  insert into public.monthly_user_totals
    (user_id, year_month, total, category_totals, store_totals, daily_totals, items_count, updated_at)
  values
    (p_user_id, p_year_month, v_total, v_category, v_stores, v_daily, v_items_count, now())
  on conflict (user_id, year_month) do update set
    total = excluded.total,
    category_totals = excluded.category_totals,
    store_totals = excluded.store_totals,
    daily_totals = excluded.daily_totals,
    items_count = excluded.items_count,
    updated_at = now();
end;
$$;

-- §4. Trigger function
create or replace function public.trigger_recalculate_monthly_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_ym text;
  v_old_ym text;
begin
  if TG_OP = 'DELETE' then
    v_user_id := OLD.user_id;
    v_ym := to_char(OLD.purchase_date, 'YYYY-MM');
    perform public.recalculate_monthly_totals(v_user_id, v_ym);
  elsif TG_OP = 'UPDATE' then
    v_user_id := NEW.user_id;
    v_ym := to_char(NEW.purchase_date, 'YYYY-MM');
    v_old_ym := to_char(OLD.purchase_date, 'YYYY-MM');
    perform public.recalculate_monthly_totals(v_user_id, v_ym);
    if v_ym != v_old_ym then
      perform public.recalculate_monthly_totals(v_user_id, v_old_ym);
    end if;
  else -- INSERT
    v_user_id := NEW.user_id;
    v_ym := to_char(NEW.purchase_date, 'YYYY-MM');
    perform public.recalculate_monthly_totals(v_user_id, v_ym);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

-- §5. Trigger
create trigger trg_monthly_totals_recalculate
  after insert or update or delete on public.purchases
  for each row
  execute function public.trigger_recalculate_monthly_totals();

-- §6. Index
create index idx_monthly_user_totals_user on public.monthly_user_totals (user_id);
