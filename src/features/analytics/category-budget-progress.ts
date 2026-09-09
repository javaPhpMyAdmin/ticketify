import type { CategoryBudget, CategoryMonthlyTotal } from '@/types';

/**
 * Shared progress-bar palette (spec NFR-4: identical thresholds/colors in
 * every consumer). Consolidates the hex values previously duplicated inline
 * in `CategoryBudgetCard` and `CategoryBudgetRow` — surfaces switch to this
 * constant in the surfacing batch.
 */
export const BUDGET_COLOR = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
} as const;

/**
 * Single source of truth for the budget progress-bar color (spec REQ:
 * green below 70% of limit, amber at 70–100%, red above 100%).
 * `ratio = spend / limit` — callers already compute this for the
 * `ProgressBar` value. Boundary: exactly 100% counts as red, matching the
 * previous component logic and the `CategoryBudgetCard` inline ternary.
 */
export function budgetProgressColor(ratio: number): string {
  if (ratio >= 1) return BUDGET_COLOR.red;
  if (ratio >= 0.7) return BUDGET_COLOR.amber;
  return BUDGET_COLOR.green;
}

/**
 * Pure merge of budget limits into cache-backed category totals (design AD-5,
 * post-step in the `useMonthlyCache` personal path). Never mutates its
 * inputs and preserves the input totals order. For each total:
 * a budget row with the same slug, the same month and `amount > 0` fills
 * `budget_limit = amount`; otherwise `budget_limit = null`. Budget rows for
 * slugs not present in `totals` are ignored (they never add entries).
 */
export function computeCategoryBudgetProgress(
  totals: CategoryMonthlyTotal[],
  budgets: CategoryBudget[],
  monthKey: string,
): CategoryMonthlyTotal[] {
  const limitBySlug = budgetBySlug(budgets, monthKey);
  return totals.map((t) => {
    const limit = limitBySlug.get(t.category_slug);
    return limit === undefined
      ? { ...t, budget_limit: null }
      : { ...t, budget_limit: limit };
  });
}

/**
 * Builds a `slug → amount` lookup for the month (design contract — History
 * personal `CategoryBudgetCard` limit lookup). Only budget rows for the given
 * month with `amount > 0` are included: `<= 0` rows are delete-on-zero
 * artifacts that must never surface as a budget.
 */
export function budgetBySlug(
  budgets: CategoryBudget[],
  monthKey: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of budgets) {
    if (b.month === monthKey && b.amount > 0) {
      map.set(b.category_slug, b.amount);
    }
  }
  return map;
}