import { useQuery } from '@tanstack/react-query';

import {
  fetchMonthlyBudget,
  type MonthlyBudget,
} from '../api';
import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { queryKeys } from '@/lib/query-keys';
import { readMonthlyPurchasesTotal } from '@/lib/supabase/feature-access';
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
 * Spent-failure contract: the "spent" amount is a SECOND read
 * (`spentQuery`) — the `monthly_purchases_total` RPC, the SUM of
 * `purchases.total` (what the user was actually charged, AFTER
 * payment-method discounts like "Desc. de ley 19210"). When `error` is
 * non-null, `spent === 0` is a FAILURE FALLBACK, never real spend: the
 * progress UI cannot render null, so the 0 exists only as a stand-in while
 * the spent read loads or fails. No number is ever fabricated — a progress
 * bar showing 0% with `error` set means "unknown", not "spent nothing".
 *
 * Cache contract: `spentQuery` uses its OWN key
 * (`queryKeys.monthlyPurchasesTotal`), separate from the analytics
 * `monthlyTotals` rows key — the cache must never mix the category-rows
 * shape with the single-total shape under one key.
 */
export interface BudgetSnapshot {
  budget: MonthlyBudget;
  spent: number;
  /** 0..1. */
  percent: number;
  /** User-safe message when the authenticated read fails or the profile is missing. */
  error: string | null;
  /** True while either read is in flight with no data yet (initial fetch). */
  isLoading: boolean;
  /**
   * True once the budget read succeeded (a real limit exists), even if a
   * background refetch later fails. Screens render the budget error state
   * only when `error && !hasData` — a "Límite: $0" card must never stand
   * in for a failed budget read.
   */
  hasData: boolean;
  /** True while a background refetch is in flight (data is stale but valid). */
  isRefetching: boolean;
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
  // `useMonthlyTotals`, so both surfaces agree on which month is "now".
  const monthKey = currentMonthKey();
  const spentQuery = useQuery({
    queryKey: queryKeys.monthlyPurchasesTotal(userId!, monthKey),
    enabled: !!userId,
    queryFn: () =>
      readMonthlyPurchasesTotal(monthKey).then(toQueryData),
    select: (rows) =>
      rows.reduce((acc, row) => acc + (Number.isFinite(row.total) ? row.total : 0), 0),
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
    isLoading: budgetQuery.isLoading || spentQuery.isLoading,
    hasData: budgetQuery.data !== undefined,
    isRefetching: budgetQuery.isRefetching || spentQuery.isRefetching,
  };
}
