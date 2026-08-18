import { useMemo } from 'react';

import { currentMonthKey, previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import { useMonthlyCache } from './useMonthlyCache';

/**
 * Reactive month-over-month overview for the analytics tab.
 *
 * Uses `useMonthlyCache` for both the current and previous month totals.
 * The cache reads from the materialized `monthly_user_totals` table
 * (trigger-maintained on purchase writes), guaranteeing full-server-side
 * totals regardless of how much of the paginated receipt feed has been
 * loaded. Cache misses trigger a one-time recalculation automatically.
 */
export function useMonthlyOverview(monthKey = currentMonthKey()) {
  const prevMonth = previousMonthKey(monthKey);

  const current = useMonthlyCache(monthKey);
  const previous = useMonthlyCache(prevMonth);

  return useMemo(() => {
    const currentTotal = current.monthTotal;
    const previousTotal = previous.monthTotal;

    const changePct =
      previousTotal > 0
        ? Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10
        : null;

    return { currentTotal, previousTotal, changePct };
  }, [current.monthTotal, previous.monthTotal]);
}
