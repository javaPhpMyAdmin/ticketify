/**
 * Budget feature — Supabase calls for the user's monthly budget.
 *
 * TODO: replace the stubbed `fetchMonthlyBudget` with a real
 * `supabase.from('profiles').select('monthly_budget').eq('id', userId).single()`
 * once auth is wired up. The shape returned is identical to what the
 * current home screen reads from `useSettingsStore`, so swapping the
 * implementation in this file is a one-line change for callers.
 */
import { monthlyBudget } from '@/lib/fixtures/demo';

export interface MonthlyBudget {
  amount: number;
  /** ISO 4217 currency. */
  currency: string;
}

export async function fetchMonthlyBudget(_userId: string): Promise<MonthlyBudget> {
  // TODO: Supabase call.
  // const { data, error } = await supabase
  //   .from('profiles')
  //   .select('monthly_budget, currency')
  //   .eq('id', _userId)
  //   .single();
  // if (error) throw error;
  // return { amount: data.monthly_budget, currency: data.currency };
  return monthlyBudget;
}
