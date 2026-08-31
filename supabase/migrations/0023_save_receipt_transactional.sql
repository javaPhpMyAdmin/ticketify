-- ============================================================================
-- Ticketify — save_receipt: single transactional receipt-save RPC
--
-- Replaces the two-step client flow (consume_scan_on_save → purchases insert
-- → purchase_items insert) with a single SECURITY DEFINER function that
-- atomically:
--   1. Checks the monthly scan cap (tier-aware, uses 0021's guarded atomic
--      UPDATE pattern).
--   2. Inserts the purchases row (status 'confirmed').
--   3. Inserts the purchase_items rows via unnest.
--   4. Returns the new purchase_id and updated scan counts.
--
-- Because PL/pgSQL runs in one implicit transaction, a failure at ANY point
-- (including after the scan-slot increment) rolls back the entire function
-- — so there is no window where the slot is consumed but the write fails.
-- The SECURITY DEFINER owner (postgres) bypasses RLS on purchases,
-- purchase_items, and scan_usage (no FORCE ROW LEVEL SECURITY anywhere).
--
-- What this migration does
-- ------------------------
--   §1  purchase_item_input composite type (RPC array argument shape).
--   §2  save_receipt() — the transactional save RPC.
--   §3  Grants (authenticated only) + revoke.
--
-- NOTE: consume_scan_on_save (0021 §3) is intentionally NOT dropped here.
-- It is kept for this release to avoid breaking a rollback path if the new
-- client is deployed before the migration or vice versa. It will be removed
-- in a later migration once the new client is confirmed in production.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. purchase_item_input — composite type for the RPC array argument
-- ---------------------------------------------------------------------------

create type public.purchase_item_input as (
  name        text,
  quantity    numeric,
  unit_price  numeric,
  total_price numeric,
  category_id uuid,
  is_impulse  boolean,
  sort_order  int
);

comment on type public.purchase_item_input is
  'Row type for passing purchase line items into save_receipt. Matches the purchase_items columns (minus purchase_id, which the RPC provides).';

-- Least privilege: only 'authenticated' needs to construct this type (to call
-- save_receipt). Avoid exposing USAGE to anon/public so it can't be a
-- stepping stone for future functions that reference it.
revoke usage on type public.purchase_item_input from public, anon;
grant usage on type public.purchase_item_input to authenticated;

-- ---------------------------------------------------------------------------
-- §2. save_receipt() — single transactional receipt-save RPC
--
-- SECURITY DEFINER, auth.uid()-scoped. The caller provides the receipt
-- metadata + an array of purchase_item_input rows. The function:
--   1. Validates the authenticated user exists.
--   2. Seeds the scan_usage row if missing (0021 pattern).
--   3. Atomically increments the scan slot with a tier-aware cap check
--      (re-reads profiles.tier inside the UPDATE to close TOCTOU).
--   4. Inserts the purchases row (status 'confirmed').
--   5. Inserts all purchase_items rows via unnest.
--
-- Returns (ok, purchase_id, scans_used, scans_limit). ok=false when the
-- free-tier cap is reached — never raises (same contract as
-- consume_scan_on_save). Any other failure (DB error, missing profile,
-- empty items array) raises an exception which rolls back everything
-- including the slot increment.
-- ---------------------------------------------------------------------------

