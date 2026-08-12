import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { fetchScanUsage } from '@/features/profile';
import { useProEntitlement } from '@/features/pro';
import { SCAN_USAGE_STALE_TIME } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import { toQueryData } from '@/lib/supabase/query-adapters';

/**
 * Minimal usage view exposed by `useScanQuota` (pro-subscription spec —
 * REQ-QUOTA-6, REQ-GATE-4). The full `ScanUsage` row stays in
 * `@/types`, but every UI consumer only needs `used` + `limit` — the
 * nullable limit (`null` = Pro unlimited, set by set_profile_tier on
 * GRANT after migration 0011) is what flips the meter to "Ilimitado".
 */
export interface ScanQuotaUsage {
  used: number;
  limit: number | null;
}

export interface ScanQuotaResult {
  /**
   * The user's `scan_usage` row for the current month, narrowed to the
   * shape the meter actually needs. `null` while loading or when the
   * row genuinely does not exist (a fresh month).
   */
  usage: ScanQuotaUsage | null;
  /** Client entitlement — Pro flips the meter to unlimited. */
  isPro: boolean;
  /** Re-read the scan_usage row (post-scan, post-RPC, post-refresh). */
  refresh: () => Promise<void>;
}

/**
 * Current-month scan quota for the home screen (pro-subscription spec —
 * REQ-QUOTA-6, REQ-GATE-4, REQ-GATE-5). Reuses the profile feature's
 * authenticated read (`fetchScanUsage`) with the same query key and
 * stale time, so profile and home share one cache entry — mounting both
 * never double-fetches. Disabled until a signed-in user exists.
 *
 * `isPro` is read from `useProEntitlement` (M4) so a purchase or
 * expiration flips the meter on the already-mounted home screen
 * without an app restart (REQ-GATE-5).
 */
export function useScanQuota(): ScanQuotaResult {
  const { userId } = useSessionUser();
  const yearMonth = utcYearMonth();
  const { isPro, refresh: refreshEntitlement } = useProEntitlement();

  const usageQuery = useQuery({
    queryKey: queryKeys.scanUsage(userId!, yearMonth),
    enabled: !!userId,
    staleTime: SCAN_USAGE_STALE_TIME,
    queryFn: () => fetchScanUsage(userId!, yearMonth).then(toQueryData),
  });

  const usage: ScanQuotaUsage | null = usageQuery.data
    ? {
        used: usageQuery.data.scans_used,
        limit: usageQuery.data.scans_limit,
      }
    : null;

  return {
    usage,
    isPro,
    refresh: async () => {
      await usageQuery.refetch();
      await refreshEntitlement();
    },
  };
}
