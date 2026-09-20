/**
 * Pro entitlement store (pro-subscription spec — REQ-PRO-1, REQ-GATE-5).
 *
 * The single source of truth for the client's "is Pro" state. The
 * bootstrap (`src/features/pro/pro-bootstrap.tsx`) calls `revenuecat.configure`
 * and pipes the resulting `CustomerInfo` through `setPro`. The
 * `useProEntitlement` hook (`src/features/pro/hooks/useProEntitlement.ts`)
 * is the only consumer that should matter to screens: every gate reads
 * `isPro` and `isLoading` through it.
 *
 * Initial state is `{ isPro: false, isLoading: true }`. The gate
 * (`src/features/pro/gate.ts`) treats `isLoading === true` as
 * `'locked'`, so pro content never flashes unlocked while the SDK
 * configuration is still in flight — REQ-GATE-5.
 *
 * Post-cutover (0039, revenuecat-trial-migration slice B): the trial
 * lifecycle fields (`subscriptionStatus`, `trialEndsAt`, `isFrozen`,
 * `isTrialing`, `daysRemaining`) are GONE. Trial eligibility is owned
 * by Play Console / App Store Connect native intro offers (the
 * paywall reads them from `getOfferings().introPhase`). The store now
 * holds just the binary pro/not-pro signal + the monotonic `everPaid`
 * flag.
 */
import { create } from 'zustand';

import { getCustomerInfo, type CustomerInfoSnapshot } from '@/lib/revenuecat';

export interface ProState {
  /** True when the signed-in user holds the `pro` entitlement. */
  isPro: boolean;
  /**
   * True while the bootstrap is fetching `CustomerInfo`. Starts as `true`
   * so a fresh mount of the gate defaults to `locked` — REQ-GATE-5.
   */
  isLoading: boolean;

  /**
   * Monotonic flag: true once the user has EVER made a real paid purchase
   * (migration 0021). A former paid user can never start a free trial
   * again (pre-cutover the trial surface used this; post-cutover the
   * paywall hides the trial CTA from ever-paid users via the intro-phase
   * projection in `getOfferings`).
   */
  everPaid: boolean;

  // --- Actions ---

  /** Re-reads `CustomerInfo` from the SDK and updates `isPro`. */
  refresh: () => Promise<void>;
  /** Direct setter for the SDK's `customerInfoUpdate` listener (M5+). */
  setPro: (isPro: boolean) => void;
  /** Direct setter for the monotonic ever-paid flag. */
  setEverPaid: (everPaid: boolean) => void;
  /**
   * Restore the full initial state (locked defaults). Called on SIGNED_OUT
   * and at the start of every per-user resolution so a previous user's
   * `isPro` / `everPaid` can never leak into the next session on the same
   * device.
   */
  reset: () => void;
}

export const useProStore = create<ProState>((set) => ({
  isPro: false,
  // REQ-GATE-5: gate stays locked until the SDK configuration resolves.
  // Bootstrap clears this when `CustomerInfo` arrives (or when the SDK
  // is unavailable and we settle on the safe default).
  isLoading: true,

  everPaid: false,

  refresh: async () => {
    const info: CustomerInfoSnapshot | null = await getCustomerInfo();
    set({ isPro: info?.isPro ?? false, isLoading: false });
  },

  setPro: (isPro) => set({ isPro }),

  setEverPaid: (everPaid) => set({ everPaid }),

  reset: () =>
    set({
      isPro: false,
      isLoading: true,
      everPaid: false,
    }),
}));
