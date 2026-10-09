import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { readMonthlyCacheRowsForMonth } from '@/lib/supabase/feature-access';
import { toQueryData } from '@/lib/supabase/query-adapters';
import type { MonthlyTotalsCacheRow } from '@/types';
import { queryKeys } from '@/lib/query-keys';
import { useSettingsStore } from '@/stores/use-settings-store';

/**
 * Reads the raw materialized monthly cache row for personal mode, bound to
 * the VIEWER-currency row (decision 9 single-series binding; full rationale
 * on `bindViewerRows` in `@/features/charts/aggregate`).
 *
 * 0044 re-keyed `monthly_user_totals` per unit, so a month holds one row per
 * effective currency. The `daily_totals` / `store_totals` jsonb feeds
 * single-series surfaces (daily bars, store bars, run rate), which read the
 * viewer-currency row ONLY.
 *
 * Returns `null` when no row exists (cache miss) or when the viewer unit has
 * no row that month — never a fabricated figure. Used by the charts screen for
 * the jsonb fields the `CategoryMonthlyTotal[]` transform discards.
 */
export function useMonthlyCacheData(
  yearMonth = currentMonthKey(),
): MonthlyTotalsCacheRow | null {
  const { userId } = useSessionUser();
  const currency = useSettingsStore((s) => s.currency);

  const cacheQuery = useQuery({
    queryKey: queryKeys.monthlyCache(userId ?? '', yearMonth),
    enabled: !!userId,
    queryFn: () =>
      readMonthlyCacheRowsForMonth(userId!, yearMonth).then(toQueryData),
  });

  const rows = cacheQuery.data ?? [];
  // Single-series binding: the viewer-currency row only (see decision 9).
  return rows.find((row) => row.currency === currency) ?? null;
}