import { useEffect, useState } from 'react';

import { fetchCategoryBreakdown } from '../api';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the per-category breakdown for a given year-month (data-access
 * spec). Authenticated-only: reads the `monthly_category_totals` RPC for the
 * signed-in user, with a user-safe error when the call fails. No fabricated
 * fallback.
 */
export function useCategoryBreakdown(yearMonth: string): {
  rows: CategoryMonthlyTotal[];
  isLoading: boolean;
  error: string | null;
} {
  const [rows, setRows] = useState<CategoryMonthlyTotal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setRows([]);
    setError(null);
    setIsLoading(true);

    fetchCategoryBreakdown(yearMonth).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setRows(result.data);
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
  }, [yearMonth]);

  return { rows, isLoading, error };
}
