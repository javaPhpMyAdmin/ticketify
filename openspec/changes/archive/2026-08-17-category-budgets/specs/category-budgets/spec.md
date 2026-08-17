# Category Budgets Specification

## Purpose

Per-category monthly budget configuration and display: users set spending limits per category per month, view spend-vs-limit progress bars in analytics screens, and manage budgets from a dedicated settings screen.

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

Category rows in "Tus tendencias" (both `CategoryBudgetRow` and `CategoryBudgetCard`) MUST display a progress bar when `budget_limit` is non-null. The progress bar color MUST be green when spend < 70% of limit, yellow when spend is 70–100% of limit, and red when spend > 100% of limit. When `budget_limit` is null, no progress bar is shown — only the spend amount.

#### Scenario: Spend under 70% of budget

- GIVEN a category with spend $30,000 and budget $50,000 (60%)
- WHEN the category row renders
- THEN the progress bar is green
- AND the text shows "$30.000 de $50.000"

#### Scenario: Spend at 85% of budget

- GIVEN a category with spend $42,500 and budget $50,000 (85%)
- WHEN the category row renders
- THEN the progress bar is yellow

#### Scenario: Spend exceeds 100% of budget

- GIVEN a category with spend $60,000 and budget $50,000 (120%)
- WHEN the category row renders
- THEN the progress bar is red
- AND the text shows "$60.000 de $50.000"

#### Scenario: No budget set (null)

- GIVEN a category with spend $10,000 and `budget_limit = null`
- WHEN the category row renders
- THEN no progress bar is shown
- AND the text shows only the spend amount

### Requirement: Category Budget Settings Screen

A new `/settings/category-budgets` screen MUST list all 13 categories from `EXPENSE_CATEGORIES`, each with a numeric input for the monthly limit. A "Guardar" button MUST upsert all non-zero amounts to `category_budgets` in a single batch for the current month. Zero-valued inputs MUST be treated as "no budget" and delete the corresponding row.

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
