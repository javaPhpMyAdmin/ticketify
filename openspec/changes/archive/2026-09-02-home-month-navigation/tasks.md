# tasks — home-month-navigation

## PR 1 — analytics full-month + shared query
### T1.1 Key factory  (REQ-2)
- Files: `src/lib/query-keys.ts`
- Do: add `monthReceipts(userId, monthKey)` → `['home','month-receipts',userId,monthKey]` and `monthReceiptsPrefix(userId)` → `['home','month-receipts',userId]`.
- Verify: `pnpm typecheck && pnpm lint`.
- Accept: second element `'month-receipts'` disjoint from `homeFeed`'s `'feed'`; no prefix collision.
- [x] Applied. Added both factories to `src/lib/query-keys.ts`. Grep confirms `'month-receipts'` only in query-keys.ts; `'feed'` vs `'month-receipts'` disjoint.

### T1.2 Shared `useMonthReceipts` hook  (REQ-1)
- Files: `src/features/home/hooks/useHomeFeed.ts`
- Do: add `useMonthReceipts(monthKey = currentMonthKey())` returning `{ data, isLoading, hasData }`; `data = query.data ?? useReceiptsStore.list` (fallback only), `queryFn` = `readPurchaseListByMonth(userId!, monthKey).then(toQueryData)`, `enabled: !!userId`, `queryKey: queryKeys.monthReceipts`. ZERO `setState` on the receipts store.
- Verify: `pnpm typecheck && pnpm lint`.
- Accept: hook uses `queryKeys.monthReceipts`; no `useReceiptsStore.setState` inside.
- [x] Applied. Hook added, read-only, uses `queryKeys.monthReceipts`. No setState on store.

### T1.3 Migrate 3 literal keys in detail hooks  (REQ-3)
- Files: `src/features/home/hooks/useHomeFeed.ts` (lines ~350, ~453, ~487)
- Do: replace `['month-receipts', userId, monthKey|month]` with `queryKeys.monthReceipts(userId, ...)` in `useCategoryDetail`, `useItemDetail`, `useStoreDetail`. Keep `monthQuery.data ?? list` fallback.
- Verify: `pnpm typecheck && pnpm lint`.
- Accept: grep `'month-receipts'` in useHomeFeed.ts = 0.
- [x] Applied. All three migrated; fallbacks preserved. Grep of useHomeFeed.ts = 0.

### T1.4 Export hook from barrel  (REQ-1)
- Files: `src/features/home/index.ts`
- Do: add `export { useMonthReceipts } from './hooks/useHomeFeed'`.
- Verify: `pnpm typecheck`.
- Accept: `@/features/home` exports `useMonthReceipts`.
- [x] Applied. Barrel now exports `useMonthReceipts`. Typecheck passes.

### T1.5 Invalidate monthReceipts caches  (REQ-4)
- Files: `src/features/tickets/api.ts`
- Do: add `void queryClient.invalidateQueries({ queryKey: queryKeys.monthReceiptsPrefix(userId) })` to both `invalidateReceiptFeeds` and `invalidateEditFeeds`. Keep `monthlyCachePrefix` excluded.
- Verify: `pnpm typecheck && pnpm test:home-api` (save/edit paths) + `pnpm test:monthly-cache`.
- Accept: both invalidators call prefix; `monthlyCachePrefix` untouched.
- [x] Applied. Both invalidators call prefix; `monthlyCachePrefix` untouched. Tests pass.

### T1.6 Analytics full-month aggregation  (REQ-7, REQ-8, REQ-9)
- Files: `src/app/(tabs)/analytics.tsx` (lines 74, 90-95)
- Do: use `const { data: fullMonthList } = useMonthReceipts(monthKey)`; drive `monthKeys`, `allItems`, `monthTotal`, `topItems` off `fullMonthList` (store list used ONLY as loading fallback). Preserve `viewMode === 'household'` RPC branch (line 223) untouched.
- Verify: `pnpm typecheck && pnpm lint && pnpm test:charts` (aggregation parity) + `pnpm test:monthly-overview`.
- Accept: `aggregateItemsByMonth` runs on query data; household branch line 223 unchanged; no new `useReceiptsStore.setState`.
- [x] Applied. `monthKeys`/`allItems`/`monthTotal`/`topItems` driven off `useMonthReceipts(monthKey).data`. Household RPC branch untouched. Store list import removed from analytics (fallback lives inside the hook).

