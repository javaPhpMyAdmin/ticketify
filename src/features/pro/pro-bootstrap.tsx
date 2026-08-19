/**
 * Pro bootstrap (pro-subscription spec — REQ-PRO-1,
 * subscription-trial — DB subscription state).
 *
 * Configures the RevenueCat SDK exactly once per process and pipes the
 * resulting `CustomerInfo` into `useProStore`. Mounted inside
 * `QueryClientProvider` in `_layout.tsx`; renders `null` so it never
 * affects the visual tree.
 *
 * Safe-by-default (REQ-GATE-5):
 *
 *   - Missing API key → `configure` returns false, the store stays at
 *     `{ isPro: false, isLoading: true }`. The gate is locked.
 *   - Native module unavailable (Expo Go / dev client not rebuilt) →
 *     `configure` returns false. Same outcome.
 *   - `getCustomerInfo` rejects → store lands at `{ isPro: false,
 *     isLoading: false }`. The gate is locked (free default), and the
 *     paywall surfaces a user-safe error when the SDK is reachable but
 *     cannot read the entitlement.
 *
 * The `configured` flag is the module-level guard the design calls for:
 * `Purchases.configure` resets internal SDK state (cached customerInfo,
 * listener registrations), so re-calling it on every session flip would
 * break the customerInfoUpdate listener and the live entitlement state.
 *
 * Subscription state (migration 0016):
 *   On every bootstrap path that resolves to a userId, the profile is
 *   read from DB to populate `subscriptionStatus` and `trialEndsAt`.
 *   This ensures the gate can resolve `'frozen'` for expired trials.
 */
import { useEffect } from 'react';

import { useSessionUser } from '@/features/auth';
import {
  configure as configureRevenueCat,
  getCustomerInfo,
  isNativeAvailable,
} from '@/lib/revenuecat';
import { readProfileRow } from '@/lib/supabase/feature-access';
import { useProStore } from '@/stores/use-pro-store';

import { isProOverrideEnabled } from './gate';

const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

/**
 * Tracks whether `configure` has already run this process. Mirrors the
 * guard inside the wrapper (`src/lib/revenuecat.ts`) but is checked
 * here too so a re-render of the bootstrap (e.g. after a session flip)
 * never re-configures the SDK.
 */
let bootstrapped = false;

/**
 * Read the user's subscription state from the DB profile and push it
 * into the store. Called on every bootstrap path that has a userId.
 * Never throws — a failed read leaves the store defaults (none/locked).
 */
async function syncSubscriptionFromDB(userId: string): Promise<void> {
  const result = await readProfileRow(userId);
  if (result.status === 'ok' && result.data) {
    const { subscription_status, trial_ends_at } = result.data;
    useProStore.getState().setSubscriptionState(
      subscription_status ?? 'none',
      trial_ends_at ?? null,
    );
  }
}

/**
 * Bootstraps RevenueCat on mount. Returns null — the bootstrap is a
 * pure side-effect carrier.
 */
export function ProBootstrap(): null {
  const { userId } = useSessionUser();
  const setPro = useProStore((s) => s.setPro);

  useEffect(() => {
    if (bootstrapped) return;
    if (isProOverrideEnabled()) {
      // DEV-ONLY: see the safety note in `gate.ts`. This branch is the
      // single point where the override flips the store to Pro BEFORE
      // any RevenueCat call (configure / getCustomerInfo / listener
      // registration) so the gate opens without the native module. The
      // run order matters: do not move this branch below the real
      // SDK bootstrap, or the SDK will overwrite our override on its
      // first customerInfo snapshot.
      if (userId) {
        useProStore.setState({ isPro: true, isLoading: false });
        // Still sync subscription state from DB for frozen-state resolution.
        void syncSubscriptionFromDB(userId);
      } else {
        // No session yet: leave the store in its default `{ isLoading: true,
        // isPro: false }` so the gate stays locked until the session
        // resolves and this effect re-runs.
        return;
      }
      bootstrapped = true;
      return;
    }
    if (!userId) {
      // No session yet: do not configure — there is nothing to look up.
      // The store stays at `{ isLoading: true }` so the gate remains
      // locked until the session resolves and this effect re-runs.
      return;
    }
    if (!isNativeAvailable()) {
      // Native module missing: settle the gate so Pro screens do not
      // stay in the loading state forever. The gate resolves to
      // `'locked'` (`isPro: false`), which is the safe default.
      // Still sync subscription state for frozen-state detection.
      useProStore.setState({ isLoading: false, isPro: false });
      void syncSubscriptionFromDB(userId);
      return;
    }
    if (!REVENUECAT_API_KEY) {
      // SDK is reachable but the project is missing its API key: log
      // a warning so the misconfiguration is observable, then settle
      // the gate on the safe default.
      console.warn(
        '[pro-bootstrap] EXPO_PUBLIC_REVENUECAT_API_KEY is empty; the paywall will report a configuration error.',
      );
      useProStore.setState({ isLoading: false, isPro: false });
      void syncSubscriptionFromDB(userId);
      return;
    }
    const ok = configureRevenueCat(REVENUECAT_API_KEY);
    if (!ok) {
      useProStore.setState({ isLoading: false, isPro: false });
      void syncSubscriptionFromDB(userId);
      return;
    }
    bootstrapped = true;

    // Pipe the first customerInfo snapshot into the store. The gate
    // settles on the entitlement state. A failed fetch leaves
    // `isPro: false, isLoading: false` so the gate locks on the safe
    // default rather than staying in the loading state.
    void (async () => {
      const info = await getCustomerInfo();
      useProStore.setState({
        isPro: info?.isPro ?? false,
        isLoading: false,
      });

      // Sync subscription state from DB (frozen-state detection).
      void syncSubscriptionFromDB(userId);

      // The SDK's customerInfoUpdate listener will fire on every
      // subsequent entitlement change (renewal, refund, family-share
      // transfer). We register it AFTER the initial snapshot so the
      // listener path is the single source of truth for live updates.
      try {
        // Runtime require (mirrors the wrapper): the native module is
        // not linked in Expo Go, so a static import would crash there.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Purchases = require('react-native-purchases');
        if (Purchases?.addCustomerInfoUpdateListener) {
          Purchases.addCustomerInfoUpdateListener((ci: any) => {
            const isPro =
              ci?.entitlements?.all?.['pro']?.isActive === true;
            setPro(isPro);
          });
        }
      } catch (err) {
        console.warn(
          '[pro-bootstrap] customerInfoUpdate listener registration failed:',
          err,
        );
      }
    })();
  }, [userId, setPro]);

  return null;
}
