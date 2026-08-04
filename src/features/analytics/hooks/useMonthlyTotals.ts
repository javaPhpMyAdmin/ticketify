import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchMonthlyTotals } from '../api';
import { useSessionUser } from '@/features/auth';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the current month's category totals plus a derived total
 * (data-access spec) through TanStack Query (server-state-caching spec). The
 * read is authenticated-only and disabled until a signed-in user exists. The
 * key embeds the shared UTC year-month (one derivation shared with scan
 * usage), so it rolls over exactly when the month changes. The
 * `monthly_category_totals` RPC is scoped to `auth.uid()` server-side — only
 * the year-month is sent. Errors surface via `toQueryErrorMessage`; there is
 * no fabricated fallback.
 */
export function useMonthlyTotals(): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
  error: string | null;
} {
  const { userId } = useSessionUser();
  const yearMonth = utcYearMonth();

  const totalsQuery = useQuery({
    queryKey: queryKeys.monthlyTotals(userId!, yearMonth),
    enabled: !!userId,
    queryFn: () => fetchMonthlyTotals(yearMonth).then(toQueryData),
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
  };
}
