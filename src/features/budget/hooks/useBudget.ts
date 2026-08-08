import { useQuery } from '@tanstack/react-query';

import {
  fetchMonthlyBudget,
  sumCategoryTotals,
  type MonthlyBudget,
} from '../api';
import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { queryKeys } from '@/lib/query-keys';
import { readCategoryTotals } from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';

/**
 * Returns the user's monthly budget plus the amount spent so far (data-access
 * spec) through TanStack Query (server-state-caching spec). Both reads are
 * authenticated-only and disabled until a signed-in user exists. The budget
 * comes from the profile row's `monthly_budget`.
 *
 * Spent-failure contract: the "spent" amount is a SECOND read (`spentQuery`)
 * — the shared `monthly_category_totals` RPC summed via `select`. When
 * `error` is non-null, `spent === 0` is a FAILURE FALLBACK, never real
 * spend: the progress UI cannot render null, so the 0 exists only as a
 * stand-in while the spent read loads or fails. No number is ever
 * fabricated — a progress bar showing 0% with `error` set means "unknown",
 * not "spent nothing".
 *
 * Cache contract: `spentQuery` reads ROWS on the SAME cache key the
 * analytics screen uses (`queryKeys.monthlyTotals(userId, currentMonthKey())`
 * — the local current month the analytics month selector starts on), so both
 * surfaces share one rows-shaped cache entry and the sum happens
 * per-observer, never in the cache.
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

  // The local current month — the same value the analytics screen passes to
  // `useMonthlyTotals`, so the shared cache key collides with analytics by
  // design and the entry always holds rows.
  const monthKey = currentMonthKey();
  const spentQuery = useQuery({
    queryKey: queryKeys.monthlyTotals(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readCategoryTotals(monthKey).then(toQueryData),
    select: (rows) => sumCategoryTotals(rows),
  });

  const budget = budgetQuery.data ?? NEUTRAL_BUDGET;
  const spent = spentQuery.data ?? 0;
  const percent = budget.amount > 0 ? Math.min(1, spent / budget.amount) : 0;
  return {
    budget,
    spent,
    percent,
    error: budgetQuery.error
      ? toQueryErrorMessage(budgetQuery.error)
      : spentQuery.error
        ? toQueryErrorMessage(spentQuery.error)
        : null,
  };
}
