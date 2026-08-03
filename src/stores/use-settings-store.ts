import { create } from 'zustand';

import type { ScanTier } from '@/types';
import { settingsDefaults } from '@/lib/fixtures/demo';

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

const defaults: Pick<SettingsState, 'monthly_budget' | 'currency' | 'tier' | 'household_sharing'> =
  settingsDefaults;

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaults,
  setBudget: (monthly_budget) => set({ monthly_budget }),
  setCurrency: (currency) => set({ currency }),
  setTier: (tier) => set({ tier }),
  setHouseholdSharing: (household_sharing) => set({ household_sharing }),
  hydrate: (next) => set((prev) => ({ ...prev, ...next })),
}));