### T1.7 Migrate history literal key  (REQ-3)
- Files: `src/app/(tabs)/history.tsx` (line 73)
- Do: replace `['history-month-receipts', userId, monthKey]` with `queryKeys.monthReceipts(userId, monthKey)`. QueryFn + fallback unchanged.
- Verify: `pnpm typecheck && pnpm test:home`.
- Accept: grep `history-month-receipts` = 0.
- [x] Applied. Migrated; queryKeys imported. Grep `history-month-receipts` = 0.

### T1.8 Migrate charts literal key  (REQ-3)
- Files: `src/app/pro/charts.tsx` (line 185)
- Do: replace `['month-receipts', userId, monthKey]` with `queryKeys.monthReceipts(userId, monthKey)`. Keep `monthList = monthReceiptsQuery.data ?? list`.
- Verify: `pnpm typecheck && pnpm test:charts`.
- Accept: grep `'month-receipts'` outside query-keys.ts = 0.
- [x] Applied. Migrated; fallback preserved. Grep `'month-receipts'` outside query-keys.ts = 0.

## PR 2 — Home month navigation UI
### T2.1 Parameterize mapPurchaseRowsToHomeFeed  (REQ-5, REQ-10)
- Files: `src/features/home/hooks/useHomeFeed.ts` (lines 565-588)
- Do: add optional `monthKey: string = currentMonthKey()` 3rd param; replace hardcoded `const monthKey = currentMonthKey()` (line 569). Filter + aggregation already use the local var.
- Verify: `pnpm typecheck && pnpm test:home` (mapPurchaseRowsToHomeFeed coverage).
- Accept: default month is current; existing call sites compile unchanged.
- [x] Applied. Added optional 3rd param with default; removed hardcoded const. Existing call sites (useHomeFeed internal) compile unchanged.

### T2.2 Home month selector + month view  (REQ-5, REQ-6, REQ-10, REQ-11)
- Files: `src/app/(tabs)/index.tsx`
- Do: add `useState(monthKey)` default `currentMonthKey()`; chevron selector via `getAvailableMonthKeys` (from `useMonthReceipts` data), `goOlder`/`goNewer`/`monthKeyToLabel` (history pattern). Current month → existing `useHomeFeed()` path (infinite scroll, budget card, snacks, household card). `monthKey !== currentMonthKey()` → render `useMonthReceipts(monthKey).data` receipts + month total; HIDE `MonthlyBudgetCard` + `SnacksBreakdownModal`; NO infinite scroll. NEVER write the receipts store. Reset `monthKey` to `currentMonthKey()` via `useFocusEffect` (from `@react-navigation/native`) on tab focus.
- Verify: `pnpm typecheck && pnpm lint && pnpm test:home`.
- Accept: `useFocusEffect` imported from `@react-navigation/native`; grep shows no `setState` on `useReceiptsStore` in month view; budget/snacks render only when `monthKey === currentMonthKey()`.
- [x] Applied. Added `monthKey` state, chevron selector (getAvailableMonthKeys/goOlder/goNewer/monthKeyToLabel), `useFocusEffect` reset from `@react-navigation/native`. Current month → existing infinite-scroll feed; past month → `useMonthReceipts(monthKey)` full list + total, no budget/snacks/household, no infinite scroll, no store writes. Full `pnpm test` chain green (20 suites, 0 failures) incl. test:scan-contract; typecheck + lint pass. Grep confirms `useFocusEffect` from `@react-navigation/native` (index.tsx:1) and no `setState` on `useReceiptsStore` in the screen.

## Test strategy note
No jest/vitest — node harnesses in `scripts/`. `test-home.mjs` covers pure home-feed helpers incl. `mapPurchaseRowsToHomeFeed`; `test-charts.mjs` covers aggregation parity (shares the same `ReceiptSpendRecord[]` surface analytics uses); `test-monthly-overview.mjs` / `test-monthly-cache.mjs` cover RPC/cache invalidation. If PR #2 past-month view needs skeletons, extend `useMonthReceipts` interface (`error`, `isRefetching`) in PR #2, not PR #1.

## Review Workload Forecast
- Chained PRs recommended: Yes (this change is split into PR #1 + PR #2 by design)
- 400-line budget risk: High
- 800-line budget risk: Low  (or "n/a — under 800")
- Estimated changed lines: ~250-320 total (PR #1 ~120-150, PR #2 ~130-170)
- Decision needed before apply: Yes
