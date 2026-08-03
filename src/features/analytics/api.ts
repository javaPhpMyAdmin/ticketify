/**
 * Analytics feature — Supabase aggregations for the analytics tab.
 *
 * TODO: replace the stubs with real RPCs. The view layer (`useMonthlyTotals`,
 * `useCategoryBreakdown`) consumes the same shape the rest of the app
 * uses, so the migration is one file.
 */
import type { CategoryMonthlyTotal } from '@/types';
import { categoryBreakdownRows } from '@/lib/fixtures/demo';

export async function fetchMonthlyTotals(_userId: string): Promise<CategoryMonthlyTotal[]> {
  // TODO: call an analytics RPC.
  // const { data, error } = await supabase.rpc('monthly_category_totals', { user_id: _userId });
  // if (error) throw error;
  // return data as CategoryMonthlyTotal[];
  return categoryBreakdownRows;
}

export async function fetchCategoryBreakdown(
  _userId: string,
  _yearMonth: string,
): Promise<CategoryMonthlyTotal[]> {
  // TODO: Supabase call.
  return categoryBreakdownRows;
}
