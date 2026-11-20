/**
 * Pure month-bucket helpers and the minimal receipt shape shared by the
 * analytics aggregators. Kept dependency-free on purpose: re-exporting the
 * `PriceAlert` type from `@/types` pulls this module into isolated harness
 * programs, and importing a React hook barrel there would drag the whole
 * component tree into configs without JSX support.
 */

/**
 * Minimal receipt shape the pure month aggregators consume. The receipts
 * store's rows satisfy it structurally; declaring the subset here keeps the
 * aggregation functions decoupled from the store (and testable in
 * isolation).
 */
export interface ReceiptSpendRecord {
  id?: string;
  store_name?: string;
  purchase_date: string;
  /**
   * Line total of the receipt. Optional on the minimal record shape: the
   * store list rows always carry it, but declaring it
   * optional keeps the aggregators (monthly overview, etc.) defensive.
   */
  total?: number;
  /**
   * The unit the receipt was recorded in (REQ-8), when the source row
   * provides it — drill-down purchases attach it so single-row renders
   * can label with the row's own unit.
   */
  currency?: string | null;
  category_totals?: Record<string, number>;
  items?: {
    /**
     * The underlying `purchase_items.id`. Optional — only present on
     * rows hydrated from the real Supabase read (the receipts store
     * passes it through); minimal fixtures and test doubles omit it.
     * Consumers that need to target a single row server-side (e.g. the
     * item rename hook) treat its absence as "can't write".
     */
    id?: string;
    name: string;
    amount: number;
    /**
     * Quantity and unit price are optional, matching the price-alert
     * source rows: present only when the item participates in price
     * alerts, where the unit price is the comparable figure across months.
     */
    quantity?: number;
    unit_price?: number;
    category: string;
    /**
     * Impulse flag: present only on rows persisted after the parse-flow
     * started emitting it (older receipts from before the flag existed have
     * `undefined`, which the impulse aggregator treats as "not impulse").
     * The Home "Antojos / Snacks" callout and breakdown modal rely on it
     * to distinguish want from need at the line-item level.
     */
    is_impulse?: boolean;
  }[];
}

/**
 * Month bucket (`YYYY-MM`) a receipt lands in, derived by slicing the ISO
 * date — no Date parsing, so no timezone shifting at month boundaries.
 */
export function getMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The current month bucket (`YYYY-MM`) in local calendar time, matching the
 * local-date keys `todayLocalISO` produces (a UTC slice would drift a day
 * on late-evening timestamps in UTC-x zones).
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Previous month bucket (`YYYY-MM`) for a given month key. String math only
 * (no Date parsing), mirroring `getMonthKey`: December rolls to January of
 * the previous year.
 */
export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
