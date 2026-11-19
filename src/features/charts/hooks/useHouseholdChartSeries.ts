/**
 * Mode-aware read hook for the Pro Stats household series.
 *
 * The personal path keeps reading `monthly_user_totals` directly. This hook is
 * enabled ONLY in household mode and reads the read-only migration 0048 RPC;
 * nothing here writes the personal cache.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { readHouseholdChartSeries } from '@/lib/supabase/feature-access';
import { queryKeys } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { HouseholdChartSeriesRow } from '@/types';

import { toChartCacheRows, type ChartCacheRow } from '../householdSeries';

export interface UseHouseholdChartSeriesResult {
  rows: HouseholdChartSeriesRow[];
  /** Cache-shaped view of the same rows, sorted by (month, unit). */
  cacheRows: ChartCacheRow[];
  error: string | null;
  /** False while the RPC has not resolved — never render a false $0 before it. */
  hasData: boolean;
  refetch: () => Promise<unknown>;
}

const EMPTY_ROWS: HouseholdChartSeriesRow[] = [];

export function useHouseholdChartSeries(
  householdId: string | null | undefined,
  yearMonths: string[],
  enabled = true,
): UseHouseholdChartSeriesResult {
  const queryEnabled = enabled && !!householdId && yearMonths.length > 0;
  const query = useQuery({
    queryKey: queryKeys.householdChartSeries(householdId ?? '', yearMonths),
    enabled: queryEnabled,
    queryFn: () =>
      readHouseholdChartSeries(householdId!, yearMonths).then(toQueryData),
  });

  const rows = query.data ?? EMPTY_ROWS;
  const cacheRows = useMemo(() => toChartCacheRows(rows), [rows]);
  return {
    rows,
    cacheRows,
    error: query.error ? toQueryErrorMessage(query.error) : null,
    // A disabled query is RESOLVED with no rows, not a permanent skeleton:
    // callers must show a no-data state instead of waiting forever.
    hasData: !queryEnabled || query.data !== undefined,
    refetch: query.refetch,
  };
}
