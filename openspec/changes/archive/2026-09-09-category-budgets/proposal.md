# Proposal: Category Budgets v2 — Personal Surfacing + Rollover

## Intent

The v1 change (archived 2026-08-17) delivered storage, settings, and household-mode progress bars, but **personal-mode screens never see budget limits** — `transformCacheToCategoryTotals` hardcodes `budget_limit: null`. Additionally, budgets expire at month rollover with no carry-forward, and a UTC/local timezone mismatch causes settings to save under the wrong month key in UTC-x timezones. This delta closes those three gaps so personal-mode users get the same budget visibility as household-mode users.

## Scope

### In Scope
- Wire `budget_limit` into personal-mode History (CategoryBudgetCard), Analytics (CategoryBudgetRow), and Pro charts
- Extract shared `mergeBudgetLimits(totals, budgets, monthKey)` helper + single `budgetProgressColor()` function
- Monthly rollover: copy previous month's limits into new month on first visit (client-side upsert with fallback)
- Unify settings + display month key to `currentMonthKey()` (local) — fix UTC drift bug
- Deduplicate `budgetProgressColor` (currently inline in both Card and Row)

### Out of Scope
- Home banner or notification for budget alerts
- Household-mode changes (already working via RPC)
- Push notifications or alerts
- Budget suggestions, auto-limits, or multi-currency

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `category-budgets`: Personal-mode surfacing (transformCache supplies limits), rollover persistence, shared color logic, UTC fix

## Approach

**Client-side merge**: The RPC already returns `budget_limit` for household. For personal, `transformCacheToCategoryTotals` in `useMonthlyCache.ts` reads budgets via `useCategoryBudgets(month)` and injects real `budget_limit` values into the totals object. A pure helper `mergeBudgetLimits(totals, budgets, monthKey)` returns the totals with `budget_limit` filled per category (unchanged rows when no budget matches), and `budgetProgressColor(ratio)` maps spend/limit ratios to the shared color. Progress bar components consume these instead of computing inline.

**Rollover**: On month mount, if no budgets exist for the target month, read previous month → upsert into current month. Lazy; one idempotence schema addition (migration `0030` — `rollover_applied` marker + sentinel row) so the one-shot survives sessions/devices. Design decision (deferred to design phase): whether this runs in `useCategoryBudgets` hook or a one-shot `useEffect` — resolved: read-path effect in the hook (AD-1).

**UTC fix**: Replace all `utcYearMonth()` calls in settings with `currentMonthKey()`. Single function, no schema change.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/analytics/hooks/useMonthlyCache.ts` | Modified | Inject budget_limit in transformCacheToCategoryTotals |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Modified | Use shared helper + `budgetProgressColor`, remove inline color logic, a11y label |
| `src/features/home/components/CategoryBudgetCard.tsx` | Modified | Use shared helper, remove inline color logic |
| `src/lib/supabase/feature-access.ts` | Modified | Rollover read/write + marker accessor, defensive marker exclusion |
| `supabase/migrations/0030_category_budgets_rollover.sql` | Added | `rollover_applied` marker column + sentinel semantics |
| `src/features/analytics/hooks/useCategoryBudgets.ts` | Modified | Rollover fallback logic |
| `src/app/settings/category-budgets.tsx` | Modified | Fix month key to local |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Multi-category totals double-count with budget | Low | Helper only reads, never mutates cache |
| Categories renamed or removed between months | Low | Upsert only existing `EXPENSE_CATEGORIES` slugs |
| Rollover race on month boundary | Low | Lazy upsert; idempotent; user is on-screen |
| UTC/local divergence persists in edge cases | Med | Single `currentMonthKey()` source; grep for stale `utcYearMonth` |

## Rollback Plan

All changes are additive to existing merged code. Revert the PR commit. Migration `0030` is additive (new column, default false, no backfill) — rolling back the PR leaves the column harmless; a later re-ship is safe because the rollover never touches past months and the column stays idle until the client writes a rollover. Rollover rows can be deleted manually if needed.

## Dependencies

- Archived v1 `category-budgets` change (merged)
- `useCategoryBudgets` hook + `queryKeys.categoryBudgets` (already merged)
- `currentMonthKey()` function (already exists)

## Success Criteria

- [ ] Personal-mode History, Analytics, and Pro charts show progress bars when budgets are set
- [ ] `budgetProgressColor` exists in one place, used by both Card and Row
- [ ] Rollover: opening app in a new month with no budgets → previous month's limits appear
- [ ] UTC-x timezone: settings save matches display month
- [ ] `pnpm typecheck` passes
