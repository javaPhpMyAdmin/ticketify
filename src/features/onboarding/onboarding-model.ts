/**
 * Pure model for the onboarding flow state machine.
 *
 * The onboarding flow is a linear 3-step wizard:
 *
 *   step-1 — Scanner hero: AI ticket mockup
 *   step-2 — Budget hero: monthly limit card
 *   step-3 — Insights hero: weekly chart card
 *
 * Each screen owns its own navigation decisions; this module is the
 * shared state-machine helper so the screens stay decoupled (the
 * paywall harness pattern — pure logic, harness-tested, zero runtime
 * react-native deps). Every function is pure and total: the boundary
 * sentinel is `null` (never throws), callers use the sentinel to
 * decide between "inter-step push" (mid-flow) and "terminal action"
 * (mark complete + nav to auth).
 *
 * The `Step` literal union is the same string the expo-router route
 * names use (`step-1`/`step-2`/`step-3`), so the screen <-> model
 * seam is just a string and the model never has to know about the
 * router.
 */

export const TOTAL_STEPS = 3;

export type Step = 'step-1' | 'step-2' | 'step-3';

/**
 * 1-based step index for the human-readable step badge ("Paso 1 de 3").
 * The return type is the literal union `1 | 2 | 3` so callers can
 * interpolate into the `stepBadge` i18n template without an `as` cast.
 */
export function getStepIndex(step: Step): 1 | 2 | 3 {
  // Indexed by the trailing digit — the step ids are kept numerically
  // monotonic on purpose so a future step-4 maps to the same branch.
  return step === 'step-1' ? 1 : step === 'step-2' ? 2 : 3;
}

/**
 * Linear successor. Returns `null` on the last step — callers
 * interpret the null as "this is the terminal step, perform the
 * completion action" (mark onboarding complete + route to auth).
 */
export function getNextStep(step: Step): Step | null {
  return step === 'step-1'
    ? 'step-2'
    : step === 'step-2'
      ? 'step-3'
      : null;
}

/**
 * Linear predecessor. Returns `null` on the first step — callers
 * interpret the null as "no back-arrow on this step" (step-1 has no
 * sub-header back button). The screen wrapper uses the null to
 * skip rendering the IconButton entirely.
 */
export function getPreviousStep(step: Step): Step | null {
  return step === 'step-2'
    ? 'step-1'
    : step === 'step-3'
      ? 'step-2'
      : null;
}

/** True on the first step — there is no previous step to navigate to. */
export function isFirstStep(step: Step): boolean {
  return step === 'step-1';
}

/** True on the last step — the CTA copy flips to the "Empezar ahora" text. */
export function isLastStep(step: Step): boolean {
  return step === 'step-3';
}
