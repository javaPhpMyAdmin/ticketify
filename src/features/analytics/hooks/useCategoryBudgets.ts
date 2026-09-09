import { useEffect, useRef } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { currentMonthKey, previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import { EXPENSE_CATEGORIES } from '@/features/home/categories';
import { queryKeys } from '@/lib/query-keys';
import {
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
 * limits once (idempotent PK upsert, ref-guarded one-shot per mount+month).
 */
export function useCategoryBudgets(yearMonth = currentMonthKey()) {
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
  // Guards: not-current month → skip; rows exist → skip; loading → skip;
  // ref guard → skip. One-shot per mount+month via rolloverDoneRef.
  const rolloverDoneRef = useRef<string | null>(null);

  const rolloverMutation = useMutation({
    mutationFn: async () => {
      const prevKey = previousMonthKey(yearMonth);
      const prevResult = await readCategoryBudgets(userId!, prevKey);
      if (prevResult.status !== 'ok') return;

      const prevBudgets = prevResult.data ?? [];
      const validKeys = new Set(Object.keys(EXPENSE_CATEGORIES));

      // Filter: slug must exist in EXPENSE_CATEGORIES and amount > 0 (AD-7)
      const copies = prevBudgets
        .filter((b) => validKeys.has(b.category_slug) && b.amount > 0)
        .map((b) => ({ category_slug: b.category_slug, amount: b.amount }));

      if (copies.length === 0) return;

      return upsertCategoryBudgets(copies, yearMonth, userId!).then(toQueryData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.monthlyTotals(userId!, yearMonth),
      });
    },
  });

  useEffect(() => {
    if (!userId) return;
    if (yearMonth !== currentMonthKey()) return;
    if (budgets.length > 0) return;
    if (budgetsQuery.data === undefined) return;
    if (rolloverMutation.isPending) return;
    if (rolloverDoneRef.current === yearMonth) return;

    rolloverDoneRef.current = yearMonth;
    rolloverMutation.mutate();
  }, [userId, yearMonth, budgets, budgetsQuery.data, rolloverMutation.isPending]);

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
