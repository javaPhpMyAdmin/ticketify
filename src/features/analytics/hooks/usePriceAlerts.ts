import { useMemo } from 'react';

import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { computePriceAlerts, type PriceAlert } from '../price-alerts';

/**
 * Reactive price alerts (data-access spec). The receipts store is
 * store-backed — the Home feed query hydrates it from `purchases` — so
 * there is no server query in this hook: it subscribes to the store (like
 * `useCategoryDetail`) and derives the alerts with `useMemo` —
 * `computePriceAlerts` re-runs only when the receipt list or the selected
 * month changes. `monthKey` defaults to the current month; the analytics
 * month selector passes the chosen month so alerts compare that month
 * against its predecessor.
 */
export function usePriceAlerts(monthKey = currentMonthKey()): PriceAlert[] {
  const list = useReceiptsStore((s) => s.list);
  return useMemo(() => computePriceAlerts(list, undefined, monthKey), [list, monthKey]);
}
