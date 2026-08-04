/**
 * Tickets feature — Supabase Storage + the `parse-ticket` edge
 * function. Stubs for now; wiring them up is a single-file change
 * once auth and the edge function are live.
 */
import { tempId } from '@/lib/format';
import type { ReceiptDraft, ReviewItem } from '@/types';

export interface UploadResult {
  /** Public URL where the receipt image is served from. */
  url: string;
}

/**
 * Uploads the local image to the `receipts` bucket and returns a
 * public URL the rest of the flow can attach to the draft.
 */
export async function uploadToStorage(
  _userId: string,
  _imageUri: string,
): Promise<UploadResult> {
  // TODO(Phase 5): upload to the `receipts` bucket (path: userId/tempId.jpg).
  return { url: _imageUri };
}

export interface ParsedReceipt {
  store: string;
  date: string;
  total: number;
  items: ReviewItem[];
}

/**
 * Calls the `parse-ticket` edge function. Returns a structured
 * draft the user can review before committing to the DB.
 */
export async function parseTicket(_imageUrl: string): Promise<ParsedReceipt> {
  // TODO(Phase 5): invoke the `parse-ticket` edge function; seed items with
  // temp ids. Until then, return a mock draft so the review flow is usable.
  return {
    store: 'Whole Foods Market',
    date: new Date().toISOString().slice(0, 10),
    total: 9.69,
    items: [
      { temp_id: tempId(), name: 'Avocado, Hass', quantity: 2, unit_price: 1.5, total_price: 3.0, category_id: null, is_impulse: false, ai_suggested_category_id: 'frutas-verduras' },
      { temp_id: tempId(), name: 'Coca-Cola 2.25L', quantity: 1, unit_price: 4.49, total_price: 4.49, category_id: null, is_impulse: true, ai_suggested_category_id: 'refrescos' },
      { temp_id: tempId(), name: 'Whole Wheat Bread', quantity: 1, unit_price: 2.2, total_price: 2.2, category_id: null, is_impulse: false, ai_suggested_category_id: 'panaderia' },
    ],
  };
}

/**
 * Persists the confirmed draft to the DB. Returns the new
 * purchase id on success.
 *
 * ADR-8 + data-access spec ("Purchase Writes Out of Scope"): purchase and
 * receipt writes stay no-ops in this change. The call returns a local id so
 * the flow completes, but nothing is persisted until Phase 5 wires the real
 * `purchases` / `purchase_items` insert (the remote schema is not applied
 * yet).
 */
export async function saveReceipt(
  _userId: string,
  _draft: ReceiptDraft,
): Promise<{ id: string }> {
  // TODO(Phase 5): insert into `purchases` and `purchase_items` for the
  // authenticated user. Deliberately still a no-op: writes are out of scope
  // and the remote schema does not exist yet.
  return { id: tempId() };
}
