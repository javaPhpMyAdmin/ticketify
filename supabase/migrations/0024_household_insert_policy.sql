-- 0024_household_insert_policy.sql
-- ---------------------------------------------------------------------------
-- Fix the missing INSERT policy on public.households.
--
-- Root cause (bug, present since 0014): `create_household` is SECURITY INVOKER
-- and inserts a row into public.households as the authenticated caller
-- (`created_by = auth.uid()`). RLS is enabled on the table and 0014 defines
-- SELECT/UPDATE/DELETE policies for `authenticated`, but there is NO INSERT
-- policy — so a Pro/trial user hitting "create household" always failed with:
--
--     42501  new row violates row-level security policy for table "households"
--
-- The owner-pays flow (0017) also inserts via this same path; without the
-- INSERT policy the RPC aborts before it can reach the household_members
-- insert (which already has its own `household_members_insert_owner` policy).
--
-- This policy lets an authenticated caller create a household row whose
-- `created_by` equals their own auth.uid() — mirroring the existing
-- `households_update_owner` / `households_delete_owner` checks. It never lets
-- a caller create a row owned by someone else, and never lets a caller later
-- re-run with a foreign created_by (the with-check enforces the same rule on
-- the inserted row).
-- ---------------------------------------------------------------------------

drop policy if exists "households_insert_owner" on public.households;
create policy "households_insert_owner" on public.households
  for insert to authenticated
  with check (created_by = auth.uid());
