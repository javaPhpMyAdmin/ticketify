/**
 * Pure manual-receipt payload builders — no React, no Supabase, no RN.
 *
 * Node-loadable: every export is a plain function that operates on typed
 * data structures.  The node harness (`scripts/test-manual-receipt.mjs`)
 * compiles and imports these functions directly to verify the payload
 * contract without a device.
 *
 * The api seam (`buildSaveReceiptArgs`) resolves category slugs to DB
 * uuids at save time; the row builder here keeps the app-level slug
 * identity so the test contract stays device-free.
 */

import { todayLocalISO } from '@/lib/format';
import type {
  CardType,
  PaymentMethod,
  ReceiptDraft,
  ReviewItem,
} from '@/types';

// ---------------------------------------------------------------------------
// PurchaseItemInput — mirrors `public.purchase_item_input` (migration 0023).
// Structurally identical to the row shape the api seam sends to save_receipt.
// Kept in this module so the pure builder's return type is self-documenting
// and node-loadable; the api seam defines its own structural equivalent.
// ---------------------------------------------------------------------------

/**
 * Category slug (app-level identity, e.g. 'otros' | 'lacteos').
 *
 * A slug is NOT a DB uuid: it MUST never be sent raw to the `save_receipt`
 * RPC — it has to pass through the slug→uuid resolution in the api seam
 * (`buildSaveReceiptArgs` → `fetchCategoryIdsBySlug`). The brand exists only
 * in the type system (runtime value stays the plain slug string), so the
 * node harness and the seam assign/compare it without casts, while PR3 gets
 * a compile-time error if it tries to feed a slug straight into an RPC arg.
 */
export type CategorySlug = string & { readonly __categorySlug: unique symbol };

/**
 * One row in the `p_items` array sent to the `save_receipt` RPC.
 *
 * `category_id` at this level is a **slug** (app-level category identity);
 * the api seam (`buildSaveReceiptArgs`) resolves slugs to DB uuid FKs
 * before the RPC call.
 */
export interface PurchaseItemInput {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  /** Category slug (app-level identity); resolved to a uuid FK by the seam. */
  category_id: CategorySlug | null;
  is_impulse: boolean;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Manual form error codes
// ---------------------------------------------------------------------------

/** Stable error codes returned by `validateManualForm`. */
export const MANUAL_FORM_ERROR = {
  STORE_REQUIRED: 'store_required',
  DATE_REQUIRED: 'date_required',
  ITEMS_REQUIRED: 'items_required',
  QUANTITY_INVALID: 'quantity_invalid',
  PRICE_INVALID: 'price_invalid',
  TOTAL_INVALID: 'total_invalid',
} as const;

// ---------------------------------------------------------------------------
// buildManualDraft
// ---------------------------------------------------------------------------

/**
 * Builds a `ReceiptDraft` from a manual-entry form.
 *
 * `image_url` is always `''` — manual entries carry no photo.  The RPC
 * persists `null` (the seam converts `''` via `draft.image_url || null`).
 * `is_manual` is always `true` — the draft body IS the origin carrier: the
 * shared seam (`buildSaveReceiptArgs`) emits `p_is_manual: draft.is_manual
 * ?? false`, so the manual flow reaches the RPC as manual while scan drafts
 * (which never set the field) stay scanned (migration 0029).
 * Card fields are optional display metadata; the seam and RPC never send
 * them (decision #1137: manual entries share scans_used/scans_limit;
 * `card_brand`/`card_type` are draft-only display).
 */
export function buildManualDraft(
  storeName: string,
  purchaseDate: string,
  items: ReviewItem[],
  total: number,
  paymentMethod: PaymentMethod,
  cardType?: CardType | null,
): ReceiptDraft {
  return {
    store_name: storeName,
    // Default to today's date when none is provided (mirrors startDraft).
    purchase_date: purchaseDate || todayLocalISO(),
    total,
    payment_method: paymentMethod,
    is_manual: true,
    image_url: '',
    card_type: cardType ?? null,
    items,
  };
}

// ---------------------------------------------------------------------------
// validateManualForm
// ---------------------------------------------------------------------------

/** Date validation regex (YYYY-MM-DD with calendar-correct round-trip). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Validates a manual-entry draft before save.  Returns an array of stable
 * error codes (empty array means valid).  Checks:
 *
 * 1. `store_name` is non-blank.
 * 2. `purchase_date` is a valid ISO date string.
 * 3. At least one item exists.
 * 4. Every item has quantity > 0 (integer) and unit_price >= 0.
 * 5. `total` >= 0.
 *
 * If multiple rules fail the codes are returned in canonical order (first
 * match per code, deduped across items).
 *
 * NOTE — deliberately NO cross-check of `draft.total` against
 * Σ(quantity * unit_price): the spec does not define a code for that
 * mismatch (ticket-level discounts and rounding make the sum diverge
 * legitimately), and the RPC already forces each row total server-side
 * (migration 0023 line 195). Validation stays field-level only.
 */
export function validateManualForm(draft: ReceiptDraft): string[] {
  const errors: string[] = [];

  if (draft.store_name.trim() === '') {
    errors.push(MANUAL_FORM_ERROR.STORE_REQUIRED);
  }

  if (!isValidISODate(draft.purchase_date)) {
    errors.push(MANUAL_FORM_ERROR.DATE_REQUIRED);
  }

  if (!draft.items || draft.items.length === 0) {
    errors.push(MANUAL_FORM_ERROR.ITEMS_REQUIRED);
  } else {
    let qtyBad = false;
    let priceBad = false;
    for (const item of draft.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) qtyBad = true;
      if (item.unit_price < 0) priceBad = true;
    }
    if (qtyBad) errors.push(MANUAL_FORM_ERROR.QUANTITY_INVALID);
    if (priceBad) errors.push(MANUAL_FORM_ERROR.PRICE_INVALID);
  }

  if (draft.total < 0) {
    errors.push(MANUAL_FORM_ERROR.TOTAL_INVALID);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// buildItemRows
// ---------------------------------------------------------------------------

/**
 * Pure row builder: converts `ReviewItem[]` to the `purchase_item_input`
 * shape sent to `save_receipt`.
 *
 * - `total_price` is **forced** to `quantity * unit_price` (defense in
 *   depth; the RPC also recomputes server-side — migration 0023 line 195).
 * - `sort_order` matches the input sequence.
 * - `category_id` keeps the app-level **slug** (user pick preferred over the
 *   AI suggestion, fallback `'otros'`); the api seam resolves slugs to DB
 *   uuids via `fetchCategoryIdsBySlug`. CONTRACT: the output rows are
 *   NEVER valid RPC input on their own — `category_id` is a slug, not a
 *   uuid FK, so this result must go through `buildSaveReceiptArgs` before
 *   `save_receipt`. The `CategorySlug` brand makes feeding a row raw into
 *   the RPC a compile error.
 * - Card fields are intentionally absent (manual entries have no card
 *   metadata in the RPC).
 */
export function buildItemRows(items: ReviewItem[]): PurchaseItemInput[] {
  return items.map((item, index) => ({
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.quantity * item.unit_price,
    // The review screen stores the category as a slug; the cast narrows the
    // plain string to the branded type — the slug→uuid resolution happens
    // later in the seam (buildSaveReceiptArgs), never here.
    category_id: (item.category_id ??
      item.ai_suggested_category_id ??
      'otros') as CategorySlug,
    is_impulse: item.is_impulse,
    sort_order: index,
  }));
}
