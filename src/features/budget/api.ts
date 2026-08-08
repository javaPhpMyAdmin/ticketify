/**
 * Budget feature — Supabase call for the user's monthly budget
 * (data-access spec).
 *
 * Authenticated-only: reads `profiles.monthly_budget` and
 * `currency` for the signed-in user, with a defensive error state on failure.
 */
import {
  readMonthlyBudgetRow,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';
import type { CategoryMonthlyTotal } from '@/types';

export interface MonthlyBudget {
  amount: number;
  /** ISO 4217 currency. */
  currency: string;
}

export type MonthlyBudgetReadResult = FeatureReadResult<MonthlyBudget>;

/** The signed-in user's monthly budget, shaped from their `profiles` row. */
export async function fetchMonthlyBudget(
  userId: string,
): Promise<MonthlyBudgetReadResult> {
  const result = await readMonthlyBudgetRow(userId);
  if (result.status !== 'ok') return result;
  return {
    status: 'ok',
    data: {
      amount: result.data.monthly_budget,
      currency: result.data.currency,
    },
  };
}

/**
 * Sums the month's category totals into the amount spent so far. Pure —
 * hooks derive `spent` via a TanStack `select` over the SHARED analytics
 * cache key, so the cache always holds the ROWS shape (`CategoryMonthlyTotal[]`),
 * never a pre-summed number (a number/rows shape mismatch on one key would
 * crash the other surface).
 */
export function sumCategoryTotals(rows: CategoryMonthlyTotal[]): number {
  return rows.reduce((acc, t) => acc + t.total, 0);
}
