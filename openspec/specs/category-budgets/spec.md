# Category Budgets Specification

## Purpose

Per-category monthly budget configuration and display: users set spending limits per category per month, view spend-vs-limit progress bars in both personal and household modes across History, Analytics, and Pro charts, and manage budgets from a dedicated settings screen. Budgets carry forward automatically at month rollover (one-shot, idempotent, user-editable). Month keys derive from the device-local calendar so settings saves always match the displayed month in every timezone.

## Requirements

### Requirement: Category Budget Storage

The system MUST persist per-category monthly budgets in a `category_budgets` table with columns `user_id` (uuid, FK profiles), `category_slug` (text), `month` (text, YYYY-MM format), and `amount` (numeric 12,2). A UNIQUE constraint on `(user_id, category_slug, month)` MUST enforce one budget per category per month. Row-level security MUST restrict access to own rows only (`auth.uid() = user_id` on select, insert, update, delete).

#### Scenario: Set a budget for a category

- GIVEN a signed-in user with no budget for "supermercado" in 2026-08
- WHEN the user saves a $50,000 budget for "supermercado" 2026-08
- THEN a row is inserted into `category_budgets` with `user_id`, `category_slug = 'supermercado'`, `month = '2026-08'`, `amount = 50000`

#### Scenario: Update an existing budget (upsert)

- GIVEN a signed-in user with a $50,000 budget for "supermercado" 2026-08
- WHEN the user saves a $60,000 budget for "supermercado" 2026-08
- THEN the existing row is updated to `amount = 60000`
- AND no duplicate row is created

#### Scenario: Delete a budget

- GIVEN a signed-in user with a $50,000 budget for "supermercado" 2026-08
- WHEN the user removes the budget (sets amount to 0 or explicit delete)
- THEN the row is deleted from `category_budgets`
- AND no budget is returned for that category/month

#### Scenario: RLS blocks cross-user access

- GIVEN user A has a budget row
- WHEN user B queries `category_budgets`
- THEN user B sees zero rows (no budget data from other users)

### Requirement: Category Budgets Read via RPC

The existing `monthly_category_totals` RPC MUST be extended to LEFT JOIN `category_budgets` on `(user_id, category_slug, month)` and return a `budget_limit` field (nullable numeric). The return shape MUST preserve all existing fields — `budget_limit` is an additive nullable column only.

#### Scenario: Category with budget set

- GIVEN user has a $50,000 budget for "supermercado" in 2026-08
- WHEN `monthly_category_totals('2026-08')` is called
- THEN the "supermercado" row includes `budget_limit = 50000`

#### Scenario: Category without budget set

- GIVEN user has no budget for "snacks" in 2026-08
- WHEN `monthly_category_totals('2026-08')` is called
- THEN the "snacks" row includes `budget_limit = null`

#### Scenario: Existing consumers unaffected

- GIVEN a client consuming `monthly_category_totals` before this change
- WHEN the extended RPC is called
- THEN all original fields return unchanged
- AND `budget_limit` is an additional nullable field

### Requirement: Category Budget Progress Display

Category spend rows MUST display a progress bar whenever `budget_limit` is non-null, in BOTH modes: personal mode (History `CategoryBudgetCard`, Analytics `CategoryBudgetRow`, Pro charts) via limits injected into the cache-backed totals, and household mode via the RPC field (unchanged). The bar color MUST come from a single shared `budgetProgressColor` function: green below 70% of limit, amber at 70–100%, red at or above 100% (matching v1 component behavior — `ratio >= 1` → red). When `budget_limit` is null, no bar renders — only the spend amount.

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

A new `/settings/category-budgets` screen MUST list all 13 categories from `EXPENSE_CATEGORIES`, each with a numeric input for the monthly limit. A "Guardar" button MUST upsert all non-zero amounts to `category_budgets` in a single batch for the current month. Zero-valued inputs MUST be treated as "no budget" and delete the corresponding row. The system MUST use the local `currentMonthKey()` as the single month key when reading and saving settings budgets, so the saved month always equals the displayed month in every timezone.

#### Scenario: Set budgets for multiple categories

- GIVEN the user is on the category-budgets settings screen for 2026-08
- WHEN the user enters $50,000 for "supermercado" and $20,000 for "snacks" and taps "Guardar"
- THEN both rows are upserted into `category_budgets` for month 2026-08

#### Scenario: Clear a budget via zero input

- GIVEN the user has a $50,000 budget for "supermercado" 2026-08
- WHEN the user clears the input to 0 and taps "Guardar"
- THEN the "supermercado" row for 2026-08 is deleted

#### Scenario: Settings screen is accessible from profile

