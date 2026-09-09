# Design: Category Budgets v2 — Personal Surfacing + Rollover

## Technical Approach

100% client-side, zero backend/schema change. Three seams:

1. **Rollover lives in the read path of `useCategoryBudgets`** — a query-state-guided effect (the `useMonthlyCache` cache-miss pattern, useMonthlyCache.ts:113-122) that, when the resolved current-month budget read is empty and the month is the local current month, upserts copies of the previous month's rows once. Idempotent by PK; one-shot per hook instance + month via a ref guard.
2. **Shared pure helper** `computeCategoryBudgetProgress(totals, budgets, monthKey)` merges budget limits into the cache-backed totals by slug, and `budgetProgressColor(ratio)` is the single color source, replacing the duplicated inline logic in `CategoryBudgetCard` and the local export in `CategoryBudgetRow`.
3. **UTC fix** — settings screen and all budget-flow hook defaults switch `utcYearMonth()` → local `currentMonthKey()` (NFR-2).

Pro charts need **zero direct edits**: `hasAnyBudgets` (charts.tsx:417) and `limit` (charts.tsx:825) already read `budget_limit` — they light up once `useMonthlyCache` injects real limits.

## Architecture Decisions

| # | Decision | Options | Choice | Rationale |
|---|----------|---------|--------|-----------|
| AD-1 | Rollover placement | (a) Effect inside `useCategoryBudgets` read path; (b) one-shot effect in a view (settings); (c) lazy upsert inside `readCategoryBudgets` (feature-access) | **(a)** | NFR-1: must ride the existing `readCategoryBudgets` read, not a new call; (b) only fires when the user opens settings — fails "first read of the month" when surfacing (Home reads no budgets, so a Home effect would add a new call). (c) violates ADR-7 (reads never write) and cannot invalidate/refetch React Query keys. (a) covers settings + every surface via the shared `queryKeys.categoryBudgets(userId, month)` key and mirrors the exact `useMonthlyCache` cache-miss effect (data gate → `!isPending` → mutate → refetch). |
| AD-2 | One-shot vs re-trigger | Effect without guard; `useRef` per instance+month | **Ref guard** | If the previous month is empty the upsert is a no-op, the refetch returns empty again, and the effect re-fires forever. `rolloverDoneRef.current === yearMonth` breaks the loop; StrictMode double-effect and multi-mount (charts + analytics + history) are safe because the upsert is idempotent on `(user_id, category_slug, month)`. |
| AD-3 | Helper location | Flat `src/features/analytics/category-budget-progress.ts`; `src/features/analytics/lib/`; `src/features/home/lib/` | **Flat analytics root** | Analytics pure functions are flat: `monthly-overview.ts`, `price-alerts.ts`, `analytics-headline.ts`. Home's `lib/` (runRate.ts) belongs to the home feature; this helper is analytics-domain over `CategoryMonthlyTotal`/`CategoryBudget`. |
| AD-4 | `budgetProgressColor` signature | `(ratio: number)`; existing `(spent, limit)` | **(ratio)** | Callers already compute `amount / limit` for the `ProgressBar` value (Card :110, Row :90) — a single-arg pure mapping over the spec thresholds (green <0.7, amber 0.7–1, red ≥1) is trivially testable. Barrel keeps exporting the name from the new file (analytics/index.ts:18 swap); no consumers exist, so removing it from `CategoryBudgetRow` is safe. |
| AD-5 | Merge placement | Post-step in `useMonthlyCache` personal path; budgets param on `transformCacheToCategoryTotals` | **Post-step** | Keeps the transform's contract (`budget_limit: null`, hooks/useMonthlyCache.ts:45) and the merge in one place — `useMemo(() => computeCategoryBudgetProgress(transformCacheToCategoryTotals(row), budgets, yearMonth), [row, budgets, yearMonth])`. The `budgets` dependency makes the totals recompute when the rollover refetch lands (covers the totals-refetch-before-budgets-refetch race). |
| AD-6 | Budgets query in household mode | Gate `enabled: !isHousehold`; call unconditionally | **Unconditional** | Hooks-order stability across `viewMode` switches (same rule as useMonthlyCache.ts:80 "Both query keys must be stable"). Cost: one indexed read of ≤13 rows in household mode. Bonus: the RPC LEFT JOIN reads `auth.uid()`'s rows, so the rollover also feeds household bars after the `monthlyTotals` invalidation. Merge applied to personal totals only. |
| AD-7 | Rollover copy filter | Copy all prev rows; filter to `EXPENSE_CATEGORIES` + `amount > 0` | **Filter to registry slugs + > 0** | Spec scenario "Category removed from list is not copied"; `amount <= 0` rows are delete-on-zero artifacts that should not exist, filtered defensively so a copied "0 budget" never flips `hasAnyBudgets` (`budget_limit !== null`). |
| AD-8 | Personal-mode Analytics surfacing | (a) New "Categorías" `CategoryBudgetRow` section fed by the existing cache-backed totals; (b) leave personal analytics budget-free | **(a)** | Spec REQ + gate 3 (manual) require bars in Analytics personal, but today the personal branch renders only `TopItemsBreakdown` (analytics.tsx:309). The totals are already fetched (:79, cache-backed when personal) — the section reuses that query's loading/error/hasData, mirroring the household branch and charts' Editar/Configurar affordance (charts.tsx:786). Zero new backend calls. |

