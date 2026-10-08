-- 0043_household_entry_currency.sql
-- ---------------------------------------------------------------------------
-- money-integrity — slice A, §entry only (tasks.md 3.2, A-entry sub-split).
--
-- What this slice does
-- --------------------
--   §1  households.currency — the household's single unit. Nullable, NO
--       backfill, NO check constraint: rows created before this migration
--       keep NULL and are treated as "currency unknown" everywhere (spec
--       Non-Goal: no migration SHALL backfill existing rows). Every
--       household created through create_household gets a value below. A
--       distinct client INSERT path (the households_insert_owner policy)
--       can bypass the RPC and leave currency NULL — direct inserts are
--       out of scope for this change.
--   §2  create_household — seeds households.currency from the creator's
--       profile currency (spec: Household Entry Single-Currency Check,
--       "Creator establishes the household currency").
--   §3  join_household — raises `currency_mismatch` with the structured
--       SQLSTATE `CU001` when the caller's profile currency differs from
--       the household's, BEFORE the invite code is consumed: a rejected
--       join creates no membership row, does not set profiles.household_id,
--       and leaves the code usable. The structured code is NEW vs the house
--       string-only pattern (P0002/plain messages) — it exists for
--       observability and alert grouping; the message text stays stable for
--       clients. A NULL household currency (pre-0043 row) skips the check.
--       The check runs ONLY at entry — nothing re-validates or revokes
--       later (decision 1).
--   §4  Owner pin + least-privilege re-apply (0034 §3 / 0026 §5): `create
--       or replace function` resets EXECUTE to PUBLIC (the 0029 §4 trap),
--       so both definer RPCs are re-pinned to postgres and re-granted to
--       authenticated only. §4 also revokes UPDATE (currency) from
--       authenticated: the household currency is established at creation
--       (spec) and households_update_owner otherwise lets an owner UPDATE
--       any column — including NULLing the currency, which would silently
--       disable the entry check via the NULL-skip branch. CAVEAT (verified
--       empirically on the local stack): Postgres ignores a column-level
--       revoke while a table-level UPDATE grant is held, and the platform
--       issues `grant all on all tables in schema public` to authenticated —
--       so this revoke is belt-and-braces today and bites only once the
--       table-level grant is narrowed. The real protection is that no
--       client write path touches the column. Hard enforcement (a
--       BEFORE UPDATE trigger, or a table-level revoke + column re-grants)
--       is left as an explicit follow-up decision, not silently applied.
--
-- Deliberately NOT in this slice (land in the A-main follow-up migration,
-- 0044_grouped_aggregation.sql): grouped aggregation in
-- monthly_category_totals / monthly_purchases_total, the monthly_user_totals
-- cache re-key, and the recalculate_monthly_totals rewrite.
--
-- Normalization judgment: both sides of the check are compared as
-- upper(btrim(...)). profiles.currency has been written as 'USD' (0001),
-- 'usd' (0040) and 'USD' again (0041), and NFR-1 calls for a canonical
-- uppercase ISO code — a raw equality would wrongly reject a 'usd' profile
-- against a 'USD' household. households.currency is seeded already
-- canonicalized (the write boundary normalizes, NFR-1 spirit).
--
-- No catalog validation: the entry check deliberately does NO catalog check
-- (upper/btrim only) — it is product simplicity, NOT a correctness
-- guarantee (spec household-sharing), unlike 0042's save_receipt write
-- path, which catalog-checks p_currency. Aggregation stays correct on its
-- own because it groups by recorded unit.
--
-- Non-breaking: the column is nullable and no existing RPC reads it;
-- create_household/join_household keep their signatures, SECURITY DEFINER
-- posture, tier gate, capacity check, and error codes (the only new error
-- is `currency_mismatch` / SQLSTATE `CU001`).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- §1. households.currency
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists currency text;

comment on column public.households.currency is
  'Single currency of the household, seeded from the creator''s profile currency at creation (0043 §entry). NULL on pre-0043 rows (no backfill) — entry checks skip NULL. Entry-only: never re-validated, never used as an aggregation label.';

-- ---------------------------------------------------------------------------
-- §2. create_household — seed currency from the creator's profile
--
-- Body is 0034 §1 (tier-only gate, owner membership, profiles.household_id)
-- plus the currency seed. All other behavior is preserved exactly.
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_hid      uuid;
  v_currency text;
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

  -- Entry single-currency (0043 §entry): the creator's profile currency
  -- becomes the household currency, canonicalized (upper/btrim) at the
  -- write boundary — profiles.currency saw 'USD'/'usd'/'USD' across
  -- 0001/0040/0041.
  select upper(btrim(currency)) into v_currency
    from public.profiles where id = auth.uid();

  -- Create the household.
  insert into public.households (name, created_by, currency)
  values (p_name, auth.uid(), v_currency)
  returning id into v_hid;

  -- Add the caller as owner.
  insert into public.household_members (household_id, user_id, role)
  values (v_hid, auth.uid(), 'owner');

  -- Set the caller's household_id.
  update public.profiles set household_id = v_hid where id = auth.uid();

  return v_hid;
