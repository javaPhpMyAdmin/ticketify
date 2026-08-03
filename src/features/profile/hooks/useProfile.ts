import { useEffect, useState } from 'react';

import { fetchProfile, fetchScanUsage, setHouseholdSharing } from '../api';
import { useAuthMode } from '@/features/auth';
import { demoScanUsage, demoUser } from '@/lib/fixtures/demo';
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
 * Aggregates the current user's profile and scan usage (data-access spec,
 * ADR-4). The data source is selected by the LIVE mode BEFORE any network
 * call: demo mode returns the fixtures synchronously (zero network);
 * authenticated mode reads Supabase for the signed-in user, surfacing a
 * user-safe error when the row is missing or the read fails.
 */
export function useProfile(): UseProfileResult {
  const { mode, userId } = useAuthMode();
  const [user, setUser] = useState<User | null>(() =>
    mode === 'demo' ? demoUser : null,
  );
  const [usage, setUsage] = useState<ScanUsage | null>(() =>
    mode === 'demo' ? demoScanUsage : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(mode !== 'demo');

  useEffect(() => {
    let cancelled = false;

    if (mode === 'demo') {
      setUser(demoUser);
      setUsage(demoScanUsage);
      setError(null);
      setIsLoading(false);
      return;
    }

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
        // 'demo' is unreachable: the hook already branched on the live mode.
        if (scanUsage.status === 'ok') setUsage(scanUsage.data);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [mode, userId]);

  return {
    user,
    usage,
    isLoading,
    error,
    setHouseholdSharing: async (enabled: boolean) => {
      if (mode === 'authenticated' && userId) {
        await setHouseholdSharing(userId, enabled);
      }
    },
  };
}