**Judgment call (flagged for tasks)**: pass `limit={t.budget_limit ?? undefined}` on the History household `CategoryBudgetCard` (:423) as v1-intent parity (v1 added the Card's limit prop but only wired charts; delta says household "unchanged" — the line only *adds* bars where the v1 RPC field already existed).

## Data Flow

```
useCategoryBudgets(monthKey)  ← settings / history / useMonthlyCache (shared key)
   ├─ readCategoryBudgets(userId, month) ──▶ budgets[]
   │    budgets[] empty ∧ monthKey === currentMonthKey()
   │      └─▶ rolloverMutation (ref-guarded, once)
   │            readCategoryBudgets(userId, previousMonthKey(monthKey))
   │            └ filter: slug ∈ EXPENSE_CATEGORIES ∧ amount > 0
   │            upsertCategoryBudgets(copies, monthKey)      (idempotent PK)
   │            └ invalidate categoryBudgets + monthlyTotals → refetch
   └─ save() (unchanged, already invalidates both keys)

useMonthlyCache(yearMonth)
   └─ computeCategoryBudgetProgress(transformCacheToCategoryTotals(row), budgets, yearMonth)
        └─▶ CategoryMonthlyTotal[] con budget_limit real
              ├─▶ charts.tsx "Tus tendencias"   (sin cambios)
              └─▶ analytics.tsx personal "Categorías" (nuevo)
history.tsx personal: budgetBySlug(budgets, monthKey) ──▶ CategoryBudgetCard.limit
```

## Interfaces / Contracts

### `src/features/analytics/category-budget-progress.ts` — new, pure (only type imports)

```ts
import type { CategoryBudget, CategoryMonthlyTotal } from '@/types';

export const BUDGET_COLOR = { green: '#10B981', amber: '#F59E0B', red: '#EF4444' } as const;

/** Spec thresholds: green <70%, amber 70–100%, red >100%. ratio = spend / limit. */
export function budgetProgressColor(ratio: number): string;

/**
 * Pure merge, never mutates inputs, preserves totals order. For each total:
 * matched slug + month + amount > 0 → budget_limit = amount; else budget_limit = null.
 */
export function computeCategoryBudgetProgress(
  totals: CategoryMonthlyTotal[],
  budgets: CategoryBudget[],
  monthKey: string,
): CategoryMonthlyTotal[];

/** slug → amount map for a month (History card limit lookup). */
export function budgetBySlug(budgets: CategoryBudget[], monthKey: string): Map<string, number>;
```

### `useCategoryBudgets` — signature unchanged, behavior added

```ts
export function useCategoryBudgets(yearMonth = currentMonthKey()): {
  budgets: CategoryBudget[]; isLoading: boolean; error: string | null;
  save: (b: Array<{ category_slug: string; amount: number }>) => Promise<unknown>;
  isSaving: boolean;
};
```

Rollover internals (mirrors the recalc effect, useMonthlyCache.ts:113-122):
- `rolloverMutation.mutationFn`: read prev month (`readCategoryBudgets`) → filter registry slugs ∧ `> 0` → `upsertCategoryBudgets(copies, yearMonth, userId)` (empty copies → early return). `onSuccess` invalidates `queryKeys.categoryBudgets(userId, yearMonth)` and `queryKeys.monthlyTotals(userId, yearMonth)` (household keys match by prefix).
- Effect gates: `!userId` → return; `yearMonth !== currentMonthKey()` → return; `budgets.length > 0` → return (rows exist — no rollover); `budgetsQuery.data === undefined` → return (loading/error); `isPending` → return; `rolloverDoneRef.current === yearMonth` → return; else set ref + `mutate()`. Deps: `[userId, yearMonth, budgets, budgetsQuery.data, rolloverMutation.isPending]`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/features/analytics/category-budget-progress.ts` | Create | Pure helpers (contract above) |
| `src/features/analytics/hooks/useCategoryBudgets.ts` | Modify | Default → `currentMonthKey()`; add rollover effect + mutation (AD-1/AD-2/AD-7) |
| `src/features/analytics/hooks/useMonthlyCache.ts` | Modify | Call `useCategoryBudgets(yearMonth)` unconditionally; merge in totals memo (AD-5/AD-6); default → `currentMonthKey()` |
| `src/features/analytics/hooks/useMonthlyCacheData.ts` | Modify | Default → `currentMonthKey()` (NFR-2 hygiene; dead default today) |
| `src/features/analytics/hooks/useMonthlyTotals.ts` | Modify | Default → `currentMonthKey()` (delegates to useMonthlyCache) |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Modify | Drop local `budgetProgressColor`; import from lib; call `budgetProgressColor(amount / limit)` |
| `src/features/analytics/index.ts` | Modify | Re-export `budgetProgressColor` + new helpers from the lib (swap :18) |
| `src/features/home/components/CategoryBudgetCard.tsx` | Modify | Replace inline hex ternary (:56-63) with `budgetProgressColor(amount / limit)` |
| `src/app/settings/category-budgets.tsx` | Modify | `utcYearMonth()` → `currentMonthKey()` (:19, :32) |
| `src/app/(tabs)/history.tsx` | Modify | Personal: `useCategoryBudgets(monthKey)` + `budgetBySlug` map → `limit` on Card (:456); Household: `limit={t.budget_limit ?? undefined}` (flagged parity line) |
| `src/app/(tabs)/analytics.tsx` | Modify | Personal branch: "Categorías" Card with `CategoryBudgetRow` list (reusing :79 totals + loading/error/hasData) + Editar/Configurar link (AD-8) |
| `src/app/pro/charts.tsx` | No edit | Surfacing via shared hook; `hasAnyBudgets`/`limit` already consume `budget_limit` |
| `scripts/test-category-budget-progress.mjs` + `scripts/tsconfig.category-budget-progress-test.json` | Create | Pure-helper harness |
| `scripts/test-category-budget-rollover.mjs` + `scripts/tsconfig.category-budget-rollover-test.json` | Create | Hook harness (jsdom + act + QueryClientProvider, pattern test-run-rate-hook.mjs) |
| `scripts/test-mocks/feature-access.js` | Modify | Add `readCategoryBudgets`/`upsertCategoryBudgets` control seams (currently only recalc/totals) |
| `package.json` | Modify | Add `test:category-budget-progress` + `test:category-budget-rollover` to the `test` chain |

## Testing Strategy

Runner: repo pattern — `scripts/test-*.mjs` node harnesses (tsc into temp dir, require-hook stubs, deterministic fixtures). Gate 2 (spec) asks for harness list — two new harnesses:

| Harness | Cases |
|---|---|
| `test-category-budget-progress.mjs` | Merge: slug matched → limit filled (all hexes: 0.69→green, 0.7→amber, 0.99→amber, 1→red, 1.2→red); unmatched → null; `amount <= 0` row → null; foreign-month budget ignored; inputs unmutated (deep-freeze), order preserved; `budgetBySlug` month filter + `> 0`; `budgetProgressColor` boundary table |
| `test-category-budget-rollover.mjs` | Mount real hook with controllable `currentMonthKey` stub (useHomeFeed stub pattern) + mocked feature-access: copy-on-first-read (empty current, Jul rows → Aug upsert with filtered slugs); rows-exist → no upsert; prev empty → no upsert AND no re-fire after refetch (`rolloverDoneRef` loop guard); past/future month → no upsert; slug removed from registry → not copied; `amount <= 0` prev rows → not copied; double-mount (two hook instances) → both upserts idempotent, final rows unchanged; save-after-rollover preserves edits; rollover error → no invalidate, no loop |

**UTC/local** (decision #4): (1) source regression — harness asserts compiled `useCategoryBudgets.js` + `settings/category-budgets` no longer reference `utcYearMonth` and import `currentMonthKey` (NFR-2); (2) TZ derivation — subprocess block (TZ-swap technique of test-format.mjs:72-73) runs the REAL `currentMonthKey` under `TZ=America/Montevideo` vs `TZ=UTC` at the boundary instant `2026-08-31T23:30Z` (local `2026-08` vs UTC `2026-09`) via a fixed-now Date double (pattern test-features.mjs:975-984); also reuses that existing case. Manual gate 5 covers device-timezone end-to-end.

Verification: gate 1 `pnpm typecheck`; gate 3/4/6 manual scenarios from the spec; `pnpm test` chain green.

## Edge Cases and Mitigations

| Edge case | Behavior | Mitigation |
|---|---|---|
| Prev month empty | No copies, UI stays limit-free | Ref guard prevents effect re-fire/infinite loop (AD-2) |
| Current month has ≥1 row | No rollover at all | `budgets.length > 0` gate (spec) |
| Removed slug / zero-amount prev row | Not copied | AD-7 filter |
| Deleted budget (delete-on-zero) | Row gone → not copied → stays deleted on revisit | delete-on-zero + empty-gate |
| Past/future month read (History navigates months) | No rollover | `yearMonth === currentMonthKey()` gate |
| StrictMode double-effect / charts+analytics+history mounted | Duplicate upsert attempts | PK-idempotent; single invalidate; ref guard per instance |
| Totals refetch lands before budgets refetch | Momentary null limits | Memo dep on `budgets` recomputes on arrival (AD-5) |
| Prev read error | Silently skip (no copies, no loop) | Mutation error → no invalidate; ref already set |
| Household mode | Merge not applied; budgets query still fires (rollover feeds RPC) | AD-6 |
| Month boundary while settings screen stays mounted | Key frozen at first render (v1 behavior, unchanged) | Out of scope; same with `utcYearMonth` today |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Rollover writes real rows on read (data surprise) | Med | Product decision (explicit copies, user-editable); scoped to empty current month only; idempotent; no-op without prev data |
| Infinite refetch loop when prev empty | Low | `rolloverDoneRef` one-shot (AD-2) |
| Concurrent rollover from multiple surfaces | Low | PK upsert + shared query key |
| Analytics personal section changes layout | Med | Mirrors existing household branch + charts patterns; flagged in AD-8 (spec gate 3 mandates it) |
| `utcYearMonth` remnants outside budget flow | Low | NFR-2 scoped to budgets; grep in verify; other features keep it |

## Migration / Rollout

No migration, no SQL, no feature flag. Rollback = revert PR; rollover-created rows are real `category_budgets` rows and can be deleted manually. Rollover adds at most one prev-month read + one upsert per month transition (NFR-1).

## No-Goals

No Home banner/alerts, no household RPC/schema change, no push/notifications, no budget suggestions/smart limits, no multi-currency, no backfill migration, no deletion of stale previous-month rows.

## Open Questions

- [x] AD-8 reconciles the spec's "Analytics CategoryBudgetRow — personal" with the current TopItemsBreakdown-only branch (new section, reuses existing fetch).
- Note: History-household `limit` parity line — 1-line, v1-intent; tasks phase may scope it out if strict "household unchanged" wins.