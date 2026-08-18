import { create } from 'zustand';

import { useHouseholdStore } from '@/stores/use-household-store';

/**
 * App-level user preferences (non-auth settings). Session presence in
 * `useSessionStore` is the single source of truth for the root gate — the
 * data-source mode concept was removed by scope amendment 2026-08-03, so no
 * mode lives here.
 *
 * D3 (pro-subscription): the local `tier` / `setTier` fields were removed.
 * Tier is server-authoritative (`profiles.tier`, written by the
 * `revenuecat-webhook` edge function through the `set_profile_tier` RPC,
 * see migration 0011) and read by the client through `useProEntitlement`
 * (backed by RevenueCat `customerInfo` on the client). No local mirror,
 * no write path, no race.
 *
 * Household sharing toggle: when the user disables sharing, the household
 * store is immediately reset so stale household state doesn't persist.
 */
interface SettingsState {
  monthly_budget: number;
  currency: string; // ISO 4217
  household_sharing: boolean;
  setBudget: (value: number) => void;
  setCurrency: (currency: string) => void;
  setHouseholdSharing: (enabled: boolean) => void;
  hydrate: (next: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  monthly_budget: 1200,
  currency: 'UYU',
  household_sharing: false,
  setBudget: (monthly_budget) => set({ monthly_budget }),
  setCurrency: (currency) => set({ currency }),
  setHouseholdSharing: (household_sharing) => {
    set({ household_sharing });
    if (!household_sharing) {
      useHouseholdStore.getState().reset();
    }
  },
  hydrate: (next) => set((prev) => ({ ...prev, ...next })),
}));
