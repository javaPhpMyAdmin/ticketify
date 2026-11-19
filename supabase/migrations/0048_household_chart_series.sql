-- ============================================================================
-- Ticketify — 0048_household_chart_series.sql
--
-- Change: read-only household chart series for the Pro Stats screen
--
-- What this migration does
-- ------------------------
--   Creates public.household_chart_series(uuid, text[]) — a SECURITY DEFINER,
--   STABLE function that returns the cache-shaped monthly series the Pro
--   charts screen needs for a household: one row per (year_month, effective
--   currency), with net confirmed-purchase totals plus daily/store/category
--   jsonb aggregates matching monthly_user_totals (migration 0044).
--
-- Why a new RPC
-- -------------
--   The personal charts read monthly_user_totals directly. That table is
--   KEYED BY USER, so none of its rows can represent the household. The
--   existing household RPCs are insufficient: monthly_purchases_total returns
--   only (currency, total); monthly_category_totals only category rows;
--   get_household_feed has no currency column; and calling
--   recalculate_monthly_totals with a household id WRITES the caller's
--   personal cache (never safe in household mode). This RPC is read-only.
--
-- Contract
-- --------
--   • Membership is checked inside with public.is_household_member(auth.uid(),
--     p_household_id). A non-member gets zero rows, not an error.
--   • Only purchases with status = 'confirmed' are aggregated.
--   • Effective unit is coalesce(nullif(upper(btrim(purchases.currency)), ''),
--     nullif(upper(btrim(profiles.currency)), ''), 'USD') — the recorder's
--     unit, never the viewer's and never households.currency.
--   • Empty months return ZERO rows (no fabricated zero row; a resolved empty
--     month is the client's explicit no-data signal).
--   • daily_totals / store_totals / category_totals mirror 0044's SELECT-side
--     expressions exactly; daily_category_totals adds day → slug → gross
--     line-item sums so servicios can be excluded per day (discounts remain
--     unattributed per category, as in 0029 §3).
--   • Windows longer than 36 months resolve to zero rows, so an oversized
--     request can never become an unbounded payload.
--
-- Reversal: drop function public.household_chart_series(uuid, text[]); no
-- schema or data change is made here.
-- ============================================================================

drop function if exists public.household_chart_series(uuid, text[]);

create function public.household_chart_series(
  p_household_id uuid,
  p_year_months text[]
)
returns table (
  year_month text,
  currency text,
  total numeric,
  daily_totals jsonb,
  store_totals jsonb,
  category_totals jsonb,
  daily_category_totals jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_household_id is null
     or p_year_months is null
     or array_length(p_year_months, 1) is null
     or array_length(p_year_months, 1) > 36 then
    return;
  end if;

  if not public.is_household_member(auth.uid(), p_household_id) then
    return;
  end if;

  return query
  with target_users as (
    select hm.user_id
      from public.household_members hm
     where hm.household_id = p_household_id
  ),
  month_purchases as (
    select
      to_char(p.purchase_date, 'YYYY-MM') as year_month_key,
      coalesce(
        nullif(upper(btrim(p.currency)), ''),
        nullif(upper(btrim(pr.currency)), ''),
        'USD'
      ) as unit,
      p.id,
      p.total as purchase_total,
      p.purchase_date,
      p.store_id
    from public.purchases p
    join target_users tu on tu.user_id = p.user_id
    left join public.profiles pr on pr.id = p.user_id
    where p.status = 'confirmed'
      and to_char(p.purchase_date, 'YYYY-MM') = any(p_year_months)
  ),
  cat_agg as (
    select
      mp.year_month_key,
      mp.unit,
      coalesce(c.slug, 'otros') as slug,
      coalesce(c.name, 'Otros') as name,
      sum(pi.total_price)::numeric(12, 2) as total,
      count(*)::int as item_count
    from public.purchase_items pi
    join month_purchases mp on mp.id = pi.purchase_id
    left join public.categories c on c.id = pi.category_id
    group by mp.year_month_key, mp.unit, c.slug, c.name
  ),
  store_agg as (
    select
      mp.year_month_key,
      mp.unit,
      coalesce(s.name, 'Sin tienda') as store_name,
      sum(mp.purchase_total)::numeric(12, 2) as total,
      count(*)::int as item_count
    from month_purchases mp
    left join public.stores s on s.id = mp.store_id
    group by mp.year_month_key, mp.unit, s.name
  ),
  daily_agg as (
    select
      mp.year_month_key,
      mp.unit,
      to_char(mp.purchase_date, 'YYYY-MM-DD') as day,
      sum(mp.purchase_total)::numeric(12, 2) as total
    from month_purchases mp
    group by mp.year_month_key, mp.unit, to_char(mp.purchase_date, 'YYYY-MM-DD')
  ),
  daily_cat_agg as (
    select
      mp.year_month_key,
      mp.unit,
      to_char(mp.purchase_date, 'YYYY-MM-DD') as day,
      coalesce(c.slug, 'otros') as slug,
      sum(pi.total_price)::numeric(12, 2) as total
    from public.purchase_items pi
    join month_purchases mp on mp.id = pi.purchase_id
    left join public.categories c on c.id = pi.category_id
    group by mp.year_month_key, mp.unit,
             to_char(mp.purchase_date, 'YYYY-MM-DD'), c.slug
  )
  select
    mp.year_month_key,
    mp.unit,
    coalesce(sum(mp.purchase_total), 0)::numeric(12, 2),
    (select coalesce(jsonb_object_agg(day, total), '{}'::jsonb)
       from daily_agg da
      where da.year_month_key = mp.year_month_key
        and da.unit = mp.unit),
    (select coalesce(
       jsonb_object_agg(store_name, jsonb_build_object('total', total, 'count', item_count)),
       '{}'::jsonb)
       from store_agg sa
      where sa.year_month_key = mp.year_month_key
        and sa.unit = mp.unit),
     (select coalesce(
        jsonb_object_agg(slug, jsonb_build_object('total', total, 'count', item_count, 'name', name)),
        '{}'::jsonb)
        from cat_agg ca
       where ca.year_month_key = mp.year_month_key
         and ca.unit = mp.unit),
     (select coalesce(
        jsonb_object_agg(dcs.day, dcs.categories),
        '{}'::jsonb)
        from (
          select dca.day,
                 jsonb_object_agg(dca.slug, dca.total) as categories
            from daily_cat_agg dca
           where dca.year_month_key = mp.year_month_key
             and dca.unit = mp.unit
           group by dca.day
        ) dcs)
  from month_purchases mp

  group by mp.year_month_key, mp.unit
  order by mp.year_month_key, mp.unit;
end;
$$;

comment on function public.household_chart_series(uuid, text[]) is
  'Read-only cache-shaped monthly series for Pro Stats household mode: one row per (year_month, effective unit), net confirmed-purchase totals plus 0044-matching daily/store/category jsonb. SECURITY DEFINER: membership checked inside; empty months and non-members return zero rows.';

alter function public.household_chart_series(uuid, text[]) owner to postgres;

revoke all on function public.household_chart_series(uuid, text[]) from public, anon;

grant execute on function public.household_chart_series(uuid, text[]) to authenticated;
