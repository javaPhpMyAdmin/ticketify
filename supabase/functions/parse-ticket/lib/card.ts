/**
 * Normalizers for the card fields Gemini extracts from a receipt
 * (`card_brand` / `card_type`). Pure functions with no Deno/network
 * dependencies so the node harness can exercise them directly.
 */

/**
 * Card brand: trimmed with casing preserved as detected. Blank/absent values
 * degrade to null — the review screen renders nothing when the receipt shows
 * no card or the brand is unreadable.
 */
export function normalizeCardBrand(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Card type: compared lowercase ('debit' | 'credit') and normalized.
 * Anything else — including absent values and models guessing a kind the
 * receipt does not state — degrades to null.
 */
export function normalizeCardType(value: unknown): 'debit' | 'credit' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'debit' || normalized === 'credit' ? normalized : null;
}
