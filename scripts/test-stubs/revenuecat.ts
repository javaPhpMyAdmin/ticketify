/**
 * Test double for `@/lib/revenuecat` (delete-account harness).
 *
 * The real `revenuecat.ts` imports `react-native-purchases`, which cannot
 * load in plain node. The compiled `use-session-store.deleteAccount` action
 * calls `logOutRevenueCat()` as a best-effort first step; this stub exposes
 * a controllable `logOutRevenueCat` plus a tiny setter seam so the harness
 * can verify the call ORDER (must run BEFORE the wrapper) and can prove
 * the action SWALLOWS a rejection (never throws).
 *
 * Also exposes the surface the pro store (`useProStore.refresh`) touches
 * — `getCustomerInfo` and `CustomerInfoSnapshot` — so the compiled module
 * loads. The Pro entitlement store is exercised here indirectly (its
 * `reset()` runs in the cleanup chain) but `getCustomerInfo` itself is
 * not on the delete-account path; a fixed null snapshot is enough.
 *
 * Default behavior: `logOutRevenueCat()` resolves `{ ok: true }` — the
 * "happy" path the cleanup chain expects. The setter seams below let a
 * test pin a different resolution (a rejection) or spy on call order.
 */
export interface CustomerInfoSnapshot {
  isPro: boolean;
}

/**
 * The pro store's `refresh()` calls this on the bootstrap path. The
 * delete-account harness never exercises that code (the action does not
 * trigger it), so a fixed null is enough to satisfy the compiler.
 */
export async function getCustomerInfo(): Promise<CustomerInfoSnapshot | null> {
  return null;
}
let logOutImpl: () => Promise<{ ok: boolean; message?: string }> = async () => ({
  ok: true,
});

/** How many times the stub's `logOutRevenueCat` has been called since reset. */
let callCount = 0;

/** Mirrors the real module's `RevenueCatIdentityResult`. */
export type RevenueCatIdentityResult = { ok: boolean; message?: string };

/**
 * Best-effort local SDK clear (mirrors the real module's contract). The
 * session store calls this BEFORE the wrapper invoke — the harness verifies
 * both the order and that a rejection is swallowed (no throw).
 */
export async function logOutRevenueCat(): Promise<RevenueCatIdentityResult> {
  callCount += 1;
  return logOutImpl();
}

/**
 * Pin a custom implementation for `logOutRevenueCat` (harness seam). Pass
 * `async () => { throw new Error('boom') }` to prove the session store
 * swallows the rejection without bubbling it up.
 */
export function __setLogOutRevenueCat(
  impl: () => Promise<RevenueCatIdentityResult>,
): void {
  logOutImpl = impl;
}

/** Call count for `logOutRevenueCat` since the last reset. */
export function __logOutCallCount(): number {
  return callCount;
}

/** Reset the stub to defaults (call count → 0, happy-path impl). */
export function __resetRevenueCatBehavior(): void {
  logOutImpl = async () => ({ ok: true });
  callCount = 0;
}
