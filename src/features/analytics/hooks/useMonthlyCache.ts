import { useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { fetchMonthlyTotals } from '../api';
import { mergeBudgetLimits } from '../category-budget-progress';
import { queryKeys } from '@/lib/query-keys';
import { useCategoryBudgets } from './useCategoryBudgets';
import {
  readMonthlyCacheRow,
  readMonthlyPurchasesTotal,
  triggerMonthlyRecalc,
} from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type {
  CategoryMonthlyTotal,
  CurrencyTotal,
  MonthlyTotalsCacheRow,
} from '@/types';

// ---------------------------------------------------------------------------
// Transform: cache row → CategoryMonthlyTotal[]
// ---------------------------------------------------------------------------

/**
 * Maps the `category_totals` jsonb from the cache row to the
 * `CategoryMonthlyTotal[]` shape consumers expect. The cache stores
 * `{ slug: { total, count, name } }` — we add `category_id = slug`,
 * compute `percent_of_total`, and set `budget_limit = null` (consumers
 * merge budgets separately).
 *
 * 0044: the row is per-unit, so the transformed rows carry the row's unit
 * (`currency`) — the caller renders each amount under its own unit and the
 * percent is naturally windowed within it (per-unit parity with the RPC).
 * Unit-less legacy rows (personal mode) leave `currency` undefined → the
 * viewer profile is the fallback at render time (REQ-8 s4).
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
      currency: row.currency,
    }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reads the materialized monthly cache for personal mode. When a
 * `householdId` is provided, the category rows fall through to the
 * `monthly_category_totals` RPC directly (no cache — avoids cross-user
 * invalidation complexity) and the `monthTotal` headline reads the
 * confirmed-only, net-paid `monthly_purchases_total` RPC under the SAME
 * query key Home's household card uses (D2): both screens share one cache
 * entry, so Personal and Household headlines reconcile to the cent.
 *
 * Cache-miss path: when the read returns no row, a one-time
 * `triggerMonthlyRecalc` mutation fires and refetches once complete.
 *
 * The return shape matches `useMonthlyTotals` so consumers can swap
 * between them without API changes.
 */
export function useMonthlyCache(
  yearMonth = currentMonthKey(),
  householdId?: string | null,
): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  /** Per-unit net totals (household mode: `monthly_purchases_total` rows). */
  householdTotals: CurrencyTotal[];
  isLoading: boolean;
  error: string | null;
  hasData: boolean;
  refetch: () => Promise<unknown>;
} {
  const { userId } = useSessionUser();

  const isHousehold = !!householdId;

  // Shared budget read (AD-6): called unconditionally so hooks order stays
  // stable across viewMode switches. In household mode the rollover is
  // disabled (`rolloverEnabled = !isHousehold`): household limits come from
  // the server-side aggregation (migration 0026 nulls `budget_limit` there),
  // so per-member copying must not happen (R3-S1 — household unchanged).
  const { budgets } = useCategoryBudgets(yearMonth, !isHousehold);

  // All query keys must be stable regardless of mode (React hooks rules).
  const cacheKey = queryKeys.monthlyCache(userId ?? '', yearMonth);
  const householdKey = [
    ...queryKeys.monthlyTotals(userId ?? '', yearMonth),
    householdId,
  ] as const;
  // Shared with Home's `useHouseholdMonthTotal` (D2): the net headline key —
  // one cache entry and one invalidation path for Analytics and Home.
  const householdNetKey = queryKeys.householdMonthlyPurchasesTotal(
    householdId ?? '',
    yearMonth,
  );

  // Personal mode: read from the materialized cache rows (0044 re-keyed the
  // table per unit — a month holds one row per effective currency).
  const cacheQuery = useQuery({
    queryKey: cacheKey,
    enabled: !!userId && !isHousehold,
    queryFn: () =>
      readMonthlyCacheRow(userId!, yearMonth).then(toQueryData),
  });

  // Household mode: fall through to the category totals RPC directly.
  const householdQuery = useQuery({
    queryKey: householdKey,
    enabled: !!userId && isHousehold,
    queryFn: () =>
      fetchMonthlyTotals(yearMonth, householdId).then(toQueryData),
  });

  // Household mode: net headline from the confirmed-only
  // `monthly_purchases_total` RPC (D2). Personal mode stays cache-backed;
  // the per-category rows stay gross line-item sums (D3 — discounts are not
  // attributed per category, 0029 §3).
  const netTotalQuery = useQuery({
    queryKey: householdNetKey,
    enabled: !!userId && isHousehold,
    queryFn: () =>
      readMonthlyPurchasesTotal(yearMonth, householdId).then(toQueryData),
  });

  // Cache miss (personal mode): trigger a one-time recalculation via RPC.
  const triggerMutation = useMutation({
    mutationFn: () =>
      triggerMonthlyRecalc(userId!, yearMonth).then(toQueryData),
    onSuccess: () => {
      cacheQuery.refetch();
    },
  });

  // Auto-trigger recalc when the cache is empty and not already in flight.
  // `cacheQuery.data` is an array since 0044 (one row per unit); an empty
  // array is the cache-miss signal.
  const rows = cacheQuery.data ?? [];
  useEffect(() => {
    if (
      !isHousehold &&
      rows.length === 0 &&
      !cacheQuery.isLoading &&
      !triggerMutation.isPending
    ) {
      triggerMutation.mutate();
    }
  }, [rows.length, cacheQuery.isLoading, isHousehold]); // eslint-disable-line react-hooks/exhaustive-deps

  // AD-5: personal mode merges the month's budgets into the cache-backed
  // totals (post-step — the transform keeps its `budget_limit: null`
  // contract). Per-unit rows transform independently, so `percent_of_total`
  // is naturally windowed within each unit (0044 parity with the RPC).
  const totals = useMemo(
    () =>
      isHousehold
        ? transformCacheToCategoryTotals(rows[0] ?? null)
        : mergeBudgetLimits(
            rows.flatMap((row) => transformCacheToCategoryTotals(row)),
            budgets,
            yearMonth,
          ),
    [rows, budgets, yearMonth, isHousehold],
  );
  const monthTotal = rows.reduce((sum, row) => sum + row.total, 0);

  if (isHousehold) {
    const hTotals = householdQuery.data ?? [];
    // 0044: per-unit net rows; the headline renders one figure per group,
    // so the raw grouped rows are surfaced as `householdTotals`.
    const hNetRows = netTotalQuery.data ?? [];
    const householdTotals: CurrencyTotal[] = hNetRows.map((r) => ({
      total: r.total,
      currency: r.currency,
    }));
    return {
      totals: hTotals,
      monthTotal: hNetRows.reduce((sum, r) => sum + r.total, 0),
      householdTotals,
      isLoading: householdQuery.isLoading || netTotalQuery.isLoading,
      error: householdQuery.error
        ? toQueryErrorMessage(householdQuery.error)
        : netTotalQuery.error
          ? toQueryErrorMessage(netTotalQuery.error)
          : null,
      hasData:
        householdQuery.data !== undefined && netTotalQuery.data !== undefined,
      refetch: () =>
        Promise.all([householdQuery.refetch(), netTotalQuery.refetch()]),
    };
  }

  return {
    totals,
    monthTotal,
    householdTotals: [],
    isLoading: cacheQuery.isLoading || triggerMutation.isPending,
    error: cacheQuery.error
      ? toQueryErrorMessage(cacheQuery.error)
      : null,
    hasData: cacheQuery.data !== undefined,
    refetch: cacheQuery.refetch,
  };
}
