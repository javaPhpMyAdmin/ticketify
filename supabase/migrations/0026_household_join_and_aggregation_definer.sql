-- 0026_household_join_and_aggregation_definer.sql
-- ---------------------------------------------------------------------------
-- Convert household RPCs to SECURITY DEFINER so RLS policies cannot abort or
-- filter their internal queries.
--
-- Root cause (bug, present since 0014/0017): the household RPCs run as
-- SECURITY INVOKER, i.e. with the authenticated caller's privileges and RLS
-- applied to every statement inside.
--
--   • join_household         inserts into public.household_members. The only
--     INSERT policy (household_members_insert_owner) requires the caller to
--     be the household owner (created_by = auth.uid()). A brand-new member
--     joining via invite code is NOT the owner, so the RPC aborts with:
--        42501  new row violates row-level security policy
--     The client then surfaces the generic "No se pudieron cargar los
--     datos" message.
--
--   • monthly_purchases_total / monthly_category_totals / get_household_feed
--     SELECT public.purchases rows of ALL household members. RLS applies the
--     purchases_select_own policy (auth.uid() = user_id), so the totals only
--     include the caller's own purchases — the household card under-reports.
--
-- Fix: recreate these functions as SECURITY DEFINER (the established pattern,
-- see 0024 households_insert_owner + 0025 create_household). The function
-- runs with the privileges of its owner (postgres) and bypasses RLS, while
-- the security-relevant checks remain inside the function body:
--
--   • join_household: still validates code, consumption, capacity, and that
--     the caller is not already in a household.
--   • get_household_feed: still raises unless is_household_member(...).
--   • monthly_purchases_total / monthly_category_totals: still gate the
--     household branch on is_household_member(auth.uid(), p_household_id).
--
-- All functions keep `set search_path = public` (avoiding search_path
-- hijacking) and refer to tables with qualified names.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- §1. join_household — SECURITY DEFINER (was invoker, 0017 §3)
-- ---------------------------------------------------------------------------

create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_hid    uuid;
  v_count  int;
begin
  -- Caller must not already belong to a household.
  if exists (
    select 1 from public.profiles where id = auth.uid() and household_id is not null
  ) then
    raise exception 'already in a household';
  end if;

  -- Find a valid, unconsumed, non-expired code.
  select ic.household_id into v_hid
    from public.invite_codes ic
   where ic.code = p_code
     and ic.consumed_by is null
     and ic.expires_at > now()
   limit 1;

  if v_hid is null then
    raise exception 'invalid or expired invite code';
  end if;

  -- Household must not be full.
  select count(*) into v_count
    from public.household_members
   where household_id = v_hid;

  if v_count >= 5 then
    raise exception 'household is full';
  end if;

  -- Mark the code as consumed.
  update public.invite_codes
     set consumed_by = auth.uid(),
         consumed_at = now()
   where household_id = v_hid
     and code = p_code
     and consumed_by is null;

  -- Add membership.
  insert into public.household_members (household_id, user_id, role)
  values (v_hid, auth.uid(), 'member')
  on conflict do nothing;

  -- Set the caller's household_id.
  update public.profiles set household_id = v_hid where id = auth.uid();

  return v_hid;
end;
$$;

-- ---------------------------------------------------------------------------
-- §2. monthly_purchases_total — SECURITY DEFINER (was invoker, 0014 §6b)
-- ---------------------------------------------------------------------------

create or replace function public.monthly_purchases_total(
  p_year_month text,
  p_household_id uuid default null
)
returns table (total numeric)
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
  select sum(p.total)::numeric(12, 2)
  from public.purchases p
  join target_users tu on tu.uid = p.user_id
  where p.status = 'confirmed'
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
$$;

-- ---------------------------------------------------------------------------
-- §3. monthly_category_totals — SECURITY DEFINER (was invoker, 0014 §6a)
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

-- ---------------------------------------------------------------------------
-- §4. get_household_feed — SECURITY DEFINER (was invoker, 0014 §6c)
-- ---------------------------------------------------------------------------

create or replace function public.get_household_feed(
  p_household_id uuid,
  p_year_month text default null
)
returns table (
  id uuid,
  store_name text,
  purchase_date date,
  total numeric,
  member_name text,
  category_totals jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  -- Verify the caller is a member of this household.
  if not public.is_household_member(auth.uid(), p_household_id) then
    raise exception 'Not a household member';
  end if;

  return query
  select
    p.id,
    s.name AS store_name,
    p.purchase_date,
    p.total,
    pr.full_name AS member_name,
    -- Level B: category_totals from purchase_items, no individual items
    (
      select jsonb_object_agg(
        coalesce(c.slug, 'otros'),
        pi_agg.total_price
      )
      from (
        select
          pi.total_price,
          pi.category_id
        from public.purchase_items pi
        where pi.purchase_id = p.id
      ) pi_agg
      left join public.categories c on c.id = pi_agg.category_id
    ) AS category_totals
  from public.purchases p
  join public.profiles pr on pr.id = p.user_id
  left join public.stores s on s.id = p.store_id
  where p.user_id in (
    select hm.user_id from public.household_members hm
    where hm.household_id = p_household_id
  )
  and p.status = 'confirmed'
  and (p_year_month is null or to_char(p.purchase_date, 'YYYY-MM') = p_year_month)
  order by p.purchase_date desc;
end;
$$;

comment on function public.join_household(text) is
  'Join a household by invite code. Validates the code, adds the caller as a member, and sets profiles.household_id. SECURITY DEFINER: membership insert must bypass the owner-only INSERT policy while the RPC holds the security checks.';

comment on function public.monthly_purchases_total(text, uuid) is
  'Total confirmed purchases for a month. Optional p_household_id sums across all household members. SECURITY DEFINER: household mode must bypass purchases_select_own to include all members.';

comment on function public.monthly_category_totals(text, uuid) is
  'Per-category monthly spend totals. Optional p_household_id aggregates across all household members. Budget_limit is only shown for single-user mode. SECURITY DEFINER: household mode must bypass purchases_select_own.';

comment on function public.get_household_feed(uuid, text) is
  'Level B household receipt feed: totals + category breakdown + store names, no individual items. Optional p_year_month filters by month. SECURITY DEFINER: membership checked inside; SELECT bypasses purchases_select_own for household members.';