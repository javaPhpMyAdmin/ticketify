-- ============================================================================
-- Ticketify — 0046_widen_currency_catalog.sql
--
-- Change: currency-catalog widening (product decision 2026-10-12)
-- Phase:  same save_receipt() validation as 0042, WIDENED catalog (14 → 28)
--
-- What this migration does
-- ------------------------
--   Re-creates public.save_receipt(uuid, date, numeric, text, text,
--   public.purchase_item_input[], text, boolean) — the SAME function 0042
--   shipped — with exactly ONE behavioural difference: the inline catalog
--   gate (`v_currency` `NOT IN (...)`) is widened from 14 to 28 ISO 4217
--   codes (the seven new LATAM codes and the seven new INTL codes added by
--   the 2026-10-12 product decision). Everything else in the function body
--   is byte-identical to 0042.
--
-- Why a new migration and not an edit to 0042
-- -------------------------------------------
--   Applied migrations are immutable, so 0042's body cannot be edited in
--   place. This file therefore carries the full `create or replace function`
--   copy of 0042, plus the trailing COMMENT ON FUNCTION and the grant
--   statements, mirrored verbatim so this file stays self-sufficient. The
--   §1 `add column` and its column COMMENT from 0042 are NOT repeated: they
--   already applied and would fail if re-run.
--
-- Parity
-- ------
--   The literal mirrors SUPPORTED_CURRENCIES in src/lib/format.ts (client
--   source of truth) and its duplicate in supabase/functions/parse-ticket/
--   lib/parse.ts — three independent copies total (the test harness stubs
--   compile the real format.ts, so they are derived, not copies).
--   `scripts/test-currency-catalog.mjs` now reads THIS file (0046) for the
--   inline catalog `NOT IN (...)` parity check; it previously tracked 0042's
--   literal, which is frozen at the 14 codes 0042 shipped. No catalog table
--   by design (NFR-1: no CHECK constraint, catalog lives in code).
--
-- Reversal: `create or replace` the 0042 body back (the 14-code literal), or
-- roll forward; no schema or data change is made here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §2. save_receipt() — 8-param overload with p_currency (shape A)
--
-- Body identical to 0032 §5 EXCEPT:
--   * signature gains `p_currency text` (REQUIRED) before `p_is_manual`;
--   * a catalog re-check normalizes/validates p_currency into v_currency;
--   * the purchases INSERT writes the currency column.
--
-- Everything 0032 established is kept: SECURITY DEFINER + auth.uid() scoping,
-- tier-aware atomic scan-slot increment (TOCTOU-closed), the item/array
-- guards, the forced total_price = quantity * unit_price, and the
-- server-side category ownership validation. All invariants run inside the
-- single implicit transaction that rolls back everything on ANY failure.
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
  p_currency       text,
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
  v_user     uuid := auth.uid();
  v_month    text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_tier     text;
  v_used     int;
  v_limit    int;
  v_pid      uuid;
  v_i        int;
  v_currency text;
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

  -- Catalog re-check (REQ-8 #2 — second of two gates; the edge parse is the
  -- first). A code outside the supported catalog is NOT persisted: it is
  -- normalized to NULL, which is exactly what "no unit detected" stores, so
  -- the receipt falls back to the viewer's profile currency at render time.
  -- This NEVER raises — a guessed or tampered unit must not cost the user an
  -- otherwise valid receipt (the scan slot above is already incremented, and
  -- this branch still saves the row).
  --
  -- The list mirrors SUPPORTED_CURRENCIES in src/lib/format.ts (client
  -- source of truth) and its duplicate in supabase/functions/parse-ticket/
  -- lib/parse.ts — three independent copies total (the test harness stubs
  -- compile the real format.ts, so they are derived, not copies). Keep them
  -- in sync; parity is pinned on both sides: the edge copy by
  -- scripts/test-parse-ticket.mjs, this literal by
  -- scripts/test-currency-catalog.mjs. No catalog table by design (NFR-1:
  -- no CHECK constraint, catalog lives in code).
  if p_currency is not null then
    v_currency := upper(btrim(p_currency));
    if v_currency not in (
      -- LATAM
      'ARS', 'BOB', 'BRL', 'CLP', 'COP', 'CRC', 'DOP', 'GTQ', 'HNL', 'MXN', 'NIO', 'PAB', 'PEN', 'PYG', 'UYU',
      -- INTL
      'AUD', 'CAD', 'CHF', 'DKK', 'EUR', 'GBP', 'HKD', 'JPY', 'NOK', 'NZD', 'SEK', 'SGD', 'USD'
    ) then
      v_currency := null;
    end if;
  end if;

  -- Category ownership validation (0032 §5): RLS does not fire here (SECURITY
  -- DEFINER), so ownership is enforced server-side, fail-closed, per line.
  -- NULL passes (legal uncategorized line); any non-NULL id must exist AND be
  -- a global canonical row or a row owned by the caller. Rejects happen
  -- BEFORE the purchases INSERT — the implicit transaction rolls everything
  -- back (scan-slot increment included) on any failure.
  for v_i in 1 .. array_length(p_items, 1) loop
    if p_items[v_i].category_id is not null then
      if not exists (
        select 1 from public.categories c
         where c.id = p_items[v_i].category_id
           and (c.user_id is null or c.user_id = v_user)
      ) then
        raise exception 'invalid item category';
      end if;
    end if;
  end loop;

  -- Insert the purchase row (status 'confirmed' as the client sets it).
  -- `is_manual` is set HERE from p_is_manual — the ORIGIN writer, once.
  -- `currency` is set HERE from v_currency on create; afterwards only the
  -- recorded unit can change (the edit-path updateReceipt PATCH writes it
  -- via normalizeCurrency, restorePurchase puts the pre-edit value back) —
  -- neither ever touches is_manual.
  insert into public.purchases (
    user_id, store_id, purchase_date, total, payment_method, image_url, status, is_manual, currency
  ) values (
    v_user, p_store_id, p_purchase_date, p_total, p_payment_method, p_image_url, 'confirmed', p_is_manual, v_currency
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

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], text, boolean) is
  'Transactional receipt save with origin AND unit (0042): checks monthly scan cap, validates every line category server-side (NULL, global canonical, or owned by the caller — fail-closed, 0032 §5), catalog-checks p_currency (out-of-catalog normalized to NULL, never raised — REQ-8 #2), inserts purchases + purchase_items atomically (is_manual from p_is_manual, currency from the re-checked p_currency), increments scan slot. SECURITY DEFINER, authenticated-role callable. Returns (ok, purchase_id, scans_used, scans_limit); ok=false when the free-tier cap is reached (never raises). 8-param overload in SHAPE A: p_currency is REQUIRED and precedes the defaulted p_is_manual, because Postgres has no fewest-defaults tie-break (42P03) — a defaulted p_currency would make the live 7-key call ambiguous (PGRST203). The 6-param and 7-param signatures from 0023/0029/0032 are untouched.';

-- ---------------------------------------------------------------------------
-- §3. Grants — authenticated only, revoke public + anon (NEW signature)
--
-- CREATE OR REPLACE on a NEW signature defaults EXECUTE to public; revoke it
-- exactly the way 0023 §3 and 0029 §4 did. The 0032 grants on the 6-param
-- and 7-param overloads are untouched (still valid).
-- ---------------------------------------------------------------------------

revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], text, boolean) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], text, boolean) to authenticated;

-- Re-stated for the two pre-existing signatures (0032 §5 house style): keeps
-- this file self-sufficient if it is ever applied to a partial stack where
-- 0032's grants never ran. No behaviour change.
revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) to authenticated;

revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) to authenticated;
