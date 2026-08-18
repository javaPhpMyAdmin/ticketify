/**
 * Household sharing store — client-side cache for the user's household state.
 *
 * The store holds the household row, the current user's membership (role),
 * the list of household members, and an active invite code when the owner
 * opens the invite screen. Downstream hooks (`useHousehold`) hydrate the
 * store after a successful Supabase read; `reset()` clears everything when
 * the user leaves or disbands the household, or disables sharing.
 *
 * Lifetime: session-scoped. Not persisted to AsyncStorage — a fresh read on
 * every auth session start keeps the client in sync with the DB.
 */
import { create } from 'zustand';

import type { Household, HouseholdMember, InviteCode, HouseholdRole } from '@/types';

interface HouseholdState {
  /** The household row, or null when the user belongs to no household. */
  household: Household | null;
  /** The current user's role within the household (null when no household). */
  role: HouseholdRole | null;
  /** Denormalized member list for the household screen. */
  members: HouseholdMember[];
  /** Active invite code (owner only, set when invite screen opens). */
  inviteCode: InviteCode | null;
  /** True while the household info is being fetched. */
  isLoading: boolean;

  setHousehold: (household: Household | null, role?: HouseholdRole | null) => void;
  setMembers: (members: HouseholdMember[]) => void;
  setInviteCode: (code: InviteCode | null) => void;
  setLoading: (loading: boolean) => void;
  /** Clear all household state (leaving, disbanding, or disabling). */
  reset: () => void;
}

const INITIAL_STATE: Pick<HouseholdState, 'household' | 'role' | 'members' | 'inviteCode' | 'isLoading'> = {
  household: null,
  role: null,
  members: [],
  inviteCode: null,
  isLoading: false,
};

export const useHouseholdStore = create<HouseholdState>((set) => ({
  ...INITIAL_STATE,

  setHousehold: (household, role = null) => set({ household, role }),
  setMembers: (members) => set({ members }),
  setInviteCode: (code) => set({ inviteCode: code }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set(INITIAL_STATE),
}));