end;
$$;

-- ---------------------------------------------------------------------------
-- §3. join_household — entry single-currency check
--
-- Body is 0026 §1 (already-in-household, code resolution, capacity, code
-- consumption, membership, profiles.household_id) plus the currency check
-- inserted AFTER the capacity check and BEFORE the code is consumed, so a
-- rejection costs the caller nothing and the fixture code stays usable.
-- ---------------------------------------------------------------------------

create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_hid            uuid;
  v_count          int;
  v_hh_currency    text;
  v_caller_currency text;
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

  -- Entry single-currency check (0043 §entry): reject a caller whose
  -- profile currency differs from the household's, BEFORE any state is
  -- written — no code consumed, no membership row, household_id stays
  -- NULL. A NULL household currency (pre-0043 row, no backfill) skips
  -- the check. Both sides compared canonically (upper/btrim); the check
  -- runs ONLY at entry — nothing re-validates a member afterwards.
  select upper(btrim(h.currency)) into v_hh_currency
    from public.households h
   where h.id = v_hid;

  if v_hh_currency is not null then
    select upper(btrim(p.currency)) into v_caller_currency
      from public.profiles p
     where p.id = auth.uid();

    if v_caller_currency is distinct from v_hh_currency then
      -- Structured raise (4R CRITICAL-1): a dedicated SQLSTATE gives
      -- observability tooling and alert grouping a stable code to key on
      -- — unlike the house string-only pattern (plain messages, P0002).
      -- `message` stays exactly 'currency_mismatch' so client string
      -- matching is unchanged.
      raise exception
        using errcode = 'CU001',
              message = 'currency_mismatch',
              detail  = 'Household currency differs from the caller profile currency';
    end if;
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
-- §4. Definer owner + comments + least-privilege execution
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER runs as the function owner; pin both to postgres so a
-- non-postgres migration runner cannot leave them owned by a lesser role.
-- Idempotent belt-and-braces, 0025/0026/0034 style.
alter function public.create_household(p_name text) owner to postgres;
alter function public.join_household(p_code text) owner to postgres;

comment on function public.create_household(p_name text) is
  'Creates a household with the caller as owner and seeds households.currency from the caller''s profile currency (0043 §entry). SECURITY DEFINER (owner: postgres). Gate: tier = ''pro'' ONLY — subscription_status is client-writable (sync_client_subscription) and never authorizes paid capability. Raises Pro subscription required otherwise.';

comment on function public.join_household(text) is
  'Join a household by invite code. Validates the code, enforces the entry single-currency check (currency_mismatch / SQLSTATE CU001 when the caller''s profile currency differs from the household''s; NULL household currency skips; 0043 §entry — entry-only, nothing re-validates later), adds the caller as a member, and sets profiles.household_id. SECURITY DEFINER: membership insert must bypass the owner-only INSERT policy while the RPC holds the security checks.';

-- Least privilege: `create or replace function` resets EXECUTE to PUBLIC
-- (the 0029 §4 trap) — an unauthenticated caller could otherwise execute
-- these definer RPCs as postgres and use them as oracles. Revoke from
-- public/anon and grant to authenticated only (0034 §3 / 0026 §5).
revoke all on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

revoke all on function public.join_household(text) from public, anon;
grant execute on function public.join_household(text) to authenticated;

-- Established-at-creation invariant (spec: "A household SHALL have one
-- currency, established at creation"): households_update_owner lets an owner
-- UPDATE any column, and NULLing currency would silently disable the entry
-- check via the NULL-skip branch. This column-level revoke is intended to
-- keep every other column writable while making the household currency
-- immutable to clients.
--
-- CAVEAT (verified empirically): a column-level revoke does NOT override a
-- table-level UPDATE grant, and the platform grants `grant all on all tables
-- in schema public` to authenticated — so this statement is belt-and-braces
-- today (has_column_privilege stays true after it). It bites only once the
-- table-level grant is narrowed. The real protection is that no client write
-- path sets households.currency (0043 §entry seeds it through the definer
-- RPC). Hard enforcement is a follow-up decision.
revoke update (currency) on public.households from authenticated;
