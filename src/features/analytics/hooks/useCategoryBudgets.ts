import { useEffect, useRef } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { currentMonthKey, previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import { EXPENSE_CATEGORIES } from '@/features/home/categories';
import { queryKeys } from '@/lib/query-keys';
import {
  markCategoryBudgetRolloverApplied,
  readCategoryBudgets,
  upsertCategoryBudgets,
} from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { CategoryBudget } from '@/types';

/**
 * Hook wrapping per-category budget read + write via React Query.
 *
 * `budgets` — the user's budget limits for the month (possibly empty).
 * `isLoading` — true while the initial read is in flight.
 * `error` — user-safe error string, or null.
 * `save(budgets)` — upserts the given budget amounts for the current month
 *   and invalidates the query so the UI stays fresh.
 *
 * Rollover (AD-1/AD-2/AD-7): when the resolved current-month budget read is
 * empty and the month is the local current month, copies the previous month's
 * limits once and durably records the copy (migration 0030: the
 * `rollover_applied` flag plus the `__rollover__` sentinel row). The record
 * is written even when there is nothing to copy, so the copy never re-runs on
 * remount or restart — including after the user clears every budget
 * (delete-on-zero does not touch the sentinel).
 *
 * `rolloverEnabled` (default true) lets callers opt out — the household
 * context passes `false` because household limits are aggregated server-side
 * and must not be re-copied per member (AD-6).
 */
export function useCategoryBudgets(
  yearMonth = currentMonthKey(),
  rolloverEnabled = true,
) {
  const { userId } = useSessionUser();
  const queryClient = useQueryClient();

  const budgetsQuery = useQuery({
    queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
    enabled: !!userId,
    queryFn: () =>
      readCategoryBudgets(userId!, yearMonth).then(toQueryData),
  });

  const saveMutation = useMutation({
    mutationFn: (budgets: Array<{ category_slug: string; amount: number }>) =>
      upsertCategoryBudgets(budgets, yearMonth, userId!).then(toQueryData),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
      });
      // Also invalidate monthly totals since the RPC now returns budget_limit
      queryClient.invalidateQueries({
        queryKey: queryKeys.monthlyTotals(userId!, yearMonth),
      });
    },
  });

  const budgets: CategoryBudget[] = budgetsQuery.data ?? [];

  // --- Rollover (AD-1, AD-2) ---
  // Guards: disabled → skip; not-current month → skip; rows exist or the
  // rollover already ran this month (copies/sentinel carry rollover_applied)
  // → skip; loading → skip; ref guard → skip. One-shot per mount+month via
  // rolloverDoneRef, plus the durable marker so restart is safe too.
  const rolloverDoneRef = useRef<string | null>(null);
  const lastRolloverAttemptRef = useRef<number | null>(null);

  const rolloverMutation = useMutation({
    mutationFn: async (): Promise<{ copied: number } | null> => {
      const prevKey = previousMonthKey(yearMonth);
      const prevResult = await readCategoryBudgets(userId!, prevKey);
      if (prevResult.status !== 'ok') return null;

      const prevBudgets = prevResult.data ?? [];
      const validKeys = new Set(Object.keys(EXPENSE_CATEGORIES));

      // Filter: slug must exist in EXPENSE_CATEGORIES and amount > 0 (AD-7).
      // The sentinel slug (amount 0) is excluded by the amount filter.
      const copies = prevBudgets
        .filter((b) => validKeys.has(b.category_slug) && b.amount > 0)
        .map((b) => ({ category_slug: b.category_slug, amount: b.amount }));

      lastRolloverAttemptRef.current = copies.length;

      // Persist the copies (rollover_applied = true) + the __rollover__
      // sentinel — durable "ran for this month", even with zero copies.
      const result = await markCategoryBudgetRolloverApplied(
        copies,
        yearMonth,
        userId!,
      );
      if (result.status !== 'ok') return null;
      return { copied: copies.length };
    },
    onSuccess: (result) => {
      // No-op result (prev read error / write error) → nothing was copied →
      // skip invalidation: refetching would only re-enter the same gate.
      if (result === null) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.monthlyTotals(userId!, yearMonth),
      });
    },
    onError: () => {
      // Unexpected throw (not a FeatureReadResult error): log the attempt so
      // repeated failures are diagnosable without user-visible noise.
      console.warn(
        `[rollover] copy for ${yearMonth} failed after reading ${
          lastRolloverAttemptRef.current ?? 'unknown'
        } previous budgets`,
      );
    },
  });

  useEffect(() => {
    if (!userId) return;
    if (!rolloverEnabled) return;
    if (yearMonth !== currentMonthKey()) return;
    if (budgets.length > 0) return;
    if (budgets.some((b) => b.rollover_applied === true)) return;
    if (budgetsQuery.data === undefined) return;
    if (rolloverMutation.isPending) return;
    if (rolloverDoneRef.current === yearMonth) return;

    rolloverDoneRef.current = yearMonth;
    rolloverMutation.mutate();
  }, [
    userId,
    yearMonth,
    budgets,
    budgetsQuery.data,
    rolloverMutation.isPending,
    rolloverEnabled,
  ]);

  return {
    budgets,
    isLoading: budgetsQuery.isLoading,
    error: budgetsQuery.error
      ? toQueryErrorMessage(budgetsQuery.error)
      : null,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}