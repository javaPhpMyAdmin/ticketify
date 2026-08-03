/**
 * Analytics feature — Supabase aggregations for the analytics tab
 * (data-access spec).
 *
 * Dual-mode (ADR-4): demo mode returns `{ status: 'demo' }` WITHOUT touching
 * the network (the hooks serve the fixtures); authenticated mode reads the
 * `monthly_category_totals(p_year_month)` RPC (ADR-7), which is scoped to
 * `auth.uid()` server-side — the client only passes the year-month, never a
 * user id.
 */
import {
  readCategoryTotals,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';
import type { CategoryMonthlyTotal } from '@/types';

export type CategoryTotalsReadResult = FeatureReadResult<CategoryMonthlyTotal[]>;

/** Current-month category totals for the signed-in user. */
export async function fetchMonthlyTotals(
  yearMonth: string,
): Promise<CategoryTotalsReadResult> {
  return readCategoryTotals(yearMonth);
}

/** Per-category breakdown for a given year-month (same RPC, one source). */
export async function fetchCategoryBreakdown(
  yearMonth: string,
): Promise<CategoryTotalsReadResult> {
  return readCategoryTotals(yearMonth);
}
