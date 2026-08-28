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
 * Trial state (migration 0016 — subscription-trial):
 *   `subscriptionStatus`, `trialEndsAt`, `isTrialing`, `isFrozen` extend
 *   the store so the gate and entitlement hook can resolve the `'frozen'`
 *   state for expired trials.
 */
import { create } from 'zustand';

import type { SubscriptionStatus } from '@/types';
import { getCustomerInfo, type CustomerInfoSnapshot } from '@/lib/revenuecat';

export interface ProState {
  /** True when the signed-in user holds the `pro` entitlement. */
  isPro: boolean;
  /**
   * True while the bootstrap is fetching `CustomerInfo`. Starts as `true`
   * so a fresh mount of the gate defaults to `locked` — REQ-GATE-5.
   */
  isLoading: boolean;

  // --- Trial state (migration 0016) ---

  /** Business lifecycle of the subscription. */
  subscriptionStatus: SubscriptionStatus;
  /** Trial expiry timestamp (ISO), null when no trial is active. */
  trialEndsAt: string | null;
  /** Derived: true when `subscriptionStatus === 'trial'` AND trial has not expired. */
  isTrialing: boolean;
  /**
   * Derived: true when writes are blocked. Only true for an expired/
   * overdue trial that still carries a `trial_ends_at` timestamp (the
   * cron hasn't normalized yet). Once the cron clears `trial_ends_at`
   * the profile is a legitimate FREE plan (quota reset) and NOT frozen.
   */
  isFrozen: boolean;

  // --- Actions ---

  /** Re-reads `CustomerInfo` from the SDK and updates `isPro`. */
  refresh: () => Promise<void>;
  /** Direct setter for the SDK's `customerInfoUpdate` listener (M5+). */
  setPro: (isPro: boolean) => void;
  /**
   * Set subscription lifecycle state from the DB profile. Called by
   * `pro-bootstrap` on launch/foreground and by `startFreeTrial` on success.
   */
  setSubscriptionState: (status: SubscriptionStatus, trialEndsAt: string | null) => void;
}

/** Compute derived trial booleans from raw status + timestamp. */
function deriveTrialState(
  status: SubscriptionStatus,
  trialEndsAt: string | null,
): { isTrialing: boolean; isFrozen: boolean } {
  const now = Date.now();
  const trialEndsTs = trialEndsAt ? new Date(trialEndsAt).getTime() : 0;
  // A trial whose timestamp is in the past is expired even if the DB still
  // says 'trial' (the cron that persists 'expired' may not have run yet).
  // This is the client-side safety net so an overdue trial drops to
  // 'frozen' (→ paywall) immediately.
  const isExpired = status === 'trial' && trialEndsAt !== null && trialEndsTs <= now;
  const isTrialing = status === 'trial' && !isExpired;
  // 'expired' means frozen ONLY while a trial_ends_at timestamp is still
  // set — i.e. the cron `expire_overdue_trials` hasn't normalized the
  // profile yet (blocked, upgrade CTA). Once the cron runs it clears
  // trial_ends_at to null and the profile becomes a legitimate FREE plan
  // (tier=free, monthly scan quota reset), so the user must NOT be frozen
  // and must be able to scan up to the free monthly limit again.
  const isFrozen =
    (status === 'expired' && trialEndsAt !== null) || isExpired;
  return { isTrialing, isFrozen };
}

export const useProStore = create<ProState>((set) => ({
  isPro: false,
  // REQ-GATE-5: gate stays locked until the SDK configuration resolves.
  // Bootstrap clears this when `CustomerInfo` arrives (or when the SDK
  // is unavailable and we settle on the safe default).
  isLoading: true,

  subscriptionStatus: 'none',
  trialEndsAt: null,
  isTrialing: false,
  isFrozen: false,

  refresh: async () => {
    const info: CustomerInfoSnapshot | null = await getCustomerInfo();
    set({ isPro: info?.isPro ?? false, isLoading: false });
  },

  setPro: (isPro) => set({ isPro }),

  setSubscriptionState: (status, trialEndsAt) => {
    const { isTrialing, isFrozen } = deriveTrialState(status, trialEndsAt);
    // isTrialing is false only when the trial is genuinely expired, so a
    // non-expired trial OR an active subscription grants Pro access.
    const isPro = status === 'active' || isTrialing;
    set({
      subscriptionStatus: status,
      trialEndsAt,
      isTrialing,
      isFrozen,
      isPro,
    });
  },
}));
