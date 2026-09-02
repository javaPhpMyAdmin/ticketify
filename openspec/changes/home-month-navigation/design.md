# Design: Home Month Navigation

## Context & Goals

Home and analytics aggregate over `useReceiptsStore.list`, which only contains pages loaded via infinite scroll (10/page). Analytics Top Artículos, monthKeys, and totals are therefore **partial** — August food showed $791 vs actual spend. Home has no month selector at all. The fix: one shared `useMonthReceipts` hook + key factory + Home month navigation, shipped in two chained PRs.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Parameterize `mapPurchaseRowsToHomeFeed` with `monthKey` arg | Reuses existing pure function, minimal new code; home month view just passes the selected monthKey | **Chosen** |
| Separate `mapPurchaseRowsToFullMonthFeed` function | More explicit but duplicates aggregation logic | Rejected |
| Store month data in `useReceiptsStore` | Violates REQ-10, corrupts infinite-scroll fallbacks | Rejected |
| `useFocusEffect` from `@react-navigation/native` for reset | Available transitively via expo-router; fires on every tab re-focus | **Chosen** |
| `useEffect` + route params for reset | Misses tab re-focus without navigation event | Rejected |

## Query Design

### Key factory (`src/lib/query-keys.ts`)

```ts
monthReceipts: (userId: string, monthKey: string) =>
  ['home', 'month-receipts', userId, monthKey] as const,
monthReceiptsPrefix: (userId: string) =>
  ['home', 'month-receipts', userId] as const,
```

**No prefix collision**: existing `homeFeed` is `['home', 'feed', userId]` — second element `'feed'` vs `'month-receipts'` keeps them disjoint.

### Shared hook (`src/features/home/hooks/useHomeFeed.ts`)

```ts
export function useMonthReceipts(monthKey = currentMonthKey()) {
  const list = useReceiptsStore((s) => s.list);       // fallback only
  const { userId } = useSessionUser();
  const query = useQuery({
    queryKey: queryKeys.monthReceipts(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readPurchaseListByMonth(userId!, monthKey).then(toQueryData),
  });
  return {
    data: query.data ?? list,   // TanStack data wins; store is fallback
    isLoading: query.isLoading,
    hasData: query.data !== undefined,
  };
}
```

The store fallback ensures smooth UX on first load. Once the query resolves, TanStack data takes over — **never written back to the store**.

### Invalidation (`src/features/tickets/api.ts`)

Add to both `invalidateReceiptFeeds` and `invalidateEditFeeds`:

```ts
void queryClient.invalidateQueries({
  queryKey: queryKeys.monthReceiptsPrefix(userId),
});
```

This invalidates every month variant at once. `monthlyCachePrefix` stays excluded (DB trigger maintains it).

## Component / Data-Flow Changes

### `mapPurchaseRowsToHomeFeed` — parameterize monthKey

Current signature (line 565-568):
```ts
function mapPurchaseRowsToHomeFeed(rows, householdTotal?): HomeFeed
```
Hardcodes `const monthKey = currentMonthKey()` at line 569.

**Change**: add optional `monthKey` parameter defaulting to `currentMonthKey()`:
```ts
function mapPurchaseRowsToHomeFeed(
  rows: HomeFeedReceiptRow[],
  householdTotal?: number | null,
  monthKey: string = currentMonthKey(),
): HomeFeed
```

The filter at line 572 (`getMonthKey(item.purchase_date) === monthKey`) and the aggregation at line 582 already use this local variable — no other changes needed inside the function.

### `useHomeFeed` — current-month only store hydration (REQ-10)

The `useEffect` at lines 652-656 writes `useReceiptsStore.setState({ list: rows })`. This MUST stay gated to the current-month infinite-scroll path only:

