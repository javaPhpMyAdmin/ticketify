import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import type { CategoryMonthlyTotal } from '@/types';

import { useMonthlyCache } from './useMonthlyCache';

/**
 * Returns the category totals for a year-month plus a derived total.
 *
 * This is now a thin wrapper around `useMonthlyCache` which reads the
 * materialized `monthly_user_totals` cache row for personal mode and
 * falls through to the `monthly_category_totals` RPC for household mode.
 *
 * The return shape is unchanged so existing consumers (charts, analytics)
 * continue to work without modification.
 */
export function useMonthlyTotals(
  yearMonth = currentMonthKey(),
  householdId?: string | null,
): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
  error: string | null;
  hasData: boolean;
  refetch: () => Promise<unknown>;
} {
  return useMonthlyCache(yearMonth, householdId);
}
