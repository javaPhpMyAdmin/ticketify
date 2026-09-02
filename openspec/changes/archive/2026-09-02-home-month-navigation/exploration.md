# Exploration: home-month-navigation

> Status: success. Research + mapping only — no code written, no source files edited.
> Artifact store: hybrid (this file + engram `sdd/home-month-navigation/explore`).

## Executive summary

Both problems share ONE root cause: month-scoped figures computed over a **partial** receipt list.
Home (`useHomeFeed`) and analytics ("Top Artículos") aggregate over `useReceiptsStore.list`, which is
hydrated only with the infinite-scroll pages the home feed has loaded so far (10/page). History and
Pro charts already solved this — they fetch the FULL month via `readPurchaseListByMonth` under
(unfortunately duplicated) literal query keys. Recommended: introduce ONE shared full-month query
(`useMonthReceipts`) with ONE key factory (`queryKeys.monthReceipts`), migrate the 5 existing
literal-key call sites to it, compute analytics top items over the full list, and give home a month
selector that reuses the history/analytics chevron pattern with a month-scoped receipt list. Single
coherent change, safely splittable into two chained PRs (analytics correctness fix first, home
feature second).

## A. Current state

### Who computes what from which list

| Screen | Feed for aggregations | Source | Accuracy |
|--------|----------------------|--------|----------|
| Home — recent tickets | `mapPurchaseRowsToHomeFeed(rows)` filtered to `currentMonthKey()` | `useHomeFeed` infinite query pages (loaded only) | Partial until fully scrolled |
| Home — category strip | `aggregateCategoriesByMonth(rows, currentMonthKey())` | same page rows | Partial until fully scrolled |
| Home — snacks total | `readMonthlyImpulseTotal` RPC | server-side | Accurate |
| Home — household card | `readMonthlyPurchasesTotal` RPC | server-side | Accurate |
| Home — budget card spent | `monthly_purchases_total` RPC (`useBudget`) | server-side current month | Accurate |
| Analytics — overview | `useMonthlyOverview` → materialized cache / RPC | server-side | Accurate |
| Analytics — household categories | `fetchMonthlyTotals(month, householdId)` RPC | server-side | Accurate |
| Analytics — **Top Artículos** | `aggregateItemsByMonth(storeList, monthKey, ['servicios'])` | `useReceiptsStore.list` | **Partial — the reported bug** |
| Analytics — month availability | `getAvailableMonthKeys(storeList)` | store list | **Partial (missing months)** |
| History — categories/counts | `aggregateCategoriesByMonth(fullList, monthKey)` | `useQuery(['history-month-receipts', userId, monthKey])` full month | Accurate |
| Pro charts — hero/summary/stores | cache jsonb or `monthList` fallback | `useQuery(['month-receipts', userId, monthKey])` full month | Accurate (annual trend still uses store list) |

### The exact mechanism history uses (and analytics/home lack)

`readPurchaseListByMonth(userId, yearMonth)` (`src/features/home/api.ts:190-218`) — one batched
PostgREST read of ALL confirmed purchases in `[YYYY-MM-01, nextMonth-01)`, nested
`stores` + `purchase_items` + `categories`, no pagination. History mounts it as a plain query and
falls back to the store list while it loads:

```ts
// history.tsx:72-78
const { data: monthList } = useQuery({
  queryKey: ['history-month-receipts', userId, monthKey],
  enabled: !!userId,
  queryFn: () => readPurchaseListByMonth(userId!, monthKey).then(toQueryData),
});
const fullList = monthList ?? list;
```

The same pattern already exists for drill-downs — `useCategoryDetail`, `useItemDetail`,
`useStoreDetail` (`useHomeFeed.ts:349-353, 452-456, 486-490`) and Pro charts (`charts.tsx:184-189`)
all fetch the full month. Analytics' Top Artículos simply never adopted it: it reads the store.
Home's category strip shares the defect class (pages only), though the receipts list itself is
truthful per loaded page.

## B. Answers to the seven questions

### 1. What feeds home today; minimal change for month navigation

Home = `useBudget` (RPC accurate) + `useHomeFeed` (infinite query, current-month derivation) +
`HouseholdCard` (RPC) + `SnacksBreakdownModal` (RPC). Month helpers all exist in
`useHomeFeed.ts`: `currentMonthKey`, `previousMonthKey`, `getAvailableMonthKeys`, `monthKeyToLabel`;
history/analytics already implement the full navigation pattern (helper `goOlder`/`goNewer` over
`monthKeys`, `indexOf` −1 handling for a receipt-less current month).

**Minimal change**: add `monthKey` state (default `currentMonthKey()`), render the same chevron
selector, and for the selected month use ONE full-month query (`useMonthReceipts`) instead of the
page-derived derivation; keep the current-month infinite feed only for the default view (recent
tickets keep progressive loading), and for other months list that month's receipts from the full
query. Budget card + snacks callout are current-month RPCs — hide or disable them for non-current
months (product decision, see risks).

### 2. Why history gets the full list and analytics/home don't

