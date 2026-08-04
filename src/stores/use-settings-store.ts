import { create } from 'zustand';

import type { ScanTier } from '@/types';

/**
 * App-level user preferences (non-auth settings). Session presence in
 * `useSessionStore` is the single source of truth for the root gate — the
 * data-source mode concept was removed by scope amendment 2026-08-03, so no
 * mode lives here.
 */
interface SettingsState {
  monthly_budget: number;
  currency: string; // ISO 4217
  tier: ScanTier;
  household_sharing: boolean;
  setBudget: (value: number) => void;
  setCurrency: (currency: string) => void;
  setTier: (tier: ScanTier) => void;
  setHouseholdSharing: (enabled: boolean) => void;
  hydrate: (next: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  monthly_budget: 1200,
  currency: 'USD',
  tier: 'free',
  household_sharing: false,
  setBudget: (monthly_budget) => set({ monthly_budget }),
  setCurrency: (currency) => set({ currency }),
  setTier: (tier) => set({ tier }),
  setHouseholdSharing: (household_sharing) => set({ household_sharing }),
  hydrate: (next) => set((prev) => ({ ...prev, ...next })),
}));
