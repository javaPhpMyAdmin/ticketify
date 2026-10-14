/**
 * Pure rules for the "recently chosen currencies" list the picker surfaces.
 *
 * Extracted from `useSettingsStore` so the ordering / de-dupe / cap rules can
 * be asserted in plain Node without dragging in zustand, React or
 * AsyncStorage. The store stays the in-memory authority: it owns the state and
 * the persistence side-effect, and delegates only the list math here.
 *
 * Dependency-free on purpose (no `@/lib/format`, no React): the supported set
 * is passed in by the caller, which keeps this module loadable from any harness
 * and free of the store's import graph.
 */

/**
 * How many recently-chosen codes the picker surfaces. A small cap keeps the
 * review-screen chip row short; the full catalog stays one tap away.
 */
export const MAX_RECENT_CURRENCIES = 5;

/**
 * Promote `code` to the front of a most-recent-first list.
 *
 * - `code` is upper-cased so `'usd'` and `'USD'` can never both appear.
 * - an existing entry equal to `code` ignoring case is dropped first, so a
 *   re-selection moves the code to the front instead of duplicating it.
 * - the result is capped at `MAX_RECENT_CURRENCIES`.
 *
 * Pure: the input list is never mutated; a NEW array is always returned.
 */
export function pushRecentCurrency(
  list: readonly string[],
  code: string,
): string[] {
  const upper = code.toUpperCase();
  // Case-fold the comparison so a legacy lowercase entry ('usd') is recognized
  // as the same code as 'USD' and not duplicated.
  return [
    upper,
    ...list.filter((existing) => existing.toUpperCase() !== upper),
  ].slice(0, MAX_RECENT_CURRENCIES);
}

/**
 * Project a stored list onto the codes the catalog still ships.
 *
 * Used at the hydration seam: device-local recents are filtered to
 * `supported`, upper-cased to their canonical form, de-duplicated and capped.
 * A catalog shrink must not resurrect a code the app no longer offers, and a
 * legacy lowercase entry must survive as its canonical upper-case spelling.
 *
 * Pure: returns a NEW array; neither input is mutated.
 */
export function sanitizeRecentCurrencies(
  list: readonly string[],
  supported: readonly string[],
): string[] {
  const catalog = new Set<string>(supported);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of list) {
    const upper = entry.toUpperCase();
    if (seen.has(upper) || !catalog.has(upper)) continue;
    seen.add(upper);
    result.push(upper);
    if (result.length === MAX_RECENT_CURRENCIES) break;
  }
  return result;
}
