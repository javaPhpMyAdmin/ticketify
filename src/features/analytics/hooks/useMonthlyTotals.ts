import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import type { CategoryMonthlyTotal, CurrencyTotal } from '@/types';

import { useMonthlyCache } from './useMonthlyCache';

/**
 * Returns the category totals for a year-month plus a derived total.
 *
 * This is now a thin wrapper around `useMonthlyCache` which reads the
 * materialized `monthly_user_totals` cache rows for personal mode (one row
 * per unit since 0044) and falls through to the `monthly_category_totals`
 * RPC for household mode.
 *
 * `householdTotals` carries the per-unit NET totals (`monthly_purchases_total`
 * rows) that headline surfaces render as one labeled figure per currency
 * (decision 9). Empty in personal mode.
 */
export function useMonthlyTotals(
  yearMonth = currentMonthKey(),
  householdId?: string | null,
): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  householdTotals: CurrencyTotal[];
  isLoading: boolean;
  error: string | null;
  hasData: boolean;
  refetch: () => Promise<unknown>;
} {
  return useMonthlyCache(yearMonth, householdId);
}
