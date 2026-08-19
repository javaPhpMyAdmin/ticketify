/**
 * `useProEntitlement` — the single hook screens consume for Pro
 * gating (pro-subscription spec — REQ-PRO-1, REQ-GATE-5,
 * subscription-trial — frozen state).
 *
 * The hook reads `isPro`, `isLoading`, and the new trial state fields
 * from `useProStore` via selector subscriptions so the component only
 * re-renders when those values actually change (zustand's shallow-equality
 * default on selector results is sufficient for primitives).
 *
 * `refresh()` is exposed for the paywall to re-check `CustomerInfo`
 * after a purchase or restore — the SDK updates its internal cache and
 * the next `refresh()` reflects the new entitlement state.
 *
 * Trial state (migration 0016):
 *   `isTrialing`, `isFrozen`, `trialEndsAt`, `daysRemaining` expose the
 *   subscription lifecycle for frozen-state UI and trial countdown.
 */
import { useProStore } from '@/stores/use-pro-store';

import type { SubscriptionStatus } from '@/types';

export interface ProEntitlement {
  isPro: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;

  // --- Trial state (migration 0016) ---
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  /** True when subscription_status === 'trial' and trial has not expired. */
  isTrialing: boolean;
  /** True when subscription_status === 'expired' (trial expired, writes blocked). */
  isFrozen: boolean;
  /** Whole days remaining in the trial, or 0 if no active trial. */
  daysRemaining: number;
}

/** Compute whole days remaining from a trial_ends_at timestamp. */
function computeDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function useProEntitlement(): ProEntitlement {
  const isPro = useProStore((s) => s.isPro);
  const isLoading = useProStore((s) => s.isLoading);
  const refresh = useProStore((s) => s.refresh);
  const subscriptionStatus = useProStore((s) => s.subscriptionStatus);
  const trialEndsAt = useProStore((s) => s.trialEndsAt);
  const isTrialing = useProStore((s) => s.isTrialing);
  const isFrozen = useProStore((s) => s.isFrozen);
  const daysRemaining = computeDaysRemaining(trialEndsAt);
  return {
    isPro,
    isLoading,
    refresh,
    subscriptionStatus,
    trialEndsAt,
    isTrialing,
    isFrozen,
    daysRemaining,
  };
}
