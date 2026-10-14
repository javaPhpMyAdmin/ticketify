import { create } from 'zustand';

import { SUPPORTED_CURRENCIES } from '@/lib/format';
import {
  loadRecentCurrencies,
  saveRecentCurrencies,
} from '@/stores/recent-currencies-storage';
import { useHouseholdStore } from '@/stores/use-household-store';

/**
 * How many recently-chosen currencies the picker surfaces. A small cap keeps
 * the review-screen chip row short; the full catalog stays one tap away.
 */
const RECENT_CURRENCIES_CAP = 5;

/** Same-order, same-length content comparison for the recent-code list. */
function sameRecentCurrencies(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

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
 * the currency formatters withhold the whole UNIT CONVENTION until it flips —
 * the symbol AND the separators. Rendering the seed's convention before the
 * row lands would show a real balance in the wrong unit, which is worse than
 * showing the bare number: because grouping is keyed by currency code, a
 * `'USD'` seed renders a UYU balance as `1,234.56`, which that user reads as
 * `1234,56`-worth of pesos being off by 1000x (see `currencySymbolGateOpen`
 * in `src/lib/format.ts`, the module that actually enforces this).
 *
 * The seed is `USD`, the single universal default (currency-universality
 * REQ-4). It is a pre-hydration placeholder only: on first launch the row is
 * created carrying the DEVICE's region-derived code, and after hydration the
 * row's own value wins. It is deliberately NOT derived from the device region
 * at module init — that would flash the region currency at users who chose a
 * different one, the same class of bug this gate exists to prevent.
 *
 * The two mutators are deliberately narrow and asymmetric on purpose:
 * `markCurrencyHydrated()` only ever sets the flag (it can never un-hydrate),
 * so a late-arriving good payload cannot re-close a gate a later error opened;
 * `resetHydration()` is the single teardown path shared by sign-out and
 * account deletion, so neither can forget to shut it.
 *
 * Recent currencies (D8): a device-local convenience, NOT profile state — the
 * most-recent-first codes the user has chosen in a picker, capped at
 * `RECENT_CURRENCIES_CAP`. The STORE is the in-memory authority; the mirror
 * lives in `recent-currencies-storage.ts` behind a best-effort AsyncStorage
 * write that can never block a selection. `hydrate()` is the merge seam: it
 * applies the caller's patch synchronously (unchanged) and then loads the
 * stored list in the background, filtered to codes the catalog still ships.
 */
interface SettingsState {
  monthly_budget: number;
  currency: string; // ISO 4217
  household_sharing: boolean;
  /** True once `profiles.currency` has been read for the current session. */
  currencyHydrated: boolean;
  /** Most-recent-first chosen codes, capped at `RECENT_CURRENCIES_CAP`. */
  recentCurrencies: string[];
  setBudget: (value: number) => void;
  setCurrency: (currency: string) => void;
  setHouseholdSharing: (enabled: boolean) => void;
  /** Marks the profile currency as authoritative. Never re-closes the gate. */
  markCurrencyHydrated: () => void;
  /** Promote `code` to the front of `recentCurrencies` and mirror it. */
  pushRecentCurrency: (code: string) => void;
  /** Session teardown: re-closes the gate so the next user starts fail-closed. */
  resetHydration: () => void;
  hydrate: (next: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  monthly_budget: 1200,
  currency: 'USD',
  household_sharing: false,
  currencyHydrated: false,
  recentCurrencies: [],
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
  pushRecentCurrency: (code) => {
    // Case-fold first so `'usd'` and `'USD'` can never both appear; drop any
    // existing entry, then cap at the front-of-list (LRU) limit.
    const upper = code.toUpperCase();
    const next = [
      upper,
      ...get().recentCurrencies.filter((existing) => existing !== upper),
    ].slice(0, RECENT_CURRENCIES_CAP);
    set({ recentCurrencies: next });
    // Fire-and-forget mirror: the store already holds the truth and a storage
    // failure must NEVER block the selection that produced it.
    void saveRecentCurrencies(next);
  },
  resetHydration: () =>
    set((prev) => (prev.currencyHydrated ? { currencyHydrated: false } : prev)),
  hydrate: (next) => {
    set((prev) => ({ ...prev, ...next }));
    // Recents are device-local, so they hydrate from their own mirror rather
    // than the profile patch. Filter to codes the catalog still ships (a
    // future shrink must not resurrect a retired code) and re-cap. The
    // skip-equal guard keeps a repeat hydrate from notifying subscribers with
    // an identical list.
    void loadRecentCurrencies()
      .then((stored) => {
        const catalog = new Set<string>(SUPPORTED_CURRENCIES);
        const recent = stored
          .filter((code) => catalog.has(code))
          .slice(0, RECENT_CURRENCIES_CAP);
        if (!sameRecentCurrencies(get().recentCurrencies, recent)) {
          set({ recentCurrencies: recent });
        }
      })
      .catch(() => {
        // `loadRecentCurrencies` never rejects; this guards a future change to
        // that contract without ever surfacing an unhandled rejection.
      });
  },
}));