History and charts/hooks issue an explicit month-scoped query. Analytics and home derive from the
shared store, which `useHomeFeed` hydrates with **loaded pages only** (`useHomeFeed.ts:652-656`).
Analytics also derives its `monthKeys` from that partial list, so months whose receipts were never
scrolled into the feed can disappear from navigation entirely (the reverse case of the report:
August was reachable because some August rows loaded, but the totals were computed over only those
rows → $791 instead of the real sum).

### 3. Aggregators take a full list — where defined

Pure functions in `src/features/home/hooks/useHomeFeed.ts` (barrel-exported from
`src/features/home/index.ts`; `previousMonthKey` and `aggregateImpulseItemsByMonth` are NOT in the
barrel — consumers import the file directly):

- `aggregateCategoriesByMonth(list, monthKey)` → `HomeCategory[]`
- `aggregateCategoryItemCounts(list, monthKey)`
- `aggregateItemsByCategory(list, categoryKey, monthKey)`
- `aggregateItemsByMonth(list, monthKey, excludeCategories = [])` → `CategoryItemSummary[]`
- `aggregateImpulseItemsByMonth(list, monthKey)`

All take the **entire** list as a parameter and filter by month internally (`getMonthKey(...) !==
monthKey → skip`). They are correct on any list — accuracy is purely a caller concern. The
Top-Artículos bug is `analytics.tsx:90-93` passing the partial store list.

### 4. Query keys for month-scoped reads; key for the new reads

`src/lib/query-keys.ts` has factories for totals/RPC reads (`monthlyTotals`, `monthlyPurchasesTotal`,
`monthlyImpulseTotal`, `monthlyImpulseItems`, `monthlyCache`, `homeFeed`, `itemSearch`,
`categoryBudgets`, household variants) but **no factory for the full month receipt list**. The
same read is today cached under TWO disjoint string literals:

- `['month-receipts', userId, monthKey]` — charts.tsx:185, useHomeFeed.ts:350/453/487
- `['history-month-receipts', userId, monthKey]` — history.tsx:73

Consequences: duplicate cache entries + redundant fetches for identical data, and neither key is
covered by `invalidateReceiptFeeds`/`invalidateEditFeeds` (tickets/api.ts:639-683) — with the
app-wide `staleTime` 60s (`query-client.ts:20`) a saved receipt can leave these caches fresh-but-stale
for up to a minute. Also note `homeFeedPage` (query-keys.ts:94) is unused; `useHomeFeed` keys its
infinite query via `queryKeys.homeFeed`.

**Recommended key** (collision-free, follows the `['home', …]` domain-prefixed style):

```ts
monthReceipts: (userId: string, monthKey: string) =>
  ['home', 'month-receipts', userId, monthKey] as const,
monthReceiptsPrefix: (userId: string) => ['home', 'month-receipts', userId] as const,
```

Nothing currently starts with `['home', 'month-receipts', …]`; the prefix enables exact
invalidation of every month variant. Migrate the 5 literal call sites + the 2 new consumers
(analytics, home) to it.

### 5. Edge cases

- **Current month with no receipts**: `monthKeys.indexOf(monthKey) === -1` → only "older" enabled,
  jumps to newest month with data (existing pattern in history/analytics/charts — reuse verbatim).
- **Months with no data never appear as steps**: `getAvailableMonthKeys` derives keys from receipts
  only. On analytics it must derive from the FULL month list or availability is wrong.
- **Currency**: no change — `formatCurrency` + settings currency everywhere; Top-Artículos bar
  denominator (`monthTotal`) is the sum of `allItems`; computing over the full list fixes the
  denominator (and thus the percentages) automatically.
- **Household mode**: `useMonthlyTotals(monthKey, householdId)` is server-side RPC — accurate
  today. `readPurchaseListByMonth` is personal-scoped (RLS `purchases_select_own`), and the
  Top-Artículos block only renders in personal mode; household mode must keep its RPC path. Home's
  receipt list is personal regardless — no household receipt list exists client-side.
- **Pro charts** (`charts.tsx`): already fetches the full month (`monthList`) for hero/stores/daily
  figures, so it is mostly correct — but `availableYears` (line 386) and `aggregateYearlySpend(list)`
  (line 465) still read the partial store list; once the shared key lands, migrate those too (small,
  optional in-scope). Charts has no top-items equivalent (category rows come from the cache/RPC).
- **Materialized cache limit**: `monthly_user_totals` stores `total`, `category_totals`,
  `store_totals`, `daily_totals`, `items_count` — **no per-item names**. Top Artículos CANNOT come
  from the cache; a full-month read (or a new server-side items RPC) is required.

### 6. Caching concerns

- `staleTime` 60s / `gcTime` 5min default (`query-client.ts:20,26`); focus refetch refetches stale
  only.
- `invalidateReceiptFeeds` (save) and `invalidateEditFeeds` (edit) must gain
  `monthReceiptsPrefix(userId)` or month-scoped caches stay fresh-but-stale ≤60s after writes.