create or replace function public.save_receipt(
  p_store_id       uuid,
  p_purchase_date  date,
  p_total          numeric,
  p_payment_method text,
  p_image_url      text,
  p_items          public.purchase_item_input[]
)
returns table (
  ok         boolean,
  purchase_id uuid,
  scans_used  int,
  scans_limit int
)
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_tier  text;
  v_used  int;
  v_limit int;
  v_pid   uuid;
  v_i     int;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  -- Read tier for the initial scan_usage seed (same pattern as 0021 §3).
  select tier into v_tier from public.profiles where id = v_user;
  v_tier := coalesce(v_tier, 'free');

  -- Seed the row if it does not exist yet (first save of the month).
  insert into public.scan_usage (user_id, year_month, scans_used, scans_limit)
  values (v_user, v_month, 0,
          case when v_tier = 'pro' then null else 15 end)
  on conflict (user_id, year_month) do nothing;

  -- Guarded atomic increment: re-reads profiles.tier inside the UPDATE via
  -- FROM to close the TOCTOU window between the seed read and the decision.
  -- Pro users always pass; free users must be under the cap.
  update public.scan_usage su
     set scans_used = su.scans_used + 1
    from public.profiles pr
   where su.user_id = v_user
     and su.year_month = v_month
     and pr.id = v_user
     and (pr.tier = 'pro' or su.scans_used < coalesce(su.scans_limit, 15))
   returning su.scans_used, su.scans_limit into v_used, v_limit;

  if not found then
    -- Cap reached: read the current counts for the caller (ok=false, no raise).
    select su.scans_used, su.scans_limit
      into v_used, v_limit
      from public.scan_usage su
     where su.user_id = v_user
       and su.year_month = v_month;

    ok         := false;
    purchase_id := null;
    scans_used  := coalesce(v_used, 0);
    scans_limit := coalesce(v_limit, 15);
    return next;
    return;
  end if;

  -- Guard: receipt must have at least one item, and cap the array size so a
  -- malicious/greedy client cannot send a huge array and exhaust resources.
  if p_items is null or array_length(p_items, 1) is null or array_length(p_items, 1) = 0 then
    raise exception 'receipt requires at least one item';
  end if;
  if array_length(p_items, 1) > 500 then
    raise exception 'too many items (max 500)';
  end if;

  -- Monetary validation (per user decision 2026-08-31): conservative, data
  -- hygiene not total exactness. Enforce hard, non-fixable invariants — a
  -- line with quantity <= 0 or a negative unit price is broken data and the
  -- save is rejected (everything rolls back). The month total is only checked
  -- to be non-negative: receipts carry end-of-receipt discounts (debit/card
  -- promo, "descuento de ley", coupons) that are NOT line items, so the sum
  -- of line totals does not have to equal the final total-to-pay.
  if p_total is null or p_total < 0 then
    raise exception 'invalid receipt total';
  end if;
  for v_i in 1 .. array_length(p_items, 1) loop
    if p_items[v_i].quantity is null or p_items[v_i].quantity <= 0 then
      raise exception 'invalid item quantity';
    end if;
    if p_items[v_i].unit_price is null or p_items[v_i].unit_price < 0 then
      raise exception 'invalid item unit price';
    end if;
  end loop;

  -- Insert the purchase row (status 'confirmed' as the client sets it).
  insert into public.purchases (
    user_id, store_id, purchase_date, total, payment_method, image_url, status
  ) values (
    v_user, p_store_id, p_purchase_date, p_total, p_payment_method, p_image_url, 'confirmed'
  )
  returning id into v_pid;

  -- Insert all purchase_items rows from the input array. `x` is of the named
  -- composite type purchase_item_input, so no column definition list is
  -- allowed (and none is needed — the field names come from the type).
  --
  -- total_price is FORCED to quantity * unit_price (per user decision
  -- 2026-08-31): a line where the sent total_price disagrees (dirty OCR /
  -- tampered client) is corrected to the consistent value instead of
  -- rejecting the whole receipt.
  insert into public.purchase_items (
    purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order
  )
  select
    v_pid,
    x.name,
    x.quantity,
    x.unit_price,
    x.quantity * x.unit_price,
    x.category_id,
    x.is_impulse,
    x.sort_order
  from unnest(p_items) as x;

  ok         := true;
  purchase_id := v_pid;
  scans_used  := v_used;
  scans_limit := v_limit;
  return next;
end;
$$;

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) is
  'Transactional receipt save: checks monthly scan cap, inserts purchases + purchase_items atomically, increments scan slot. SECURITY DEFINER, authenticated-role callable. Returns (ok, purchase_id, scans_used, scans_limit). ok=false when the free-tier cap is reached (never raises).';

-- ---------------------------------------------------------------------------
-- §3. Grants — authenticated only, revoke public + anon
-- ---------------------------------------------------------------------------

revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) to authenticated;

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) is
  'Transactional receipt save: checks monthly scan cap, inserts purchases + purchase_items atomically, increments scan slot. SECURITY DEFINER, authenticated-role callable.';
