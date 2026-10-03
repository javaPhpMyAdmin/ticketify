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
 *
 * Currency hydration (fail-closed): `currency` starts as the SEED default
 * below, not as a known-truth value for the signed-in user — the profile row
 * is the authority. `currencyHydrated` records whether that row has actually
 * been read, and it starts `false`. Screens that render money therefore must
 * consult it (via `useCurrencyHydrated`) instead of trusting `currency`, and
 * the currency formatters withhold their symbol until it flips. Rendering the
 * seed's symbol before the row lands would show a real balance in the wrong
 * unit, which is worse than showing the bare number.
 *
 * The seed is `USD`, the single universal default (currency-universality
 * REQ-4). It is a pre-hydration placeholder only: on first launch the row is
 * created carrying the DEVICE's region-derived code, and after hydration the
 * row's own value wins.
 *
 * The two mutators are deliberately narrow and asymmetric on purpose:
 * `markCurrencyHydrated()` only ever sets the flag (it can never un-hydrate),
 * so a late-arriving good payload cannot re-close a gate a later error opened;
 * `resetHydration()` is the single teardown path shared by sign-out and
 * account deletion, so neither can forget to shut it.
 */
interface SettingsState {
  monthly_budget: number;
  currency: string; // ISO 4217
  household_sharing: boolean;
  /** True once `profiles.currency` has been read for the current session. */
  currencyHydrated: boolean;
  setBudget: (value: number) => void;
  setCurrency: (currency: string) => void;
  setHouseholdSharing: (enabled: boolean) => void;
  /** Marks the profile currency as authoritative. Never re-closes the gate. */
  markCurrencyHydrated: () => void;
  /** Session teardown: re-closes the gate so the next user starts fail-closed. */
  resetHydration: () => void;
  hydrate: (next: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  monthly_budget: 1200,
  currency: 'USD',
  household_sharing: false,
  currencyHydrated: false,
  setBudget: (monthly_budget) => set({ monthly_budget }),
  setCurrency: (currency) => set({ currency }),
  setHouseholdSharing: (household_sharing) => {
    set({ household_sharing });
    if (!household_sharing) {
      useHouseholdStore.getState().reset();
    }
  },
  markCurrencyHydrated: () =>
    // The `if` is not redundant: it keeps a good payload that arrives after a
    // bad one (or after an unrelated re-render) from notifying subscribers
    // with a no-op write, which every money screen would re-render for.
    set((prev) => (prev.currencyHydrated ? prev : { currencyHydrated: true })),
  resetHydration: () =>
    set((prev) => (prev.currencyHydrated ? { currencyHydrated: false } : prev)),
  hydrate: (next) => set((prev) => ({ ...prev, ...next })),
}));
