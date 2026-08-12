/**
 * Pure gate logic for the Pro tier (feature-gating spec — REQ-GATE-5).
 *
 * `resolveGateState` is a single source of truth for "should this
 * content render?" — every gate (route guard, export-row routing,
 * charts entry card) projects through this function so the loading,
 * pro, and free states are decided in exactly one place.
 *
 * The contract:
 *
 *   - `isLoading === true` → `'locked'`. Pro content must never flash
 *     unlocked while the SDK is still resolving (REQ-GATE-5).
 *   - `isPro === true` → `'unlocked'`.
 *   - Otherwise → `'locked'`.
 *
 * Pure / no React / no I/O so the truth table is unit-tested in M8.1
 * without rendering.
 */
export type GateState = 'locked' | 'unlocked';

export function resolveGateState(isPro: boolean, isLoading: boolean): GateState {
  if (isLoading) return 'locked';
  if (isPro) return 'unlocked';
  return 'locked';
}
