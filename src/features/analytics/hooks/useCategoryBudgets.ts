import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
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
 */
export function useCategoryBudgets(yearMonth = utcYearMonth()) {
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
