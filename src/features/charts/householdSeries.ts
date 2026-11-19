/**
 * Pure adapters that turn `household_chart_series` rows (migration 0048) into
 * the shapes the existing Pro charts aggregators already consume.
 *
 * The RPC is intentionally READ-ONLY and cache-shaped: one row per
 * (year_month, effective currency) with the same daily/store/category jsonb
 * aggregates as `monthly_user_totals`. That lets the personal and household
 * paths share every chart math function instead of duplicating derivations.
 * No React, no I/O — deterministic and node-testable.
 */
import type { ReceiptSpendRecord } from '@/features/home/hooks/useHomeFeed';
import { bindViewerRows } from '@/lib/money';
import type {
  HouseholdChartSeriesRow,
  MonthlyTotalsCacheRow,
} from '@/types';

/**
 * The subset of a cache row the charts actually read. `daily_category_totals`
 * is 0048-only (the personal cache has no per-day category breakdown), hence
 * the optional field.
 */
export type ChartCacheRow = Pick<
  MonthlyTotalsCacheRow,
  | 'year_month'
  | 'currency'
  | 'total'
  | 'category_totals'
  | 'store_totals'
  | 'daily_totals'
> & {
  daily_category_totals?: Record<string, Record<string, number>>;
};

/**
 * RPC rows → cache-row shape. Sorting is part of the contract: React Query
 * results and jsonb object key order are not guaranteed stable across
 * refetches, so the chart x-axis must not depend on either.
 */
export function toChartCacheRows(
  rows: HouseholdChartSeriesRow[],
): ChartCacheRow[] {
  return rows
    .map((row) => ({
      year_month: row.year_month,
      currency: row.currency,
      total: row.total,
      daily_totals: row.daily_totals ?? {},
      store_totals: row.store_totals ?? {},
      category_totals: row.category_totals ?? {},
      daily_category_totals: row.daily_category_totals ?? {},
    }))
    .sort(
      (a, b) =>
        a.year_month.localeCompare(b.year_month) ||
        a.currency.localeCompare(b.currency),
    );
}

/**
 * The viewer-unit row for one month, or null when this household month has no
 * spend in the viewer's unit. Null is the explicit "no row" signal — callers
 * must not fabricate a zero while the RPC is still loading or has errored.
 */
export function chartCacheRowForMonth(
  rows: HouseholdChartSeriesRow[],
  monthKey: string,
  viewerCurrency: string,
): ChartCacheRow | null {
  const bound = bindViewerRows(
    toChartCacheRows(rows).filter((row) => row.year_month === monthKey),
    viewerCurrency,
  );
  return bound[0] ?? null;
}

/**
 * Minimal receipt-shaped points for the aggregators that need per-day input
 * (weekly bars, daily average, day detail). The RPC exposes `daily_totals`
 * (net per day) plus `daily_category_totals` (gross per day, per slug), so a
 * servicios-only day excludes ITS OWN gross servicios amount instead of a
 * month-wide proportional share. This is the whole point of the extra jsonb
 * column: a day with servicios and a day without it must not be diluted into
 * one another.
 *
 * Accepted approximation: discounts are not attributed per category. The
 * receipt `total` is net while `category_totals` are gross line-item sums, so
 * the shared `effectiveReceiptTotal` clamps a services-heavy day at 0 rather
 * than inventing a per-item discount split. Only the viewer's unit is emitted
 * — never a cross-unit sum.
 */
export function householdRowsToReceipts(
  rows: HouseholdChartSeriesRow[],
  monthKey: string,
  viewerCurrency: string,
): ReceiptSpendRecord[] {
  const row = chartCacheRowForMonth(rows, monthKey, viewerCurrency);
  if (!row) return [];

  const dayCategories = row.daily_category_totals ?? {};
  return Object.entries(row.daily_totals)
    .filter(([date]) => date.startsWith(`${monthKey}-`))
    .map(([date, total]) => [date, Number(total)] as const)
    .filter(([, total]) => Number.isFinite(total) && total > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => {
      const categoryTotals: Record<string, number> = {};
      for (const [slug, amount] of Object.entries(dayCategories[date] ?? {})) {
        const numeric = Number(amount);
        if (Number.isFinite(numeric) && numeric > 0) categoryTotals[slug] = numeric;
      }
      return {
        id: `household-${date}-${row.currency}`,
        purchase_date: date,
        total,
        category_totals: categoryTotals,
        items: [],
      };
    });
}
