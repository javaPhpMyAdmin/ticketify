import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { currentMonthKey, previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import { useSessionUser } from '@/features/auth';
import { queryKeys } from '@/lib/query-keys';
import { readMonthlyPurchasesTotal } from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { MonthOverview } from '../monthly-overview';

/**
 * Reactive month-over-month overview for the analytics tab.
 *
 * MIGRATION NOTE: this hook previously derived totals from the
 * `useReceiptsStore` local store, which only contains the pages the user
 * has scrolled through (infinite scroll). That produced incomplete totals
 * (e.g. 15k vs the real 43k). It now uses the `monthly_purchases_total`
 * RPC for both the current and previous month, guaranteeing a full-server-
 * side total regardless of how much of the feed has been loaded.
 */
export function useMonthlyOverview(monthKey = currentMonthKey()): MonthOverview {
  const { userId } = useSessionUser();
  const prevMonth = previousMonthKey(monthKey);

  // Current month total — same RPC useBudget uses for the home bar.
  const currentQuery = useQuery({
    queryKey: queryKeys.monthlyPurchasesTotal(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readMonthlyPurchasesTotal(monthKey).then(toQueryData),
  });

  // Previous month total — for the month-over-month badge.
  const previousQuery = useQuery({
    queryKey: queryKeys.monthlyPurchasesTotal(userId!, prevMonth),
    enabled: !!userId,
    queryFn: () => readMonthlyPurchasesTotal(prevMonth).then(toQueryData),
  });

  return useMemo(() => {
    const currentTotal =
      currentQuery.data?.reduce((acc, row) => acc + (Number.isFinite(row.total) ? row.total : 0), 0) ?? 0;
    const previousTotal =
      previousQuery.data?.reduce((acc, row) => acc + (Number.isFinite(row.total) ? row.total : 0), 0) ?? 0;

    const changePct =
      previousTotal > 0
        ? Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10
        : null;

    return { currentTotal, previousTotal, changePct };
  }, [currentQuery.data, previousQuery.data]);
}
