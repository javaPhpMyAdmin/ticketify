-- ============================================================================
-- Ticketify — purchases.is_manual: distinguish manual vs scanned tickets
--
-- The app internally knows (by UI flow) whether a ticket was camera-scanned
-- or entered manually, but that distinction was not modeled: `image_url IS
-- NULL` was the only fragile proxy (updateReceipt can wipe the photo of a
-- scanned ticket). This migration adds a persistent origin column:
--
-- What this migration does
-- ------------------------
--   §1  purchases.is_manual boolean NOT NULL DEFAULT false.
--   §2  One-time backfill: image_url IS NULL rows become manual (the demo
--       seeds with no photo are manual entries; picsum rows stay scanned).
--   §3  save_receipt() 7-param overload with p_is_manual (DEFAULT false).
--   §4  Grants for the NEW signature (authenticated only) + revoke.
--
-- The 6-param save_receipt(uuid, date, numeric, text, text,
-- public.purchase_item_input[]) from 0023 REMAINS as the compat/rollback
-- cushion: old clients that omit p_is_manual resolve to the exact 6-param
-- match; new clients (named notation with p_is_manual) resolve to the
-- 7-param. The old overload will be dropped in a LATER migration once the
-- new client is confirmed in production (same reason 0023 kept
-- consume_scan_on_save).
--
-- Origin is immutable: updateReceipt / restorePurchase NEVER write
-- is_manual (the client omits it and the column is NOT in any UPDATE), so
-- a ticket keeps its origin for life. A future "change origin" feature
-- needs its own migration + flow, never the edit path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. purchases.is_manual — origin column (false = scanned, true = manual)
-- ---------------------------------------------------------------------------

alter table public.purchases
  add column is_manual boolean not null default false;

comment on column public.purchases.is_manual is
  'Ticket origin: true when the purchase was entered manually (no photo), false when created from a camera scan. Set ONLY at INSERT inside save_receipt (from p_is_manual); never updated afterwards (origin is immutable across edits).';

-- ---------------------------------------------------------------------------
-- §2. Backfill — image_url IS NULL rows are manual entries
--
-- The only historical proxy available (spec-approved): a purchase without
-- a photo could only have been entered manually. Affects exactly the demo
-- seed rows without an image (a1-a6, a9); the picsum rows (a7/a8) stay
-- scanned. Reversible via a flip UPDATE (is_manual = false WHERE ...).
-- ---------------------------------------------------------------------------

update public.purchases
   set is_manual = true
 where image_url is null;

-- ---------------------------------------------------------------------------
-- §3. save_receipt() — 7-param overload with p_is_manual
--
-- Body identical to 0023 §2 EXCEPT the purchases INSERT gains `is_manual`
-- (from p_is_manual, default false). All invariants from 0023 are kept:
-- SECURITY DEFINER + auth.uid() scoping, tier-aware atomic scan-slot
-- increment (TOCTOU-closed), the item/array guards, the forced
-- total_price = quantity * unit_price, and the single implicit transaction
-- that rolls back everything on ANY failure — including the slot increment.
--
-- Returns (ok, purchase_id, scans_used, scans_limit). ok=false when the
-- free-tier cap is reached — never raises (same contract as 0023).
-- ---------------------------------------------------------------------------

create or replace function public.save_receipt(
  p_store_id       uuid,
  p_purchase_date  date,
  p_total          numeric,
  p_payment_method text,
  p_image_url      text,
  p_items          public.purchase_item_input[],
  p_is_manual      boolean default false
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
  -- `is_manual` is set HERE from p_is_manual — the ONLY writer of origin.
  insert into public.purchases (
    user_id, store_id, purchase_date, total, payment_method, image_url, status, is_manual
  ) values (
    v_user, p_store_id, p_purchase_date, p_total, p_payment_method, p_image_url, 'confirmed', p_is_manual
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

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) is
  'Transactional receipt save with origin: checks monthly scan cap, inserts purchases + purchase_items atomically (is_manual from p_is_manual, default false), increments scan slot. SECURITY DEFINER, authenticated-role callable. Returns (ok, purchase_id, scans_used, scans_limit). ok=false when the free-tier cap is reached (never raises). 7-param overload — the 6-param signature from 0023 remains for old clients.';

-- ---------------------------------------------------------------------------
-- §4. Grants — authenticated only, revoke public + anon (NEW signature)
--
-- CREATE OR REPLACE defaults EXECUTE to public on a new signature; this
-- must be revoked the same way 0023 §3 did for the 6-param function. The
-- 0023 grants on the 6-param overload are untouched (still valid).
-- ---------------------------------------------------------------------------

revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) to authenticated;

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) is
  'Transactional receipt save with origin: checks monthly scan cap, inserts purchases + purchase_items atomically (is_manual from p_is_manual), increments scan slot. SECURITY DEFINER, authenticated-role callable.';