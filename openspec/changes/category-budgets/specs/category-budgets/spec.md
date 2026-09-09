# Delta for Category Budgets

Delta v2 over the archived v1 capability (2026-08-17). Closes three gaps: personal-mode screens never surface `budget_limit`, budgets vanish at month rollover, and settings save under a UTC month key that diverges from the local display month. Requirements not listed below are unchanged.

## ADDED Requirements

### Requirement: Monthly Budget Rollover

When the current month has no budget rows for a category, the system MUST copy the previous month's limits as the current month's defaults at first read of the month. Limp: opening the app on the 1st with last month's budgets set MUST NOT leave the current month empty. The copies SHALL be explicit current-month rows (user-editable), not view-time fallbacks: editing or deleting them SHALL affect only the current month. Delete-on-zero (v1) SHALL keep applying to copied rows. Rollover MUST be a client-side lazy upsert, idempotent, and MUST only copy for existing `EXPENSE_CATEGORIES` slugs.

#### Scenario: Copy previous month on first read

- GIVEN the user has a $50,000 "supermercado" budget for 2026-08 and no rows for 2026-09
- WHEN the app first reads budgets for 2026-09
- THEN a $50,000 "supermercado" row is upserted for 2026-09
- AND progress bars for 2026-09 display that limit

#### Scenario: Rollover preserves user changes on revisit

- GIVEN rollover copied $50,000 into 2026-09 and the user edits it to $60,000
- WHEN the app re-reads 2026-09 budgets on a later visit
- THEN the row stays $60,000 — rollover MUST NOT re-copy or overwrite it

#### Scenario: Category removed from list is not copied

- GIVEN a previous-month budget for a slug no longer in `EXPENSE_CATEGORIES`
- WHEN rollover runs
- THEN no row is created for that slug

#### Scenario: Rows exist — no rollover

- GIVEN the current month already has at least one budget row
- WHEN budgets are read
- THEN rollover does not run and all current-month rows are untouched

## MODIFIED Requirements

### Requirement: Category Budget Progress Display

Category spend rows MUST display a progress bar whenever `budget_limit` is non-null, in BOTH modes: personal mode (History `CategoryBudgetCard`, Analytics `CategoryBudgetRow`, Pro charts) via limits injected into the cache-backed totals, and household mode via the RPC field (unchanged). The bar color MUST come from a single shared `budgetProgressColor` function: green below 70% of limit, amber at 70–100%, red at or above 100% (matching v1 component behavior — `ratio >= 1` → red). When `budget_limit` is null, no bar renders — only the spend amount.
(Previously: progress bars computed with inline duplicated color logic; personal-mode cache path hardcoded `budget_limit: null`, so personal screens never showed bars.)

#### Scenario: Personal mode shows bar with limit set

- GIVEN a personal-mode user with spend $30,000 and budget $50,000 for "supermercado" in the current month
- WHEN History/Analytics/Pro-chart category rows render
- THEN `budget_limit` equals 50000 and a green progress bar is shown

#### Scenario: Personal mode hides bar without limit

- GIVEN a personal-mode user with no budget for a category
- WHEN the category row renders
- THEN no progress bar is shown and only the spend amount appears

#### Scenario: Spend exceeds 100% of budget

- GIVEN a category with spend $60,000 and budget $50,000 (120%)
- WHEN the category row renders
- THEN the shared color function returns red

#### Scenario: Household output unchanged

- GIVEN a household-mode user with a budgeted category
- WHEN `monthly_category_totals` renders in a category row
- THEN behavior and colors match v1 — identical thresholds via the shared function

### Requirement: Category Budget Settings Screen

The system MUST replace `utcYearMonth()` with the local `currentMonthKey()` as the single month key when reading and saving settings budgets, so the saved month always equals the displayed month in every timezone.
(Previously: settings saved under `utcYearMonth()` while displays used `currentMonthKey()`, diverging in UTC-x timezones at month boundaries.)

#### Scenario: UTC-x user saves in display month

- GIVEN a user in UTC-3 on 2026-09-01 20:00 (UTC date 2026-09-02, local date 2026-09-01)
- WHEN the user saves a budget in settings
- THEN the row stores month `2026-09` (local), matching the displayed month

#### Scenario: Saved budgets read back for current month

- GIVEN a budget saved via settings for the current month
- WHEN the settings screen reloads
- THEN the input shows the saved amount for that same month key

## Non-Functional Requirements

- **NFR-1 (performance)**: Budget surfacing and rollover MUST add zero new backend calls per screen — both reuse the existing `readCategoryBudgets` read; all computation SHALL be synchronous pure functions over already-fetched rows.
- **NFR-2 (timezone)**: Settings and display SHALL derive the month key from the device-local calendar only (`currentMonthKey()`); `utcYearMonth()` SHALL NOT be used for reading or saving budgets anywhere.
- **NFR-3 (accessibility)**: Progress bars SHALL expose an accessibility label with spend and limit values; the no-budget state MUST NOT leave empty focusable regions.
- **NFR-4 (consistency)**: Color thresholds SHALL be identical in every consumer (single shared function); currency/copy formatting SHALL match v1.

## Acceptance Gates

1. `pnpm typecheck` passes.
2. Harness(es) defined in design/tasks pass (exact harness list deferred to sdd-design).
3. Manual — personal surfacing: with budgets set, History, Analytics, and Pro charts show bars in all three colors; with none set, no bars anywhere.
4. Manual — rollover: fresh month with no rows shows previous month's limits on first open; editing them persists; deleting them keeps them deleted on revisit.
5. Manual — timezone: in a UTC-x timezone at a month boundary, settings save matches the display month.
6. Manual — consistency: Card and Row render identical colors for the same ratio.