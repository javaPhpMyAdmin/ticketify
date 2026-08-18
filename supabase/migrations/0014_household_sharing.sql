-- ============================================================================
-- Ticketify — Household Sharing (PR1: Schema + RPCs)
--
-- Adds household support so multiple users can share a single expense
-- tracking space. A household has one owner and up to 4 members. New members
-- join via a 6-character invite code that expires after 72 hours.
--
-- What this migration does
-- ------------------------
--   §1  Tables: households, household_members, invite_codes
--   §2  profiles.household_id column (self-referencing FK)
--   §3  Helper function: is_household_member(uid, hid)
--   §4  RLS policies for new tables
--   §5  RPCs: create_household, generate_invite_code, join_household,
--        leave_household, disband_household
--   §6  Modified RPCs: monthly_category_totals, monthly_purchases_total
--        (household-aware with backward-compatible default)
--   §7  Indexes
--
-- What this migration does NOT do
-- --------------------------------
--   - No client-side code changes
--   - No edge functions or webhooks
--   - No UI or navigation changes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. Tables
-- ---------------------------------------------------------------------------

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.households is
  'Households group users for shared expense tracking. One owner, up to 4 members total.';

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

comment on table public.household_members is
  'Membership junction for households. Exactly one owner per household.';

create table public.invite_codes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code         text not null,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  expires_at   timestamptz not null,
  consumed_by  uuid references public.profiles(id),
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.invite_codes is
  'One-time invite codes for household join. Valid for 72h, consumed on use.';

-- ---------------------------------------------------------------------------
-- §2. profiles.household_id
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column household_id uuid references public.households(id) on delete set null;

comment on column public.profiles.household_id is
  'Current household membership. Set on join, cleared on leave or disband.';

-- ---------------------------------------------------------------------------
-- §3. Helper function: is_household_member(uid, hid)
--
-- Simple SQL function for use in RLS policies. Returns true if the user is
-- a member of the specified household.
-- ---------------------------------------------------------------------------

create or replace function public.is_household_member(uid uuid, hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.user_id = uid and hm.household_id = hid
  )
$$;

-- ---------------------------------------------------------------------------
-- §4. Row Level Security
-- ---------------------------------------------------------------------------

-- households
alter table public.households enable row level security;

drop policy if exists "households_select_member" on public.households;
create policy "households_select_member" on public.households
  for select to authenticated
  using (public.is_household_member(auth.uid(), id));

drop policy if exists "households_update_owner" on public.households;
create policy "households_update_owner" on public.households
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "households_delete_owner" on public.households;
create policy "households_delete_owner" on public.households
  for delete to authenticated
  using (created_by = auth.uid());

-- household_members
alter table public.household_members enable row level security;

drop policy if exists "household_members_select_member" on public.household_members;
create policy "household_members_select_member" on public.household_members
  for select to authenticated
  using (public.is_household_member(auth.uid(), household_id));

drop policy if exists "household_members_insert_owner" on public.household_members;
create policy "household_members_insert_owner" on public.household_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.households h
      where h.id = household_id and h.created_by = auth.uid()
    )
  );

drop policy if exists "household_members_delete_owner" on public.household_members;
create policy "household_members_delete_owner" on public.household_members
  for delete to authenticated
  using (
    exists (
      select 1 from public.households h
      where h.id = household_id and h.created_by = auth.uid()
    )
  );

-- invite_codes
alter table public.invite_codes enable row level security;

-- Users can generate invite codes (INSERT) — the RPC validates ownership.
drop policy if exists "invite_codes_insert_auth" on public.invite_codes;
create policy "invite_codes_insert_auth" on public.invite_codes
  for insert to authenticated
  with check (auth.uid() = created_by);

-- Users can read codes they created (for display in UI).
drop policy if exists "invite_codes_select_own" on public.invite_codes;
create policy "invite_codes_select_own" on public.invite_codes
  for select to authenticated
  using (auth.uid() = created_by);

-- Users can update a code when consuming it (consumed_by, consumed_at).
drop policy if exists "invite_codes_update_consume" on public.invite_codes;
create policy "invite_codes_update_consume" on public.invite_codes
  for update to authenticated
  using (consumed_by is null and expires_at > now())
  with check (auth.uid() = consumed_by);

