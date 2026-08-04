import { useQuery } from '@tanstack/react-query';

import { fetchMonthlyBudget, type MonthlyBudget } from '../api';
import { useSessionUser } from '@/features/auth';
import { queryKeys } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';

/**
 * Returns the user's monthly budget plus the amount spent so far (data-access
 * spec) through TanStack Query (server-state-caching spec). The read is
 * authenticated-only and disabled until a signed-in user exists. The budget
 * comes from the profile row's `monthly_budget`. The "spent" aggregation has
 * no backend read yet (purchase reads are out of scope), so it reports 0 —
 * never a hardcoded value.
 */
export interface BudgetSnapshot {
  budget: MonthlyBudget;
  spent: number;
  /** 0..1. */
  percent: number;
  /** User-safe message when the authenticated read fails or the profile is missing. */
  error: string | null;
}

/** Neutral fallback while an authenticated read loads or fails — never fabricated. */
const NEUTRAL_BUDGET: MonthlyBudget = { amount: 0, currency: 'USD' };

export function useBudget(): BudgetSnapshot {
  const { userId } = useSessionUser();

  const budgetQuery = useQuery({
    queryKey: queryKeys.budget(userId!),
    enabled: !!userId,
    queryFn: () => fetchMonthlyBudget(userId!).then(toQueryData),
  });

  const budget = budgetQuery.data ?? NEUTRAL_BUDGET;
  const spent = 0;
  const percent = budget.amount > 0 ? Math.min(1, spent / budget.amount) : 0;
  return {
    budget,
    spent,
    percent,
    error: budgetQuery.error ? toQueryErrorMessage(budgetQuery.error) : null,
  };
}
