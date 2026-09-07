/**
 * Pure manual-form helpers — no React, no Supabase, no RN.
 *
 * Node-loadable: every export is a plain function that operates on typed
 * data structures.  The node harness (`scripts/test-manual-receipt.mjs`)
 * compiles and imports these functions directly to verify the contract
 * without a device.
 */

import { tempId } from '@/lib/format';
import { MANUAL_FORM_ERROR } from '@/features/tickets/manual-receipt';
import type { ReviewItem } from '@/types';

// ---------------------------------------------------------------------------
// Stable error code → user-friendly es-AR message
// ---------------------------------------------------------------------------

/**
 * Maps stable validation error codes (from `validateManualForm`) to
 * display-ready Spanish (es-AR) messages.  The screen only needs to
 * call `formatManualErrors(errors)` where `errors` is the string[]
 * returned by `validateManualForm`; the codes are never shown raw.
 */
export const MANUAL_ERROR_MESSAGES: Record<string, string> = {
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
 * Converts an array of stable error codes into user-friendly es-AR
 * messages. Unknown codes are dropped (not shown raw).  Returns a
 * unique list (a code may appear only once in `validateManualForm`'s
 * output, but this guard is defensive).
 */
export function formatManualErrors(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    const msg = MANUAL_ERROR_MESSAGES[code];
    if (msg && !seen.has(msg)) {
      seen.add(msg);
      out.push(msg);
    }
  }
  return out;
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