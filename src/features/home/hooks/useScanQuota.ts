import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { fetchScanUsage } from '@/features/profile';
import { SCAN_USAGE_STALE_TIME } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import { toQueryData } from '@/lib/supabase/query-adapters';
import type { ScanUsage } from '@/types';

export interface ScanQuotaResult {
  /** The user's `scan_usage` row for the current month; null while loading. */
  usage: ScanUsage | null;
}

/**
 * Current-month scan quota for the home screen. Reuses the profile
 * feature's authenticated read (`fetchScanUsage`) with the same query key
 * and stale time, so profile and home share one cache entry — mounting
 * both never double-fetches. Disabled until a signed-in user exists.
 */
export function useScanQuota(): ScanQuotaResult {
  const { userId } = useSessionUser();
  const yearMonth = utcYearMonth();

  const usageQuery = useQuery({
    queryKey: queryKeys.scanUsage(userId!, yearMonth),
    enabled: !!userId,
    staleTime: SCAN_USAGE_STALE_TIME,
    queryFn: () => fetchScanUsage(userId!, yearMonth).then(toQueryData),
  });

  return { usage: usageQuery.data ?? null };
}
