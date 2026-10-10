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

Profile reads MUST return the authenticated user's profile row including `subscription_status` (text enum: `'none' | 'active'`). The field MUST be present in the profile response regardless of subscription state. A missing-profile state MUST still be surfaced when the row does not exist.

(Previously: Profile reads returned `trial_ends_at` (nullable timestamp) and `subscription_status` enum `'none' | 'trial' | 'active' | 'expired'`. `trial_ends_at` is dropped from `profiles`; the enum narrows to `'none' | 'active'`. Trial information is now sourced from `CustomerInfo` in `REQ-PRO-TRIAL-PILL` (pro-subscription).)

> Source: change `revenuecat-trial-migration` (archived 2026-09-20). Merged from delta `openspec/changes/archive/2026-09-20-revenuecat-trial-migration/specs/data-access/spec.md`.

#### Scenario: Profile read includes subscription_status

- GIVEN a signed-in user with `subscription_status = 'active'`
- WHEN the profile is read
- THEN the database row for the signed-in user is returned
- AND `subscription_status` is present in the response

#### Scenario: New user defaults

- GIVEN a signed-in user with no prior profile (first sign-up)
- WHEN the profile is read
- THEN `subscription_status` is `'none'`

#### Scenario: Existing Pro user backward compatible

- GIVEN a signed-in user with `subscription_status = 'active'` (pre-existing paid user)
- WHEN the profile is read
- THEN `subscription_status` is `'active'`
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

