/**
 * Pure model for the paywall screen (`src/app/pro/index.tsx`).
 *
 * Zero react-native deps (only `@/theme/colors`, which is pure TS) so the
 * node harness `scripts/test-paywall-model.mjs` can compile it in
 * isolation — the same pattern as `gate.ts` for the Pro gate truth table.
 *
 * Busy-regression fix: the PlanButtons previously shared ONE
 * `state === 'purchasing'` flag, so a monthly tap spun BOTH buttons — the
 * annual (emphasis) button showed a white Spinner on the emerald
 * background (read as a "white rectangle"). The per-plan busy contract:
 * exactly the plan being purchased shows busy, nothing else.
 */
import { colors } from '@/theme/colors';

/** The two purchasable plan keys, matching the `OfferingsSnapshot` shape. */
export type PlanKey = 'monthly' | 'annual';

/** Paywall screen state machine (`loading | ready | purchasing | error`). */
export type PaywallState = 'loading' | 'ready' | 'purchasing' | 'error';

/**
 * Whether a given plan's button should render its busy spinner.
 *
 * Busy is per-plan: `purchasingPlan === plan` AND the shared purchase is
 * in flight (`state === 'purchasing'`). Any other state — `loading`
 * (offerings fetch), `ready` (idle), `error` (failed) — means NO button
 * is busy, even if `purchasingPlan` is stale from an earlier purchase.
 */
export function isPlanBusy(
  plan: PlanKey,
  purchasingPlan: PlanKey | null,
  state: PaywallState,
): boolean {
  return purchasingPlan === plan && state === 'purchasing';
}

/**
 * Caption color for the intro caption ("{{trialDays}} días gratis…").
 *
 * The non-emphasis button renders the caption on the light `surface`,
 * so it uses `colors.primary` (emerald). The emphasis button has an
 * emerald (`colors.primary`) background, so its caption MUST use
 * `colors.onPrimary` (white) — the regression hardcoded `colors.primary`
 * for both, making the emphasis caption invisible (emerald-on-emerald).
 */
export function planCaptionColor(emphasis: boolean): string {
  return emphasis ? colors.onPrimary : colors.primary;
}