-- ============================================================================
-- Ticketify — 0044_grouped_aggregation.sql
--
-- Change: money-integrity (slice A-main, tasks 3.3 + 3.4)
-- Phase:  grouped aggregation + cache re-key
--
-- What this migration does
-- ------------------------
--   §1  §aggregation — `monthly_category_totals(text, uuid)` and
--       `monthly_purchases_total(text, uuid)` gain a per-row `currency`
--       label and subtotal PER RECORDED UNIT:
--         effective unit = coalesce(row.currency, RECORDER profile currency, 'USD')
--       — the recorder (profiles of p.user_id), NEVER the caller/viewer and
--       NEVER households.currency (R1 forward from PR3 / household-sharing
--       "Aggregation RPCs" s2-s5). percent_of_total is windowed WITHIN each
--       unit; budget_limit stays personal-only; the household scope keeps the
--       is_household_member gate and non-members still get zero rows.
--       The return TYPES change (7→8 columns on category totals, 1→2 on
--       month total), which PostgreSQL refuses under `create or replace`
--       (42P13) — so both functions are DROPPED and recreated. §4 re-pins
--       owner + grants (the drop wipes both).
--
--   §2  §cache — `monthly_user_totals` is re-keyed:
--         PK (user_id, year_month) → (user_id, year_month, currency)
--       with `currency` text NOT NULL. Existing rows are relabeled under the
--       current profile currency to satisfy the NOT NULL swap, then TRUNCATED
--       (stale-data guard, 4R fix pass): their totals predate the per-unit
--       key and may have summed across units, so they are dropped and lazily
--       recomputed. No `purchases` row is rewritten (relabel-not-rewrite,
--       Recalculate RPC s5). `total` keeps its name (§5).
--
--   §3  §cache — `recalculate_monthly_totals` is rewritten (0015 body):
--       grouped upsert per effective unit present in the month; units with
--       no remaining spend are PRUNED (pass-3 §2); an empty month still
--       leaves EXACTLY ONE zero row keyed by the caller's profile currency
--       (pass-3 §1) so the `.maybeSingle()`-era client contract — one total
--       per (user, month) — degrades gracefully to one row per unit.
--
-- 42P13 note: this migration deliberately DROPS the two aggregation
-- functions (return-type change) instead of create-or-replace. The
-- household-totals.sql smoke pins them back: 8 columns on
-- monthly_category_totals, (currency, total) on monthly_purchases_total,
-- owner postgres, least-privilege EXECUTE (authenticated only).
--
-- Reversal: `drop function public.monthly_category_totals(text, uuid),
-- public.monthly_purchases_total(text, uuid)`, restore 0026/0031 bodies,
-- and re-key `monthly_user_totals` back to (user_id, year_month). Cache
-- rows written after this migration may carry multiple units per month —
-- collapsing them into one row requires summing per month (the units are
-- NOT exchangeable, so a reversal is a best-effort relabel, never a merge
-- into a single authoritative total).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. §aggregation — grouped RPCs with per-row currency
-- ---------------------------------------------------------------------------

