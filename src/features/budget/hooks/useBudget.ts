import { useEffect, useState } from 'react';

import { fetchMonthlyBudget, type MonthlyBudget } from '../api';
import { monthlyBudget as defaultBudget } from '@/lib/fixtures/demo';

/**
 * Returns the user's monthly budget plus the amount spent so far
 * within the current period. The current implementation is a stub
 * seeded with the demo fixture; once the real Supabase aggregations
 * land, only the body of this hook changes.
 */
export interface BudgetSnapshot {
  budget: MonthlyBudget;
  spent: number;
  /** 0..1. */
  percent: number;
}

export function useBudget(): BudgetSnapshot {
  const [budget, setBudget] = useState<MonthlyBudget>(defaultBudget);
  const spent = 850;

  useEffect(() => {
    let cancelled = false;
    // TODO: replace with `useQuery(fetchMonthlyBudget, userId)`.
    fetchMonthlyBudget('demo').then((next) => {
      if (cancelled) return;
      setBudget(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const percent = budget.amount > 0 ? Math.min(1, spent / budget.amount) : 0;
  return { budget, spent, percent };
}
