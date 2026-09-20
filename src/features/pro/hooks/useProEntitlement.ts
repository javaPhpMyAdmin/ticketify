/**
 * `useProEntitlement` — the single hook screens consume for Pro
 * gating (pro-subscription spec — REQ-PRO-1, REQ-GATE-5) and the
 * profile trial pill (REQ-PRO-TRIAL-PILL).
 *
 * The hook reads `isPro`, `isLoading`, `trialEndsAt`, and the monotonic
 * `everPaid` flag from `useProStore` via selector subscriptions so the
 * component only re-renders when those values actually change (zustand's
 * shallow-equality default on selector results is sufficient for
 * primitives).
 *
 * `refresh()` is exposed for the paywall to re-check `CustomerInfo`
 * after a purchase or restore — the SDK updates its internal cache and
 * the next `refresh()` reflects the new entitlement state.
 *
 * Post-cutover (0039, revenuecat-trial-migration slice B): the trial
 * fields (`subscriptionStatus`, `isTrialing`, `isFrozen`,
 * `daysRemaining`) are GONE.
 *
 * Post-cutover (slice C): `trialEndsAt` is RE-INTRODUCED, sourced from
 * CustomerInfo (NOT the DB — the DB column was dropped). The profile
 * pill consumer reads it; null when not on a free trial.
 */
import { useProStore } from '@/stores/use-pro-store';

export interface ProEntitlement {
  isPro: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;

  /**
   * Trial-end ISO timestamp (CustomerInfo-derived). The profile
   * trial pill renders `t('trialPill', { date })` when this is a
   * non-null string (i.e. user is on an active FREE TRIAL). null for
   * paid subscribers, free users, intro-phase subscribers, or
   * expired trials — the pill is hidden.
   */
  trialEndsAt: string | null;

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
  const trialEndsAt = useProStore((s) => s.trialEndsAt);
  const everPaid = useProStore((s) => s.everPaid);
  return {
    isPro,
    isLoading,
    refresh,
    trialEndsAt,
    everPaid,
  };
}
