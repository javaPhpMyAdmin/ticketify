/**
 * Pure gate logic for the Pro tier (feature-gating spec — REQ-GATE-5,
 * subscription-trial — frozen state).
 *
 * `resolveGateState` is the single source of truth for "should this
 * content render?" — every gate (route guard, export-row routing,
 * charts entry card) projects through this function so the loading,
 * pro, and free states are decided in exactly one place.
 *
 * The contract (3-state, post migration 0016):
 *
 *   - `isLoading === true` → `'locked'`. Pro content must never flash
 *     unlocked while the SDK is still resolving (REQ-GATE-5).
 *   - `isFrozen === true`  → `'frozen'`. Trial expired — data visible,
 *     writes blocked (subscription-trial spec).
 *   - `isPro === true`     → `'unlocked'`.
 *   - Otherwise            → `'locked'`.
 *
 * Pure / no React / no I/O so the truth table is unit-tested in M8.1
 * without rendering.
 */
export type GateState = 'locked' | 'unlocked' | 'frozen';

export function resolveGateState(
  isPro: boolean,
  isFrozen: boolean,
  isLoading: boolean,
): GateState {
  if (isLoading) return 'locked';
  if (isFrozen) return 'frozen';
  if (isPro) return 'unlocked';
  return 'locked';
}

/**
 * DEV-ONLY ESCAPE HATCH — DO NOT ENABLE IN PRODUCTION.
 *
 * `EXPO_PUBLIC_PRO_OVERRIDE=true` short-circuits the Pro gate to
 * `isPro=true` before any RevenueCat work runs. The intent is letting a
 * developer or QA tester see the Pro UI without:
 *   - configuring a RevenueCat dashboard,
 *   - creating products in App Store Connect / Play Console,
 *   - building and deploying a release-signed APK with the SDK linked.
 *
 * The override lives here (a pure read of `process.env`) rather than in
 * the bootstrap effect so the bootstrap can branch on it deterministically
 * (no React hooks), and the test harness can match the true/false cases
 * without mocking the environment.
 *
 * Safety: the env var name carries the `EXPO_PUBLIC_` prefix so Expo
 * inlines it into the bundle at build time — there is no runtime
 * configuration attack surface (it cannot be flipped on at runtime by an
 * attacker without rebuilding the binary). Still, before any production
 * release the override MUST be left as `false` (or unset), otherwise the
 * gate opens for every user, paid or not.
 */
export function isProOverrideEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PRO_OVERRIDE === 'true';
}
