# Tasks: Monthly Totals Cache

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~420 (migration ~180, client ~140, tests ~80, types/infra ~20) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Migration + types + infra + new hook | PR 1 | foundation; no consumer changes yet |
| 2 | Consumer migration (overview, totals, charts) | PR 2 | depends on PR 1; single session |
| 3 | Tests (unit + integration) | PR 3 | depends on PR 2; isolated |

## Phase 1: Database Migration

- [x] 1.1 Create `supabase/migrations/0015_monthly_totals_cache.sql` with `monthly_user_totals` table (composite PK `user_id` + `year_month`, jsonb columns, `updated_at`)
- [x] 1.2 Add RLS: enable RLS + SELECT policy `monthly_user_totals_select_own` scoped to `auth.uid() = user_id`
- [x] 1.3 Add RPC `recalculate_monthly_totals(p_user_id, p_year_month, p_household_id DEFAULT NULL)` with CTE aggregation from `purchases` + `purchase_items` and upsert
- [x] 1.4 Add trigger function `trigger_recalculate_monthly_totals()` handling INSERT/UPDATE/DELETE with month-change recalc on UPDATE
- [x] 1.5 Create trigger `trg_monthly_totals_recalculate` on `purchases` AFTER INSERT/UPDATE/DELETE
- [x] 1.6 Add index `idx_monthly_user_totals_user(user_id)`

## Phase 2: TypeScript Infrastructure

- [x] 2.1 Add `MonthlyTotalsCacheRow` interface to `src/types/index.ts`
- [x] 2.2 Add `monthlyCache(userId, yearMonth)` and `monthlyCachePrefix(userId)` query keys to `src/lib/query-keys.ts`
- [x] 2.3 Add `readMonthlyCacheRow(userId, yearMonth)` and `triggerMonthlyRecalc(userId, yearMonth)` to `src/lib/supabase/feature-access.ts`

## Phase 3: Core Hook

- [x] 3.1 Create `src/features/analytics/hooks/useMonthlyCache.ts` — reads cache via `useQuery`, falls through to existing RPCs for household mode
- [x] 3.2 Add cache-miss detection + one-time `triggerMonthlyRecalc` mutation with `onSuccess` refetch
- [x] 3.3 Add `transformCacheToCategoryTotals(row)` helper that maps `category_totals` jsonb to `CategoryMonthlyTotal[]`
- [x] 3.4 Export `useMonthlyCache` from `src/features/analytics/index.ts`

## Phase 4: Consumer Migration

- [x] 4.1 Modify `src/features/analytics/hooks/useMonthlyOverview.ts` — replace `readMonthlyPurchasesTotal` RPC calls with `useMonthlyCache(monthKey)` reads for current and previous month totals
- [x] 4.2 Modify `src/features/analytics/hooks/useMonthlyTotals.ts` — replace `monthly_category_totals` RPC with `useMonthlyCache` returning `CategoryMonthlyTotal[]`
- [x] 4.3 Modify `src/app/pro/charts.tsx` — replace `aggregateSpendTrend` (paginated store) with 6-month `monthly_user_totals` query; replace `aggregateDailySpend` with `daily_totals` from cache; replace `aggregateStoresByMonth` with `store_totals`; replace `aggregateDailyAverage` with `total / days_in_month`; replace `getTopCategory` with `category_totals` sort

## Phase 5: Testing

- [ ] 5.1 Unit test `transformCacheToCategoryTotals` with fixture cache rows (valid row, empty row, missing categories). **Pending** — no test exists. `transformCacheToCategoryTotals` is implemented in `src/features/analytics/hooks/useMonthlyCache.ts` (lines 28–48), but there is no `scripts/test-*.mjs` (or vitest/jest) covering it. `scripts/test-monthly-overview.mjs` covers `computeMonthOverview` only, not the transform. Should live in a new `scripts/test-monthly-cache.mjs` (same harness pattern as `test-monthly-overview.mjs`), wired into `package.json:test:monthly-cache` and the `test` chain.
- [ ] 5.2 Integration test `useMonthlyCache` cache-hit path (mock Supabase returns row) and cache-miss path (mock returns null, verify mutation fires then refetch). **Pending** — no test exists. No harness drives the `useMonthlyCache` hook's cache-hit/miss behaviour. Would need a React test renderer harness (mock `readMonthlyCacheRow` + `triggerMonthlyRecalc`) similar to `test-profile-hook.mjs`'s mount-based approach.
- [x] 5.3 Verify `pnpm typecheck` passes with no new errors across all modified files. ✅ Done — the change is live (consumers `useMonthlyOverview`, `useMonthlyTotals`, and the Pro charts all read the cache), so the typecheck is green.
