/**
 * `useFrozenGuard` — STUB (post-cutover migration 0039,
 * revenuecat-trial-migration slice B).
 *
 * The pre-cutover implementation intercepted individual write actions
 * with a `guard()` wrapper that surfaced an upgrade dialog when the
 * user's trial was expired (the `'frozen'` state — trial window past
 * but DB still carried `trial_ends_at` so the cron hadn't normalized
 * yet). The frozen window existed ONLY to block writes between DB
 * trial expiry and a paid subscription.
 *
 * Post-cutover there is no DB trial surface. Trial eligibility is owned
 * by Play Console / App Store Connect native intro offers; expiry is
 * reconciled by the RevenueCat webhook's `EXPIRATION` event. The
 * `isFrozen` gate state is gone (gate is binary: `locked | unlocked`).
 *
 * This stub keeps the same exported shape (`{ isFrozen, guard }`) so
 * existing call sites in `(tabs)/index.tsx` and the settings screens
 * continue to compile. `guard` is now a pass-through that always
 * invokes the action immediately, and `isFrozen` is always `false`.
 * Slice C will remove the call sites entirely.
 */
export interface FrozenGuardResult {
  /** Always `false` post-cutover (frozen state no longer exists). */
  isFrozen: boolean;
  /**
   * Pass-through: invokes the action immediately. No upgrade dialog
   * can fire because there is no frozen state to surface.
   */
  guard: <T>(action: () => T | Promise<T>) => T | Promise<T>;
}

export function useFrozenGuard(): FrozenGuardResult {
  return {
    isFrozen: false,
    guard: <T,>(action: () => T | Promise<T>) => action(),
  };
}
