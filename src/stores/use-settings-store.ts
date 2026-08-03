import { create } from 'zustand';

import type { ScanTier } from '@/types';
import { settingsDefaults } from '@/lib/fixtures/demo';

/**
 * The app's single source of truth for the data source (ADR-4):
 * - `'demo'` — feature hooks return fixtures, zero network calls.
 * - `'authenticated'` — feature hooks query Supabase for the signed-in user.
 *
 * The mode is promoted to `'authenticated'` by the session store whenever a
 * valid session exists (restore, sign-in, OAuth, password recovery). It is
 * never demoted by the gate, so a sign-out leaves the mode `'authenticated'`
 * with no session — the root gate then shows the sign-in screen instead of
 * leaking demo data into an authenticated context.
 */
export type AuthMode = 'demo' | 'authenticated';

interface SettingsState {
  monthly_budget: number;
  currency: string; // ISO 4217
  tier: ScanTier;
  household_sharing: boolean;
  mode: AuthMode;
  setBudget: (value: number) => void;
  setCurrency: (currency: string) => void;
  setTier: (tier: ScanTier) => void;
  setHouseholdSharing: (enabled: boolean) => void;
  setMode: (mode: AuthMode) => void;
  hydrate: (next: Partial<SettingsState>) => void;
}

const defaults: Pick<
  SettingsState,
  'monthly_budget' | 'currency' | 'tier' | 'household_sharing'
> = settingsDefaults;

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaults,
  mode: 'demo',
  setBudget: (monthly_budget) => set({ monthly_budget }),
  setCurrency: (currency) => set({ currency }),
  setTier: (tier) => set({ tier }),
  setHouseholdSharing: (household_sharing) => set({ household_sharing }),
  setMode: (mode) => set({ mode }),
  hydrate: (next) => set((prev) => ({ ...prev, ...next })),
}));
