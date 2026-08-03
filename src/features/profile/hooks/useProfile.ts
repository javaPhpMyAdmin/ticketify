import { useEffect, useState } from 'react';

import { fetchProfile, fetchScanUsage, setHouseholdSharing } from '../api';
import type { ScanUsage, User } from '@/types';

export interface UseProfileResult {
  user: User | null;
  usage: ScanUsage | null;
  isLoading: boolean;
  setHouseholdSharing: (enabled: boolean) => Promise<void>;
}

/**
 * Aggregates the current user's profile, scan usage, and a setter
 * for the household-sharing toggle. Data flows from the stub fetchers
 * (which return the demo fixtures) until a real query layer lands.
 */
export function useProfile(_userId: string | null = null): UseProfileResult {
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<ScanUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const userId = _userId ?? 'demo';
    const yearMonth = new Date().toISOString().slice(0, 7);
    Promise.all([fetchProfile(userId), fetchScanUsage(userId, yearMonth)]).then(
      ([nextUser, nextUsage]) => {
        if (cancelled) return;
        setUser(nextUser);
        setUsage(nextUsage);
        setIsLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [_userId]);

  return {
    user,
    usage,
    isLoading,
    setHouseholdSharing: async (enabled: boolean) => {
      if (_userId) {
        await setHouseholdSharing(_userId, enabled);
      }
    },
  };
}
