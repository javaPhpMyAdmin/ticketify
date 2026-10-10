# Delta — household-sharing

> Change: `money-integrity`. Aggregation becomes unit-correct, household
> entry gains a single-currency check, and household surfaces render grouped
> breakdowns. `get_household_feed` is deliberately untouched — dead read
> surface, deferred by the proposal. Open item owned by `sdd-design`, not
> pinned here: `percent_of_total` across two currencies.

## ADDED Requirements

### Requirement: Household Entry Single-Currency Check

A household SHALL have one currency, established at creation from the
creator's profile currency. `join_household` (invite acceptance) MUST reject a
caller whose profile currency differs from the household's currency, creating
no membership row. The check runs ONLY at entry: nothing re-validates a
member's profile currency afterwards, and no membership is revoked by a later
profile-currency change. This check is product simplicity — it keeps most
household views to a single breakdown. It is NOT a correctness guarantee:
sums stay right because aggregation groups by unit, not because this check
exists.

#### Scenario: Creator establishes the household currency

- GIVEN a creator whose profile currency is `UYU`
- WHEN `create_household('Mi hogar')` succeeds
- THEN the household's currency is `UYU`

#### Scenario: Matching currency joins

- GIVEN a household whose currency is `UYU` and a caller with profile currency `UYU`
- WHEN the caller runs `join_household(code)`
- THEN membership is created and `profiles.household_id` is set

#### Scenario: Mismatched currency rejected at entry

- GIVEN a household whose currency is `UYU` and a caller with profile currency `ARS`
- WHEN the caller runs `join_household(code)`
- THEN the join is rejected
- AND no membership row exists and `profiles.household_id` stays NULL

#### Scenario: Enforced only at entry

- GIVEN a member whose profile currency changes after joining
- WHEN they save receipts and other members aggregate the month
- THEN their membership is unchanged and their rows aggregate under the units
  they were recorded in

## MODIFIED Requirements

### Requirement: Household-Scoped Aggregation RPCs

The `monthly_category_totals(p_year_month, p_household_id DEFAULT NULL)` RPC
SHALL accept an optional `p_household_id` parameter. When NULL (default), the
totals are scoped to `auth.uid()`. When set and the caller is a member
(`is_household_member`), totals aggregate across all household members'
purchases. In both scopes, aggregation is grouped by the recorded unit of
each purchase: amounts of different currencies MUST NEVER be summed into one
figure, and the result SHALL expose one subtotal per unit present.
`budget_limit` is only shown in personal mode (NULL in household mode). The
`monthly_purchases_total(p_year_month, p_household_id DEFAULT NULL)` RPC SHALL
follow the same grouping rule: personal when NULL, household-scoped when set.
Non-members calling household-scoped RPCs get zero results (not an error).

(Previously: both RPCs summed unit-less amounts across members and returned a
single figure that the client labeled with the viewer's currency.)

#### Scenario: Personal category totals unchanged

- GIVEN a user calling `monthly_category_totals('2026-08')` without `p_household_id`
  whose recorded purchases are all in one currency
- WHEN the RPC is called
- THEN only the caller's purchases are aggregated and one subtotal per
  category is returned, as today

#### Scenario: Household category totals aggregate members

- GIVEN household `h1` with members `abc` and `def`, all purchases in one currency
- WHEN `monthly_category_totals('2026-08', 'h1')` is called by `abc`
- THEN totals aggregate purchases from both `abc` and `def`
- AND `budget_limit` is NULL for all rows (household mode)

#### Scenario: Mixed-currency household returns subtotals per unit

- GIVEN household `h1` where `abc` recorded purchases in `UYU` and `def`
  recorded purchases in `CLP` during `2026-08`
- WHEN `monthly_category_totals('2026-08', 'h1')` is called by `abc`
- THEN the result exposes the `UYU` amounts and the `CLP` amounts separately
- AND no returned figure adds a `UYU` amount to a `CLP` amount
- AND `budget_limit` is NULL for all rows

#### Scenario: Personal totals group by unit after a currency switch

- GIVEN the caller's own `2026-08` contains rows recorded in `UYU` and rows
  recorded in `CLP`
- WHEN `monthly_category_totals('2026-08')` is called without `p_household_id`
- THEN the result carries a `UYU` subtotal and a `CLP` subtotal
- AND no figure merges the two units

#### Scenario: Non-member gets zero results

- GIVEN a user NOT in household `h1`
- WHEN the user calls `monthly_category_totals('2026-08', 'h1')`
- THEN zero rows are returned

### Requirement: Client-Side Household State

The client SHALL maintain a Zustand household store (`use-household-store`)
with `householdId`, `householdName`, `role`, `members`, and `inviteCode`. The
`useHousehold` hook SHALL fetch household info and members, hydrate the store,
and be enabled only when `household_sharing` is active. The home feed SHALL
render a `HouseholdCard` showing the household name, current-month total, and
member count when a household exists; when the current month spans more than
one currency, the card SHALL show one labeled subtotal per currency instead of
a single figure. The Analytics and History screens SHALL support a
personal/household view toggle that passes `householdId` to the aggregation
RPCs and SHALL render the per-currency breakdown on headline surfaces
(overview, category breakdown) whenever the aggregated data spans more than
one unit; single-series charts bind the viewer-currency group only, per the
`monthly-totals-cache` Client-Side Read Contract (product decision 9).
Refetch-on-focus is implemented via an `AppState` listener that invalidates
household query keys on foreground.

(Previously: the card and the household views rendered one number for the
month, labeled with the viewer's profile currency regardless of what units the
members actually recorded.)

#### Scenario: Household card on home feed

- GIVEN a user with an active household whose month is single-currency
- WHEN the home feed renders
- THEN a `HouseholdCard` shows the household name, current-month total, and
  member count as one figure

#### Scenario: Mixed-currency month renders a grouped breakdown

- GIVEN a household whose month contains `UYU` and `CLP` purchases
- WHEN the home feed renders the `HouseholdCard`
- THEN the card shows a `UYU` subtotal and a `CLP` subtotal, each with its own
  unit label
- AND no single merged figure is displayed

#### Scenario: Analytics household toggle

- GIVEN a user with an active household viewing Analytics
- WHEN the user taps the household toggle
- THEN `monthly_category_totals` is called with `p_household_id`
- AND the chart and overview reflect household-scoped data

#### Scenario: Settings screen shows household management

- GIVEN a user with an active household
- WHEN the user navigates to Settings > Household
- THEN the member list, invite code, leave, and disband (owner) actions are displayed