-- ---------------------------------------------------------------------------
-- §5. RPCs
-- ---------------------------------------------------------------------------

-- §5a. create_household(p_name)
-- Creates a household, adds the caller as owner, and sets profiles.household_id.
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_hid uuid;
begin
  -- Verify Pro tier.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and tier = 'pro'
  ) then
    raise exception 'Pro subscription required';
  end if;

  -- Caller must not already belong to a household.
  if exists (
    select 1 from public.profiles where id = auth.uid() and household_id is not null
  ) then
    raise exception 'already in a household';
  end if;

  -- Create the household.
  insert into public.households (name, created_by)
  values (p_name, auth.uid())
  returning id into v_hid;

  -- Add the caller as owner.
  insert into public.household_members (household_id, user_id, role)
  values (v_hid, auth.uid(), 'owner');

  -- Set the caller's household_id.
  update public.profiles set household_id = v_hid where id = auth.uid();

  return v_hid;
end;
$$;

comment on function public.create_household(text) is
  'Creates a new household with the caller as owner. Raises if already in a household. Returns the household UUID.';

-- §5b. generate_invite_code(p_household_id)
-- Owner-only. Generates a 6-char code valid for 72 hours.
-- Guards: caller must be owner, max 5 members, max 3 active codes in 24h.
create or replace function public.generate_invite_code(p_household_id uuid)
returns text
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_code   text;
  v_owner  uuid;
  v_count  int;
  v_active int;
begin
  -- Verify Pro tier.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and tier = 'pro'
  ) then
    raise exception 'Pro subscription required';
  end if;

  -- Verify household exists and caller is the owner.
  select created_by into v_owner
    from public.households
   where id = p_household_id;

  if v_owner is null then
    raise exception 'household not found';
  end if;

  if v_owner != auth.uid() then
    raise exception 'only the owner can generate invite codes';
  end if;

  -- Max 5 members total (owner + 4 others).
  select count(*) into v_count
    from public.household_members
   where household_id = p_household_id;

  if v_count >= 5 then
    raise exception 'household is full (max 5 members)';
  end if;

  -- Max 3 unconsumed codes created in the last 24 hours.
  select count(*) into v_active
    from public.invite_codes
   where household_id = p_household_id
     and consumed_by is null
     and created_at > now() - interval '24 hours';

  if v_active >= 3 then
    raise exception 'too many active invite codes (max 3 per 24h)';
  end if;

  -- Generate a 6-character alphanumeric code (uppercase + digits).
  v_code := upper(
    substr(
      replace(replace(replace(replace(replace(replace(replace(replace(
        gen_random_uuid()::text, '-', ''), 'a', ''), 'b', ''), 'c', ''),
        'd', ''), 'e', ''), 'f', ''), 'g', ''),
      1, 6
    )
  );

  insert into public.invite_codes (household_id, code, created_by, expires_at)
  values (p_household_id, v_code, auth.uid(), now() + interval '72 hours');

  return v_code;
end;
$$;

comment on function public.generate_invite_code(uuid) is
  'Generates a 6-char invite code valid for 72h. Owner only, max 5 members, max 3 active codes/24h.';

-- §5c. join_household(p_code)
-- Validates the code, creates membership, sets profiles.household_id.
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_hid    uuid;
  v_count  int;
begin
  -- Verify Pro tier.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and tier = 'pro'
  ) then
    raise exception 'Pro subscription required';
  end if;

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

comment on function public.join_household(text) is
  'Joins a household via invite code. Validates code, checks household capacity, creates membership.';

-- §5d. leave_household()
-- Removes the caller from their household. If owner, transfers ownership
-- to the longest-tenured member. Clears profiles.household_id.
create or replace function public.leave_household()
returns void
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_hid     uuid;
  v_role    text;
  v_new_own uuid;
