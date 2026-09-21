# Delta for Data Access

## MODIFIED Requirements

### Requirement: Profile Reads

Profile reads MUST return the authenticated user's profile row including `subscription_status` (text enum: `'none' | 'active'`). The field MUST be present in the profile response regardless of subscription state. A missing-profile state MUST still be surfaced when the row does not exist.

(Previously: Profile reads returned `trial_ends_at` (nullable timestamp) and `subscription_status` enum `'none' | 'trial' | 'active' | 'expired'`. `trial_ends_at` is dropped from `profiles`; the enum narrows to `'none' | 'active'`. Trial information is now sourced from `CustomerInfo` in `REQ-PRO-TRIAL-PILL` (pro-subscription).)

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

## ADDED Requirements

### Requirement: Trial Cutover Backfill (REQ-DATA-TRIAL-CUTOVER)

The cutover migration MUST flip every profile with `subscription_status = 'trial'` to `(subscription_status = 'active', tier = 'pro', trial_ends_at = NULL)` BEFORE the column drops. The backfill MUST be idempotent: it MUST only update rows still in `'trial'` (never overwrite a row that has already moved to `'active'` or `'none'`). The backfill MUST run BEFORE the CHECK is narrowed so existing rows remain representable. After the backfill, no new `'trial'` rows are ever produced because `start_free_trial()` is dropped (`REQ-DATA-RPC-TRIAL-REMOVAL`).

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
