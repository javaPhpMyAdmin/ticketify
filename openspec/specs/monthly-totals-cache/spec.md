# Monthly Totals Cache Specification

## Purpose

Replace client-side aggregation from paginated `useReceiptsStore` with a server-side materialized cache table. Every analytics screen reads from `monthly_user_totals` to guarantee complete totals regardless of how much the user has scrolled through the infinite feed.

## Requirements

### Requirement: Cache Table Schema

The system SHALL create a `monthly_user_totals` table with composite primary
key `(user_id, year_month, currency)`.

Columns: `currency` (the row's ISO 4217 unit), `total` (numeric),
`category_totals` (jsonb), `store_totals` (jsonb), `daily_totals` (jsonb),
`items_count` (integer), `updated_at` (timestamptz). The `year_month` column
stores `YYYY-MM` format strings. One row holds one unit: `total` and every
jsonb column aggregate only purchases of that month whose effective currency
(their recorded unit, or the viewer's profile currency for legacy unit-less
rows) matches the row's `currency`. Existing cache rows are re-keyed under the
profile currency current at migration time — relabeled only long enough to
satisfy the NOT NULL key swap, then TRUNCATED: their totals were computed
under the old single-row contract and may have summed across units, so no
stale cross-unit sum survives the reshape. Cache rows are derived data, so
the dropped rows are lazily recomputed one row per recorded unit on the next
read (client cache-miss one-shot recalc or the purchases trigger). No
`purchases` row is ever rewritten (relabel-not-rewrite; pinned by the
household-totals smoke fixture (k)).

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/monthly-totals-cache/spec.md`. Previously: primary key `(user_id, year_month)` — one row per user/month whose unit-less `total` merged every currency the month contained.

#### Scenario: New month receipt inserted

- GIVEN a user has no existing cache row for `2026-08`
- WHEN a purchase recorded in `USD` is inserted for that user in `2026-08`
- THEN the trigger creates a row keyed `(user, 2026-08, USD)` with aggregated
  values for that month, and it is the only row for that month
- AND `updated_at` is set to `now()`

#### Scenario: Switch month yields one row per unit

- GIVEN user `abc` has `UYU` purchases and `CLP` purchases in `2026-08`
- WHEN `recalculate_monthly_totals('abc', '2026-08')` runs
- THEN the month has exactly two rows: `(abc, 2026-08, UYU)` and
  `(abc, 2026-08, CLP)`
- AND each row's `total` and jsonb columns hold only that row's unit

#### Scenario: Existing month updated

- GIVEN a user has a `USD` cache row for `2026-07` with total `$500`
- WHEN a purchase in `2026-07` is updated (amount changed)
- THEN the trigger calls `recalculate_monthly_totals` for that user/month
- AND the `(user, 2026-07, USD)` row is upserted with the recalculated total
  and `updated_at = now()`

#### Scenario: Receipt deleted

- GIVEN user `abc` has three `USD` purchases in `2026-06`
- WHEN one of those purchases is deleted
- THEN the trigger recalculates and upserts the `(abc, 2026-06, USD)` row
- AND that row equals the sum of the two remaining purchases, with
  `updated_at` refreshed

#### Scenario: Pre-reshape rows are relabeled, then truncated, never rewritten

- GIVEN user `abc` has a cache row `(abc, 2026-07)` written before this change
  and profile currency `UYU`
- WHEN the reshape migration runs
- THEN the legacy row is temporarily relabeled `(abc, 2026-07, UYU)` to satisfy
  the NOT NULL key swap
- AND that row is then TRUNCATED — its pre-reshape total may have summed across
  units, so no stale cross-unit sum survives the migration
- AND the row is lazily recomputed one row per recorded unit on the next read
  (client cache-miss one-shot recalc or the purchases trigger)
- AND no `purchases` row gains a currency from the migration

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

The system SHALL expose a PostgreSQL function
`recalculate_monthly_totals(p_user_id uuid, p_year_month text, p_household_id uuid DEFAULT NULL)`
that aggregates from `purchases` + `purchase_items`. Aggregation is grouped
by the recorded currency of each purchase in both scopes: amounts of different
units MUST NEVER be summed into one figure, and the recalculated result SHALL
expose one subtotal per unit present. When `p_household_id` is provided, the
function SHALL aggregate across all household members
(`profiles.household_id = p_household_id`). The function SHALL upsert into
`monthly_user_totals`.

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/monthly-totals-cache/spec.md`. Previously: aggregation summed unit-less amounts, so a mid-month profile currency switch or a mixed-currency household produced one arithmetically wrong number.

#### Scenario: Personal recalculation

- GIVEN user `abc` has purchases in `2026-08` all recorded in one currency
- WHEN `recalculate_monthly_totals('abc', '2026-08')` is called
- THEN the cache row for `(abc, 2026-08)` in that unit contains the sum of all
  purchase totals
- AND `category_totals` contains per-category aggregates as `{slug: {total, count}}`
- AND `store_totals` contains per-store aggregates as `{store_id: {total, count}}`
- AND `daily_totals` contains per-day aggregates as `{YYYY-MM-DD: total}`
- AND `items_count` equals the total number of purchase_items across all purchases

#### Scenario: Personal recalculation after a mid-month currency switch

- GIVEN user `abc` recorded `UYU` receipts before changing their profile
  currency mid-month and `CLP` receipts after
- WHEN `recalculate_monthly_totals('abc', '2026-08')` is called
- THEN the cached result carries a `UYU` subtotal and a `CLP` subtotal
- AND no stored value adds `UYU` amounts to `CLP` amounts

#### Scenario: Household recalculation

- GIVEN household `h1` has members `abc` and `def`, all purchases in one currency
- WHEN `recalculate_monthly_totals('abc', '2026-08', 'h1')` is called
- THEN the function aggregates purchases from BOTH `abc` and `def`
- AND the result is stored with `user_id = 'abc'` (the calling user)

#### Scenario: Household recalculation across mixed currencies

- GIVEN household `h1` where `abc` recorded `UYU` purchases and `def`
  recorded `CLP` purchases in `2026-08`
- WHEN `recalculate_monthly_totals('abc', '2026-08', 'h1')` is called
- THEN the result stored for `abc` exposes a `UYU` subtotal and a `CLP`
  subtotal
- AND no stored value merges the two units

#### Scenario: Empty month

- GIVEN user `abc` has zero purchases in `2025-01` and profile currency `UYU`
- WHEN `recalculate_monthly_totals('abc', '2025-01')` is called
- THEN exactly one cache row exists for that month, keyed `(abc, 2025-01, UYU)` —
  the caller's profile currency — with `total = 0`, empty jsonb objects, and
  `items_count = 0`
- AND no other currency row exists for that month

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

Client hooks SHALL read from `monthly_user_totals` via a lightweight Supabase
query or dedicated hook. The `useMonthlyTotals` hook SHALL read
`category_totals` and `total` from the cache row instead of calling the
`monthly_category_totals` RPC. The `useMonthlyOverview` hook SHALL read
`total` from the cache row instead of calling `readMonthlyPurchasesTotal`.
Charts aggregations (`aggregateSpendTrend`, `aggregateDailySpend`,
`aggregateStoresByMonth`, `aggregateDailyAverage`) SHALL
read from the cache's jsonb columns instead of deriving from
`useReceiptsStore`.

Surface class decides how a mixed month renders (product decision 9).
Headline and aggregated surfaces — the overview, the hero card, and the
category breakdown — SHALL read the per-currency subtotals and render them
grouped, one labeled figure per unit. Single-series surfaces — the run-rate,
the 6-month trend (`aggregateSpendTrend`), and the daily/store charts
(`aggregateDailySpend`, `aggregateDailyAverage`, `aggregateStoresByMonth`) —
SHALL bind the viewer-currency row only and render exactly one figure: never
split into per-currency series (chart redesign rejected) and never hidden
when the month is mixed (hiding rejected). On a month where the viewer
switched currency mid-month these surfaces therefore show only the
viewer-currency group's amounts: the under-report is an accepted product
limitation, not a defect. Single-currency months keep the single-figure
behavior on every surface.

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/monthly-totals-cache/spec.md`. Previously: hooks always read one `total`, so a mixed-currency month rendered one figure labeled as if it were a single currency.

#### Scenario: Charts display correct totals

- GIVEN user has 50 receipts in `2026-08` but only scrolled through 10 (2 pages)
- WHEN the Pro charts screen renders
- THEN the hero card total shows the sum of ALL 50 receipts
- AND category breakdown shows correct per-category totals from cache

#### Scenario: Mixed-currency month renders grouped

- GIVEN a cached month whose purchases span `UYU` and `CLP`
- WHEN the analytics screen renders its overview and category breakdown
- THEN each aggregate appears once per unit, labeled with that unit
- AND no rendered figure combines `UYU` and `CLP` amounts

#### Scenario: Single-series charts bind the viewer-currency group

- GIVEN a cached month with a `UYU` row and a `CLP` row and viewer profile
  currency `UYU`
- WHEN the analytics screen renders the 6-month trend, the daily chart, and
  the store chart
- THEN each renders one series from the `UYU` row only
- AND no chart is hidden or split into per-currency series

#### Scenario: Switch-month under-report is accepted

- GIVEN a month where the viewer switched from `UYU` to `CLP` mid-month, so
  the cache holds both rows and the viewer currency is now `CLP`
- WHEN the run-rate and the 6-month trend render that month
- THEN they show only the `CLP` row's amounts for that month
- AND the `UYU` group's amounts are omitted there — an accepted limitation,
  not a defect — while headline surfaces still show both groups

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
