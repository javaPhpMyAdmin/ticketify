/**
 * Pure aggregations for the Pro charts (pro-subscription spec — REQ-CHART-1..6).
 *
 * These functions consume the same `ReceiptSpendRecord[]` shape the free
 * analytics use (`features/home/hooks/useHomeFeed`), so the Pro charts and
 * the analytics tab read the SAME receipts and only the visualization
 * layer differs. No React, no I/O, no skia — they are deterministic and
 * trivially testable (M8.1 will exercise zero-fill, sort determinism, and
 * donut parity against `aggregateCategoriesByMonth`).
 *
 * `aggregateCategoriesByMonth` is RE-EXPORTED from `useHomeFeed` rather
 * than duplicated, so the donut chart and the free analytics share a
 * single source of truth — the donut cannot drift away from the category
 * strip just because someone tweaked the math here.
 */
import {
  aggregateCategoriesByMonth,
  getMonthKey,
  previousMonthKey,
  type HomeCategory,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';

export interface SpendTrendPoint {
  /** `YYYY-MM` month bucket, in the same order as the input `months` array. */
  month: string;
  /** Sum of `receipt.total` for receipts landing in this month (0 when none). */
  total: number;
}

/**
 * Per-month spend, zero-filled across the requested `months` window. Months
 * with no receipts render as `{ month, total: 0 }` (NOT omitted) so the
 * trend chart keeps a continuous x-axis — a gap would lie about "we had
 * no spending" when the truth is "no data was recorded". The output
 * preserves the input order (`months` is the source of truth for ordering,
 * not the receipts themselves).
 *
 * Deterministic: same input always yields the same output; the months loop
 * never depends on insertion order of the receipts.
 */
export function aggregateSpendTrend(
  records: ReceiptSpendRecord[],
  months: string[],
): SpendTrendPoint[] {
  const totalsByMonth = new Map<string, number>();
  for (const receipt of records) {
    const key = getMonthKey(receipt.purchase_date);
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + (receipt.total ?? 0));
  }
  return months.map((month) => ({
    month,
    total: totalsByMonth.get(month) ?? 0,
  }));
}

export interface StoreSpend {
  /** Stable identifier — falls back to the store name when no id is set. */
  storeId: string;
  /** Display name, e.g. "Mercado del Puerto". */
  storeName: string;
  /** Sum of receipt totals for this store within the requested month. */
  total: number;
}

/**
 * Per-store totals for a single month, sorted by total descending and
 * tie-broken by storeName ascending. The record shape exposes only
 * `store_name` (no `store_id`), so we use the name as both the id and
 * the display label — that keeps two receipts from different branches of
 * the same chain merged (the parser would set a separate `store_id` later
 * if we ever add one). A normalized comparison (`trim` + lowercase)
 * prevents "Mercado X" and "mercado x" from splitting into two rows.
 */
export function aggregateStoresByMonth(
  records: ReceiptSpendRecord[],
  month: string,
): StoreSpend[] {
  const totalsByStore = new Map<string, { storeName: string; total: number }>();
  for (const receipt of records) {
    if (getMonthKey(receipt.purchase_date) !== month) continue;
    const rawName = receipt.store_name ?? '';
    const displayName = rawName.trim() || 'Sin tienda';
    const key = displayName.toLowerCase();
    const entry = totalsByStore.get(key) ?? { storeName: displayName, total: 0 };
    entry.total += receipt.total ?? 0;
    // First-seen casing wins so the legend reads the original brand
    // spelling rather than whatever casing happens to be last in `records`.
    if (entry.storeName !== displayName && entry.storeName.toLowerCase() !== key) {
      entry.storeName = displayName;
    }
    totalsByStore.set(key, entry);
  }
  return [...totalsByStore.entries()]
    .map(([storeId, { storeName, total }]) => ({ storeId, storeName, total }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.storeName.localeCompare(b.storeName);
    });
}

/**
 * Re-export of the free analytics category aggregator. The donut chart
 * consumes its output shape (`HomeCategory`); routing it through this
 * barrel keeps the chart feature's import surface stable and prevents
 * drift between the donut and the analytics category strip.
 */
export { aggregateCategoriesByMonth };
export type { HomeCategory };

/**
 * Month-over-month spend delta — the "vs. last month" pill on the Pro
 * charts screen. Pure derivation, no React.
 *
 * `previous` is `null` when the previous month has NO receipts at all
 * (not zero — "we have no data for last month" is meaningfully different
 * from "you spent $0 last month", and the UI surfaces that distinction
 * by skipping the delta pill). `current` is always a number (0 is a real
 * "nothing this month" answer). `deltaPct` is `null` when `previous` is
 * null; otherwise `((current - previous) / previous) * 100`.
 *
 * `isImprovement` reflects the user's mental model of "good vs. bad"
 * spend: less spend than last month is good, more is bad. The UI uses
 * it to pick green/red coloring, not to make a value judgement. Receipts
 * with no `total` are treated as 0 (defensive — `ReceiptSpendRecord.total`
 * is optional in the minimal record shape).
 */
export interface MonthlyDelta {
  current: number;
  /** Null when the previous month has no receipts; zero is a valid amount. */
  previous: number | null;
  /** Percentage change vs. the previous month; null when `previous` is null. */
  deltaPct: number | null;
  /** True when `deltaPct < 0` (less spent than the previous month). */
  isImprovement: boolean;
}

export function aggregateMonthlyDelta(
  records: ReceiptSpendRecord[],
  monthKey: string,
): MonthlyDelta {
  let current = 0;
  let previous: number | null = null;
  let previousSeen = false;
  const prevKey = previousMonthKey(monthKey);
  for (const receipt of records) {
    const total = receipt.total ?? 0;
    const key = getMonthKey(receipt.purchase_date);
    if (key === monthKey) {
      current += total;
    } else if (key === prevKey) {
      previous = (previous ?? 0) + total;
      previousSeen = true;
    }
  }
  if (!previousSeen) previous = null;
  const deltaPct =
    previous === null || previous === 0
      ? null
      : ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    deltaPct,
    isImprovement: deltaPct !== null && deltaPct < 0,
  };
}
