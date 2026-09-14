# Tasks: User Categories + Category Budgets (category-management)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,500–2,000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1–PR7 (stacked to main) |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

TDD RED→GREEN; gate: `pnpm test` + `pnpm typecheck` + `pnpm lint`.

## Phase 1: Storage & Save Seam (PR 1)

- [x] 1.1 RED `supabase/tests/user-categories.sql`: partial unique idxs, RLS write policies block cross-user, kind CHECK, FK RESTRICT; register in `scripts/test-db-smoke.mjs` (CI; no local CLI)
- [x] 1.2 GREEN `supabase/migrations/0032_user_categories.sql`: add `user_id uuid references profiles(id) on delete cascade`; drop `categories_slug_key`; `categories_global_slug_idx`/`categories_user_slug_idx`/`categories_user_sort_idx`; RLS insert/update/delete own-row policies; FK `purchase_items_category_id_fkey` → RESTRICT
- [x] 1.3 RED `scripts/test-manual-receipt.mjs`: `fetchCategoryIdsBySlug(userId)` resolves own custom + canonical; 'otros' fallback kept
- [x] 1.4 GREEN `src/features/tickets/api.ts`: `fetchCategoryIdsBySlug(userId)` — `.or('user_id.is.null,user_id.eq.<uid>')`, `order('sort_order,slug')`, no `.limit(200)`; update callers (buildSaveReceiptArgs, updateReceipt)

## Phase 2: Feature Module (PR 2)

- [x] 2.1 RED `scripts/test-categories.mjs` + `tsconfig.categories-test.json` (chained into `pnpm test`): slugify accents/collapse, `slugCollides`, `mergeCategoryCatalog` canonical-first, `resolveCategory` 'otros' fallback
- [x] 2.2 GREEN `src/features/categories/catalog.ts` (pure): `slugify`, `slugCollides`, `mergeCategoryCatalog`, `resolveCategory`
- [x] 2.3 GREEN `src/features/categories/api.ts`: `readCategoryCatalog(userId)` (global ∨ own), `createCustomCategory`, `deleteCustomCategory`, `reassignCategoryItems` bulk UPDATE
- [x] 2.4 GREEN `src/features/categories/hooks/useCategoryCatalog.ts` + barrel; `queryKeys.categories(userId)` in `src/lib/query-keys.ts`; invalidate after mutations

## Phase 3: Picker Create (PR 3)

- [x] 3.1 RED `scripts/test-manual-screen.mjs`: picker lists catalog rows, create affordance, canonical/own collision blocked with feedback
- [x] 3.2 GREEN `CategoryPickerModal.tsx`: render merged catalog; create form (name ≤40, palette color, need/want required); `slugify`+`slugCollides`; map 23505 → friendly error; row created before selectable
- [x] 3.3 i18n: es-AR source keys (tickets/settings) + pt-BR/en

## Phase 4: Picker Delete (PR 4)

- [x] 4.1 RED `scripts/test-manual-screen.mjs` extend: in-use delete blocked, no re-bucket; empty delete succeeds
- [x] 4.2 GREEN delete flow: long-press own row → count `purchase_items` (RLS-scoped); blocked + reassignment picker; `reassignCategoryItems(fromId,toId)`; empty → `deleteCustomCategory`
- [x] 4.3 Invalidations (catalog/feed/totals); i18n blocked/reassign copy

## Phase 5: Editor Wiring (PR 5)

- [x] 5.1 GREEN `ItemEditorModal.tsx`: category row (label via `resolveCategory`), `initialValues.category_id` (slug|null), `onSave` round-trip
- [x] 5.2 GREEN `src/app/ticket/manual.tsx`: stack picker over editor; save `category_id` add + edit
- [x] 5.3 GREEN review flow: `ReviewItemRow.tsx` chip → enhanced picker, create+assign; null default kept
- [x] 5.4 Update `test-manual-receipt.mjs` + `test-scan-contract.mjs`: add/edit round-trip, canonical unchanged, null default

## Phase 6: Display Convergence (PR 6)

- [x] 6.1 RED update `test-home.mjs`, `test-charts.mjs`, `test-home-api.mjs`, `test-household-category-items.mjs`: stub catalog; custom slug renders own visuals; unknown → 'otros'
- [x] 6.2 GREEN `resolveCategoryDisplay` (STATIC-FIRST: canonical 13 always render the static taxonomy — byte-identical with today; custom slugs render the catalog row) at `useHomeFeed.ts` (strip/chips), `(tabs)/history.tsx`, `receipts/[id].tsx` (chip resolver), `(tabs)/analytics.tsx`, `pro/charts.tsx`; remove bare `getExpenseCategory` display sites. Household RPC rows converge via `resolveHouseholdCategoryVisuals` (de-owned: static taxonomy unless the row's category_id IS the viewer's entry). `CategoryDonut.tsx` stays exported-but-unused: the charts surface's donut visual is covered by pro/charts.tsx row resolution, and `CategorySlice.color` remains a backward-compatible optional prop (no consumers) — documented here rather than removed so a future consumer keeps the prop contract. `mapPurchaseRowsToHomeFeed` receives the catalog from the Home container (`useCategoryCatalog` mounted once, same query key) — Home strip rows converge with the other tabs.

## Phase 7: Budgets + Rollover (PR 7)

- [x] 7.1 GREEN `src/app/settings/category-budgets.tsx`: merged catalog list (custom label/color), batch upsert, zero → delete, `currentMonthKey()`
- [x] 7.2 GREEN `useCategoryBudgets.ts`: rollover `validKeys` = catalog (13 ∪ own), sentinel excluded
- [x] 7.3 Update `test-category-budget-rollover.mjs` + `test-category-budget-progress.mjs`
- [x] 7.4 Manual script: create→assign→display→budget/rollover→blocked delete→reassign→delete