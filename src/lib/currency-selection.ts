import type { SupportedCurrency } from '@/lib/format';

/**
 * The selected-row decision for the settings currency picker
 * (`src/app/settings/currency.tsx`), extracted as a dependency-free PURE
 * function so it can be pinned BEHAVIORALLY rather than asserted through a
 * regex over the component's source text.
 *
 * It lives in its own module beside `format.ts` on purpose: the
 * `test-currency-catalog` harness compiles TypeScript to a temp dir and can
 * only LOAD a module with no runtime imports, because the `@/*` path alias
 * does not resolve in plain Node. The single `import type` below is erased at
 * emit, exactly like the `SupportedCurrency` reference in
 * `src/i18n/detector.ts` — it buys the catalog type link for free.
 *
 * WHY the compare case-folds: an earlier migration backfilled a LOWERCASE
 * `'usd'` into `profiles.currency`. Every money formatter case-folds, so the
 * amounts on screen kept looking right — but the picker compared
 * `code === currency` against UPPERCASE catalog codes, so NO row rendered as
 * selected and `accessibilityState={{ selected }}` was false for all 14. The
 * user could not tell "my currency is gone" from "the list does not know it",
 * and the natural reaction — tapping another row — is a SILENT currency
 * change that re-bases every amount in the app. Normalizing at the hydration
 * boundary (`useProfile`) fixes the store value but leaves this decision
 * correct only by coincidence, which is why the decision itself is here and is
 * asserted directly.
 *
 * Behavior, in full — no fallback row is invented anywhere:
 *   - `'USD'`  -> exactly one row selected, `USD`.
 *   - `'usd'`  -> exactly one row selected, `USD` (the reported regression).
 *   - `'CHF'`  -> ZERO rows selected: a stored currency outside the catalog is
 *                 the tracked graceful-degradation follow-up, not something to
 *                 paper over here with a synthetic row.
 *   - `null` / `''` -> zero rows selected.
 */
export function isCurrencySelected(
  code: SupportedCurrency,
  current: string | null | undefined,
): boolean {
  // No current currency yet (the pre-hydration seed has not been replaced, or
  // the profile read failed) means no row can honestly claim to be the user's
  // choice. Explicit rather than incidental: every catalog code is a non-empty
  // string, so `''` would already fail the compare below — the guard states
  // the intent instead of leaning on that accident.
  if (!current) return false;
  return code === current.toUpperCase();
}