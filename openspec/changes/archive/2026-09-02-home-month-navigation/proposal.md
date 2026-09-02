# Proposal: Home Month Navigation & Full-Month Analytics

## Intent

Home and analytics aggregate month figures over `useReceiptsStore.list` (loaded pages only, 10/page): analytics Top Artículos and month availability are PARTIAL (Aug food showed $791 vs real spend) and Home can't review past months. ONE shared full-month query + key factory fixes both. Root-cause map: `exploration.md`.

## Confirmed product assumptions (user-approved)

- Prev-month Home: receipts + month total only.
- Budget card + snacks callout: current-month RPCs — hidden elsewhere.
- Returning to Home resets to current month.
- Top Artículos: item + full-month total + % of month spend.
- Full-month fix covers ALL month-scoped analytics figures.

## Scope

### In Scope
- Key factory `monthReceipts` + `monthReceiptsPrefix` (prefix `['home', 'month-receipts', userId, …]`).
- `useMonthReceipts(userId, monthKey)` over `readPurchaseListByMonth`, store fallback while loading.
- Migrate the 5 literal keys (`useHomeFeed.ts` ×3, `history.tsx`, `charts.tsx`) to the factory.
- Analytics (personal): `monthKeys`, Top Artículos, `monthTotal` from full month list.
- Home: chevron selector (history pattern); prev-month receipts + total; hide budget/snacks off current; reset on return.
- `monthReceiptsPrefix` in both invalidators; barrel exports.

### Out of Scope
- Household Top Artículos stays on RPC (`readPurchaseListByMonth` is personal-scoped).
- `monthly_user_totals` cache: no per-item names — never a Top Artículos source.
- Charts annual-trend store fallback; any store re-hydration with one month's rows.

## Capabilities

### New Capabilities
- `home-month-navigation`: Home month selector; prev-month receipts + total; current-month-only card hiding; reset-on-return; personal-only constraint.

### Modified Capabilities
- `data-access`: month-scoped analytics MUST aggregate over the full-month read, not the store list; availability from the full list.
- `server-state-caching`: single `monthReceipts` factory (stable prefix) for ALL full-month reads; both invalidators cover it.

## Approach

Exploration option 1. ONE change, TWO chained PRs: PR #1 = factory + migration + invalidation + analytics fix (bug fix); PR #2 = Home month navigation UI. Month data lives in TanStack only — never re-hydrate the store.

## Affected Areas

| Area | Description |
|------|-------------|
| `src/lib/query-keys.ts` | add `monthReceipts`, `monthReceiptsPrefix` |
| `src/features/home/hooks/useHomeFeed.ts` | `useMonthReceipts`; migrate 3 literal keys |
| `src/app/(tabs)/analytics.tsx` | full-list aggregations (lines 74, 91) |
| `src/app/(tabs)/index.tsx` | month selector + month view + card hiding |
| `src/app/(tabs)/history.tsx`, `src/app/pro/charts.tsx` | literal key → factory |
| `src/features/tickets/api.ts` | prefix in both invalidators |
| `src/features/home/index.ts` | barrel exports |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Literal key survives → duplicate caches | Med | grep acceptance check |
| Month view re-hydrates store → corrupts fallbacks | Med | TanStack-only; design rule |
| Budget card on past month misleading | Low | hidden off current month |
| Heavy month payload | Low | history already does this; cached |
| Household routed through personal read | Low | Top Artículos personal-only; RPC untouched |

## Rollback Plan

No DB/schema changes. Revert PR #2 (UI) independently; PR #1 (factory + analytics) stands alone as the bug fix. If the factory regresses, restore literal keys — cache miss + refetch only, no data loss.

## Dependencies

`readPurchaseListByMonth` (existing, personal RLS) and household RPCs — no backend change.

## Success Criteria

- [ ] `pnpm typecheck` passes.
- [ ] grep: no literal `queryKey: ['month-receipts'` / `['history-month-receipts'` remains.
- [ ] Past-month analytics: items/categories/total = full-month sums; % base = full-month total; no vanishing months.
- [ ] Home navigates months; prev-month view shows receipts + total; budget/snacks hidden; returning resets to current.
- [ ] Save/edit invalidates `monthReceipts` caches; store never re-hydrated by the month view.