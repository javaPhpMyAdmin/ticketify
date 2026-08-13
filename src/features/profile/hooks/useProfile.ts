import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  fetchProfile,
  fetchScanUsage,
  setHouseholdSharing,
  setProfileBudget,
  setProfileCurrency,
  WRITE_ERROR_MESSAGE,
  type ProfileWriteResult,
} from '../api';
import { useSessionUser } from '@/features/auth';
import { queryClient, SCAN_USAGE_STALE_TIME } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import { useSettingsStore } from '@/stores/use-settings-store';
import type { ScanUsage, User } from '@/types';

export interface UseProfileResult {
  user: User | null;
  usage: ScanUsage | null;
  isLoading: boolean;
  /** User-safe message when an authenticated read fails or the profile is missing. */
  error: string | null;
  setHouseholdSharing: (enabled: boolean) => Promise<void>;
  /**
   * Persists the user's `profiles.currency` and resolves with the write
   * result: `{ status: 'ok' }` on success, or a user-safe `message` the UI
   * can show inline. A successful write invalidates the profile and budget
   * queries so the budget card and the profile row re-read the new currency.
   */
  setCurrency: (currency: string) => Promise<ProfileWriteResult>;
  /**
   * Persists the user's `profiles.monthly_budget`. Same posture as
   * `setCurrency`: a successful write invalidates the profile and budget
   * queries so the home budget card re-reads the new limit on next render.
   */
  setBudget: (amount: number) => Promise<ProfileWriteResult>;
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

  // Hydrates the settings store's currency from the profile row (the source
  // of truth): the effect keys on the VALUE, so it fires on first load and
  // on a post-write refetch, but never re-sets a currency the user just
  // picked — the invalidation refetch below returns the same value the write
  // persisted, so the hydrate and the selector converge instead of fighting.
  // Skipping equal values also keeps a same-currency refetch from notifying
  // store subscribers.
  useEffect(() => {
    const profileCurrency = profileQuery.data?.currency;
    if (!profileCurrency) return;
    const stored = useSettingsStore.getState().currency;
    if (stored !== profileCurrency) {
      useSettingsStore.getState().setCurrency(profileCurrency);
    }
  }, [profileQuery.data?.currency]);

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
    setCurrency: async (currency: string) => {
      if (!userId) {
        return { status: 'error', message: WRITE_ERROR_MESSAGE };
      }
      const result = await setProfileCurrency(userId, currency);
      if (result.status === 'ok') {
        // The budget card and the profile row both carry the currency:
        // invalidate both so the next refetch re-reads the new value
        // (server-state-caching spec — same pattern as saveReceipt).
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.budget(userId) });
      }
      return result;
    },
    setBudget: async (amount: number) => {
      if (!userId) {
        return { status: 'error', message: WRITE_ERROR_MESSAGE };
      }
      const result = await setProfileBudget(userId, amount);
      if (result.status === 'ok') {
        // The budget bar reads from the budget query and the profile row
        // also carries the limit; invalidate both so the home card reflects
        // the new value without a manual pull-to-refresh.
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.budget(userId) });
      }
      return result;
    },
  };
}
