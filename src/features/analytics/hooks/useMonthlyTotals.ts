import { useEffect, useMemo, useState } from 'react';

import { fetchMonthlyTotals } from '../api';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the current month's category totals plus a derived total.
 * The rows come from `fetchMonthlyTotals` (stubbed to the demo
 * fixtures until the real Supabase RPC lands).
 */
export function useMonthlyTotals(): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
} {
  const [totals, setTotals] = useState<CategoryMonthlyTotal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMonthlyTotals('demo').then((data) => {
      if (cancelled) return;
      setTotals(data);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const monthTotal = useMemo(
    () => totals.reduce((acc, t) => acc + t.total, 0),
    [totals],
  );

  return { totals, monthTotal, isLoading };
}