- GIVEN the user is on the profile/settings screen
- WHEN the user taps "Presupuestos por categoría"
- THEN the app navigates to `/settings/category-budgets`

#### Scenario: UTC-x user saves in display month

- GIVEN a user in UTC-3 on 2026-09-01 20:00 (UTC date 2026-09-02, local date 2026-09-01)
- WHEN the user saves a budget in settings
- THEN the row stores month `2026-09` (local), matching the displayed month

#### Scenario: Saved budgets read back for current month

- GIVEN a budget saved via settings for the current month
- WHEN the settings screen reloads
- THEN the input shows the saved amount for that same month key

### Requirement: Empty State CTA

When NO category budgets are configured for the current month (all `budget_limit` values are null), the category breakdown section MUST display a subtle CTA: "Configurar presupuestos" that navigates to `/settings/category-budgets`. When at least one budget is configured, the CTA MUST NOT appear.

#### Scenario: No budgets configured shows CTA

- GIVEN the user has no category budgets for the current month
- WHEN the category breakdown section renders
- THEN a "Configurar presupuestos" CTA is visible

#### Scenario: At least one budget configured hides CTA

- GIVEN the user has a budget for "supermercado" in the current month
- WHEN the category breakdown section renders
- THEN the CTA is not shown

### Requirement: Month Switch Recomputes Budgets

When the user switches to a different month, the budget display MUST recompute: progress bars, budget_limit values, and the empty-state CTA MUST reflect the selected month's data. Budgets are per-month — a budget set for 2026-08 MUST NOT appear when viewing 2026-07.

#### Scenario: Different month shows different budgets

- GIVEN the user has budgets set for 2026-08 but not 2026-07
- WHEN the user switches to 2026-07
- THEN all `budget_limit` values are null
- AND the empty-state CTA appears

#### Scenario: Return to month with budgets

- GIVEN the user switched to 2026-07 (no budgets) and then back to 2026-08 (has budgets)
- WHEN 2026-08 re-renders
- THEN progress bars and budget_limit values reappear correctly

### Requirement: Monthly Budget Rollover

When the current month has no budget rows for a category, the system MUST copy the previous month's limits as the current month's defaults at first read of the month. Limp: opening the app on the 1st with last month's budgets set MUST NOT leave the current month empty. The copies SHALL be explicit current-month rows (user-editable), not view-time fallbacks: editing or deleting them SHALL affect only the current month. Delete-on-zero (v1) SHALL keep applying to copied rows. Rollover MUST be a client-side lazy upsert, idempotent, and MUST only copy for existing `EXPENSE_CATEGORIES` slugs. Rollover SHALL be one-shot per month across sessions and devices (persisted `rollover_applied` marker + sentinel row). Household mode SHALL remain unchanged (R3-S1): rollover and the client-side merge apply to the caller's own rows only; household `budget_limit` continues to come from the server-side aggregation and the household screens keep their v1 behavior.

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

#### Scenario: Marker prevents re-rollover on a later session

- GIVEN rollover already ran for 2026-09 (marker + sentinel written)
- WHEN the app reads 2026-09 budgets again in a new session
- THEN no copies are created again — `readCategoryBudgets` still returns the sentinel row, so the `budgets.length > 0` gate stops the rollover before it can copy (the sentinel never surfaces to the UI because consumers iterate `EXPENSE_CATEGORIES` or filter `amount > 0`)

## Non-Functional Requirements

### NFR-1: Performance

Budget surfacing and rollover MUST add zero new backend calls per screen — both reuse the existing `readCategoryBudgets` read; all computation SHALL be synchronous pure functions over already-fetched rows.

### NFR-2: Timezone and month-key consistency

Settings and display SHALL derive the month key from the device-local calendar only (`currentMonthKey()`); `utcYearMonth()` SHALL NOT be used for reading or saving budgets anywhere.

### NFR-3: Accessibility

Progress bars SHALL expose an accessibility label with spend and limit values; the no-budget state MUST NOT leave empty focusable regions.

### NFR-4: Color and formatting consistency

Color thresholds SHALL be identical in every consumer (single shared function); currency/copy formatting SHALL match v1.

## Acceptance Gates

1. `pnpm typecheck` passes.
2. Harness(es) defined in design/tasks pass (exact harness list deferred to sdd-design).
3. Manual — personal surfacing: with budgets set, History, Analytics, and Pro charts show bars in all three colors; with none set, no bars anywhere.
4. Manual — rollover: fresh month with no rows shows previous month's limits on first open; editing them persists; deleting them keeps them deleted on revisit.
5. Manual — timezone: in a UTC-x timezone at a month boundary, settings save matches the display month.
6. Manual — consistency: Card and Row render identical colors for the same ratio.
