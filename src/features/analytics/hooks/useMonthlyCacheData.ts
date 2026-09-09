import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { readMonthlyCacheRow } from '@/lib/supabase/feature-access';
import { toQueryData } from '@/lib/supabase/query-adapters';
import type { MonthlyTotalsCacheRow } from '@/types';
import { queryKeys } from '@/lib/query-keys';

/**
 * Reads the raw materialized monthly cache row for personal mode.
 * Returns `null` when no row exists (cache miss — the recalc trigger
 * in `useMonthlyCache` handles backfill).
 *
 * For household mode, returns `null` (household data is not cached).
 *
 * Used by the charts screen to access `daily_totals` and `store_totals`
 * jsonb fields that the `CategoryMonthlyTotal[]` transform discards.
 */
export function useMonthlyCacheData(
  yearMonth = currentMonthKey(),
): MonthlyTotalsCacheRow | null {
  const { userId } = useSessionUser();

  const cacheQuery = useQuery({
    queryKey: queryKeys.monthlyCache(userId ?? '', yearMonth),
    enabled: !!userId,
    queryFn: () =>
      readMonthlyCacheRow(userId!, yearMonth).then(toQueryData),
  });

  return cacheQuery.data ?? null;
}
