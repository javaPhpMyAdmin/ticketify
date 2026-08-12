/**
 * `useProEntitlement` — the single hook screens consume for Pro
 * gating (pro-subscription spec — REQ-PRO-1, REQ-GATE-5).
 *
 * The hook reads `isPro` and `isLoading` from `useProStore` via
 * selector subscriptions so the component only re-renders when those
 * two values actually change (zustand's shallow-equality default on
 * selector results is sufficient for primitives).
 *
 * `refresh()` is exposed for the paywall to re-check `CustomerInfo`
 * after a purchase or restore — the SDK updates its internal cache and
 * the next `refresh()` reflects the new entitlement state.
 */
import { useProStore } from '@/stores/use-pro-store';

export interface ProEntitlement {
  isPro: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useProEntitlement(): ProEntitlement {
  const isPro = useProStore((s) => s.isPro);
  const isLoading = useProStore((s) => s.isLoading);
  const refresh = useProStore((s) => s.refresh);
  return { isPro, isLoading, refresh };
}