- `monthlyCachePrefix` is deliberately NOT invalidated — the DB trigger maintains the materialized
  cache; keep that exclusion.
- Store-hydration discipline: the new month view must NOT re-hydrate `useReceiptsStore` with the
  selected month's rows — the store is the shared basket for the home feed + other screens; a
  month-swap hydration would corrupt analytics/history fallbacks. Full-month queries keep their
  data in TanStack, not the store.

### 7. Files a proposal would likely touch; one change or two

| File | Why |
|------|-----|
| `src/lib/query-keys.ts` | add `monthReceipts` + `monthReceiptsPrefix` factories |
| `src/features/home/hooks/useHomeFeed.ts` | add `useMonthReceipts(userId, monthKey)` shared hook; `mapPurchaseRowsToHomeFeed` month parameter; (optional) move literal keys to factory |
| `src/app/(tabs)/analytics.tsx` | top items + `monthKeys` from full month list (bug fix) |
| `src/app/(tabs)/index.tsx` | month selector + month-scoped receipts/categories; budget-card decision for non-current months |
| `src/app/(tabs)/history.tsx` | migrate literal `['history-month-receipts', …]` → factory (dedupe) |
| `src/app/pro/charts.tsx` | migrate literal `['month-receipts', …]` → factory; optional: annual-trend store fallback |
| `src/features/tickets/api.ts` | add `monthReceiptsPrefix(userId)` to both invalidators |
| `src/features/home/index.ts` | (optional) export `previousMonthKey`/`aggregateImpulseItemsByMonth` for barrel consumers |

**One change or two**: ONE coherent change — both problems are the same defect (partial-list
aggregation) and the same fix (shared full-month query + one key). The proposal should still plan
for two chained PRs to respect the 400-line review budget: PR 1 = analytics correctness + key
factory + migrations + invalidation (small, ships the bug fix first); PR 2 = home month navigation
UI. If the orchestrator prefers the smallest possible hotfix, the analytics fix alone works
independently — but it would half-land the key factory, so the single-change framing is cleaner.

## C. Approaches

1. **Shared full-month query + key factory (recommended)**
   - Pros: one mechanism fixes both problems; reuses the exact proven pattern (history/drill-downs);
     dedupes the two literal cache keys; enables correct invalidation; analytics fix is a few lines.
   - Cons: touches 6-8 files; needs home UI work for the month selector; key migration churn.
   - Effort: Medium (Low for analytics slice, Medium for home slice).

2. **Server-side top-items RPC** (like `monthly_impulse_items`)
   - Pros: exact server-side numbers; no full-list client fetch for analytics.
   - Cons: new migration + RPC; does NOTHING for home month navigation; more surface than the bug
     needs; the full-month read already exists and is cached.
   - Effort: Medium-High. Rejected.

3. **Drop pagination; read all months** (`readPurchaseList`, used by export)
   - Pros: simplest mental model; store becomes complete.
   - Cons: unbounded payload per session, regresses the infinite-scroll design; still needs a month
     view for home; not month-scoped caching.
   - Effort: Low code, High risk. Rejected.

4. **Analytics-only minimal patch** (skip home)
   - Pros: fastest fix for the reported bug.
   - Cons: leaves home month navigation out of scope of this change (fine only if the orchestrator
     wants two separate changes); risks half-migrating keys.
   - Effort: Low. Acceptable only as a chained PR #1, not as the whole change.

## D. Recommendation

Option 1: introduce `queryKeys.monthReceipts` + `monthReceiptsPrefix`, a `useMonthReceipts` hook
wrapping `readPurchaseListByMonth`, migrate the 5 literal call sites, compute analytics top items
(and analytics `monthKeys`) over the full list, wire the prefix into both invalidation seams, and
add month navigation to home reusing the history/analytics selector with a month-scoped list. Ship
as one change with the analytics slice as PR #1 (bug fix) and the home slice as PR #2 (feature).

## Risks

- **Budget card semantics on previous months**: `monthly_budget` is a single profile value, and
  `spent` is the current-month RPC — showing them for a past month would be misleading. Proposal
  must decide: hide budget card + snacks callout for non-current months.
- **Store-hydration corruption**: month navigation must never overwrite `useReceiptsStore.list`
  with a single month's rows — keep store hydration tied to the home feed pages only.
- **Key migration misses**: leaving any of the 5 literal call sites behind recreates the duplicate
  cache; the proposal should include a grep-based acceptance check for `'month-receipts'`.
- **Household mode**: must not route Top Artículos through the personal full-month read; the RPC
  path stays for household mode. Home receipt list remains personal-only.
- **Current-month default view regression**: keep progressive loading for recent tickets; the
  full-month query should back the category strip / previous months rather than replacing the
  infinite feed outright (or accept one full fetch per month — history already does this, but on
  heavy months it is a larger payload).

## Ready for proposal

Yes. Orchestrator should tell the user: root cause confirmed (partial-list aggregation from the
store vs. full-month reads), fix is a shared month-scoped query + key factory, and the two reported
problems are one change with two PR slices.