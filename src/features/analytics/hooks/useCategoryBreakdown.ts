import { useEffect, useState } from 'react';

import { fetchCategoryBreakdown } from '../api';
import { useAuthMode } from '@/features/auth';
import { categoryBreakdownRows } from '@/lib/fixtures/demo';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the per-category breakdown for a given year-month (data-access
 * spec, ADR-4). Demo mode → fixture rows, zero network; authenticated mode →
 * the `monthly_category_totals` RPC for the signed-in user.
 */
export function useCategoryBreakdown(yearMonth: string): {
  rows: CategoryMonthlyTotal[];
  isLoading: boolean;
  error: string | null;
} {
  const { mode } = useAuthMode();
  const [rows, setRows] = useState<CategoryMonthlyTotal[]>(() =>
    mode === 'demo' ? categoryBreakdownRows : [],
  );
  const [isLoading, setIsLoading] = useState(mode !== 'demo');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (mode === 'demo') {
      setRows(categoryBreakdownRows);
      setError(null);
      setIsLoading(false);
      return;
    }

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
      // 'missing-profile' cannot occur for an RPC; 'demo' is unreachable.
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [mode, yearMonth]);

  return { rows, isLoading, error };
}
