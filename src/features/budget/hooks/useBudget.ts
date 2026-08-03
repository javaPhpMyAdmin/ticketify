import { useEffect, useState } from 'react';

import { fetchMonthlyBudget, type MonthlyBudget } from '../api';
import { useAuthMode } from '@/features/auth';
import { monthlyBudget as demoBudget } from '@/lib/fixtures/demo';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';

/**
 * Returns the user's monthly budget plus the amount spent so far (data-access
 * spec, ADR-4). Demo mode → fixture budget, zero network. Authenticated mode →
 * the profile row's `monthly_budget`. The "spent" aggregation has no backend
 * read yet (purchase reads are out of scope), so authenticated mode reports 0
 * instead of leaking the demo's hardcoded value.
 */
export interface BudgetSnapshot {
  budget: MonthlyBudget;
  spent: number;
  /** 0..1. */
  percent: number;
  /** User-safe message when the authenticated read fails or the profile is missing. */
  error: string | null;
}

const DEMO_SPENT = 850; // demo fixture; purchase aggregation is out of scope
const MISSING_PROFILE_MESSAGE =
  'Your profile is not set up yet. Please try again.';
/** Neutral fallback while an authenticated read loads or fails — never fixtures. */
const NEUTRAL_BUDGET: MonthlyBudget = { amount: 0, currency: 'USD' };

export function useBudget(): BudgetSnapshot {
  const { mode, userId } = useAuthMode();
  const [budget, setBudget] = useState<MonthlyBudget>(() =>
    mode === 'demo' ? demoBudget : NEUTRAL_BUDGET,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (mode === 'demo') {
      setBudget(demoBudget);
      setError(null);
      return;
    }

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
      // 'demo' is unreachable: the hook already branched on the live mode.
    });

    return () => {
      cancelled = true;
    };
  }, [mode, userId]);

  const spent = mode === 'demo' ? DEMO_SPENT : 0;
  const percent = budget.amount > 0 ? Math.min(1, spent / budget.amount) : 0;
  return { budget, spent, percent, error };
}
