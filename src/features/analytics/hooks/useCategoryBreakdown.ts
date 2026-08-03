import { useEffect, useState } from 'react';

import { fetchCategoryBreakdown } from '../api';
import type { CategoryMonthlyTotal } from '@/types';

/**
 * Returns the per-category breakdown for a given year-month. The
 * shape matches `CategoryMonthlyTotal` from `@/types`. Currently a
 * stub — the data flows from `fetchCategoryBreakdown` until the real
 * Supabase RPC lands.
 */
export function useCategoryBreakdown(yearMonth: string): {
  rows: CategoryMonthlyTotal[];
  isLoading: boolean;
} {
  const [rows, setRows] = useState<CategoryMonthlyTotal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCategoryBreakdown('demo', yearMonth).then((data) => {
      if (cancelled) return;
      setRows(data);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [yearMonth]);

  return { rows, isLoading };
}
