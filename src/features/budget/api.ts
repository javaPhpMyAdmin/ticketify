/**
 * Budget feature — Supabase call for the user's monthly budget
 * (data-access spec).
 *
 * Authenticated-only: reads `profiles.monthly_budget` and
 * `currency` for the signed-in user, with a defensive error state on failure.
 */
import { MOCK_MONTHLY_BUDGET, USE_MOCK_DATA } from '@/lib/mock-data';
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
  if (USE_MOCK_DATA) {
    // Offline dev (EXPO_PUBLIC_MOCK_DATA=1): serve the fixture instead of
    // reading `profiles`, so the budget card renders without a real row.
    return { status: 'ok', data: MOCK_MONTHLY_BUDGET };
  }
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
