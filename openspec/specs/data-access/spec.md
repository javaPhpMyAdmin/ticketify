# Data Access Specification

## Purpose

Authenticated reads for the existing feature APIs (profile, budget, tickets, analytics): real database rows for the signed-in user whenever a session exists. Purchase/receipt writes persist real rows (Phase 5, scope amendment 2026-08-07): the save action inserts `purchases` + `purchase_items` for the signed-in user. Image upload to storage stays out of scope.

## Requirements

### Requirement: Authenticated Data Reads

Each feature read API (profile, budget, tickets, analytics) MUST read real Supabase data for the signed-in user through the server-state layer when a session exists. There MUST be no fixture fallback and no demo branch: reads are authenticated-only, cached per user under user-scoped keys, deduplicated across concurrent mounts, and retried on transient failure per the server-state retry policy. Feature hooks MUST NOT hardcode a user id. A failed read MUST surface a detectable error state and MUST NOT cache as success.

#### Scenario: Signed-in reads

- GIVEN a signed-in session
- WHEN a feature hook fetches data
- THEN the data comes from Supabase for the signed-in user

#### Scenario: Failed read

- GIVEN a session whose read fails transiently
- WHEN a feature hook fetches data
- THEN the read is retried up to the retry budget
- AND a detectable error state is surfaced
- AND the app does not crash

#### Scenario: Definitive failure surfaces immediately

- GIVEN a read resolves missing-profile or unconfigured
- WHEN a feature hook fetches data
- THEN the error state surfaces with no retry
- AND no success entry is cached for the key

#### Scenario: Cached read within the freshness window

- GIVEN a read that resolved within its staleTime
- WHEN the same hook mounts again
- THEN no new Supabase request is issued
- AND the cached data is returned

#### Scenario: Concurrent mounts are deduplicated

- GIVEN two components mounting the same hook at the same time
- WHEN both trigger the read
- THEN exactly one Supabase request is issued
- AND both receive the same cached result

### Requirement: Profile Reads

Profile reads MUST return the authenticated user's profile row including `trial_ends_at` (nullable timestamp) and `subscription_status` (text enum: `'none' | 'trial' | 'active' | 'expired'`). These fields MUST be present in the profile response regardless of subscription state. A missing-profile state MUST still be surfaced when the row does not exist.

(Previously: Profile reads return the profile row without subscription fields.)

#### Scenario: Profile read includes subscription fields

- GIVEN a signed-in user with `trial_ends_at = '2026-08-23T00:00:00Z'` and `subscription_status = 'trial'`
- WHEN the profile is read
- THEN the database row for the signed-in user is returned
- AND `trial_ends_at` and `subscription_status` are present in the response

#### Scenario: New user defaults

- GIVEN a signed-in user with no prior profile (first sign-up)
- WHEN the profile is read
- THEN `trial_ends_at` is `null`
- AND `subscription_status` is `'none'`

#### Scenario: Existing Pro user backward compatible

- GIVEN a signed-in user with `subscription_status = 'active'` (pre-existing paid user)
- WHEN the profile is read
- THEN `trial_ends_at` is `null`
- AND `subscription_status` is `'active'`
- AND all other profile fields return unchanged

#### Scenario: Missing profile still surfaces error

- GIVEN a signed-in user with no profile row
- WHEN the profile is read
- THEN the missing-profile state is surfaced
- AND subscription fields are not present

### Requirement: Budget Reads

Budget reads MUST return the monthly budget and currency from the signed-in user's profile row.

#### Scenario: Budget read

- GIVEN a signed-in user
- WHEN the monthly budget is read
- THEN the value stored in the profile row is returned

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

### Requirement: Purchase Writes Persist Real Rows

Purchase and receipt writes MUST persist real rows for the signed-in user: the save action inserts the `purchases` row and its `purchase_items` rows. The client MUST resolve item category slugs to `categories.id` uuids before inserting. Storage upload for the ticket image stays out of scope in this change. A failed write MUST surface a detectable error state and MUST NOT report success.

#### Scenario: Purchase save persists rows

- GIVEN a signed-in user
- WHEN the user triggers purchase save
- THEN a `purchases` row is inserted for the user
- AND its `purchase_items` rows are inserted with resolved `category_id` uuids
- AND the save returns the new purchase id

#### Scenario: Purchase save failure

- GIVEN a write that fails (network, constraint, missing session)
- WHEN the user triggers purchase save
- THEN a detectable error state is surfaced
- AND no partial success is reported
