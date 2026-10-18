/**
 * Dev-only onboarding preview derivation (issue #220 — extracted from
 * `src/app/_layout.tsx` so the truth table is unit-testable without
 * rendering, mirroring `src/features/pro/gate.ts`).
 *
 * `resolveOnboardingPreview() === true` means: on boot, ALWAYS route
 * into the 3-step onboarding wizard regardless of session or the
 * completed flag, so design iteration doesn't require signing out or
 * clearing storage. The root layout is the ONLY consumer.
 *
 * Safety contract (dev-only, ignored in production bundles):
 *
 *   - The env var carries the `EXPO_PUBLIC_` prefix so Expo inlines it
 *     into the bundle at build time — there is no runtime configuration
 *     attack surface.
 *   - The read is gated on React Native's `__DEV__` global, so
 *     production (Release) bundles ignore the flag entirely even if it
 *     leaks into a release build environment (e.g. a local Gradle
 *     release or `eas build --local`).
 *   - `Boolean(__DEV__)` (not a bare `__DEV__ &&`) keeps the return
 *     value a strict boolean on every runtime — including an explicitly
 *     undefined `__DEV__` (plain-node harnesses), where a bare
 *     `__DEV__ &&` would leak `undefined`.
 *
 * Zero-arg reader that projects globals/env internally (codebase
 * convention — see `isProOverrideEnabled`); the dev/prod matrix is
 * executed by `scripts/test-onboarding-preview.mjs`, and the layout
 * wiring is source-pinned by `scripts/test-onboarding-screens.mjs`.
 */
export function resolveOnboardingPreview(): boolean {
  return Boolean(__DEV__) && process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW === 'true';
}
