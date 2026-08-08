import { useMemo } from 'react';

import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { computeMonthOverview, type MonthOverview } from '../monthly-overview';

/**
 * Reactive month-over-month overview for the analytics tab (data-access
 * spec). Store-backed like `usePriceAlerts`: subscribes to the receipts
 * store and derives the comparison with `useMemo`, re-running only when
 * the receipt list or the selected month changes. `monthKey` defaults to
 * the current month so callers that
 * only ever show "now" (Home) need no argument; the analytics month
 * selector passes the chosen month explicitly.
 */
export function useMonthlyOverview(monthKey = currentMonthKey()): MonthOverview {
  const list = useReceiptsStore((s) => s.list);
  return useMemo(() => computeMonthOverview(list, monthKey), [list, monthKey]);
}
