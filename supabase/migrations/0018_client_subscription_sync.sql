-- ============================================================================
-- Ticketify — Client-Side Subscription Sync (PR 6: RevenueCat Webhook)
--
-- Adds sync_client_subscription() RPC so the client can optimistically
-- update subscription_status after a purchase or restore, without waiting
-- for the RevenueCat webhook to arrive.
--
-- Uses auth.uid() to scope the update to the caller's own profile —
-- unlike sync_subscription_status(uuid, text, timestamptz) which accepts
-- any user_id and is service-role only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- sync_client_subscription() — authenticated-user RPC
--
-- Allows the client to set its own subscription_status after a purchase,
-- restore, or trial activation. The protect_profile_tier trigger allows
-- this because it runs as SECURITY DEFINER (current_user = 'postgres').
--
-- Parameters:
--   p_status — new subscription_status ('active', 'trial', 'expired', 'none')
--
-- Security: uses auth.uid() — callers can only update their own profile.
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
  -- Validate the status value.
  if p_status not in ('none', 'trial', 'active', 'expired') then
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

-- Grant to authenticated (client SDK, user-initiated).
grant execute on function public.sync_client_subscription(text) to authenticated;

comment on function public.sync_client_subscription(text) is
  'Client-side subscription_status sync. Uses auth.uid() — callers can only update their own profile. SECURITY DEFINER to bypass protect_profile_tier trigger.';
