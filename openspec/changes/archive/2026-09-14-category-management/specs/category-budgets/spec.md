# Delta for Category Budgets

Delta over the main capability (`openspec/specs/category-budgets/spec.md`). Custom user categories join the budget catalog: the settings screen lists them and rollover carries their limits forward. Requirements not listed below are unchanged.

## MODIFIED Requirements

### Requirement: Category Budget Settings Screen

A `/settings/category-budgets` screen MUST list the dynamic category catalog — the 13 canonical `EXPENSE_CATEGORIES` plus the caller's custom categories — each with a numeric input for the monthly limit. Custom categories SHALL appear with their own label and color from their DB row. A "Guardar" button MUST upsert all non-zero amounts to `category_budgets` in a single batch for the current month. Zero-valued inputs MUST be treated as "no budget" and delete the corresponding row. The system MUST use the local `currentMonthKey()` as the single month key when reading and saving settings budgets, so the saved month always equals the displayed month in every timezone.
(Previously: the screen listed only the 13 `EXPENSE_CATEGORIES` — custom slugs had no input row.)

#### Scenario: Set budgets for multiple categories

- GIVEN the user is on the category-budgets settings screen for 2026-08
- WHEN the user enters $50,000 for "supermercado" and $20,000 for "snacks" and taps "Guardar"
- THEN both rows are upserted into `category_budgets` for month 2026-08

#### Scenario: Set a budget for a custom category

- GIVEN the user has a 'delivery' custom category and is on the settings screen for 2026-08
- WHEN the user enters $10,000 for "Delivery" and taps "Guardar"
- THEN a row is upserted for `category_slug = 'delivery'`, month 2026-08, amount 10000
- AND the input displays the custom label and color, not a fallback

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

### Requirement: Monthly Budget Rollover

When the current month has no budget rows for a category, the system MUST copy the previous month's limits as the current month's defaults at first read of the month. Limp: opening the app on the 1st with last month's budgets set MUST NOT leave the current month empty. The copies SHALL be explicit current-month rows (user-editable), not view-time fallbacks: editing or deleting them SHALL affect only the current month. Delete-on-zero (v1) SHALL keep applying to copied rows. Rollover MUST be a client-side lazy upsert, idempotent, and MUST only copy for slugs present in the dynamic category catalog — the 13 canonical `EXPENSE_CATEGORIES` slugs plus the caller's custom category rows. Rollover SHALL be one-shot per month across sessions and devices (persisted `rollover_applied` marker + sentinel row). Household mode SHALL remain unchanged (R3-S1): rollover and the client-side merge apply to the caller's own rows only; household `budget_limit` continues to come from the server-side aggregation and the household screens keep their v1 behavior.
(Previously: rollover only copied `EXPENSE_CATEGORIES` slugs, so custom budgets never carried forward.)

#### Scenario: Copy previous month on first read

- GIVEN the user has a $50,000 "supermercado" budget for 2026-08 and no rows for 2026-09
- WHEN the app first reads budgets for 2026-09
- THEN a $50,000 "supermercado" row is upserted for 2026-09
- AND progress bars for 2026-09 display that limit

#### Scenario: Custom budget carried forward

- GIVEN the user has a $10,000 'delivery' custom-category budget for 2026-08 and no rows for 2026-09
- WHEN rollover runs for 2026-09
- THEN a $10,000 'delivery' row is upserted for 2026-09 (custom slug is in the dynamic catalog)

#### Scenario: Rollover preserves user changes on revisit

- GIVEN rollover copied $50,000 into 2026-09 and the user edits it to $60,000
- WHEN the app re-reads 2026-09 budgets on a later visit
- THEN the row stays $60,000 — rollover MUST NOT re-copy or overwrite it

#### Scenario: Category removed from the catalog is not copied

- GIVEN a previous-month budget for a slug no longer in the dynamic catalog (a canonical slug dropped from `EXPENSE_CATEGORIES` or a deleted custom category)
- WHEN rollover runs
- THEN no row is created for that slug

#### Scenario: Rows exist — no rollover

- GIVEN the current month already has at least one budget row
- WHEN budgets are read
- THEN rollover does not run and all current-month rows are untouched

#### Scenario: Marker prevents re-rollover on a later session

- GIVEN rollover already ran for 2026-09 (marker + sentinel written)
- WHEN the app reads 2026-09 budgets again in a new session
- THEN no copies are created again — `readCategoryBudgets` still returns the sentinel row, so the `budgets.length > 0` gate stops the rollover before it can copy (the sentinel never surfaces to the UI because consumers iterate the dynamic catalog or filter `amount > 0`)