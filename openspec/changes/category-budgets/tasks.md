# Tasks: Category Budgets v2 — Personal Surfacing + Rollover

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 helper + harness / ~450 hook + surfacing + fix + harness (total ~650) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pure helpers + harness (T1.1–T1.4) | PR 1 | base: main; standalone; no UI |
| 2 | Rollover + surfacing + UTC fix + harness (T2.1–T4.3) | PR 2 | base: PR 1; gates 3–6 |

### Flagged Decisions

- **History household parity**: NOT in scope (proposal excludes household). Household `CategoryBudgetCard` stays unwired; parity line deferred.
- **Harness rollover**: extend `scripts/test-mocks/feature-access.js` with `readCategoryBudgets`/`upsertCategoryBudgets` seams (pattern `__setReadMonthlyCacheRows`).

## Phase 1: Pure Helper (PR 1)

- [x] T1.1 Create `src/features/analytics/category-budget-progress.ts` (design contract): `BUDGET_COLOR`, `budgetProgressColor(ratio)` (green <0.7, amber 0.7–1, red ≥1), `computeCategoryBudgetProgress(totals, budgets, monthKey)` (slug+month match, `> 0` → limit else null; order preserved, unmutated), `budgetBySlug()` → Map. Type-only imports
- [x] T1.2 Create `scripts/tsconfig.category-budget-progress-test.json` — mirror `tsconfig.monthly-overview-test.json`
- [x] T1.3 Create `scripts/test-category-budget-progress.mjs`: matched/unmatched/`<=0`/foreign-month; ratios 0.69→green, 0.7/0.99→amber, 1/1.2→red; deep-freeze unmutated; order preserved; `budgetBySlug` filter
- [x] T1.4 `package.json`: add `test:category-budget-progress` to `test` chain

## Phase 2: Rollover Hook (PR 2)

- [x] T2.1 Extend `scripts/test-mocks/feature-access.js`: budget read/upsert mocks + seams + reset
- [x] T2.2 `useCategoryBudgets.ts`: default → `currentMonthKey()`; `rolloverDoneRef` + `rolloverMutation` (read prev → filter registry ∧ `> 0` → upsert current; invalidate both keys); effect gates `!userId`/not-current/rows-exist/loading/pending/ref → return, else ref + mutate
- [x] T2.3 Create `scripts/tsconfig.category-budget-rollover-test.json`
- [x] T2.4 Create `scripts/test-category-budget-rollover.mjs` (jsdom + act + QueryClientProvider, `currentMonthKey` stub): copy-on-first-read; rows-exist → skip; prev empty → no loop; past/future → skip; removed slug / `<= 0` not copied; double-mount idempotent; save-after preserves edits; error → no invalidate
- [x] T2.5 `package.json`: add `test:category-budget-rollover` to `test` chain

## Phase 3: Surfacing + UTC Fix (PR 2)

- [x] T3.1 `useMonthlyCache.ts`: `useCategoryBudgets(yearMonth)` unconditional; memo `computeCategoryBudgetProgress(transformCacheToCategoryTotals(row), budgets, yearMonth)`; default → `currentMonthKey()`
- [x] T3.2 `useMonthlyCacheData.ts` + `useMonthlyTotals.ts`: default → `currentMonthKey()`
- [x] T3.3 `CategoryBudgetRow.tsx`: drop local color fn, import from `../category-budget-progress`
- [x] T3.4 `analytics/index.ts`: re-export `budgetProgressColor` + new helpers from lib
- [x] T3.5 `CategoryBudgetCard.tsx`: replace inline hex (:56–63) with `budgetProgressColor(amount / limit)`
- [x] T3.6 `settings/category-budgets.tsx`: `utcYearMonth()` → `currentMonthKey()`
- [x] T3.7 `history.tsx`: personal Card `limit` from `useCategoryBudgets(monthKey)` + `budgetBySlug`; household unchanged (flagged)
- [x] T3.8 `analytics.tsx`: personal "Categorías" Card (`CategoryBudgetRow` over existing totals) + "Configurar presupuestos" CTA when no budgets; mirror household gates

## Phase 4: Verification

- [ ] T4.1 `pnpm typecheck` — zero errors
- [ ] T4.2 Source regression: compiled hook + settings drop `utcYearMonth`, import `currentMonthKey` (NFR-2)
- [ ] T4.3 Gates — AUTOMATED: `pnpm test` chain green. MANUAL: (3) surfacing bars in 3 colors / none → no bars; (4) rollover fresh month → prev limits, edits persist, deletes stay; (5) UTC-x boundary save = display month; (6) Card/Row same colors per ratio