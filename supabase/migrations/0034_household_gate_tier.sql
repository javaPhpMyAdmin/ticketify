-- 0034_household_gate_tier.sql
-- ---------------------------------------------------------------------------
-- Security fix: household creation must gate on the server-authoritative
-- `tier`, never on the client-writable `subscription_status`.
--
-- Background (adversarial security review finding)
-- ------------------------------------------------
--   profiles.subscription_status is client-writable via the exposed RPC
--   sync_client_subscription(p_status) (0018) — a SECURITY DEFINER function
--   granted to `authenticated` whose allow-list included 'active'. The app
--   calls it optimistically after purchase (void fire-and-forget), but there
--   is NO server-side verification of the claim: any authenticated client
--   could call it with 'active' directly.
--
--   create_household (0017/0025) authorized on `tier = 'pro' OR
--   subscription_status IN ('trial','active')`, so a free user could call
--   sync_client_subscription('active') and then create_household(...) — a
--   paid feature (shared household) without payment.
--
-- What this migration does
-- ------------------------
--   §1  create_household — gate narrowed to `tier = 'pro'` ONLY.
--       tier is server-authoritative: it is written exclusively by
--       set_profile_tier (service-role, RevenueCat webhook path),
--       start_free_trial (0016 §2 / 0021 §5 — sets tier='pro' on trial
--       activation) and expire_overdue_trials (0020 — flips tier back to
--       'free' on expiry). Trials are therefore already reflected in tier,
--       so gating on tier='pro' alone keeps trial access working (no
--       regression — verified against the trial activation/expiry paths
--       above). All other behavior — ownership, household_id generation,
--       join semantics, SECURITY DEFINER posture, error codes — is
--       preserved exactly.
--   §2  sync_client_subscription — 'active' removed from the allow-list.
--       Only the RevenueCat webhook (sync_subscription_status,
--       service-role only) may assert 'active'. Allowing clients to claim
--       it (i) was the vector for the create_household spoof above and
--       (ii) let a trialing user move off 'trial', freezing the
--       expire_overdue_trials materialization while tier stays 'pro' past
--       trial_ends_at. Clients may still claim 'none'/'trial'/'expired' —
--       those cannot grant Pro capability (tier is the only gate) and
--       cannot freeze expiry (this RPC never writes trial_ends_at). The
--       client's optimistic sync calls (`void syncSubscriptionStatus(
--       'active')` in src/app/pro/index.tsx) fail non-blocking: the helper
--       catches the RPC error, logs a console.warn and never throws; the
--       webhook reconciles.
--   §3  Owner pin + least-privilege grants — `create or replace function`
--       resets EXECUTE to PUBLIC (the 0029 §4 trap), turning these
--       SECURITY DEFINER RPCs into unauthenticated oracles. Re-pin the
--       owner to postgres (0031 §2 style) and re-apply authenticated-role-
--       only execution (revoke public/anon, grant authenticated — 0026 §5 /
--       0031 §3 style).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- §1. create_household — tier-only gate
--
-- Old: tier = 'pro' OR subscription_status IN ('trial', 'active')
-- New: tier = 'pro' (only)
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
  -- Verify the caller is Pro. `tier` is the server-authoritative access
  -- primitive — written only by set_profile_tier (service-role webhook
  -- path), start_free_trial (trial activation sets tier='pro') and
  -- expire_overdue_trials (expiry flips tier back to 'free'). The
  -- client-writable subscription_status is deliberately NOT trusted for
  -- authorization (sync_client_subscription, 0018).
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and tier = 'pro'
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

-- Pins the definer owner (required for SECURITY DEFINER to bypass RLS as
-- postgres). Idempotent belt-and-braces, 0025/0026 style.
alter function public.create_household(p_name text) owner to postgres;

comment on function public.create_household(p_name text) is
  'Creates a household with the caller as owner. SECURITY DEFINER (owner: postgres). Gate: tier = ''pro'' ONLY — subscription_status is client-writable (sync_client_subscription) and never authorizes paid capability. Raises Pro subscription required otherwise.';

-- ---------------------------------------------------------------------------
-- §2. sync_client_subscription — 'active' is no longer client-claimable
--
-- Old allow-list: ('none', 'trial', 'active', 'expired')
-- New allow-list: ('none', 'trial', 'expired')
--
-- 'active' asserts a PAID subscription. Only the RevenueCat webhook
-- (sync_subscription_status, service-role only) may write it. Keeping it
-- client-claimable would (a) re-open the create_household spoof (fixed in
-- §1) and (b) let a trialing user freeze the cron-driven expiry: a user in
-- status='trial' with tier='pro' who claims 'active' leaves the
-- expire_overdue_trials WHERE (subscription_status = 'trial') and keeps
-- tier='pro' past trial_ends_at until a webhook event reconciles. 'active'
-- is therefore reserved for the webhook; no client can assert it.
-- ---------------------------------------------------------------------------

create or replace function public.sync_client_subscription(
  p_status text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  -- Validate the status value. 'active' is intentionally rejected: paid
  -- status is asserted only by the RevenueCat webhook via
  -- sync_subscription_status (service-role). The remaining values cannot
  -- grant Pro capability (tier is the only gate) and cannot freeze trial
  -- expiry (this RPC never writes trial_ends_at).
  if p_status not in ('none', 'trial', 'expired') then
    raise exception 'invalid subscription status: %', p_status;
  end if;

  -- Update the caller's own profile. SECURITY DEFINER bypasses the
  -- protect_profile_tier trigger. auth.uid() ensures callers cannot
  -- target other users.
  update public.profiles
     set subscription_status = p_status
   where id = auth.uid();

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Pins the definer owner (belt-and-braces, 0031 §2 style).
alter function public.sync_client_subscription(text) owner to postgres;

comment on function public.sync_client_subscription(text) is
  'Client-side subscription_status sync (auth.uid()-scoped). SECURITY DEFINER. Allow-list: none|trial|expired ONLY — ''active'' is reserved for the RevenueCat webhook (sync_subscription_status, service-role) because clients cannot verify a paid claim.';

-- ---------------------------------------------------------------------------
-- §3. Least-privilege execution (0026 §5 / 0031 §3 style)
--
-- `create or replace function` resets EXECUTE to PUBLIC (the 0029 §4 trap):
-- an unauthenticated caller could otherwise execute these definer RPCs as
-- postgres and use them as oracles. Revoke from public/anon and grant to
-- authenticated only.
-- ---------------------------------------------------------------------------

revoke all on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

revoke all on function public.sync_client_subscription(text) from public, anon;
grant execute on function public.sync_client_subscription(text) to authenticated;