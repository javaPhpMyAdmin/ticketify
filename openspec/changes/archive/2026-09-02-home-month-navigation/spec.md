# spec — home-month-navigation

## Background

Home and analytics aggregate month-scoped figures over `useReceiptsStore.list`, which is hydrated only with the infinite-scroll pages the home feed has loaded (10/page). Analytics Top Artículos computes `aggregateItemsByMonth(list, monthKey, ['servicios'])` over this partial list (analytics.tsx:90-95), producing incorrect totals — August showed $791 vs actual spend. Analytics `monthKeys` (getAvailableMonthKeys) also derives from the partial list, so months never scrolled into view vanish from navigation entirely. Home has no month selector at all.

History and Pro charts already solved this with `readPurchaseListByMonth(userId, yearMonth)` (useHomeFeed.ts:190-218) under literal query keys (`'month-receipts'` and `'history-month-receipts'`). The fix: one shared `useMonthReceipts` hook with a `queryKeys.monthReceipts` factory, migration of the 5 literal call sites, analytics full-month aggregation, Home month selector, and budget/snacks visibility rules.

## Requirements

### REQ-1: Shared month-scoped query

The system SHALL provide a `useMonthReceipts(userId, monthKey)` hook backed by `readPurchaseListByMonth`, falling back to `useReceiptsStore.list` while loading.

**Given/When/Then**:

1. Given a logged-in user, When `useMonthReceipts(userId, '2026-08')` is called, Then it returns all confirmed purchases for August 2026 (full month, no pagination).
2. Given the query is in flight with no cached data, When the hook is read, Then it falls back to `useReceiptsStore.list` (same pattern as history.tsx:78).
3. Given a different `monthKey`, When the hook is called again, Then a new query fires for that month (distinct cache entry).

### REQ-2: Query key factory

The system SHALL define `queryKeys.monthReceipts(userId, monthKey)` returning `['home', 'month-receipts', userId, monthKey]` and `queryKeys.monthReceiptsPrefix(userId)` returning `['home', 'month-receipts', userId]` in `src/lib/query-keys.ts`.

**Given/When/Then**:

1. Given `queryKeys.monthReceipts('uid', '2026-08')`, When evaluated, Then it returns `['home', 'month-receipts', 'uid', '2026-08']`.
2. Given `queryKeys.monthReceiptsPrefix('uid')`, When used with `queryClient.invalidateQueries`, Then it invalidates every `monthReceipts` cache for that user regardless of month.
3. Given the existing `homeFeed` key `['home', 'feed', userId]`, When compared to `monthReceipts` keys, Then there is no prefix collision (different second element: `'feed'` vs `'month-receipts'`).

### REQ-3: Literal key migration

All 5 literal `['month-receipts'...]` and `['history-month-receipts'...]` call sites SHALL be replaced with `queryKeys.monthReceipts(userId, monthKey)`.

**Given/When/Then**:

1. Given `grep -rn "month-receipts'" src/`, When the command runs after migration, Then zero matches remain for literal query keys containing `month-receipts` or `history-month-receipts` outside `query-keys.ts`.
2. Given `useCategoryDetail`, `useItemDetail`, `useStoreDetail` (useHomeFeed.ts), When each is called, Then they use `queryKeys.monthReceipts(userId, monthKey)` instead of a literal.
3. Given `history.tsx` (line 73), When the history query fires, Then it uses `queryKeys.monthReceipts(userId, monthKey)` instead of `['history-month-receipts', userId, monthKey]`.
4. Given `charts.tsx` (line 185), When the charts query fires, Then it uses `queryKeys.monthReceipts(userId, monthKey)` instead of `['month-receipts', userId, monthKey]`.

### REQ-4: Invalidation coverage

Both `invalidateReceiptFeeds` and `invalidateEditFeeds` (tickets/api.ts) SHALL include `queryKeys.monthReceiptsPrefix(userId)`.

**Given/When/Then**:

1. Given a receipt is saved (invalidateReceiptFeeds), When the invalidation runs, Then all `monthReceipts` caches for the user are invalidated (refetch on next read).
2. Given a receipt is edited or deleted (invalidateEditFeeds), When the invalidation runs, Then all `monthReceipts` caches for the user are invalidated.
3. Given the `monthlyCachePrefix` exclusion, When invalidation runs, Then `monthly_user_totals` caches are NOT invalidated (DB trigger maintains them).

### REQ-5: Home month selector

Home screen SHALL display a chevron month selector (reusing the history/analytics pattern) with `getAvailableMonthKeys`, `goOlder`/`goNewer`, `monthKeyToLabel`, and `monthKey` state defaulting to `currentMonthKey()`.

**Given/When/Then**:

1. Given a user with receipts in 2026-07 and 2026-08, When Home mounts, Then the selector shows the current month label and chevrons allow navigation to months with data.
2. Given the user taps the left chevron (goOlder), When the selected month changes, Then the Home screen fetches and displays that month's receipts + total.
3. Given the current month has no receipts yet, When Home mounts, Then `monthKey` is `currentMonthKey()`, the "older" chevron is enabled (points to the newest month with data), and "newer" is disabled.
4. Given the user navigated to a previous month, When they tap the right chevron (goNewer) back to the current month, Then the current-month view restores with receipts, budget card, and snacks callout.