- `useHomeFeed()` continues to own the infinite scroll and store hydration — **unchanged**.
- The home month view (PR #2) reads from `useMonthReceipts(monthKey)` which returns TanStack query data. It does **not** go through `useHomeFeed` and therefore does **not** trigger the store write.
- `useMonthReceipts` has **zero** `useReceiptsStore.setState` calls — confirmed by the hook design above.

### Home screen (`src/app/(tabs)/index.tsx`) — PR #2

1. Add `useState` for `monthKey` (default `currentMonthKey()`).
2. Add month selector (reusing the history/analytics chevron pattern): `getAvailableMonthKeys` from `useMonthReceipts` data, `goOlder`/`goNewer`/`monthKeyToLabel`.
3. For `monthKey === currentMonthKey()`: render the existing `useHomeFeed()` path (infinite scroll, budget card, snacks, household card).
4. For `monthKey !== currentMonthKey()`: render `useMonthReceipts(monthKey)` data — receipts list + month total, **no** `MonthlyBudgetCard`, **no** `SnacksBreakdownModal`, **no** infinite scroll.
5. `useFocusEffect` resets `monthKey` to `currentMonthKey()` on every Home tab focus.
6. `getAvailableMonthKeys` for the selector derives from the full-month query data (not the store).

### Analytics (`src/app/(tabs)/analytics.tsx`) — PR #1

**Current bug** (lines 74, 90-95):
```ts
const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);  // partial!
const allItems = useMemo(() => aggregateItemsByMonth(list, monthKey, ['servicios']), [list, monthKey]); // partial!
const monthTotal = allItems.reduce((sum, item) => sum + item.amount, 0);
```

**Fix**: Replace `list` with `useMonthReceipts(monthKey).data` for the aggregation source:

```ts
const { data: fullMonthList } = useMonthReceipts(monthKey);
const monthKeys = useMemo(() => getAvailableMonthKeys(fullMonthList), [fullMonthList]);
const allItems = useMemo(
  () => aggregateItemsByMonth(fullMonthList, monthKey, ['servicios']),
  [fullMonthList, monthKey],
);
const topItems = allItems.slice(0, 5);
const monthTotal = allItems.reduce((sum, item) => sum + item.amount, 0);
```

`MonthlyOverviewCard` inputs (`overview` from `useMonthlyOverview`) stay unchanged — it reads from a different RPC-backed source.

**Household mode interplay (REQ-9)**: `TopItemsBreakdown` only renders in personal mode (line 262: `viewMode === 'household'` renders the RPC category block instead). `useMonthReceipts` is personal-scoped — household reads stay on their RPC path (`useMonthlyTotals` with householdId). No conflict.

### History (`src/app/(tabs)/history.tsx`) — PR #1

**Current** (line 73): `queryKey: ['history-month-receipts', userId, monthKey]`
**Change to**: `queryKey: queryKeys.monthReceipts(userId, monthKey)`

This is a **key migration** only — the queryFn (`readPurchaseListByMonth`) and fallback pattern stay identical. The `history-month-receipts` literal disappears from the codebase.

### Charts (`src/app/pro/charts.tsx`) — PR #1

**Current** (line 185): `queryKey: ['month-receipts', userId, monthKey]`
**Change to**: `queryKey: queryKeys.monthReceipts(userId, monthKey)`

Same key migration. The `monthList = monthReceiptsQuery.data ?? list` fallback stays.

### useCategoryDetail, useItemDetail, useStoreDetail — PR #1

All three (lines 350, 453, 487 in useHomeFeed.ts) currently use literal `['month-receipts', userId, monthKey]`. Migrate each to `queryKeys.monthReceipts(userId, monthKey)`. The `readPurchaseListByMonth` queryFn and `monthQuery.data ?? list` fallback stay unchanged.

### Top Artículos (`src/features/analytics/components/TopItemsBreakdown.tsx`) — REQ-8

The component already receives `rows` (top items), `total` (month total), and `currency`. Each item in `rows` has `{ name, amount }`. The percentage is computed internally as `(item.amount / total) * 100`. **No component shape change needed** — the fix is upstream (analytics.tsx feeding full-month data instead of partial).

## Barrel exports (`src/features/home/index.ts`)

Add `useMonthReceipts` to the barrel export:
```ts
export { useHomeFeed, useMonthReceipts } from './hooks/useHomeFeed';
```

## Store Integrity Rule

**Absolute constraint**: `useReceiptsStore.setState` is called ONLY inside `useHomeFeed()` (the `useEffect` at line 652-656). No other hook or component writes to the store with month data. `useMonthReceipts` reads the store as a fallback (`?? list`) but never writes to it. The home month view (PR #2) consumes `useMonthReceipts` data directly — the store stays clean.

## Edge Cases & Constraints

- **Current month has no receipts yet**: `monthKey` defaults to `currentMonthKey()`, `getAvailableMonthKeys` returns an empty or partial list, chevrons navigate to the newest month with data. The selector works (REQ-5 scenario 3).
- **Heavy month payload**: history already fetches full-month via `readPurchaseListByMonth`. TanStack caches per-key, so a second screen fetching the same month reuses the cache.
- **Household mode**: `useMonthReceipts` is personal-scoped. Household reads continue through `useMonthlyTotals(monthKey, householdId)` and the household RPC. Top Artículos is personal-only.
- **`monthlyCachePrefix` exclusion**: neither invalidator touches the materialized cache — the DB trigger maintains it.

## PR Boundary Mapping

### PR #1: Shared query + analytics fix (standalone bug fix)

| File | Change |
|------|--------|
| `src/lib/query-keys.ts` | Add `monthReceipts` and `monthReceiptsPrefix` |
| `src/features/home/hooks/useHomeFeed.ts` | Add `useMonthReceipts` hook; migrate 3 literal keys (`useCategoryDetail`, `useItemDetail`, `useStoreDetail`) |
| `src/features/home/index.ts` | Export `useMonthReceipts` |
| `src/features/tickets/api.ts` | Add `monthReceiptsPrefix` to both `invalidateReceiptFeeds` and `invalidateEditFeeds` |
| `src/app/(tabs)/analytics.tsx` | Replace `list` with `useMonthReceipts(monthKey).data` for `monthKeys`, `allItems`, `monthTotal` |
| `src/app/(tabs)/history.tsx` | Migrate `['history-month-receipts', ...]` → `queryKeys.monthReceipts(...)` |
| `src/app/pro/charts.tsx` | Migrate `['month-receipts', ...]` → `queryKeys.monthReceipts(...)` |

**PR #1 standalone guarantee**: Home keeps working as-is (infinite scroll, budget card, snacks). Analytics gets correct full-month data. History and charts get unified keys. The home month selector does NOT exist yet — that's PR #2.

### PR #2: Home month navigation UI (layers on top)

| File | Change |
|------|--------|
| `src/app/(tabs)/index.tsx` | Add `monthKey` state, month selector, conditional rendering (current-month = existing path; past-month = `useMonthReceipts` path), `useFocusEffect` reset, hide budget/snacks off current month |
| `src/features/home/hooks/useHomeFeed.ts` | Parameterize `mapPurchaseRowsToHomeFeed` with optional `monthKey` |

**PR #2 depends on PR #1** — the `useMonthReceipts` hook and key factory must exist first.

## Open Questions

None. All 9 design decisions from the orchestrator brief are resolved above with concrete code-level specifications.
