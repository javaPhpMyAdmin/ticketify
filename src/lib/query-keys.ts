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
   * The month's IMPULSE (snacks/microgastos) total via the
   * `monthly_impulse_total` RPC — the SUM of `purchase_items.total_price`
   * WHERE `is_impulse = true`. Server-side aggregation so the snacks
   * callout loads instantly, not page-by-page via infinite scroll.
   */
  monthlyImpulseTotal: (userId: string, yearMonth: string) =>
    ['analytics', 'monthly-impulse-total', userId, yearMonth] as const,
  /**
   * Prefix of the monthlyImpulseTotal keys for a user, used to invalidate
   * every month variant at once (e.g. after a receipt save/edit).
   */
  monthlyImpulseTotalPrefix: (userId: string) =>
    ['analytics', 'monthly-impulse-total', userId] as const,
  /**
   * Per-item impulse breakdown for a month. Separate key from the total
   * because the shapes differ (array of {name, amount} vs {total}).
   */
  monthlyImpulseItems: (userId: string, yearMonth: string) =>
    ['analytics', 'monthly-impulse-items', userId, yearMonth] as const,
  /**
   * Prefix of the monthlyImpulseItems keys for a user.
   */
  monthlyImpulseItemsPrefix: (userId: string) =>
    ['analytics', 'monthly-impulse-items', userId] as const,
  /**
   * Prefix of the monthlyTotals keys for a user, used to invalidate every
   * month variant at once (e.g. after a receipt save). The month is appended
   * unconditionally by `monthlyTotals`, so this prefix matches all of them
   * and nothing else.
   */
  monthlyTotalsPrefix: (userId: string) =>
    ['analytics', 'monthly-totals', userId] as const,
  /**
   * Materialized monthly cache row (migration 0015). Key for a specific
   * (user, month) row in `monthly_user_totals`.
   */
  monthlyCache: (userId: string, yearMonth: string) =>
    ['analytics', 'monthly-cache', userId, yearMonth] as const,
  /**
   * Prefix of the monthlyCache keys for a user, used to invalidate every
   * month variant at once (e.g. after a receipt save).
   */
  monthlyCachePrefix: (userId: string) =>
    ['analytics', 'monthly-cache', userId] as const,
  /** The home feed (purchase list; all months, current-month derived). */
  homeFeed: (userId: string) => ['home', 'feed', userId] as const,
  /** Paginated home feed — one page of recent receipts. */
  homeFeedPage: (userId: string, page: number) =>
    ['home', 'feed', userId, 'page', page] as const,
  /** Item search results for a month + normalized query (user-scoped). */
  itemSearch: (userId: string, monthKey: string, query: string) =>
    ['home', 'item-search', userId, monthKey, query] as const,
  /**
   * Prefix of the itemSearch keys for a user, used to invalidate every
   * month/query variant at once (e.g. after a receipt edit/delete that
   * renames or removes items).
   */
  itemSearchPrefix: (userId: string) =>
    ['home', 'item-search', userId] as const,
  /**
   * Full month receipts for a user + month (used by useMonthReceipts).
   * Stores the complete month's receipts so aggregations (analytics top
   * items, month totals) are accurate regardless of infinite-scroll depth.
   */
  monthReceipts: (userId: string, monthKey: string) =>
    ['home', 'month-receipts', userId, monthKey] as const,
  /**
   * Prefix of the monthReceipts keys for a user, used to invalidate every
   * month variant at once (e.g. after a receipt save/edit).
   */
  monthReceiptsPrefix: (userId: string) =>
    ['home', 'month-receipts', userId] as const,

  /** Per-category budget limits for a month. */
  categoryBudgets: (userId: string, yearMonth: string) =>
    ['category-budgets', userId, yearMonth] as const,

  // -----------------------------------------------------------------------
  // Household sharing (migration 0014)
  // -----------------------------------------------------------------------

  /** The current user's household info (single row or null). */
  household: (userId: string) => ['household', userId] as const,
  /** Members of a household (array of denormalized profile rows). */
  householdMembers: (householdId: string) =>
    ['household', householdId, 'members'] as const,
  /** Household-scoped home feed (receipt list). */
  householdFeed: (householdId: string, monthKey: string) =>
    ['household', householdId, 'feed', monthKey] as const,
  /** Prefix for all household feed keys (invalidate on receipt save). */
  householdFeedPrefix: (householdId: string) =>
    ['household', householdId, 'feed'] as const,
  /**
   * Household-scoped monthly purchases total. Distinct from the user-scoped
   * key so personal and household caches never mix.
   */
  householdMonthlyPurchasesTotal: (
    householdId: string,
    yearMonth: string,
  ) => ['analytics', 'household-purchases-total', householdId, yearMonth] as const,
  /**
   * Household-scoped category totals. Distinct from the user-scoped key.
   */
  householdMonthlyTotals: (
    householdId: string,
    yearMonth: string,
  ) => ['analytics', 'household-totals', householdId, yearMonth] as const,
};
