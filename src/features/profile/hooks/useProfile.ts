import { useEffect, useState } from 'react';

import { fetchProfile, fetchScanUsage, setHouseholdSharing } from '../api';
import { useAuthMode } from '@/features/auth';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';
import type { ScanUsage, User } from '@/types';

export interface UseProfileResult {
  user: User | null;
  usage: ScanUsage | null;
  isLoading: boolean;
  /** User-safe message when an authenticated read fails or the profile is missing. */
  error: string | null;
  setHouseholdSharing: (enabled: boolean) => Promise<void>;
}

const MISSING_PROFILE_MESSAGE =
  'Your profile is not set up yet. Please try again.';

/**
 * Aggregates the current user's profile and scan usage (data-access spec).
 * Reads are authenticated-only: the hook queries Supabase for the signed-in
 * user, surfacing a user-safe error when the row is missing or the read
 * fails. There is no fabricated fallback.
 */
export function useProfile(): UseProfileResult {
  const { userId } = useAuthMode();
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<ScanUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setUser(null);
    setUsage(null);
    setError(null);
    setIsLoading(true);

    if (!userId) {
      setError('Sign in to load your profile.');
      setIsLoading(false);
      return;
    }

    const yearMonth = new Date().toISOString().slice(0, 7);
    Promise.all([fetchProfile(userId), fetchScanUsage(userId, yearMonth)]).then(
      ([profile, scanUsage]) => {
        if (cancelled) return;
        if (profile.status === 'ok') {
          setUser(profile.data);
        } else if (profile.status === 'missing-profile') {
          setError(MISSING_PROFILE_MESSAGE);
        } else if (profile.status === 'error') {
          setError(profile.message);
        } else if (profile.status === 'unconfigured') {
          setError(READ_ERROR_MESSAGE);
        }
        if (scanUsage.status === 'ok') setUsage(scanUsage.data);
        setIsLoading(false);
      },
      () => {
        // Rejected fetch (network/backend failure before a response): surface
        // the generic copy and settle the loading state — never leave the UI
        // spinning on a swallowed rejection.
        if (cancelled) return;
        setError(READ_ERROR_MESSAGE);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return {
    user,
    usage,
    isLoading,
    error,
    setHouseholdSharing: async (enabled: boolean) => {
      if (userId) {
        await setHouseholdSharing(userId, enabled);
      }
    },
  };
}
