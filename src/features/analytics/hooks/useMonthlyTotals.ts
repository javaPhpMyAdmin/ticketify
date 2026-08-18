import { useMemo } from 'react';
import { useQuery, type QueryObserverResult } from '@tanstack/react-query';

import { fetchMonthlyTotals } from '../api';
import { useSessionUser } from '@/features/auth';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the category totals for a year-month plus a derived total
 * (data-access spec) through TanStack Query (server-state-caching spec). The
 * read is authenticated-only and disabled until a signed-in user exists. The
 * key embeds the year-month (defaulting to the shared UTC derivation, one
 * derivation shared with scan usage, so it rolls over exactly when the month
 * changes); the analytics month selector passes the chosen month explicitly.
 * The `monthly_category_totals` RPC is scoped to `auth.uid()` server-side —
 * only the year-month is sent. Errors surface via `toQueryErrorMessage`;
 * there is no fabricated fallback.
 *
 * When `householdId` is provided, the RPC aggregates across all household
 * members instead of just the calling user. The query key includes the
 * household ID to keep personal and household caches separate.
 */
export function useMonthlyTotals(
  yearMonth = utcYearMonth(),
  householdId?: string | null,
): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
  error: string | null;
  /**
   * True once the read succeeded, even if a background refetch later
   * fails (TanStack keeps the data and sets `error`). The analytics
   * screen renders the error state only when `error && !hasData`.
   */
  hasData: boolean;
  /** Refetches the read (retry action on the error state). */
  refetch: () => Promise<QueryObserverResult<CategoryMonthlyTotal[], Error>>;
} {
  const { userId } = useSessionUser();

  const totalsQuery = useQuery({
    queryKey: householdId
      ? [...queryKeys.monthlyTotals(userId!, yearMonth), householdId]
      : queryKeys.monthlyTotals(userId!, yearMonth),
    enabled: !!userId,
    queryFn: () => fetchMonthlyTotals(yearMonth, householdId).then(toQueryData),
  });

  const totals = totalsQuery.data ?? [];
  const monthTotal = useMemo(
    () => (totalsQuery.data ?? []).reduce((acc, t) => acc + t.total, 0),
    [totalsQuery.data],
  );

  return {
    totals,
    monthTotal,
    isLoading: totalsQuery.isLoading,
    error: totalsQuery.error ? toQueryErrorMessage(totalsQuery.error) : null,
    hasData: totalsQuery.data !== undefined,
    refetch: totalsQuery.refetch,
  };
}
