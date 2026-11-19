/**
 * Pure source-resolution helpers for the Pro charts screen.
 *
 * The screen has two kinds of month-scoped sources: a RESOLVED cache window
 * (an empty array is a real, verified zero month) and an UNRESOLVED one
 * (`undefined` while loading or after an error). Personal mode must not turn a
 * resolved empty cache into a receipt-list fallback — that is what produced
 * non-zero bars for a verified-empty month. Household mode, in contrast, never
 * falls back to personal data; an unresolved window stays pending and a
 * resolved window with no viewer-unit row becomes an explicit no-data state.
 *
 * No React, no I/O — deterministic and node-testable.
 */
import {
  aggregateSpendTrend,
  bindViewerRows,
  yearlyPointsFromCache,
} from './aggregate';
import type { ChartCacheRow } from './householdSeries';
import type { ReceiptSpendRecord } from '@/features/home/hooks/useHomeFeed';

/** Minimal shape shared by the cache-shaped monthly sources. */
export type ResolvedCacheRow = Pick<ChartCacheRow, 'year_month' | 'currency' | 'total'>;

export interface AnnualTrendArgs {
  rows: ResolvedCacheRow[] | undefined;
  fallbackRows: ReceiptSpendRecord[];
  monthKeys: string[];
  currency: string;
}

/**
 * Monthly points for the annual card. A resolved array always wins over the
 * receipt fallback, even when empty: [].length === 0 is a verified zero month
 * in personal mode (byte-identical rule), while `undefined` means "not loaded
 * yet" and is the ONLY case allowed to use the fallback. Household callers
 * always pass the RPC's array (empty while pending), so this fallback is
 * personal-only by construction.
 */
export function annualTrendFromCacheRows({
  rows,
  fallbackRows,
  monthKeys,
  currency,
}: AnnualTrendArgs): { month: string; total: number }[] {
  if (rows !== undefined) {
    const byMonth = new Map<string, number>();
    for (const row of bindViewerRows(rows, currency)) {
      byMonth.set(row.year_month, row.total);
    }
    return monthKeys.map((month) => ({ month, total: byMonth.get(month) ?? 0 }));
  }
  return aggregateSpendTrend(fallbackRows, monthKeys);
}

export interface YearlyPointsArgs {
  rows: ResolvedCacheRow[] | undefined;
  fallbackRows: ReceiptSpendRecord[];
  currency: string;
}

/**
 * Receipt-shaped points for the 3-year capsule bars. Same resolved/unresolved
 * rule as `annualTrendFromCacheRows`: a resolved empty personal cache must
 * render zero-filled bars, never a resurrected list series.
 */
export function yearlyPointsFromCacheRows({
  rows,
  fallbackRows,
  currency,
}: YearlyPointsArgs): ReceiptSpendRecord[] {
  if (rows !== undefined) return yearlyPointsFromCache(bindViewerRows(rows, currency));
  return bindViewerRows(fallbackRows, currency);
}

export type ChartFamilyState = 'pending' | 'error' | 'no-data' | 'ready';

export interface ChartFamilyStateArgs {
  isHouseholdView: boolean;
  failed: boolean;
  /** Whether the RPC query has resolved (an empty array counts as resolved). */
  hasData: boolean;
  /** Whether the resolved response contains a row for the viewer's unit. */
  hasViewerData: boolean;
}

/**
 * Per-chart-family gate. Personal mode is always 'ready' — the household RPC
 * never blocks a personal render. Household mode distinguishes a failed RPC,
 * a still-pending RPC, a resolved-but-empty/no-access response, and a usable
 * response, so one slow family cannot hide the others' resolved surfaces.
 */
export function resolveChartFamilyState({
  isHouseholdView,
  failed,
  hasData,
  hasViewerData,
}: ChartFamilyStateArgs): ChartFamilyState {
  if (!isHouseholdView) return 'ready';
  if (failed) return 'error';
  if (!hasData) return 'pending';
  return hasViewerData ? 'ready' : 'no-data';
}
