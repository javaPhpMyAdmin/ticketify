-- ============================================================================
-- Ticketify — profiles_update_own hardening (post-review)
--
-- Follows `0001_initial_schema.sql` (already applied / pushed).
--
-- `0001` declared the profiles update policy with only a USING clause:
--
--     create policy "profiles_update_own" on public.profiles
--       for update using (auth.uid() = id);
--
-- PostgreSQL applies USING as the implicit WITH CHECK when WITH CHECK is
-- omitted (docs: "if no WITH CHECK expression is defined, then the USING
-- expression will be used both..."), so the policy is NOT exploitable today:
-- reassigning `id` to another user's uuid would already fail the implicit
-- check. This migration makes the intent explicit and pins the role:
--
--   1. WITH CHECK (auth.uid() = id) — explicit, self-documenting, and
--      resilient: if a future edit broadens USING, the write-side guard no
--      longer silently follows it.
--
--   2. TO authenticated — explicit role scoping matching the storage
--      policies in 0001. Defaults to PUBLIC otherwise; `auth.uid()` is null
--      for anon so this is defense-in-depth, not a behavior change.
--
-- The `profiles_protect_tier` trigger (0002) is orthogonal: it fires for all
-- roles, including service_role, and is not affected by this policy change.
-- ============================================================================

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
