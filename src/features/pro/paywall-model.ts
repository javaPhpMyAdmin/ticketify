/**
 * Pure model for the paywall screen (`src/app/pro/index.tsx`).
 *
 * Zero react-native deps (pure TS) so the node harness
 * `scripts/test-paywall-model.mjs` can compile it in isolation — the
 * same pattern as `gate.ts` for the Pro gate truth table.
 *
 * Busy-regression fix: the PlanButtons previously shared ONE
 * `state === 'purchasing'` flag, so a monthly tap spun BOTH buttons — the
 * annual (emphasis) button showed a white Spinner on the emerald
 * background (read as a "white rectangle"). The per-plan busy contract:
 * exactly the plan being purchased shows busy, nothing else.
 *
 * The former caption-color helper was removed with the trial-chip
 * polish: BOTH plan cards now render the trial chip with the same
 * emphasis style (solid emerald + onPrimary text), so the
 * annual-vs-monthly caption-color branch it served is gone.
 */

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
 * Discriminated union returned by `getCtaCopy`. The two shapes map 1:1
 * to the two CTA keys the screen renders:
 *
 *   - `ctaStartTrialWithDays` — the trial CTA, rendered with the
 *     interpolated `trialDays` token (e.g. "Comenzar 14 días gratis").
 *   - `ctaContinuePro` — the no-trial CTA (e.g. "Continuar con PRO"),
 *     no interpolation values.
 *
 * The screen renders the copy with `t(cta.key, cta.values)` so i18next
 * substitutes the `{{trialDays}}` token for the trial branch and
 * returns the no-args string verbatim for the continue branch.
 */
export type CtaCopy =
  | { key: 'ctaStartTrialWithDays'; values: { trialDays: number } }
  | { key: 'ctaContinuePro'; values?: undefined };

/**
 * Resolve the primary CTA copy from the currently-selected plan.
 *
 *   - `annual` plan + a positive `trialDays` → trial CTA, interpolating
 *     `trialDays` so the screen shows "Comenzar N días gratis" (or its
 *     en / pt-BR equivalent). `trialDays` comes from the RevenueCat
 *     offering's `introPhase.trialDays`.
 *   - `annual` plan + `null` / 0 `trialDays` → no intro offer
 *     configured; fall back to the no-trial CTA. Defensive: a 0 value
 *     is treated as "no trial" because the source-of-truth precondition
 *     is `introPhase.trialDays > 0`.
 *   - `monthly` plan → ALWAYS the no-trial CTA. The trial CTA is
 *     reserved for the annual plan; monthly never offers a free trial
 *     copy regardless of any provided `trialDays`.
 *
 * Pure function — same inputs return the same `CtaCopy`. The node
 * harness (`scripts/test-paywall-model.mjs`) pins both branches plus
 * the fallback contracts.
 */
export function getCtaCopy(
  plan: PlanKey,
  trialDays: number | null,
): CtaCopy {
  if (plan === 'annual' && trialDays != null && trialDays > 0) {
    return { key: 'ctaStartTrialWithDays', values: { trialDays } };
  }
  return { key: 'ctaContinuePro' };
}