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
 * paywall reads them from `getOfferings().introPhase`).
 *
 * Post-cutover (slice C, REQ-PRO-TRIAL-PILL): the store re-introduces
 * a single `trialEndsAt` field, sourced from
 * `CustomerInfo.entitlements.all.pro.expirationDate` when the user is
 * on an active FREE TRIAL. This is NOT the pre-cutover DB-derived
 * field — it's CustomerInfo-derived (per the spec) and the profile
 * pill consumer reads it via the `useProEntitlement` hook.
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
   * Trial-end ISO timestamp (sourced from CustomerInfo, not the DB —
   * the DB column was dropped by migration 0039 §7). The profile
   * pill consumer reads this; null when not on a free trial.
   */
  trialEndsAt: string | null;

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
  /**
   * Direct setter for the SDK's `customerInfoUpdate` listener (slice C:
   * accepts the full snapshot — both `isPro` and `trialEndsAt` are
   * updated atomically so the gate + the pill never disagree).
   */
  setProEntitlement: (snapshot: { isPro: boolean; trialEndsAt: string | null }) => void;
  /** Direct setter for the monotonic ever-paid flag. */
  setEverPaid: (everPaid: boolean) => void;
  /**
   * Restore the full initial state (locked defaults). Called on SIGNED_OUT
   * and at the start of every per-user resolution so a previous user's
   * `isPro` / `trialEndsAt` / `everPaid` can never leak into the next
   * session on the same device.
   */
  reset: () => void;
}

export const useProStore = create<ProState>((set) => ({
  isPro: false,
  // REQ-GATE-5: gate stays locked until the SDK configuration resolves.
  // Bootstrap clears this when `CustomerInfo` arrives (or when the SDK
  // is unavailable and we settle on the safe default).
  isLoading: true,

  trialEndsAt: null,
  everPaid: false,

  refresh: async () => {
    const info: CustomerInfoSnapshot | null = await getCustomerInfo();
    set({
      isPro: info?.isPro ?? false,
      trialEndsAt: info?.trialEndsAt ?? null,
      isLoading: false,
    });
  },

  // Slice C: rename + reshape from `setPro(isPro)` to accept the full
  // snapshot. The bootstrap listener fires this on every SDK update
  // (purchase, renewal, refund, family-share transfer). The atomic
  // `set` keeps `isPro` and `trialEndsAt` consistent — a partial update
  // would let the gate say "unlocked" while the pill says "no trial".
  setProEntitlement: (snapshot) =>
    set({ isPro: snapshot.isPro, trialEndsAt: snapshot.trialEndsAt }),

  setEverPaid: (everPaid) => set({ everPaid }),

  reset: () =>
    set({
      isPro: false,
      isLoading: true,
      trialEndsAt: null,
      everPaid: false,
    }),
}));
