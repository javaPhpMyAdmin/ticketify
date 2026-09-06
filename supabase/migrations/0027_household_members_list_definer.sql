-- 0027_household_members_list_definer.sql
-- ---------------------------------------------------------------------------
-- Fix: the household members list is incomplete — `readHouseholdMembers` on
-- the client returns only the caller instead of every member, so the Home
-- household card always shows "1 miembro" and the settings MIEMBROS (N/5)
-- counter undercounts.
--
-- Root cause: the client lists members with:
--
--     household_members ... select('profiles!inner(full_name, avatar_url)')
--
-- The `profiles!inner` join reads `public.profiles`, whose read path is
-- gated by the `profiles_select_own` RLS policy
-- (`using (auth.uid() = id)`, migration 0001). Every OTHER member's profile
-- row is invisible to the caller, so PostgREST drops those member rows from
-- the inner join and only the caller survives — the list is length 1 and the
-- count is wrong.
--
-- Fix (the established pattern, see 0025/0026): expose a SECURITY DEFINER
-- RPC that owns the query. The function runs as its owner (postgres),
-- bypassing RLS, while keeping the authorization check inside the body:
--
--   • The caller must be a member of the household
--     (public.is_household_member(auth.uid(), p_household_id)) — raised as
--     an exception otherwise, so the definer surface is not an oracle for
--     non-members.
--   • We join profiles without the `profiles_select_own` filter, so every
--     member's full_name/avatar_url is returned, giving the client the
--     complete list.
--
-- `set search_path = public` and fully-qualified names avoid search_path
-- hijacking; owner pinned to postgres and execution revoked from
-- public/anon (least privilege) keep the definer surface safe.
-- ---------------------------------------------------------------------------

create or replace function public.get_household_members(p_household_id uuid)
returns table (
  household_id uuid,
  user_id uuid,
  role text,
  joined_at timestamptz,
  full_name text,
  avatar_url text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  -- Authorization: the caller must be a member of this household before any
  -- rows are exposed. Without this, the definer query would let any
  -- authenticated user enumerate a household's members.
  if not public.is_household_member(auth.uid(), p_household_id) then
    raise exception 'Not a household member';
  end if;

  return query
  select
    hm.household_id,
    hm.user_id,
    hm.role,
    hm.joined_at,
    pr.full_name,
    pr.avatar_url
  from public.household_members hm
  join public.profiles pr on pr.id = hm.user_id
  where hm.household_id = p_household_id
  order by
    case hm.role when 'owner' then 0 else 1 end,
    hm.joined_at;
end;
$$;

-- SECURITY DEFINER runs as the function owner; pin to postgres so a
-- non-postgres migration runner cannot leave it owned by a lesser role
-- (which would re-apply RLS and silently reintroduce the bug).
alter function public.get_household_members(uuid) owner to postgres;

-- Least privilege: this is a definer RPC — anon must not execute it.
-- Without this, an unauthenticated caller could enumerate members as
-- postgres and get an internal schema error text oracle.
revoke all on function public.get_household_members(uuid) from public, anon;
grant execute on function public.get_household_members(uuid) to authenticated;

comment on function public.get_household_members(uuid) is
  'Lists the members of a household with denormalized profile fields (full_name, avatar_url), owner first. SECURITY DEFINER: bypasses profiles_select_own so every member is returned; membership checked inside via is_household_member.';
