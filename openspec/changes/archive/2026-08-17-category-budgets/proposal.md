# Proposal: Per-Category Monthly Budgets

## Intent

Users can set a global monthly budget but have no visibility into how individual categories track against a limit. This creates a blind spot: a user might blow through their grocery budget without realizing it while staying under budget overall. Per-category monthly budgets surface spend-vs-limit at the category level, enabling proactive spending control during the month.

## Scope

### In Scope
- New `category_budgets` table (user_id, category_slug, month YYYY-MM, amount) with RLS own-row policies
- Extend `monthly_category_totals` RPC via LEFT JOIN to return `budget_limit` (nullable) — preserving exact return shape
- Wire existing `CategoryBudgetRow.limit` prop (currently unused) with RPC `budget_limit` values
- Extend `CategoryBudgetCard` with `limit` prop + progress bar coloring (green/yellow/red thresholds)
- New `/settings/category-budgets.tsx` settings screen: list of 13 categories, editable amount inputs, upsert persistence
- Link from profile settings screen to the new category-budgets screen
- Subtle CTA on "Tus tendencias" category breakdown when no budgets are configured

### Out of Scope
- Push notifications for budget alerts
- Changes to global budget (`profiles.monthly_budget` untouched)
- Recurring auto-reset (budgets are per-month by design)
- Multi-currency budgets
- Budget suggestions or auto-limits

## Capabilities

### New Capabilities
- `category-budgets`: Per-category monthly budget configuration, RPC integration, and UI display (settings screen, progress bars, empty state CTA)

### Modified Capabilities
- `data-access`: Extended `monthly_category_totals` RPC return shape adds `budget_limit` field (backward-compatible nullable addition)

## Approach

**Schema**: New `category_budgets` table with `UNIQUE(user_id, category_slug, month)`. Budgets are per-month — deleting a row removes the budget for that month. No FK to `categories` table; slug alignment enforced by client registry (`EXPENSE_CATEGORIES`).

**Data layer**: Extend existing `monthly_category_totals` RPC with LEFT JOIN to `category_budgets` on `(user_id, category_slug, month)`. Returns `budget_limit` as nullable — zero extra round-trips. New read function `getUserCategoryBudgets(month)` + `useCategoryBudgets(month)` hook for the settings screen.

**UI wiring**: Pass `budget_limit` from RPC result to existing `CategoryBudgetRow.limit` and new `CategoryBudgetCard.limit`. Progress bar colors: green (<70%), yellow (70–100%), red (>100%). Empty state shows "Configurar presupuestos" CTA linking to the new settings screen.

**Settings screen**: Follows `/settings/budget.tsx` pattern. List of all 13 categories from `EXPENSE_CATEGORIES`, each with a numeric input. "Guardar" button upserts all non-zero amounts to `category_budgets` in one batch.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | New migration: `category_budgets` table + RPC extension |
| `src/features/analytics/api.ts` | Modified | `monthly_category_totals` result type gains `budget_limit` field |
| `src/features/analytics/hooks/` | New | `useCategoryBudgets(month)` hook |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Modified | Wire `limit` prop from RPC, add progress bar coloring |
| `src/features/home/components/CategoryBudgetCard.tsx` | Modified | Add `limit` prop + ProgressBar |
| `src/app/settings/category-budgets.tsx` | New | Budget configuration list screen |
| `src/app/(tabs)/profile.tsx` | Modified | Add navigation row for category budgets |
| `src/features/analytics/` | Modified | Empty-state CTA in category breakdown section |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| RPC migration breaks existing consumers | Low | Preserve exact return shape; `budget_limit` is additive nullable field only |
| Slug mismatch between client registry and DB | Low | Use same 13 slugs from `EXPENSE_CATEGORIES`; validate in settings UI |
| Settings screen batch upsert race condition | Low | Upsert is idempotent; single user, single write |

## Rollback Plan

1. Revert the migration (drop `category_budgets` table, restore original RPC)
2. Remove new settings screen and navigation link
3. Revert `CategoryBudgetRow` / `CategoryBudgetCard` limit prop wiring
4. Remove `useCategoryBudgets` hook and empty-state CTA

All changes are additive — no existing functionality is modified, only extended. Rollback is clean deletion with no data migration concerns.

## Dependencies

- Existing `monthly_category_totals` RPC (stable, already in production)
- `EXPENSE_CATEGORIES` client registry (stable, 13 canonical categories)
- TanStack Query (already wired for analytics hooks)

## Success Criteria

- [ ] User can set a monthly budget per category via the settings screen
- [ ] Category rows in "Tus tendencias" show spend-vs-limit with color-coded progress bars
- [ ] No budgets configured → subtle CTA appears; budgets configured → progress bars show
- [ ] RPC migration preserves exact return shape of `monthly_category_totals` for existing consumers
- [ ] `pnpm typecheck` passes with zero errors
