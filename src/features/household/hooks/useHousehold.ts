/**
 * Household data hook — fetches household info, members, and the
 * current user's role via TanStack Query when household sharing is
 * enabled. Hydrates `useHouseholdStore` on every successful read so
 * downstream screens and modals can read from the store without
 * additional queries.
 *
 * The query is disabled until both a signed-in user exists AND the
 * household_sharing toggle is on — no request fires in the free tier
 * or before the session stabilises.
 *
 * Refetch-on-focus: when the app returns to the foreground (AppState
 * 'active'), all household queries are refetched so the user sees
 * fresh data if another household member added receipts.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSessionUser } from '@/features/auth';
import { queryKeys } from '@/lib/query-keys';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import type { Household, HouseholdMember, HouseholdRole } from '@/types';
import {
  readHouseholdInfo,
  readHouseholdMembers,
  readHouseholdRole,
} from '@/lib/supabase/feature-access';

export interface HouseholdData {
  household: Household | null;
  members: HouseholdMember[];
  role: HouseholdRole | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches the current user's household info, members, and role.
 * Hydrates the household store on every successful read.
 * Refetches all household queries when the app returns to foreground.
 */
export function useHousehold(): HouseholdData {
  const { userId } = useSessionUser();
  const sharingEnabled = useSettingsStore((s) => s.household_sharing);
  const queryClient = useQueryClient();
  const appState = useRef(AppState.currentState);

  // ── Refetch on foreground ────────────────────────────────────────────
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          // App came to foreground — invalidate household queries so
          // the user sees fresh data (e.g. another member added a receipt).
          if (userId && sharingEnabled) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.household(userId),
            });
          }
        }
        appState.current = nextState;
      },
    );
    return () => subscription.remove();
  }, [userId, sharingEnabled, queryClient]);

  // ── Household info ────────────────────────────────────────────────────
  const householdQuery = useQuery<Household | null>({
    queryKey: queryKeys.household(userId!),
    enabled: !!userId && sharingEnabled,
    queryFn: async () => {
      const result = await readHouseholdInfo(userId!);
      return toQueryData(result);
    },
  });

  const household = householdQuery.data ?? null;
  const householdId = household?.id ?? null;

  // ── Members (only when a household exists) ─────────────────────────────
  const membersQuery = useQuery<HouseholdMember[]>({
    queryKey: queryKeys.householdMembers(householdId!),
    enabled: !!householdId,
    queryFn: async () => {
      const result = await readHouseholdMembers(householdId!);
      return toQueryData(result);
    },
  });

  // ── Role (only when a household exists) ────────────────────────────────
  const roleQuery = useQuery<string | null>({
    queryKey: [...queryKeys.household(userId!), 'role'],
    enabled: !!householdId,
    queryFn: async () => {
      const result = await readHouseholdRole(householdId!);
      return toQueryData(result);
    },
  });

  // ── Hydrate store ─────────────────────────────────────────────────────
  const members = membersQuery.data ?? [];
  const role = (roleQuery.data as HouseholdRole | null) ?? null;

  useEffect(() => {
    if (!householdQuery.isLoading) {
      useHouseholdStore.getState().setHousehold(household, role);
      useHouseholdStore.getState().setMembers(members);
      useHouseholdStore.getState().setLoading(false);
    }
  }, [household, role, members, householdQuery.isLoading]);

  return {
    household,
    members,
    role,
    isLoading: householdQuery.isLoading || membersQuery.isLoading || roleQuery.isLoading,
    error: householdQuery.error
      ? toQueryErrorMessage(householdQuery.error)
      : membersQuery.error
        ? toQueryErrorMessage(membersQuery.error)
        : roleQuery.error
          ? toQueryErrorMessage(roleQuery.error)
          : null,
  };
}