Purchase and receipt writes MUST persist real rows for the signed-in user: the
save action inserts the `purchases` row — including the receipt's currency
unit (`currency-universality` REQ-8) — and its `purchase_items` rows. The
edit path MUST persist unit corrections under the same catalog rule as the
save path: a code inside `SUPPORTED_CURRENCIES` is stored (normalized), a
code outside it is stored as no unit and MUST NOT fail the edit, and a draft
that carries no unit leaves the stored unit untouched (the update payload
omits the column). Relabel only — an edit never rewrites amounts because of a
unit change. The client MUST resolve item category slugs to `categories.id`
uuids before inserting. Storage upload for the ticket image stays out of
scope in this change. A failed write MUST surface a detectable error state
and MUST NOT report success.

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/data-access/spec.md`. Previously: the insert carried amounts only, with no unit — a foreign receipt persisted as a bare number and inherited the viewer's label at read time.

#### Scenario: Purchase save persists rows with their unit

- GIVEN a signed-in user saving a receipt whose unit is `CLP`
- WHEN the user triggers purchase save
- THEN a `purchases` row is inserted for the user carrying unit `CLP`
- AND its `purchase_items` rows are inserted with resolved `category_id` uuids
- AND the save returns the new purchase id

#### Scenario: Purchase save failure

- GIVEN a write that fails (network, constraint, missing session)
- WHEN the user triggers purchase save
- THEN a detectable error state is surfaced
- AND no partial success is reported

#### Scenario: Purchase edit persists a unit correction

- GIVEN a signed-in user editing a stored receipt whose unit is `CLP`
- WHEN the user switches the unit to `UYU` on review and confirms the edit
- THEN the `purchases` row carries unit `UYU`
- AND every amount on the row is unchanged (relabel only)
- AND a draft unit outside `SUPPORTED_CURRENCIES` is stored as no unit while
  the edit still succeeds
- AND a draft with no unit leaves the stored unit untouched

### Requirement: Trial Cutover Backfill (REQ-DATA-TRIAL-CUTOVER)

The cutover migration MUST flip every profile with `subscription_status = 'trial'` to `(subscription_status = 'active', tier = 'pro', trial_ends_at = NULL)` BEFORE the column drops. The backfill MUST be idempotent: it MUST only update rows still in `'trial'` (never overwrite a row that has already moved to `'active'` or `'none'`). The backfill MUST run BEFORE the CHECK is narrowed so existing rows remain representable. After the backfill, no new `'trial'` rows are ever produced because `start_free_trial()` is dropped (`REQ-DATA-RPC-TRIAL-REMOVAL`).

> Source: change `revenuecat-trial-migration` (archived 2026-09-20). Merged from delta `openspec/changes/archive/2026-09-20-revenuecat-trial-migration/specs/data-access/spec.md`.

#### Scenario: In-window trial user becomes active

- GIVEN a profile with `subscription_status = 'trial'` and `trial_ends_at > now()`
- WHEN the cutover backfill runs
- THEN `subscription_status` becomes `'active'`
- AND `tier` is `'pro'`
- AND `trial_ends_at` is `NULL`

#### Scenario: Past-window trial user already expired

- GIVEN a profile with `subscription_status = 'trial'` and `trial_ends_at <= now()`
- WHEN the cutover backfill runs
- THEN the row is flipped to `(active, pro, trial_ends_at = NULL)` — the user keeps Pro access with no scheduled charge
- AND the migration's pg_cron removal (`REQ-DATA-CRONS-TRIAL-REMOVAL`) prevents any future flip-back

#### Scenario: Idempotent re-run

- GIVEN a database that has already run the cutover backfill
- WHEN the backfill is re-applied
- THEN no rows are updated (the `WHERE subscription_status = 'trial'` clause matches nothing)

#### Scenario: Rollback path within 1 hour

- GIVEN the cutover migration has been applied
- WHEN the rollback migration `0040_rc_trial_rollback.sql` runs within 1 hour
- THEN `trial_ends_at` is re-added nullable
- AND the CHECK is restored to `('none','trial','active','expired')`
- AND `start_free_trial()` and `expire_overdue_trials()` are recreated
- AND pg_cron `trial-expiry` is re-scheduled

### Requirement: Profiles Trial Column Drop (REQ-DATA-PROFILES-TRIAL-COLS)

The cutover migration MUST drop `profiles.trial_ends_at` and narrow the `subscription_status` CHECK to `('none', 'active')`. The column drop MUST be preceded by `ALTER COLUMN trial_ends_at DROP NOT NULL` to keep the rollback path under 1 hour. After the cutover, `trial_ends_at` MUST NOT appear in `information_schema.columns` for `profiles`. `subscription_status` MUST reject any value outside `('none','active')` at the database layer (CHECK constraint).

> Source: change `revenuecat-trial-migration` (archived 2026-09-20). Merged from delta `openspec/changes/archive/2026-09-20-revenuecat-trial-migration/specs/data-access/spec.md`.

#### Scenario: Pre-cutover schema

- GIVEN a database before the cutover migration applies
- WHEN `information_schema.columns` is queried for `profiles`
- THEN `trial_ends_at` is present and nullable
- AND `subscription_status` CHECK accepts `('none','trial','active','expired')`

#### Scenario: Post-cutover schema

- GIVEN a database after the cutover migration applies
- WHEN `information_schema.columns` is queried for `profiles`
- THEN `trial_ends_at` is absent
- AND `subscription_status` CHECK accepts only `('none','active')`

#### Scenario: Direct write of invalid status rejected

- GIVEN any role
- WHEN `UPDATE profiles SET subscription_status = 'trial' WHERE id = ...` runs
- THEN the UPDATE fails with a CHECK constraint violation

### Requirement: Trial RPC Removal (REQ-DATA-RPC-TRIAL-REMOVAL)

The cutover migration MUST drop the `start_free_trial()` and `expire_overdue_trials()` RPCs and revoke EXECUTE from `anon` and `authenticated`. The `sync_subscription_status(user_id, status)` RPC MUST remain but MUST only accept `status IN ('none', 'active')` and reject anything else. The `mark_ever_paid()` RPC stays (still gates former-paid-user behavior). `set_profile_tier()` MUST NOT accept a trial status and MUST normalize `'active'` on grant and `'none'` on revoke.

> Source: change `revenuecat-trial-migration` (archived 2026-09-20). Merged from delta `openspec/changes/archive/2026-09-20-revenuecat-trial-migration/specs/data-access/spec.md`.

#### Scenario: start_free_trial dropped

- GIVEN a database after the cutover migration applies
- WHEN `pg_proc` is queried for `proname = 'start_free_trial'`
- THEN no rows are returned
- AND a client call to `start_free_trial()` returns `function not found`

#### Scenario: expire_overdue_trials dropped

- GIVEN a database after the cutover migration applies
- WHEN `pg_proc` is queried for `proname = 'expire_overdue_trials'`
- THEN no rows are returned
- AND the client bootstrap no longer calls it

#### Scenario: sync_subscription_status rejects trial status

- GIVEN any user
- WHEN the webhook calls `sync_subscription_status(user_id, 'trial')`
- THEN the RPC raises an exception before touching the row

#### Scenario: sync_subscription_status accepts active

- GIVEN a user with `subscription_status = 'none'`
- WHEN the webhook calls `sync_subscription_status(user_id, 'active')`
- THEN `subscription_status` becomes `'active'`

### Requirement: Trial Cron Removal (REQ-DATA-CRONS-TRIAL-REMOVAL)

The cutover migration MUST remove the pg_cron entry that schedules `expire_overdue_trials()`. After removal, no scheduled job runs the trial-expiry logic. The `cron.job` table MUST NOT contain an entry named `trial-expiry` after the cutover. The `pg_cron` extension itself stays (other scheduled jobs remain unaffected).

> Source: change `revenuecat-trial-migration` (archived 2026-09-20). Merged from delta `openspec/changes/archive/2026-09-20-revenuecat-trial-migration/specs/data-access/spec.md`.

#### Scenario: Pre-cutover cron schedule

- GIVEN a database before the cutover
- WHEN `cron.job` is queried for `jobname = 'trial-expiry'`
- THEN a row exists with the every-6-hours schedule

#### Scenario: Post-cutover cron schedule

- GIVEN a database after the cutover
- WHEN `cron.job` is queried for `jobname = 'trial-expiry'`
- THEN no rows are returned

#### Scenario: Rollback restores cron

- GIVEN the rollback migration runs
- WHEN `cron.job` is re-queried
- THEN the `trial-expiry` job is recreated with the original every-6-hours schedule
