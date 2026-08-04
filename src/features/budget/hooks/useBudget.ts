import { useEffect, useState } from 'react';

import { fetchMonthlyBudget, type MonthlyBudget } from '../api';
import { useAuthMode } from '@/features/auth';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';

/**
 * Returns the user's monthly budget plus the amount spent so far (data-access
 * spec). Reads are authenticated-only: the budget comes from the profile
 * row's `monthly_budget`. The "spent" aggregation has no backend read yet
 * (purchase reads are out of scope), so it reports 0 — never a hardcoded
 * value.
 */
export interface BudgetSnapshot {
  budget: MonthlyBudget;
  spent: number;
  /** 0..1. */
  percent: number;
  /** User-safe message when the authenticated read fails or the profile is missing. */
  error: string | null;
}

const MISSING_PROFILE_MESSAGE =
  'Your profile is not set up yet. Please try again.';
/** Neutral fallback while an authenticated read loads or fails — never fabricated. */
const NEUTRAL_BUDGET: MonthlyBudget = { amount: 0, currency: 'USD' };

export function useBudget(): BudgetSnapshot {
  const { userId } = useAuthMode();
  const [budget, setBudget] = useState<MonthlyBudget>(NEUTRAL_BUDGET);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setBudget(NEUTRAL_BUDGET);
    setError(null);
    if (!userId) {
      setError('Sign in to load your budget.');
      return;
    }

    fetchMonthlyBudget(userId).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setBudget(result.data);
      } else if (result.status === 'missing-profile') {
        setError(MISSING_PROFILE_MESSAGE);
      } else if (result.status === 'error') {
        setError(result.message);
      } else if (result.status === 'unconfigured') {
        setError(READ_ERROR_MESSAGE);
      }
    }, () => {
      // Rejected fetch (network/backend failure before a response): surface
      // the generic copy instead of swallowing the rejection.
      if (cancelled) return;
      setError(READ_ERROR_MESSAGE);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const spent = 0;
  const percent = budget.amount > 0 ? Math.min(1, spent / budget.amount) : 0;
  return { budget, spent, percent, error };
}
