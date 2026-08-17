# Delta for Data Access

## MODIFIED Requirements

### Requirement: Ticket and Analytics Reads

Ticket (scan usage) and analytics (monthly category totals) reads MUST return data for the signed-in user. The system MUST support one scan usage row per user and month, and category totals MUST be scoped to the signed-in user (`monthly_category_totals` RPC). The `monthly_category_totals` RPC MUST return a `budget_limit` field (nullable numeric) alongside existing fields, produced by a LEFT JOIN to `category_budgets` on `(user_id, category_slug, month)`. The return shape MUST preserve all existing fields — `budget_limit` is additive only.

(Previously: category totals read without budget_limit)

#### Scenario: Scan usage read

- GIVEN a signed-in user
- WHEN scan usage is read for a month
- THEN the signed-in user's row for that month is returned

#### Scenario: Category totals read

- GIVEN a signed-in user
- WHEN monthly category totals are read
- THEN only the signed-in user's totals are returned

#### Scenario: Category totals include budget_limit

- GIVEN a signed-in user with a budget set for "supermercado" in the queried month
- WHEN `monthly_category_totals` is called
- THEN the "supermercado" row includes `budget_limit` equal to the stored amount
- AND all other existing fields remain unchanged

#### Scenario: Category without budget returns null budget_limit

- GIVEN a signed-in user with no budget for "snacks" in the queried month
- WHEN `monthly_category_totals` is called
- THEN the "snacks" row includes `budget_limit = null`
