import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { readMonthlyCacheRow } from '@/lib/supabase/feature-access';
import { toQueryData } from '@/lib/supabase/query-adapters';
import type { MonthlyTotalsCacheRow } from '@/types';
import { queryKeys } from '@/lib/query-keys';
import { useSettingsStore } from '@/stores/use-settings-store';

/**
 * Reads the raw materialized monthly cache row for personal mode, bound to
 * the VIEWER-CURRENCY row (decision 9 / pass-3 §3 single-series binding).
 *
 * 0044 re-keyed `monthly_user_totals` per unit: a month holds one row per
 * effective currency. The `daily_totals` / `store_totals` jsonb feeds
 * single-series surfaces (daily bars, store bars, run rate), which SHALL
 * read the viewer-currency row ONLY — one figure, never a per-currency
 * split, never hidden.
 *
 * ACCEPTED under-report (Client-Side Read Contract s4): in a switch month
 * the viewer-currency row total comes from that unit's rows alone — spend
 * recorded in another unit before/after the switch is NOT re-denominated —
 * so a single-series bound to the viewer row mildly under-reports the
 * month. This is accepted: re-denominating would fabricate a rate.
 *
 * Returns `null` when no row exists (cache miss) or when the viewer unit
 * has no row that month (single-series has nothing to show — never a
 * fabricated figure).
 *
 * Used by the charts screen to access `daily_totals` and `store_totals`
 * jsonb fields that the `CategoryMonthlyTotal[]` transform discards.
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
      readMonthlyCacheRow(userId!, yearMonth).then(toQueryData),
  });

  const rows = cacheQuery.data ?? [];
  // Single-series binding: the viewer-currency row only (see decision 9).
  return (
    rows.find((row) => row.currency === currency) ?? null
  );
}