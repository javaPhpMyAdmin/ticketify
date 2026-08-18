import { useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import {
  readMonthlyCacheRow,
  triggerMonthlyRecalc,
} from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { CategoryMonthlyTotal, MonthlyTotalsCacheRow } from '@/types';

import { useMonthlyTotals } from './useMonthlyTotals';

// ---------------------------------------------------------------------------
// Transform: cache row → CategoryMonthlyTotal[]
// ---------------------------------------------------------------------------

/**
 * Maps the `category_totals` jsonb from the cache row to the
 * `CategoryMonthlyTotal[]` shape consumers expect. The cache stores
 * `{ slug: { total, count, name } }` — we add `category_id = slug`,
 * compute `percent_of_total`, and set `budget_limit = null` (consumers
 * merge budgets separately).
 */
export function transformCacheToCategoryTotals(
  row: MonthlyTotalsCacheRow | null,
): CategoryMonthlyTotal[] {
  if (!row) return [];

  const entries = Object.entries(row.category_totals);
  if (entries.length === 0) return [];

  return entries
    .map(([slug, { total, count, name }]) => ({
      category_id: slug,
      category_name: name,
      category_slug: slug,
      total,
      item_count: count,
      percent_of_total:
        row.total > 0 ? Math.round((total / row.total) * 1000) / 10 : 0,
      budget_limit: null,
    }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reads the materialized monthly cache for personal mode. Falls through
 * to `useMonthlyTotals` (existing RPCs) when a `householdId` is provided.
 *
 * Cache-miss path: when the read returns no row, a one-time
 * `triggerMonthlyRecalc` mutation fires and refetches once complete.
 *
 * The return shape matches `useMonthlyTotals` so consumers can swap
 * between them without API changes.
 */
export function useMonthlyCache(
  yearMonth = utcYearMonth(),
  householdId?: string | null,
): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
  error: string | null;
  hasData: boolean;
  refetch: () => Promise<unknown>;
} {
  const { userId } = useSessionUser();

  // Household mode: fall through to existing RPCs (no cache).
  if (householdId) {
    return useMonthlyTotals(yearMonth, householdId);
  }

  const cacheQuery = useQuery({
    queryKey: queryKeys.monthlyCache(userId!, yearMonth),
    enabled: !!userId,
    queryFn: () =>
      readMonthlyCacheRow(userId!, yearMonth).then(toQueryData),
  });

  // Cache miss: trigger a one-time recalculation via RPC.
  const triggerMutation = useMutation({
    mutationFn: () =>
      triggerMonthlyRecalc(userId!, yearMonth).then(toQueryData),
    onSuccess: () => {
      cacheQuery.refetch();
    },
  });

  // Auto-trigger recalc when cache is empty and not already in flight.
  useEffect(() => {
    if (
      cacheQuery.data === null &&
      !cacheQuery.isLoading &&
      !triggerMutation.isPending
    ) {
      triggerMutation.mutate();
    }
  }, [cacheQuery.data, cacheQuery.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = cacheQuery.data ?? null;
  const totals = useMemo(() => transformCacheToCategoryTotals(row), [row]);
  const monthTotal = row?.total ?? 0;

  return {
    totals,
    monthTotal,
    isLoading: cacheQuery.isLoading || triggerMutation.isPending,
    error: cacheQuery.error
      ? toQueryErrorMessage(cacheQuery.error)
      : null,
    hasData: cacheQuery.data !== undefined,
    refetch: cacheQuery.refetch,
  };
}
