/**
 * Pure quota state derivation for the home + profile quota meters
 * (pro-subscription spec — REQ-QUOTA-6, REQ-GATE-4; design D2.6).
 *
 * Lives outside React so it stays testable in isolation (the M8.1 unit
 * harness drives the truth table without spinning up a renderer). All
 * downstream UI (`ScanQuotaCard`, `UsageMeter`, `UsageLimitsCard`)
 * funnels through this single function so the "Pro is always unlimited"
 * invariant (CRITICAL-2) lives in exactly one place.
 *
 * Inputs:
 *   - `used`: scans_used from the scan_usage row (>= 0).
 *   - `limit`: scans_limit from the row, or `null` for Pro
 *              (set_profile_tier writes NULL on GRANT; the column is
 *              nullable after migration 0011).
 *   - `isPro`: client entitlement from useProEntitlement (RevenueCat).
 *              This is the authoritative "is unlimited" signal — it
 *              short-circuits the limit regardless of any stale numeric
 *              row the user may carry after a GRANT before their next
 *              scan writes NULL.
 *
 * Output `QuotaState`:
 *   - `unlimited`: `isPro`. The CRITICAL-2 invariant: Pro users never
 *                  see an exhausted state, never see a ratio, and never
 *                  see the upgrade CTA.
 *   - `effectiveLimit`: `limit ?? 15` — defensive mirror of the SQL
 *                       `coalesce(su.scans_limit, 15)` so a free user
 *                       with a freshly-minted NULL row still renders a
 *                       numeric cap (the column default is also 15).
 *   - `remaining`: `Infinity` when unlimited, else `max(0, eff - used)`.
 *   - `exhausted`: `!unlimited && eff > 0 && used >= eff`. Guards
 *                  against the divide-by-zero edge (`limit = 0`); an
 *                  exhausted state can only fire on a positive cap.
 *   - `ratio`: `0` when unlimited, else `min(1, used / eff)`. Clamped
 *              so the progress bar never overflows past 100%.
 *   - `showUpgradeCta`: `!isPro && exhausted` — REQ-GATE-4. Pro users
 *                       NEVER see the paywall CTA, even if a stale
 *                       numeric row would otherwise push them past it.
 */
export interface QuotaState {
  /** True when the user is on the unlimited Pro tier. */
  unlimited: boolean;
  /** Scans remaining this month; `Infinity` for Pro. */
  remaining: number;
  /** True only for free users who have hit their monthly cap. */
  exhausted: boolean;
  /** Fill for `<ProgressBar />`: 0..1, capped at 1; 0 if unlimited. */
  ratio: number;
  /** True only for free + exhausted: render the paywall CTA. */
  showUpgradeCta: boolean;
  /**
   * The numeric cap actually used for display. Mirrors the SQL
   * `coalesce(scans_limit, 15)` so the UI never has to think about
   * `null` for free users.
   */
  effectiveLimit: number;
}

/** SQL fallback (mirrors `parse-ticket SCANS_LIMIT` + the 0011 default). */
export const FREE_DEFAULT_LIMIT = 15;

export function computeQuotaState(
  used: number,
  limit: number | null,
  isPro: boolean,
): QuotaState {
  // CRITICAL-2: Pro is the authoritative "unlimited" signal. A Pro
  // user with a stale numeric row (because their next scan hasn't
  // written NULL yet) still renders as unlimited — `isPro` wins.
  const unlimited = isPro;
  const effectiveLimit = limit ?? FREE_DEFAULT_LIMIT;
  const remaining = unlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, effectiveLimit - used);
  const exhausted =
    !unlimited && effectiveLimit > 0 && used >= effectiveLimit;
  const ratio =
    unlimited || effectiveLimit <= 0 ? 0 : Math.min(1, used / effectiveLimit);
  const showUpgradeCta = !isPro && exhausted;

  return {
    unlimited,
    remaining,
    exhausted,
    ratio,
    showUpgradeCta,
    effectiveLimit,
  };
}
