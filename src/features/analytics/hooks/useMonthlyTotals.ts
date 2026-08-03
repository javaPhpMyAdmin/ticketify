import { useEffect, useMemo, useState } from 'react';

import { fetchMonthlyTotals } from '../api';
import { useAuthMode } from '@/features/auth';
import { categoryBreakdownRows } from '@/lib/fixtures/demo';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the current month's category totals plus a derived total
 * (data-access spec, ADR-4). Demo mode → fixture rows, zero network;
 * authenticated mode → the `monthly_category_totals` RPC, with a user-safe
 * error when the call fails (e.g. the RPC is not deployed yet).
 */
export function useMonthlyTotals(): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
  error: string | null;
} {
  const { mode } = useAuthMode();
  const [totals, setTotals] = useState<CategoryMonthlyTotal[]>(() =>
    mode === 'demo' ? categoryBreakdownRows : [],
  );
  const [isLoading, setIsLoading] = useState(mode !== 'demo');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (mode === 'demo') {
      setTotals(categoryBreakdownRows);
      setError(null);
      setIsLoading(false);
      return;
    }

    setTotals([]);
    setError(null);
    setIsLoading(true);

    const yearMonth = new Date().toISOString().slice(0, 7);
    fetchMonthlyTotals(yearMonth).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setTotals(result.data);
      } else if (result.status === 'error') {
        setError(result.message);
      } else if (result.status === 'unconfigured') {
        setError(READ_ERROR_MESSAGE);
      }
      // 'missing-profile' cannot occur for an RPC; 'demo' is unreachable.
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const monthTotal = useMemo(
    () => totals.reduce((acc, t) => acc + t.total, 0),
    [totals],
  );

  return { totals, monthTotal, isLoading, error };
}
