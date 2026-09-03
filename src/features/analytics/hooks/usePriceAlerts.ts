import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import {
  currentMonthKey,
  previousMonthKey,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';
import { readPurchaseListByMonth } from '@/features/home/api';
import { queryKeys } from '@/lib/query-keys';
import { toQueryData } from '@/lib/supabase/query-adapters';
import { computePriceAlerts, type PriceAlert } from '../price-alerts';

/**
 * Reactive price alerts (data-access spec). Self-sufficient: it owns its
 * month-scoped TanStack queries instead of depending on the receipts store
 * (previously hydrated by the Home feed). `computePriceAlerts` compares the
 * selected month against its predecessor, so the hook fetches BOTH the
 * selected month AND the previous month's full receipt rows via
 * `readPurchaseListByMonth` and combines them — preserving the exact output
 * the store-backed version produced (which had all loaded months). The
 * combines is memoized: `computePriceAlerts` re-runs only when either
 * month's rows or the selected month changes. `monthKey` defaults to the
 * current month; the analytics month selector passes the chosen month so
 * alerts compare that month against its predecessor.
 */
export function usePriceAlerts(monthKey = currentMonthKey()): PriceAlert[] {
  const { userId } = useSessionUser();

  const previousMonth = previousMonthKey(monthKey);

  const currentQuery = useQuery<ReceiptSpendRecord[]>({
    queryKey: queryKeys.monthReceipts(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readPurchaseListByMonth(userId!, monthKey).then(toQueryData),
  });
  const previousQuery = useQuery<ReceiptSpendRecord[]>({
    queryKey: queryKeys.monthReceipts(userId!, previousMonth),
    enabled: !!userId,
    queryFn: () =>
      readPurchaseListByMonth(userId!, previousMonth).then(toQueryData),
  });

  const combined = useMemo(
    () => [...(currentQuery.data ?? []), ...(previousQuery.data ?? [])],
    [currentQuery.data, previousQuery.data],
  );

  return useMemo(
    () => computePriceAlerts(combined, undefined, monthKey),
    [combined, monthKey],
  );
}
