-- ============================================================================
-- Ticketify — Household Owner-Pays Rule (PR 5)
--
-- Changes the household subscription gate from "all members must be Pro"
-- to "only the owner must be Pro (or trialing)". Members can participate
-- regardless of their subscription status.
--
-- What this migration does
-- ------------------------
--   §1  create_household — owner Pro check expanded to include trial
--   §2  generate_invite_code — Pro tier check removed (owner already validated)
--   §3  join_household — Pro tier check removed (anyone can join)
--   §4  is_household_member — no change needed (no tier check existed)
--
-- What this migration does NOT do
-- --------------------------------
--   - No client-side code changes
--   - No RLS policy changes
--   - No new tables or columns
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. create_household — owner Pro/trial check
--
-- Old: tier = 'pro' only
-- New: tier = 'pro' OR subscription_status IN ('trial', 'active')
-- Allows trial users to create households during their trial window.
-- ---------------------------------------------------------------------------

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
  -- Verify the caller has an active subscription or valid trial.
  -- Owner-pays rule: only the household creator must be Pro/trialing.
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

comment on function public.create_household(text) is
  'Creates a new household with the caller as owner. Owner must be Pro or trialing. Returns the household UUID.';

-- ---------------------------------------------------------------------------
-- §2. generate_invite_code — remove Pro tier check
--
-- Old: tier = 'pro' check required
-- New: check removed — owner validation is already done via the household
--      ownership check (v_owner != auth.uid() guard). Any household owner
--      can generate invite codes regardless of subscription status.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- §3. join_household — remove Pro tier check
--
-- Old: tier = 'pro' check required
-- New: check removed — any authenticated user with a valid invite code can
--      join a household regardless of subscription status. Members participate
--      free per the owner-pays rule.
-- ---------------------------------------------------------------------------

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
  'Joins a household via invite code. No subscription required — members participate free.';
