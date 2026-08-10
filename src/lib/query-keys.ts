/**
 * Query key factories (server-state-caching spec — D2).
 *
 * Every key embeds the userId so no two users can ever share a cache entry
 * (cross-user isolation). Analytics keys also embed the shared UTC year-month
 * derived by `utcYearMonth` — one derivation shared by the scan-usage and
 * analytics keys, replacing the duplicated `toISOString().slice(0, 7)`
 * (useProfile.ts:47, useMonthlyTotals.ts:30). The key changes exactly at month
 * rollover, which is when a refetch is correct.
 */

/**
 * Shared UTC year-month derivation, e.g. `2026-08`. Deterministic within a
 * day: the value only changes when the UTC month rolls over.
 */
export function utcYearMonth(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** User-scoped key factories, one per data domain. */
export const queryKeys = {
  /** The signed-in user's `profiles` row. */
  profile: (userId: string) => ['profile', userId] as const,
  /** The user's `scan_usage` row for a month (fresh months are ok/null). */
  scanUsage: (userId: string, yearMonth: string) =>
    ['scan-usage', userId, yearMonth] as const,
  /** The user's monthly budget read from their `profiles` row. */
  budget: (userId: string) => ['budget', userId] as const,
  /** The month's category totals via the RPC (analytics). */
  monthlyTotals: (userId: string, yearMonth: string) =>
    ['analytics', 'monthly-totals', userId, yearMonth] as const,
  /**
   * The month's TOTAL PAID via the `monthly_purchases_total` RPC — the SUM
   * of `purchases.total` (post-discount). Separate key from `monthlyTotals`
   * on purpose: the cache must never mix the category-rows shape with the
   * single-total shape under one key (server-state-caching spec).
   */
  monthlyPurchasesTotal: (userId: string, yearMonth: string) =>
    ['analytics', 'monthly-purchases-total', userId, yearMonth] as const,
  /**
   * Prefix of the monthlyPurchasesTotal keys for a user, used to invalidate
   * every month variant at once (e.g. after a receipt save).
   */
  monthlyPurchasesTotalPrefix: (userId: string) =>
    ['analytics', 'monthly-purchases-total', userId] as const,
  /**
   * Prefix of the monthlyTotals keys for a user, used to invalidate every
   * month variant at once (e.g. after a receipt save). The month is appended
   * unconditionally by `monthlyTotals`, so this prefix matches all of them
   * and nothing else.
   */
  monthlyTotalsPrefix: (userId: string) =>
    ['analytics', 'monthly-totals', userId] as const,
  /** The home feed (purchase list; all months, current-month derived). */
  homeFeed: (userId: string) => ['home', 'feed', userId] as const,
  /** Item search results for a month + normalized query (user-scoped). */
  itemSearch: (userId: string, monthKey: string, query: string) =>
    ['home', 'item-search', userId, monthKey, query] as const,
};