-- Return-type change: 42P13 forbids create-or-replace swapping the columns,
-- so the (text, uuid) overloads are dropped first. The legacy single-arg
-- overloads (0010 / 0013 §3) are NOT touched: they stay invoker-scoped for
-- legacy personal consumers and keep their original shapes.
drop function public.monthly_category_totals(text, uuid);
drop function public.monthly_purchases_total(text, uuid);

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
  budget_limit numeric,
  currency text
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
  -- Determine which user IDs to include (unchanged from 0031 §1).
  household_users as (
    select p_household_id as hid
    where p_household_id is not null
      and public.is_household_member(auth.uid(), p_household_id)
    union all
    select null as hid
    where p_household_id is null
  ),
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
  -- One row per line item carrying the EFFECTIVE unit: the row's own
  -- currency, else the RECORDER profile currency (pr.id = p.user_id), else
  -- 'USD'. Grouping by this unit is what makes a mixed household subtotal
  -- per recorded unit instead of summing across units (R1).
  item_rows as (
    select pi.total_price,
           coalesce(c.id, o.id) as category_id,
           coalesce(c.name, o.name) as category_name,
           coalesce(c.slug, o.slug) as category_slug,
           coalesce(
             nullif(upper(btrim(p.currency)), ''),
             nullif(upper(btrim(pr.currency)), ''),
             'USD'
           ) as unit
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    join target_users tu on tu.uid = p.user_id
    left join public.profiles pr on pr.id = p.user_id
    left join public.categories c on c.id = pi.category_id
    left join fallback_otros o on pi.category_id is null
    where to_char(p.purchase_date, 'YYYY-MM') = p_year_month
      and p.status = 'confirmed'
  ),
  category_spend as (
    select ir.category_id,
           ir.category_name,
           ir.category_slug,
           ir.unit,
           sum(ir.total_price)::numeric(12,2) as total,
           count(*)::bigint as item_count,
           round(
             100.0 * sum(ir.total_price)
               / nullif(sum(sum(ir.total_price)) over (partition by ir.unit), 0),
             1
           ) as percent_of_total
    from item_rows ir
    group by ir.category_id, ir.category_name, ir.category_slug, ir.unit
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
         end as budget_limit,
         cs.unit as currency
  from category_spend cs
  left join public.category_budgets cb
    on cb.user_id = auth.uid()
    and cb.category_slug = cs.category_slug
    and cb.month = p_year_month
$$;

create or replace function public.monthly_purchases_total(
  p_year_month text,
  p_household_id uuid default null
)
returns table (currency text, total numeric)
language sql
security definer
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
  -- One row per effective unit (same coalesce rule as the category RPC);
  -- a member month with no confirmed purchases yields ZERO rows, which is
  -- the client's "no data" signal (never a fabricated zero).
  select coalesce(
           nullif(upper(btrim(p.currency)), ''),
           nullif(upper(btrim(pr.currency)), ''),
           'USD'
         ) as currency,
         sum(p.total)::numeric(12, 2) as total
  from public.purchases p
  join target_users tu on tu.uid = p.user_id
  left join public.profiles pr on pr.id = p.user_id
  where p.status = 'confirmed'
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  group by 1
$$;

comment on function public.monthly_category_totals(text, uuid) is
  'Per-category monthly spend totals (confirmed purchases only), subtotaled PER RECORDED UNIT: each row carries the effective unit coalesce(purchases.currency, recorder profile currency, ''USD'') and percent_of_total is windowed within that unit. Optional p_household_id aggregates across all household members. Budget_limit is only shown for single-user mode. SECURITY DEFINER: household mode must bypass purchases_select_own.';

comment on function public.monthly_purchases_total(text, uuid) is
  'Total confirmed purchases for a month, one (currency, total) row PER RECORDED UNIT (effective unit coalesce(purchases.currency, recorder profile currency, ''USD'')). Optional p_household_id sums across all household members. SECURITY DEFINER: household mode must bypass purchases_select_own to include all members.';

-- ---------------------------------------------------------------------------
-- §2. §cache — re-key monthly_user_totals by unit, relabel, never rewrite
-- ---------------------------------------------------------------------------

alter table public.monthly_user_totals
  add column currency text;

comment on column public.monthly_user_totals.currency is
  'Effective ISO 4217 unit of the cache row: coalesce of the purchases unit and the RECORDER profile unit (coalesce(purchases.currency, profiles.currency, ''USD'')). Re-keyed by 0044: one row per (user, year_month, unit). Existing rows were relabeled under the current profile currency — purchases rows were NOT rewritten (relabel-not-rewrite, Recalculate RPC s5): switching your profile currency never rewrites stored rows.';

-- Relabel existing cache rows under the CURRENT profile currency (derived
-- data). Profiles.currency is NOT NULL with default 'USD' (0040/0041), but
-- the coalesce guards a legacy NULL profile defensively.
update public.monthly_user_totals mut
   set currency = coalesce(
     nullif(upper(btrim(pr.currency)), ''),
     'USD'
   )
  from public.profiles pr
 where pr.id = mut.user_id
   and mut.currency is null;

alter table public.monthly_user_totals
  alter column currency set not null;

-- Re-key: (user_id, year_month) is no longer unique — a mixed month holds
-- one row per unit.
alter table public.monthly_user_totals
  drop constraint monthly_user_totals_pkey;

alter table public.monthly_user_totals
  add constraint monthly_user_totals_pkey primary key (user_id, year_month, currency);

-- Stale-data guard (4R fix pass): the relabel above only satisfies the NOT
-- NULL swap; every retained row was computed under the OLD single-row
-- (pre-grouped) contract and may have SUMMED across units. Those rows are no
-- longer trustworthy once the key is per unit, and merging them per unit is
-- impossible (units are not exchangeable). Drop them all: the lazy recalc —
-- the client's cache-miss one-shot and the purchases trigger — repopulates
-- one row per recorded unit on the next read, from `purchases` truth.
truncate table public.monthly_user_totals;

-- ---------------------------------------------------------------------------
-- §3. §cache — recalculate_monthly_totals: grouped upsert + prune
-- ---------------------------------------------------------------------------

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
  v_unit         text;
  v_currencies   text[];
  v_profile_unit text;
  v_total        numeric;
  v_category     jsonb;
  v_stores       jsonb;
  v_daily        jsonb;
  v_items_count  integer;
begin
  -- Identity gate (4R fix pass, security): a caller may only recalculate
  -- their OWN personal row. `auth.uid()` is null for service-role and
  -- trigger/seed contexts (allowed); a non-null caller must match p_user_id,
  -- so the definer RPC cannot be used to recompute (or probe) another user's
  -- cache. The trigger path always passes NEW/OLD.user_id, which equals the
  -- inserting user under RLS, so it is unaffected.
  if auth.uid() is not null and p_user_id is distinct from auth.uid() then
    raise exception 'caller_can_only_recalculate_own'
      using errcode = 'P0001';
  end if;

  -- Caller's profile unit is the empty-month fallback (pass-3 §1) and the
  -- re-key anchor for pre-0044 rows.
  select coalesce(nullif(upper(btrim(currency)), ''), 'USD')
    into v_profile_unit
    from public.profiles
   where id = p_user_id;
  v_profile_unit := coalesce(v_profile_unit, 'USD');

  -- Effective units present this month across the target user set (household
  -- scope when p_household_id is given, membership-gated).
  select array_agg(distinct u.unit order by u.unit)
    into v_currencies
    from (
      select coalesce(
               nullif(upper(btrim(p.currency)), ''),
               nullif(upper(btrim(pr.currency)), ''),
               'USD'
             ) as unit
      from public.purchases p
      left join public.profiles pr on pr.id = p.user_id
      where p.user_id in (
          select p_user_id
          where p_household_id is null
          union
          select hm.user_id
          from public.household_members hm
          where hm.household_id = p_household_id
            and public.is_household_member(auth.uid(), p_household_id)
        )
        and p.status = 'confirmed'
        and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
    ) u;

  -- Empty month: still materialize one row so the old single-row read
  -- contract keeps a stable shape — a zero row keyed by the profile unit.
  if v_currencies is null then
    v_currencies := array[v_profile_unit];
  end if;

  -- One pass per unit: same aggregation as 0015, filtered to the unit.
  foreach v_unit in array v_currencies
  loop
    with target_users as (
      select p_user_id as uid
      where p_household_id is null
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
      left join public.profiles pr on pr.id = p.user_id
      where p.status = 'confirmed'
        and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
        and coalesce(
              nullif(upper(btrim(p.currency)), ''),
              nullif(upper(btrim(pr.currency)), ''),
              'USD'
            ) = v_unit
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

    insert into public.monthly_user_totals
      (user_id, year_month, currency, total, category_totals, store_totals, daily_totals, items_count, updated_at)
    values
      (p_user_id, p_year_month, v_unit, v_total, v_category, v_stores, v_daily, v_items_count, now())
    on conflict (user_id, year_month, currency) do update set
      total = excluded.total,
      category_totals = excluded.category_totals,
      store_totals = excluded.store_totals,
      daily_totals = excluded.daily_totals,
      items_count = excluded.items_count,
      updated_at = now();
  end loop;

  -- Orphan prune (pass-3 §2): a unit with no remaining spend for this
  -- (user, month) leaves the cache — the group is gone, the row must be too.
  delete from public.monthly_user_totals
   where user_id = p_user_id
     and year_month = p_year_month
     and currency <> all (v_currencies);
end;
$$;

comment on function public.recalculate_monthly_totals(uuid, text, uuid) is
  'Materializes monthly_user_totals grouped per effective unit: one row per (user, year_month, currency), prunes units with no remaining spend, and leaves exactly one zero row in the caller profile currency for an empty month. SECURITY DEFINER (household scope aggregates across members).';

-- ---------------------------------------------------------------------------
-- §4. Definer owner + least-privilege execution (0026 §5 / 0031 §3 verbatim)
--
-- The DROP in §1 wiped the owner and grants of both aggregation RPCs.
-- Re-pin owner to postgres and restrict EXECUTE to authenticated so the
-- recreated definer RPCs cannot be used as unauthenticated oracles. The
-- rewritten recalc RPC is pinned to the same floor (4R fix pass): though
-- create-or-replace preserves its ACL, the revoke/grant makes the
-- least-privilege contract explicit and drift-proof.
-- ---------------------------------------------------------------------------

alter function public.monthly_category_totals(text, uuid) owner to postgres;
alter function public.monthly_purchases_total(text, uuid) owner to postgres;
alter function public.recalculate_monthly_totals(uuid, text, uuid) owner to postgres;

revoke all on function public.monthly_category_totals(text, uuid) from public, anon;
revoke all on function public.monthly_purchases_total(text, uuid) from public, anon;
-- The recalc RPC is rewritten above; a create-or-replace preserves the ACL,
-- but this file also DROPs/recreates the two aggregation RPCs. Pin recalc's
-- least privilege explicitly so a fresh-chain grant drift cannot open the
-- definer as an unauthenticated write oracle (it now also carries the
-- caller-identity gate, but EXECUTE is the outer boundary).
revoke all on function public.recalculate_monthly_totals(uuid, text, uuid) from public, anon;

grant execute on function public.monthly_category_totals(text, uuid) to authenticated;
grant execute on function public.monthly_purchases_total(text, uuid) to authenticated;
grant execute on function public.recalculate_monthly_totals(uuid, text, uuid) to authenticated;