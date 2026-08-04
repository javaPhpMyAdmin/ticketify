import { useQuery } from '@tanstack/react-query';

import { fetchProfile, fetchScanUsage, setHouseholdSharing } from '../api';
import { useSessionUser } from '@/features/auth';
import { SCAN_USAGE_STALE_TIME } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { ScanUsage, User } from '@/types';

export interface UseProfileResult {
  user: User | null;
  usage: ScanUsage | null;
  isLoading: boolean;
  /** User-safe message when an authenticated read fails or the profile is missing. */
  error: string | null;
  setHouseholdSharing: (enabled: boolean) => Promise<void>;
}

/**
 * Aggregates the current user's profile and scan usage (data-access spec)
 * through TanStack Query (server-state-caching spec). Both reads are
 * authenticated-only and disabled until a signed-in user exists, so no
 * request ever runs without a session. The profile query is fresh for 60s;
 * scan usage goes stale sooner (30s). A missing profile or failed read
 * surfaces via `toQueryErrorMessage` — never a fabricated fallback.
 */
export function useProfile(): UseProfileResult {
  const { userId } = useSessionUser();
  const yearMonth = utcYearMonth();

  const profileQuery = useQuery({
    queryKey: queryKeys.profile(userId!),
    enabled: !!userId,
    queryFn: () => fetchProfile(userId!).then(toQueryData),
  });

  const usageQuery = useQuery({
    queryKey: queryKeys.scanUsage(userId!, yearMonth),
    enabled: !!userId,
    staleTime: SCAN_USAGE_STALE_TIME,
    queryFn: () => fetchScanUsage(userId!, yearMonth).then(toQueryData),
  });

  return {
    user: profileQuery.data ?? null,
    usage: usageQuery.data ?? null,
    isLoading: profileQuery.isLoading || usageQuery.isLoading,
    error: profileQuery.error
      ? toQueryErrorMessage(profileQuery.error)
      : usageQuery.error
        ? toQueryErrorMessage(usageQuery.error)
        : null,
    setHouseholdSharing: async (enabled: boolean) => {
      if (userId) {
        await setHouseholdSharing(userId, enabled);
      }
    },
  };
}
