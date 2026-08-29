/**
 * Pure receipt/list parsing helpers. These functions have no Deno or network
 * dependencies so they can be unit-tested from a plain-node harness.
 */

import { normalizeCardBrand, normalizeCardType } from './card.ts';

export interface ParsedItem {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  suggested_category_slug: string | null;
}

export interface ParsedReceipt {
  store_name: string;
  purchase_date: string; // YYYY-MM-DD
  total: number;
  payment_method:
    | 'cash'
    | 'card'
    | 'apple_pay'
    | 'google_pay'
    | 'transfer'
    | 'other';
  /** Card network printed on the receipt (Visa, OCA, …), null when unknown. */
  card_brand: string | null;
  /** Card kind printed on the receipt, null when unknown. */
  card_type: 'debit' | 'credit' | null;
  items: ParsedItem[];
}

/**
 * Thrown when Gemini's output cannot be trusted as structured data
 * (missing/invalid JSON or a structurally invalid payload).
 */
export class ParseError extends Error {}

/**
 * Thrown when the Gemini provider is transiently overloaded (HTTP 503 or a
 * provider 429 "high demand"). Distinct from ParseError so the handler can
 * answer with a "service saturated" envelope instead of a user/photo problem
 * message.
 */
export class ProviderOverloadedError extends Error {}

export const PAYMENT_METHODS = new Set([
  'cash',
  'card',
  'apple_pay',
  'google_pay',
  'transfer',
  'other',
]);

/**
 * Category slugs the Gemini prompt may emit. Canonical vocabulary shared
 * with the DB (`public.categories.slug`) and the client taxonomy
 * (`src/features/home/categories.ts`), so a slug emitted by the parser
 * always has a matching DB row and never misbuckets into "Otros" on the
 * client. Keep this set in sync with the DB seed and the client registry.
 */
export const CATEGORY_SLUGS = new Set([
  'bebidas',
  'frutas-verduras',
  'refrescos',
  'panaderia',
  'carnes',
  'lacteos',
  'limpieza',
  'snacks',
  'alimentos',
  'higiene',
  'farmacia',
  'servicios',
  'otros',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ParseError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ParseError(`${field} must be a finite number`);
  }
  return value;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Unknown payment methods degrade to 'other' instead of failing the scan. */
export function normalizePaymentMethod(
  value: unknown,
): ParsedReceipt['payment_method'] {
  return typeof value === 'string' && PAYMENT_METHODS.has(value)
    ? (value as ParsedReceipt['payment_method'])
    : 'other';
}

/** Today's date in UTC as YYYY-MM-DD, the default when a date is missing. */
export function currentDateYmd(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** Unknown category slugs degrade to null (the review chip shows SIN CATEGORÍA). */
export function normalizeCategorySlug(value: unknown): string | null {
  if (typeof value !== 'string' || !CATEGORY_SLUGS.has(value)) return null;
  // Slugs are already canonical (shared with the DB and the client
  // taxonomy), so they pass through unchanged.
  return value;
}

export function parseReceiptJson(raw: unknown): ParsedReceipt {
  if (!isRecord(raw)) {
    throw new ParseError('Parsed receipt is not an object');
  }

  const store_name = requireNonEmptyString(raw.store_name, 'store_name');
  // `purchase_date` is best-effort: when it is missing, empty, or fails
  // validation (bad format or calendar-invalid, e.g. 2026-02-30), the
  // receipt is still usable — default to today so the scan is not lost.
  // Receipts usually print the date, but Gemini occasionally omits or
  // garbles it, and a missing date is a review-screen fix, not a parse
  // failure. Other fields (total, items) stay strict.
  const rawDate =
    typeof raw.purchase_date === 'string' ? raw.purchase_date.trim() : '';
  let purchase_date = currentDateYmd();
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    // The regex alone accepts calendar-invalid dates like 2026-13-45 or
    // 2026-02-30 — verify the components round-trip through a UTC date.
    const [y, m, d] = rawDate.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(y, m - 1, d));
    if (
      parsedDate.getUTCFullYear() === y &&
      parsedDate.getUTCMonth() === m - 1 &&
      parsedDate.getUTCDate() === d
    ) {
      // Reject years that are obviously wrong (hallucinated by the model).
      // ±1 year from the current UTC year — a receipt more than a year old
      // is extremely unlikely and a future receipt is impossible.
      const currentYear = new Date().getUTCFullYear();
      if (Math.abs(y - currentYear) <= 1) {
        purchase_date = rawDate;
      }
    }
  }
  const total = round2(requireFiniteNumber(raw.total, 'total'));
  const payment_method = normalizePaymentMethod(raw.payment_method);
  const card_brand = normalizeCardBrand(raw.card_brand);
  const card_type = normalizeCardType(raw.card_type);

  if (!Array.isArray(raw.items)) {
    throw new ParseError('items must be an array');
  }
  const items = raw.items.map((entry, index) => parseItem(entry, index));

  // A receipt with zero line items is unparseable — the review screen would
  // otherwise confirm an empty purchase.
  if (items.length === 0) {
    throw new ParseError('items must not be empty');
  }

  return {
    store_name,
    purchase_date,
    total,
    payment_method,
    card_brand,
    card_type,
    items,
  };
}

export function parseItem(entry: unknown, index: number): ParsedItem {
  if (!isRecord(entry)) {
    throw new ParseError(`items[${index}] is not an object`);
  }
  const name = requireNonEmptyString(entry.name, `items[${index}].name`);
  // Clamp quantity to a positive integer (floor, min 1).
  const quantity = Math.max(
    1,
    Math.floor(requireFiniteNumber(entry.quantity, `items[${index}].quantity`)),
  );
  let unit_price = round2(
    requireFiniteNumber(entry.unit_price, `items[${index}].unit_price`),
  );
  const total_price = round2(
    requireFiniteNumber(entry.total_price, `items[${index}].total_price`),
  );
  // Consistency guard (scan-quantity bug): when the model emits a multi-unit
  // line whose unit_price × quantity does not close against the line total
  // (e.g. {quantity: 2, unit_price: 94, total_price: 94} instead of
  // unit_price: 47), re-derive the unit price from the total — the printed
  // line total is the most reliable figure on the receipt. The guard only
  // fires on an actual mismatch (> 2 cents) and always keeps the total as
  // the anchor, so legitimate multi-buy offers that happen to close are
  // untouched. It never produces a fractional quantity.
  if (Math.abs(quantity * unit_price - total_price) > 0.02) {
    const rederived = round2(total_price / quantity);
    if (Number.isFinite(rederived) && rederived > 0) {
      unit_price = rederived;
    }
  }
  const suggested_category_slug = normalizeCategorySlug(
    entry.suggested_category_slug,
  );

  return { name, quantity, unit_price, total_price, suggested_category_slug };
}

export interface ParsedListResult {
  items: ParsedItem[];
  total: number;
}

/**
 * Validates the JSON Gemini emitted in list mode. Only `items` is required;
 * receipt metadata is supplied by the caller with safe defaults.
 */
export function parseListJson(raw: unknown): ParsedListResult {
  if (!isRecord(raw)) {
    throw new ParseError('Parsed list is not an object');
  }

  if (!Array.isArray(raw.items)) {
    throw new ParseError('items must be an array');
  }
  if (raw.items.length === 0) {
    throw new ParseError('items must not be empty');
  }

  const items = raw.items.map((entry, index) => parseItem(entry, index));
  const total = round2(items.reduce((sum, item) => sum + item.total_price, 0));

  return { items, total };
}
