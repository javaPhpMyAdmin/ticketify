/**
 * Pure manual-form helpers — no React, no Supabase, no RN.
 *
 * Node-loadable: every export is a plain function that operates on typed
 * data structures.  The node harness (`scripts/test-manual-receipt.mjs`)
 * compiles and imports these functions directly to verify the contract
 * without a device.
 *
 * PR 2 (`app-i18n`): `MANUAL_ERROR_MESSAGES` is now a function-scoped
 * getter — `getManualErrorMessage(code)` returns the localized string at
 * call time so the active UI language wins. The export name stays the
 * same shape (a string→string map) by exposing the getter as
 * `MANUAL_ERROR_MESSAGES.get(code)` — callers that previously did
 * `MANUAL_ERROR_MESSAGES[code]` now do `MANUAL_ERROR_MESSAGES.get(code)`,
 * but `formatManualErrors` (the only caller that walked the map)
 * already invokes a function per code.
 */

import i18next from 'i18next';

import { tempId } from '@/lib/format';
import { MANUAL_FORM_ERROR } from '@/features/tickets/manual-receipt';
import type { CardType, PaymentMethod, ReviewItem } from '@/types';

// ---------------------------------------------------------------------------
// Stable error code → user-friendly message
// ---------------------------------------------------------------------------

/**
 * Hardcoded fallback message per code — used when i18next isn't
 * initialized (test harness) so the function never returns `undefined`.
 * Mirrors the es-AR copy in `src/i18n/locales/es-AR/errors.json` so the
 * fallback stays in sync with the source-of-truth locale.
 */
const MANUAL_ERROR_FALLBACK: Record<string, string> = {
  [MANUAL_FORM_ERROR.STORE_REQUIRED]: 'Ingresá el nombre de la tienda',
  [MANUAL_FORM_ERROR.DATE_REQUIRED]: 'Elegí una fecha válida',
  [MANUAL_FORM_ERROR.ITEMS_REQUIRED]: 'Agregá al menos un artículo',
  [MANUAL_FORM_ERROR.QUANTITY_INVALID]:
    'La cantidad debe ser un número entero mayor a cero',
  [MANUAL_FORM_ERROR.PRICE_INVALID]:
    'El precio unitario no puede ser negativo',
  [MANUAL_FORM_ERROR.TOTAL_INVALID]:
    'El total no puede ser negativo',
};

/**
 * Maps a stable validation error code (from `validateManualForm`) to
 * its localized message. The active UI language wins at runtime; if
 * i18next isn't initialized (e.g. test harness without `initI18n()`),
 * the function falls back to the canonical es-AR copy.
 */
export function getManualErrorMessage(code: string): string {
  if (!i18next.isInitialized) {
    return MANUAL_ERROR_FALLBACK[code] ?? '';
  }
  return i18next.t(`errors:manualForm.${code}` as
    | 'errors:manualForm.store_required'
    | 'errors:manualForm.date_required'
    | 'errors:manualForm.items_required'
    | 'errors:manualForm.quantity_invalid'
    | 'errors:manualForm.price_invalid'
    | 'errors:manualForm.total_invalid', {
    defaultValue: MANUAL_ERROR_FALLBACK[code] ?? '',
  });
}

/**
 * Public surface preserved for the export contract: a `MANUAL_ERROR_MESSAGES`
 * object whose `.get(code)` returns the localized string. Callers that
 * previously indexed with `MANUAL_ERROR_MESSAGES[code]` migrate to
 * `.get(code)`. The only consumer (`formatManualErrors` below) already
 * walks the codes via the function.
 */
export const MANUAL_ERROR_MESSAGES = {
  get: (code: string): string => getManualErrorMessage(code),
};

/**
 * Converts an array of stable error codes into user-friendly
 * messages. Unknown codes are dropped (not shown raw).  Returns a
 * unique list (a code may appear only once in `validateManualForm`'s
 * output, but this guard is defensive).
 */
export function formatManualErrors(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    const msg = getManualErrorMessage(code);
    if (msg && !seen.has(msg)) {
      seen.add(msg);
      out.push(msg);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quantity parsing (integer-only, rejects silent coercion)
// ---------------------------------------------------------------------------

const POSITIVE_INTEGER_RE = /^\d+$/;

/**
 * Parses a quantity string into a positive integer, or null when the input
 * is not an integer (e.g. '2.5'), empty, or non-numeric.  `parseInt`
 * silently truncates '2.5' → 2, so the editor must reject non-integer
 * strings instead of coercing them (4R reliability fix).  '0' is rejected
 * too — the domain contract is "entero mayor a cero".
 */
export function parseQuantity(input: string): number | null {
  const trimmed = input.trim();
  if (!POSITIVE_INTEGER_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Manual-entry initial state (REQ-002 payment default)
// ---------------------------------------------------------------------------

export interface ManualDraftPaymentDefaults {
  payment_method: PaymentMethod;
  card_type: CardType | null;
}

/**
 * Spec-correct initial payment state for the manual entry screen (REQ-002:
 * default payment method is 'other', no card type).  The shared scan seed
 * (`use-receipts-store` `emptyDraft`) defaults the draft to 'card' — correct
 * for the camera flow — so the manual screen applies these defaults right
 * after seeding instead of inheriting the scan default.
 */
export function emptyManualDraft(): ManualDraftPaymentDefaults {
  return { payment_method: 'other', card_type: null };
}

// ---------------------------------------------------------------------------
// Auto-recalculate total from items
// ---------------------------------------------------------------------------

/**
 * Σ(quantity × unit_price) for a list of ReviewItems.  Returns 0 for an
 * empty list (REQ-006: total auto-computed from items).
 */
export function autoTotal(items: ReviewItem[]): number {
  return items.reduce((acc, item) => acc + item.quantity * item.unit_price, 0);
}

// ---------------------------------------------------------------------------
// Build a ReviewItem from the editor modal form
// ---------------------------------------------------------------------------

/**
 * Constructs a ReviewItem from the raw fields the user enters in the
 * item editor modal.  `total_price` is forced to qty×unit_price
 * (defense in depth; the RPC also recomputes server-side — migration
 * 0023 line 195).  Category defaults to 'otros' fallback, `is_impulse`
 * is always false on manual entry (no impulse flag at creation).
 */
export function buildEditorReviewItem(opts: {
  name: string;
  quantity: number;
  unit_price: number;
  category_id?: string | null;
}): ReviewItem {
  const name = opts.name.trim();
  return {
    temp_id: tempId(),
    name: name || 'Sin nombre',
    quantity: opts.quantity,
    unit_price: opts.unit_price,
    total_price: opts.quantity * opts.unit_price,
    category_id: opts.category_id ?? null,
    is_impulse: false,
    ai_suggested_category_id: null,
  };
}