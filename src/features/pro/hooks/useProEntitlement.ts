/**
 * `useProEntitlement` — the single hook screens consume for Pro
 * gating (pro-subscription spec — REQ-PRO-1, REQ-GATE-5).
 *
 * The hook reads `isPro`, `isLoading`, and the monotonic `everPaid`
 * flag from `useProStore` via selector subscriptions so the component
 * only re-renders when those values actually change (zustand's
 * shallow-equality default on selector results is sufficient for
 * primitives).
 *
 * `refresh()` is exposed for the paywall to re-check `CustomerInfo`
 * after a purchase or restore — the SDK updates its internal cache and
 * the next `refresh()` reflects the new entitlement state.
 *
 * Post-cutover (0039, revenuecat-trial-migration slice B): the trial
 * fields (`subscriptionStatus`, `trialEndsAt`, `isTrialing`, `isFrozen`,
 * `daysRemaining`) are GONE. The trial surface moved into
 * `getOfferings().introPhase` (intro caption projection) — screens
 * that need trial-window info read the offering snapshot directly.
 */
import { useProStore } from '@/stores/use-pro-store';

export interface ProEntitlement {
  isPro: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;

  /**
   * True once the user has EVER made a real paid purchase (monotonic,
   * migration 0021). Survives sign-out → sign-in cycles within the same
   * process; reset only on explicit `reset()` call.
   */
  everPaid: boolean;
}

export function useProEntitlement(): ProEntitlement {
  const isPro = useProStore((s) => s.isPro);
  const isLoading = useProStore((s) => s.isLoading);
  const refresh = useProStore((s) => s.refresh);
  const everPaid = useProStore((s) => s.everPaid);
  return {
    isPro,
    isLoading,
    refresh,
    everPaid,
  };
}
