/**
 * Analytics feature — Supabase aggregations for the analytics tab
 * (data-access spec).
 *
 * Authenticated-only: reads the
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

/**
 * Current-month category totals for the signed-in user.
 * When `householdId` is provided, aggregates across all household members
 * via the `p_household_id` RPC parameter.
 */
export async function fetchMonthlyTotals(
  yearMonth: string,
  householdId?: string | null,
): Promise<CategoryTotalsReadResult> {
  return readCategoryTotals(yearMonth, householdId);
}

/** Per-category breakdown for a given year-month (same RPC, one source). */
export async function fetchCategoryBreakdown(
  yearMonth: string,
  householdId?: string | null,
): Promise<CategoryTotalsReadResult> {
  return readCategoryTotals(yearMonth, householdId);
}
