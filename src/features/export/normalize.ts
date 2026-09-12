/**
 * Shared export-row normalization — the single source of the "one line per
 * item" rule that the CSV and PDF builders both consume (same posture as
 * `features/home/feed-row.ts` for the feed aggregates: two surfaces can
 * never drift apart).
 *
 * The feed rows (`HomeFeedReceiptRow`) carry an optional `payment_method`
 * when the source provides it — `features/home/api`'s `mapPurchaseRow`
 * surfaces it from the read. `ExportReceiptRow` widens the shape with an
 * optional string so any source is picked up automatically, and the
 * fallback label (`—`) covers its absence. Structural typing means callers
 * pass `HomeFeedReceiptRow[]` unchanged.
 */
import i18next from 'i18next';

import { PAYMENT_METHOD_LABEL_KEYS } from '@/features/tickets/payment-options';
import type { HomeFeedReceiptRow, PaymentMethod } from '@/types';

/** Export input row: the feed-row shape plus the payment method when the source provides it. */
export type ExportReceiptRow = HomeFeedReceiptRow & { payment_method?: string };

/** One normalized export line: a receipt, or one line item of it. */
export interface ExportLine {
  date: string;
  store: string;
  total: string;
  paymentMethod: string;
  category: string;
  item: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  impulse: string;
}

/**
 * Payment labels live in the catalog (`common:paymentMethod*`, resolved
 * through `features/tickets/payment-options`), the SAME keys the review
 * screen's picker renders — the six pairs exist in exactly one place. The
 * `i18next.t()` call happens at call time because the export builders run
 * when the user taps Export: the label always reflects the ACTIVE locale
 * (REQ-10), never the import-time default.
 *
 * Call-time labels resolve through the same guarded helper the PDF builder
 * uses (`features/export/pdf.ts`): when i18next is not initialized yet the
 * es-AR literal is returned so a cold render still produces a sane doc.
 */

/** Neutral label for an unknown or missing payment method. */
const UNKNOWN_PAYMENT_LABEL = '—';

/**
 * es-AR fallback labels for each payment method. Used on the pre-init path
 * of `paymentMethodLabel` and as i18next's default value when a key is
 * missing — the catalog (`common:paymentMethod*`) is the runtime source of
 * truth for the active locale.
 */
const PAYMENT_METHOD_FALLBACK_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  transfer: 'Transferencia',
  other: 'Otro',
};

/**
 * Resolves a catalog key with the same guarded pattern the PDF builder
 * uses (`features/export/pdf.ts`): i18next not initialized → the es-AR
 * literal; initialized → the catalog value for the active locale, falling
 * back to the es-AR literal when a key is missing.
 */
function t(key: string, fallback: string): string {
  return i18next.isInitialized
    ? i18next.t(key, { defaultValue: fallback })
    : fallback;
}

/** Resolves a payment method to its readable label (unknown/missing → `—`). */
export function paymentMethodLabel(
  method: string | null | undefined,
): string {
  if (!method) return UNKNOWN_PAYMENT_LABEL;
  const key = PAYMENT_METHOD_LABEL_KEYS[method as PaymentMethod];
  const fallback = PAYMENT_METHOD_FALLBACK_LABELS[method as PaymentMethod];
  return key && fallback ? t(key, fallback) : UNKNOWN_PAYMENT_LABEL;
}

/**
 * Picks the singular or plural Spanish form for a count:
 * `pluralize(1, 'recibo', 'recibos')` → `'recibo'`. Shared by the export
 * screen and the PDF summary so both surfaces agree on number agreement.
 */
export function pluralize(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 1 ? singular : plural;
}

/**
 * Fixed 2-decimal notation with a dot separator (`5` → `'5.00'`), matching
 * the CSV/HTML number contract; empty string for missing values.
 */
export function formatTwoDecimals(value: number | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : '';
}

/** Plain decimal rendering for quantities (`2.5` → `'2.5'`); '' when missing. */
function formatQuantity(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : '';
}

/**
 * Normalizes rows into one export line per line item. A receipt with NO
 * items still emits exactly one line with blank item columns, so no receipt
 * is ever lost from an export.
 */
export function normalizeExportRows(rows: ExportReceiptRow[]): ExportLine[] {
  // Cell values resolve at call time so the export reflects the ACTIVE
  // locale (REQ-10); the es-AR literals keep a pre-init render sane.
  const unknownCategoryLabel = t('receipts:unknownCategory', 'sin categoría');
  const yesLabel = t('common:yes', 'sí');
  const noLabel = t('common:no', 'no');
  const lines: ExportLine[] = [];
  for (const row of rows) {
    const base = {
      date: row.purchase_date,
      store: row.store_name,
      total: formatTwoDecimals(row.total),
      paymentMethod: paymentMethodLabel(row.payment_method),
    };
    const items = row.items ?? [];
    if (items.length === 0) {
      lines.push({
        ...base,
        category: '',
        item: '',
        quantity: '',
        unitPrice: '',
        lineTotal: '',
        impulse: '',
      });
      continue;
    }
    for (const item of items) {
      lines.push({
        ...base,
        category: item.category ?? unknownCategoryLabel,
        item: item.name,
        quantity: formatQuantity(item.quantity ?? 1),
        unitPrice: formatTwoDecimals(item.unit_price ?? item.amount),
        lineTotal: formatTwoDecimals(item.amount),
        impulse: item.is_impulse ? yesLabel : noLabel,
      });
    }
  }
  return lines;
}