### REQ-6: Budget card and snacks visibility

The budget card (`MonthlyBudgetCard`) and snacks callout SHALL be hidden when `monthKey !== currentMonthKey()`. They SHALL only render on the current month.

**Given/When/Then**:

1. Given `monthKey` is the current month, When Home renders, Then the budget card and snacks callout are visible (current behavior preserved).
2. Given `monthKey` is a previous month, When Home renders, Then neither the budget card nor the snacks callout appear.
3. Given the user navigates back to the current month from a previous month, When Home re-renders, Then the budget card and snacks callout reappear.

### REQ-7: Analytics full-month aggregation

Analytics Top Artículos SHALL compute `aggregateItemsByMonth(monthList, monthKey, ['servicios'])` over the full-month list from `useMonthReceipts`, NOT over `useReceiptsStore.list`. `monthKeys` SHALL also derive from the full-month list.

**Given/When/Then**:

1. Given a user with 150 receipts in August (only 10 loaded via infinite scroll), When analytics renders, Then `allItems` aggregates all 150 receipts, not the 10 loaded.
2. Given `getAvailableMonthKeys(fullList)` on the full-month data, When `monthKeys` is computed, Then all months with receipts appear in navigation (no vanishing months).
3. Given `monthTotal = allItems.reduce(...)`, When Top Artículos renders, Then each item's percentage bar uses the correct full-month total as denominator.

### REQ-8: Top Artículos item display

Top Artículos SHALL render each item with its name, correct total, and percentage of the full-month spend.

**Given/When/Then**:

1. Given the top 5 items from `aggregateItemsByMonth(fullList, monthKey, ['servicios'])`, When rendered, Then each row shows the item name, `formatCurrency(amount, currency)`, and `(amount / monthTotal) * 100`%.
2. Given an item appearing on 3 receipts in the month, When aggregated, Then its total is the sum across all 3 receipts, not just loaded pages.

### REQ-9: Household mode isolation

Personal month reads via `useMonthReceipts` SHALL NOT break household mode. Household-specific reads SHALL continue using their RPC path (`useMonthlyTotals` with householdId).

**Given/When/Then**:

1. Given a user with a household, When analytics is in household mode, Then `TopItemsBreakdown` does NOT render (household categories block renders instead via RPC).
2. Given a user without a household, When analytics is in personal mode, Then `TopItemsBreakdown` renders using `useMonthReceipts` data.
3. Given Home in household mode, When receipt list is personal, Then the household card still reads from the RPC (`householdMonthlyPurchasesTotal`), unaffected by `useMonthReceipts`.

### REQ-10: Store integrity

Month navigation SHALL NEVER write to `useReceiptsStore` with a single month's rows. Full-month query data stays in TanStack Query only.

**Given/When/Then**:

1. Given the user navigates to a previous month on Home, When `useMonthReceipts` returns data, Then `useReceiptsStore.list` is unchanged (the existing home feed pages remain the store source).
2. Given the user is on the current month with infinite scroll, When pages load, Then `useReceiptsStore.setState({ list: rows })` fires only for the home feed pages (existing behavior), NOT for the full-month query.
3. Given analytics computes from `useMonthReceipts`, When the query returns, Then no `useReceiptsStore` write occurs.

### REQ-11: Current-month reset

Every time the Home tab mounts or re-focuses, `monthKey` SHALL reset to `currentMonthKey()`.

**Given/When/Then**:

1. Given the user navigated to a previous month, When they leave Home and return (tab re-focus), Then `monthKey` is `currentMonthKey()` and the current-month view renders.
2. Given the app is cold-launched, When Home mounts, Then `monthKey` is `currentMonthKey()`.
3. Given the user navigated to analytics and back, When Home re-mounts, Then `monthKey` resets (not persisted across navigations).

## Non-Goals

- Materialized cache (`monthly_user_totals`) changes: no per-item names, never a Top Artículos source.
- Household Top Artículos: stays on RPC (readPurchaseListByMonth is personal-scoped).
- Charts annual-trend store fallback migration (optional, not required by this change).
- Offline month loads or new server-side RPCs.
- Replacing the infinite-scroll home feed for the current month (progressive loading preserved).

## Acceptance Gates

1. **grep gate**: `grep -rn "'month-receipts'" src/` returns 0 matches outside `query-keys.ts`.
2. **grep gate**: `grep -rn "'history-month-receipts'" src/` returns 0 matches.
3. **query key uniqueness**: `queryKeys.monthReceipts` is the sole source for all month-scoped full reads; no two consumers use different literal keys for the same data.
4. **store never written by month navigation**: `useReceiptsStore` has no `setState` call triggered by `useMonthReceipts` or the home month selector.
5. **budget/snacks hidden**: `MonthlyBudgetCard` and `SnacksBreakdownModal` render ONLY when `monthKey === currentMonthKey()`.
6. **analytics correctness**: `allItems` in analytics is computed over the full-month list (TanStack query data), not `useReceiptsStore.list`.
7. **invalidation**: `invalidateReceiptFeeds` and `invalidateEditFeeds` both include `queryKeys.monthReceiptsPrefix(userId)`.
8. **typecheck**: `pnpm typecheck` passes with no errors.
