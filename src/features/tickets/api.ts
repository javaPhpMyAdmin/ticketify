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
  // TODO: Supabase Storage upload.
  // const path = `${userId}/${tempId()}.jpg`;
  // const blob = await fetch(imageUri).then((r) => r.blob());
  // const { error } = await supabase.storage
  //   .from('receipts')
  //   .upload(path, blob, { contentType: 'image/jpeg' });
  // if (error) throw error;
  // const { data } = supabase.storage.from('receipts').getPublicUrl(path);
  // return { url: data.publicUrl };
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
  // TODO: edge function call.
  // const { data, error } = await supabase.functions.invoke<{
  //   store: string;
  //   date: string;
  //   total: number;
  //   items: Array<Omit<ReviewItem, 'temp_id'>>;
  // }>('parse-ticket', { body: { imageUrl } });
  // if (error) throw error;
  // return {
  //   store: data.store,
  //   date: data.date,
  //   total: data.total,
  //   items: data.items.map((i) => ({ ...i, temp_id: tempId() })),
  // };
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
 */
export async function saveReceipt(
  _userId: string,
  _draft: ReceiptDraft,
): Promise<{ id: string }> {
  // TODO: insert into `purchases` and `purchase_items`.
  return { id: tempId() };
}
