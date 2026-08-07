import { useMemo } from 'react';

import { useReceiptsStore } from '@/stores/use-receipts-store';
import { computePriceAlerts, type PriceAlert } from '../price-alerts';

/**
 * Reactive price alerts for the current month (data-access spec). The
 * receipts store is mock-local for now, so there is no server query: the
 * hook subscribes to the store (like `useCategoryDetail`) and derives the
 * alerts with `useMemo` — `computePriceAlerts` re-runs only when the
 * receipt list changes. Phase 5 swaps the source, not the derivation.
 */
export function usePriceAlerts(): PriceAlert[] {
  const list = useReceiptsStore((s) => s.list);
  return useMemo(() => computePriceAlerts(list), [list]);
}