begin
  select household_id, hm.role into v_hid, v_role
    from public.profiles p
    join public.household_members hm on hm.household_id = p.household_id and hm.user_id = p.id
   where p.id = auth.uid();

  if v_hid is null then
    raise exception 'not in a household';
  end if;

  if v_role = 'owner' then
    -- Transfer ownership to the longest-tenured member (excluding self).
    select user_id into v_new_own
      from public.household_members
     where household_id = v_hid and user_id != auth.uid()
     order by joined_at asc
     limit 1;

    if v_new_own is not null then
      -- Promote the new owner.
      update public.household_members
         set role = 'owner'
       where household_id = v_hid and user_id = v_new_own;

      -- Demote self to member before removal.
      update public.household_members
         set role = 'member'
       where household_id = v_hid and user_id = auth.uid();
    else
      -- No other members — disband the household.
      delete from public.household_members where household_id = v_hid;
      delete from public.invite_codes where household_id = v_hid;
      delete from public.households where id = v_hid;
      update public.profiles set household_id = null where id = auth.uid();
      return;
    end if;
  end if;

  -- Remove membership.
  delete from public.household_members
   where household_id = v_hid and user_id = auth.uid();

  -- Clear household_id on profile.
  update public.profiles set household_id = null where id = auth.uid();
end;
$$;

comment on function public.leave_household() is
  'Removes the caller from their household. If owner, transfers ownership to longest-tenured member or disbands.';

-- §5e. disband_household(p_household_id)
-- Owner-only. Deletes all members, invite codes, and the household row.
-- All members' profiles.household_id is cleared via ON DELETE SET NULL.
create or replace function public.disband_household(p_household_id uuid)
returns void
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner
    from public.households
   where id = p_household_id;

  if v_owner is null then
    raise exception 'household not found';
  end if;

  if v_owner != auth.uid() then
    raise exception 'only the owner can disband a household';
  end if;

  -- Clear household_id on all member profiles explicitly (ON DELETE SET NULL
  -- handles the FK, but explicit is safer for clarity).
  update public.profiles
     set household_id = null
   where household_id = p_household_id;

  -- Delete members (CASCADE will also clean invite_codes and the household).
  delete from public.household_members where household_id = p_household_id;
  delete from public.invite_codes where household_id = p_household_id;
  delete from public.households where id = p_household_id;
end;
$$;

comment on function public.disband_household(uuid) is
  'Disbands a household. Owner only. Removes all members, codes, and the household row.';

-- ---------------------------------------------------------------------------
-- §6. Modified RPCs — household-aware totals
--
-- Both functions gain an optional p_household_id parameter. When provided,
-- totals include ALL members of that household. When NULL (default), totals
-- are scoped to the current user only — fully backward compatible.
-- ---------------------------------------------------------------------------

-- §6a. monthly_category_totals (extended)
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
security invoker
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

comment on function public.monthly_category_totals(text, uuid) is
  'Per-category monthly spend totals. Optional p_household_id aggregates across all household members. Budget_limit is only shown for single-user mode.';

-- §6b. monthly_purchases_total (extended)
create or replace function public.monthly_purchases_total(
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
  select sum(p.total)::numeric(12, 2)
  from public.purchases p
  join target_users tu on tu.uid = p.user_id
  where p.status = 'confirmed'
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
$$;

comment on function public.monthly_purchases_total(text, uuid) is
  'Total confirmed purchases for a month. Optional p_household_id sums across all household members.';

-- §6c. get_household_feed(p_household_id, p_year_month)
-- Returns Level B household receipt data: totals + categories + store names,
-- NO individual items. Used by the household feed screen to show a
-- privacy-respecting summary of household spending.
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
security invoker
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

comment on function public.get_household_feed(uuid, text) is
  'Level B household receipt feed: totals + category breakdown + store names, no individual items. Optional p_year_month filters by month.';

-- ---------------------------------------------------------------------------
-- §7. Indexes
-- ---------------------------------------------------------------------------

-- Profile lookup by household_id (for listing household members).
create index idx_household_members_user_id
  on public.household_members (user_id);

-- Code validation: find valid code by household + check consumed status.
create index idx_invite_codes_household_consumed
  on public.invite_codes (household_id, consumed_by);

-- Rate limiting: count codes created by a user in a time window.
create index idx_invite_codes_creator_time
  on public.invite_codes (created_by, created_at);
