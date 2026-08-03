/**
 * Budget feature — Supabase call for the user's monthly budget
 * (data-access spec).
 *
 * Dual-mode (ADR-4): demo mode returns `{ status: 'demo' }` WITHOUT touching
 * the network (the hook serves the fixtures); authenticated mode reads
 * `profiles.monthly_budget` and `currency` for the signed-in user.
 */
import {
  readMonthlyBudgetRow,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';

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
