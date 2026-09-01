# Monthly Totals Cache Specification

## Purpose

Replace client-side aggregation from paginated `useReceiptsStore` with a server-side materialized cache table. Every analytics screen reads from `monthly_user_totals` to guarantee complete totals regardless of how much the user has scrolled through the infinite feed.

## Requirements

### Requirement: Cache Table Schema

The system SHALL create a `monthly_user_totals` table with composite primary key `(user_id, year_month)`.

Columns: `total` (numeric), `category_totals` (jsonb), `store_totals` (jsonb), `daily_totals` (jsonb), `items_count` (integer), `updated_at` (timestamptz). The `year_month` column stores `YYYY-MM` format strings.

#### Scenario: New month receipt inserted

- GIVEN a user has no existing cache row for `2026-08`
- WHEN a purchase is inserted for that user in `2026-08`
- THEN the trigger creates a new `monthly_user_totals` row with aggregated values for that month
- AND `updated_at` is set to `now()`

#### Scenario: Existing month updated

- GIVEN a user has a cache row for `2026-07` with total `$500`
- WHEN a purchase in `2026-07` is updated (amount changed)
- THEN the trigger calls `recalculate_monthly_totals` for that user/month
- AND the cache row is upserted with the recalculated total

#### Scenario: Receipt deleted

- GIVEN a user has a cache row for `2026-06`
- WHEN a purchase in `2026-06` is deleted
- THEN the trigger recalculates and upserts the cache row
- AND if no purchases remain, `total` is set to `0` and all jsonb columns are empty objects

### Requirement: Trigger on Purchases Table

The system SHALL create a PostgreSQL AFTER trigger on `public.purchases` for INSERT, UPDATE, and DELETE events. The trigger SHALL extract `user_id` and `year_month` from the affected row and call `recalculate_monthly_totals`.

For UPDATE events, the trigger SHALL also recalculate the previous month if `year_month` changed (e.g., receipt date corrected).

#### Scenario: Trigger fires on insert

- GIVEN the trigger is installed on `purchases`
- WHEN a new purchase row is inserted
- THEN `recalculate_monthly_totals` is called with the purchase's `user_id` and `year_month`
- AND the cache row for that user/month is upserted

#### Scenario: Trigger handles month change on update

- GIVEN a purchase exists with `year_month = '2026-07'`
- WHEN the purchase is updated to `year_month = '2026-08'`
- THEN the trigger recalculates BOTH `2026-07` and `2026-08`

### Requirement: Recalculate RPC

The system SHALL expose a PostgreSQL function `recalculate_monthly_totals(p_user_id uuid, p_year_month text, p_household_id uuid DEFAULT NULL)` that aggregates from `purchases` + `purchase_items`.

When `p_household_id` is provided, the function SHALL aggregate across all household members (`profiles.household_id = p_household_id`). The function SHALL upsert into `monthly_user_totals`.

#### Scenario: Personal recalculation

- GIVEN user `abc` has 5 purchases in `2026-08`
- WHEN `recalculate_monthly_totals('abc', '2026-08')` is called
- THEN `monthly_user_totals` row for `(abc, 2026-08)` contains the sum of all 5 purchase totals
- AND `category_totals` contains per-category aggregates as `{slug: {total, count}}`
- AND `store_totals` contains per-store aggregates as `{store_id: {total, count}}`
- AND `daily_totals` contains per-day aggregates as `{YYYY-MM-DD: total}`
- AND `items_count` equals the total number of purchase_items across all purchases

#### Scenario: Household recalculation

- GIVEN household `h1` has members `abc` and `def`
- WHEN `recalculate_monthly_totals('abc', '2026-08', 'h1')` is called
- THEN the function aggregates purchases from BOTH `abc` and `def`
- AND the result is stored with `user_id = 'abc'` (the calling user)

#### Scenario: Empty month

- GIVEN user `abc` has zero purchases in `2025-01`
- WHEN `recalculate_monthly_totals('abc', '2025-01')` is called
- THEN the cache row has `total = 0`, empty jsonb objects, and `items_count = 0`

### Requirement: Row-Level Security

The system SHALL enforce RLS on `monthly_user_totals` with a SELECT policy that allows users to read only their own rows (`auth.uid() = user_id`).

#### Scenario: User reads own cache

- GIVEN user `abc` has a cache row for `2026-08`
- WHEN user `abc` queries `monthly_user_totals` filtered by their `user_id`
- THEN the row is returned

#### Scenario: User cannot read other user's cache

- GIVEN user `def` has a cache row for `2026-08`
- WHEN user `abc` queries `monthly_user_totals` filtered by `def`'s `user_id`
- THEN zero rows are returned

### Requirement: Client-Side Read Contract

Client hooks SHALL read from `monthly_user_totals` via a lightweight Supabase query or dedicated hook. The `useMonthlyTotals` hook SHALL read `category_totals` and `total` from the cache row instead of calling the `monthly_category_totals` RPC. The `useMonthlyOverview` hook SHALL read `total` from the cache row instead of calling `readMonthlyPurchasesTotal`.

Charts aggregations (`aggregateSpendTrend`, `aggregateDailySpend`, `aggregateStoresByMonth`, `aggregateDailyAverage`, `getTopCategory`) SHALL read from the cache's jsonb columns instead of deriving from `useReceiptsStore`.

#### Scenario: Charts display correct totals

- GIVEN user has 50 receipts in `2026-08` but only scrolled through 10 (2 pages)
- WHEN the Pro charts screen renders
- THEN the hero card total shows the sum of ALL 50 receipts
- AND category breakdown shows correct per-category totals from cache

#### Scenario: Cache miss fallback

- GIVEN the cache row for a month does not exist (e.g., historical month never triggered)
- WHEN the client reads the cache
- THEN the hook SHALL trigger a one-time `recalculate_monthly_totals` call
- AND show a loading state until the cache row is populated

### Requirement: Migration Naming

The migration file SHALL follow the existing `NNNN_name.sql` pattern. The next available number is `0015`.

#### Scenario: Migration is idempotent-safe

- GIVEN migration `0015_monthly_totals_cache.sql` is applied
- WHEN it runs on a fresh database
- THEN the table, trigger, RPC, and RLS policy are created without error
