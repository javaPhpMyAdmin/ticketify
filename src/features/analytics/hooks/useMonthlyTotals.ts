import { useEffect, useMemo, useState } from 'react';

import { fetchMonthlyTotals } from '../api';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the current month's category totals plus a derived total
 * (data-access spec). Authenticated-only: reads the `monthly_category_totals`
 * RPC (scoped to `auth.uid()` server-side), with a user-safe error when the
 * call fails (e.g. the RPC is not deployed yet). No fabricated fallback.
 */
export function useMonthlyTotals(): {
  totals: CategoryMonthlyTotal[];
  monthTotal: number;
  isLoading: boolean;
  error: string | null;
} {
  const [totals, setTotals] = useState<CategoryMonthlyTotal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

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
      // 'missing-profile' cannot occur for an RPC.
      setIsLoading(false);
    }, () => {
      // Rejected fetch (network/backend failure before a response): surface
      // the generic copy and settle the loading state — never leave the UI
      // spinning on a swallowed rejection.
      if (cancelled) return;
      setError(READ_ERROR_MESSAGE);
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

  return { totals, monthTotal, isLoading, error };
}
