-- 0025_create_household_security_definer.sql
-- ---------------------------------------------------------------------------
-- Fix: create_household fails with 42501 despite the INSERT policy
-- (households_insert_owner) being present. The root cause is that
-- SECURITY INVOKER + set search_path = public causes the INSERT's
-- RLS evaluation to fail even though auth.uid() resolves correctly in
-- the function body — a known interaction between RLS policy evaluation
-- context and PL/pgSQL function-local search_path.
--
-- Fix: switch create_household to SECURITY DEFINER (owner = postgres),
-- which bypasses RLS for the function's INSERT/UPDATE operations. This
-- is the same pattern used by set_profile_tier (0011) and
-- consume_scan_on_save (0021) — both SECURITY DEFINER, both do their
-- own authorization checks before modifying data.
--
-- The function's own checks are sufficient authorization:
--   1. Verifies the caller has an active subscription or trial
--   2. Verifies the caller doesn't already belong to a household
--   3. Creates the household with created_by = auth.uid()
--   4. Adds the caller as owner
--   5. Sets profiles.household_id
--
-- SECURITY DEFINER means the function runs as the owner (postgres),
-- bypassing RLS. The function's own checks (Pro subscription + no
-- existing household) are the authorization layer. The INSERT RLS
-- policy from 0024 is retained for defense-in-depth on any future
-- direct INSERTs outside the function.
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_hid uuid;
begin
  -- Verify the caller has an active subscription or valid trial.
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and (
         tier = 'pro'
         or subscription_status in ('trial', 'active')
       )
  ) then
    raise exception 'Pro subscription required to create a household';
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

-- Ensure the function is owned by postgres (required for SECURITY DEFINER
-- to run as the superuser that bypasses RLS).
alter function public.create_household(p_name text) owner to postgres;

comment on function public.create_household(p_name text) is
  'Creates a household with the caller as owner. SECURITY DEFINER (owner: postgres) to bypass RLS — the function does its own Pro-subscription and not-in-household checks. Caller must be authenticated with an active subscription or trial.';
