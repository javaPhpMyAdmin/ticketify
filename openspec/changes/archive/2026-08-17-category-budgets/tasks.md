# Tasks: Category Budgets

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~400 (310 new + 90 modified) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with work-unit commits |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Migration + types + data access + hook | PR 1 | Foundation — everything downstream depends on this |
| 2 | Component wiring + settings screen + profile link | PR 1 | UI layer — depends on Unit 1 |

> Forecast is borderline (~400 lines). Single PR is viable if implementation stays tight. If the settings screen grows beyond estimate, split Unit 2 into a chained PR.

## Phase 1: Foundation (Migration + Types + Data Access)

- [x] 1.1 Create `supabase/migrations/0013_category_budgets.sql`: `category_budgets` table DDL (PK, RLS policy) + replace `monthly_category_totals` RPC with LEFT JOIN version adding nullable `budget_limit`
- [x] 1.2 Add `budget_limit: number | null` to `CategoryMonthlyTotal` in `src/types/index.ts`
- [x] 1.3 Add `categoryBudgets(userId, yearMonth)` key factory to `src/lib/query-keys.ts`
- [x] 1.4 Add `readCategoryBudgets(userId, yearMonth)` and `upsertCategoryBudgets(budgets, yearMonth)` to `src/lib/supabase/feature-access.ts`
- [x] 1.5 Create `src/features/analytics/hooks/useCategoryBudgets.ts`: hook wrapping read + save via React Query, returns `{ budgets, isLoading, save }`

## Phase 2: Component Wiring

- [x] 2.1 Add `ProgressBar` below limit text in `CategoryBudgetRow.tsx` — color from `budgetProgressColor(spent, limit)` (green <70%, amber 70–100%, red >100%)
- [x] 2.2 Add `limit?: number` prop + ProgressBar + color-coded spend text to `CategoryBudgetCard.tsx`
- [x] 2.3 Pass `budget_limit` from RPC rows to `CategoryBudgetRow` in charts.tsx; add empty-state CTA "Configurar presupuestos" when all budgets are null

## Phase 3: Settings + Navigation

- [x] 3.1 Create `src/app/settings/category-budgets.tsx`: list 13 categories from `EXPENSE_CATEGORIES`, numeric inputs, "Guardar" button upserts non-zero / deletes zero budgets for current month
- [x] 3.2 Add "Presupuestos por categoría" navigation row to `src/app/(tabs)/profile.tsx` linking to `/settings/category-budgets`

## Phase 4: Typecheck + Verification

- [x] 4.1 Run `pnpm tsc --noEmit` — verify zero errors after all changes
- [x] 4.2 Manual verification: RPC returns `budget_limit` for set categories, null for unset; progress bar colors correct; settings save/clear round-trip; empty-state CTA visibility
