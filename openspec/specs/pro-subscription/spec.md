# Pro Subscription Specification

## Purpose

Server-side tier model, tier-aware scan quota, RevenueCat webhook ledger, subscription lifecycle, and RLS posture for the Ticketify paywall and gating system. Covers the database layer and RPCs that enforce the Pro/Free access boundary; client-side gate infrastructure, charts, meters, and UI are out of scope (covered by other specs).

## Requirements

### Requirement: Tier Model

The system SHALL expose a `profiles.tier` column with exactly two allowed values: `'free'` and `'pro'`. Tier is a server-authoritative access-control primitive — it MUST NOT be written by the client. The `set_profile_tier(uuid, text)` RPC is the sole legitimate tier writer and MUST be SECURITY DEFINER, owned by `postgres`. The RPC MUST validate the tier value against the allowlist `('free', 'pro')` and reject anything else before touching either table. On grant (`p_tier = 'pro'`), the RPC MUST atomically set `profiles.tier = 'pro'`, `profiles.subscription_status = 'active'`, clear `profiles.trial_ends_at`, and normalize `scan_usage.scans_limit = NULL` for current and future months. On revoke (`p_tier = 'free'`), the RPC MUST set `profiles.tier = 'free'`, `profiles.subscription_status` to `'expired'` (if current is `'trial'`) or `'none'` (otherwise), clear `trial_ends_at`, and set `scan_usage.scans_limit = 15` for current and future months. Past months are historical snapshots and MUST NOT be rewritten.

(REQ-PRO-1..5, REQ-SYNC-5)

#### Scenario: Pro grant normalizes scan limit

- GIVEN a free user with `scans_limit = 15` for the current month
- WHEN `set_profile_tier(user_id, 'pro')` is called via service_role
- THEN `profiles.tier = 'pro'` and `scan_usage.scans_limit = NULL` for current and future months
- AND the `protect_profile_tier` trigger allows the write (current_user = 'postgres')

#### Scenario: Revoke re-imposes free cap

- GIVEN a Pro user with `scans_limit = NULL` for the current month
- WHEN `set_profile_tier(user_id, 'free')` is called
- THEN `profiles.tier = 'free'` and `scan_usage.scans_limit = 15` for current and future months
- AND `subscription_status` is set to `'expired'` (if was `'trial'`) or `'none'` (if was `'none'` or `'expired'`)

#### Scenario: Invalid tier rejected

- GIVEN any user
- WHEN `set_profile_tier(user_id, 'invalid')` is called
- THEN the RPC raises an exception before touching either table

#### Scenario: Missing profile raises P0002

- GIVEN a user_id with no corresponding row in `profiles` (never-signed-in user)
- WHEN `set_profile_tier(user_id, 'pro')` is called
- THEN the RPC raises an exception with SQLSTATE `P0002`

### Requirement: Tier-Aware Scan Quota

The system SHALL maintain a `scan_usage` table with a nullable `scans_limit` column (default 15). A `scans_limit = NULL` row is the Pro unlimited marker; a numeric value is the free cap. The `try_consume_scan(user_id, year_month)` RPC SHALL be tier-aware: it reads `profiles.tier` server-side, and the guarded UPDATE accepts the increment when `v_tier = 'pro'` OR `scans_used < coalesce(scans_limit, 15)`. The `coalesce` defends against any row that drifted out of the normalization invariant. On success, the RPC returns `(true, scans_used, scans_limit)`. When the cap is reached, the RPC returns `(false, scans_used, scans_limit)` — it MUST NOT raise. The RPC is service-role only (REVOKE from anon/authenticated).

(REQ-QUOTA-1..7)

#### Scenario: Pro user consumes unlimited

- GIVEN a Pro user with `scans_limit = NULL` for the current month
- WHEN `try_consume_scan` is called
- THEN the UPDATE succeeds and returns `(true, scans_used, NULL)`

#### Scenario: Free user reaches cap

- GIVEN a free user with `scans_used = 15` and `scans_limit = 15`
- WHEN `try_consume_scan` is called
- THEN the RPC returns `(false, 15, 15)` — no exception raised

#### Scenario: New month row respects tier

- GIVEN a Pro user with no row for the target month
- WHEN `try_consume_scan` is called for a new month
- THEN the INSERT creates a row with `scans_limit = NULL` (Pro marker), not the default 15

#### Scenario: Race at boundary

- GIVEN a free user at `scans_used = 14` with `scans_limit = 15`
- WHEN two concurrent `try_consume_scan` calls arrive
- THEN exactly one succeeds (scans_used becomes 15) and one returns `(false, 15, 15)`

### Requirement: Save-Time Scan Consumption

The system SHALL expose a `consume_scan_on_save()` RPC that atomically consumes one scan slot scoped to `auth.uid()` at the point of purchase save (not at parse time). The RPC is SECURITY DEFINER and callable by `authenticated`. It reads `profiles.tier` server-side via a correlated subselect in the UPDATE to prevent TOCTOU drift. The RPC returns `(ok, scans_used, scans_limit)` and MUST NOT raise when the cap is reached.

#### Scenario: Successful save consumes one slot

- GIVEN a free user with `scans_used = 5` and `scans_limit = 15`
- WHEN `consume_scan_on_save()` is called
- THEN `scans_used` becomes 6 and the RPC returns `(true, 6, 15)`

#### Scenario: Save at cap returns false

- GIVEN a free user at `scans_used = 15`
- WHEN `consume_scan_on_save()` is called
- THEN the RPC returns `(false, 15, 15)` — no exception

### Requirement: Subscription Lifecycle

The system SHALL maintain `profiles.subscription_status` with exactly four states: `'none'`, `'trial'`, `'active'`, `'expired'`. The `start_free_trial()` RPC SHALL activate a 5-day trial for the authenticated user: set `trial_ends_at = now() + 5 days`, `subscription_status = 'trial'`, `tier = 'pro'`, and normalize `scan_usage.scans_limit = NULL` for all non-NULL rows. The RPC MUST enforce one-trial-per-user: reject if `trial_ends_at IS NOT NULL`, `subscription_status = 'active'`, `subscription_status = 'expired'`, or `ever_paid = true`. The `sync_subscription_status(user_id, status, trial_ends_at?)` RPC SHALL be called by the RevenueCat webhook (service-role only) to update `subscription_status` and optionally `trial_ends_at`. It is SECURITY DEFINER and bypasses the `protect_profile_tier` trigger.

(REQ-PRO-1..5)

#### Scenario: First-time trial activation

- GIVEN a user with `trial_ends_at = NULL`, `subscription_status = 'none'`, `ever_paid = false`
- WHEN the user calls `start_free_trial()`
- THEN `trial_ends_at` is set to 5 days from now
- AND `subscription_status = 'trial'` and `tier = 'pro'`
- AND `scan_usage.scans_limit = NULL` for all existing non-NULL rows

#### Scenario: Trial already used

- GIVEN a user with `trial_ends_at = '2026-08-01'` (prior trial)
- WHEN the user calls `start_free_trial()`
- THEN the RPC rejects with `'free trial already used'`

#### Scenario: Ever-paid user cannot trial

- GIVEN a user with `ever_paid = true`
- WHEN the user calls `start_free_trial()`
- THEN the RPC rejects with `'free trial not available after paid subscription'`

#### Scenario: Expired subscription blocks trial

- GIVEN a user with `subscription_status = 'expired'`
- WHEN the user calls `start_free_trial()`
- THEN the RPC rejects with `'free trial already used'`

#### Scenario: Webhook syncs subscription status

- GIVEN a user with `subscription_status = 'trial'`
- WHEN the RevenueCat webhook calls `sync_subscription_status(user_id, 'active')`
- THEN `subscription_status` becomes `'active'` and `trial_ends_at` is preserved

### Requirement: Ever-Paid Flag

The system SHALL maintain a `profiles.ever_paid` boolean column (NOT NULL, default false) that is monotonic — once set to true, it MUST NOT be unset. The flag is set only server-side by the `mark_ever_paid(user_id)` RPC (SECURITY DEFINER, service-role only). It is backfilled from existing active paid profiles and webhook_events ledger rows for `INITIAL_PURCHASE`, `RENEWAL`, or `UNCANCELLATION` event types. The `ever_paid` flag is used by `start_free_trial()` to prevent former paid users from starting a free trial.

#### Scenario: Webhook marks ever_paid

- GIVEN a user with `ever_paid = false`
- WHEN a RevenueCat `INITIAL_PURCHASE` webhook calls `mark_ever_paid(user_id)`
- THEN `ever_paid` becomes `true`
- AND a subsequent `start_free_trial()` call is rejected

#### Scenario: Client cannot set ever_paid

- GIVEN any authenticated user
- WHEN the user attempts to UPDATE `ever_paid` on their profile
- THEN the `protect_profile_tier` trigger rejects the write

### Requirement: Webhook Events Ledger

The system SHALL maintain a `webhook_events` table keyed by `(user_id, event_id)` as a composite primary key. Columns: `event_ts timestamptz`, `event_type text`, `applied_at timestamptz default now()`. The ledger is the idempotency and ordering source of truth for RevenueCat webhook processing: the webhook inserts with `ON CONFLICT DO NOTHING` and checks whether a row was returned. No row returned = already-seen event = 200 no-op. After a successful insert, the webhook checks `max(event_ts)` for the user; if `event_ts < max(event_ts)`, the event is out-of-order and treated as a 200 no-op. An index on `(user_id, event_ts desc)` makes the ordering query index-only. RLS is enabled: authenticated users may SELECT their own rows only (`auth.uid() = user_id`). No write policy exists — all inserts go through service_role which bypasses RLS. The table has no retention policy (small, grows monotonically).

(REQ-SYNC-1..7)

#### Scenario: Duplicate event deduplicated

- GIVEN a user with an existing `(user_id, event_id)` row in `webhook_events`
- WHEN the webhook delivers the same event again (retry)
- THEN the INSERT returns no row (ON CONFLICT DO NOTHING)
- AND the webhook returns 200 no-op

#### Scenario: Out-of-order event skipped

- GIVEN a user with `max(event_ts) = '2026-08-15T10:00:00Z'` in `webhook_events`
- WHEN a webhook delivers an event with `event_ts = '2026-08-14T10:00:00Z'`
- THEN the INSERT succeeds (new event_id)
- BUT the ordering check detects `event_ts < max(event_ts)`
- AND the webhook returns 200 no-op without calling `set_profile_tier`

#### Scenario: User can read own ledger

- GIVEN a user with rows in `webhook_events`
- WHEN the user queries the table via authenticated client
- THEN their own rows are returned
- AND other users' rows are not visible

### Requirement: RLS Posture — Server-Managed Columns

The `protect_profile_tier` trigger SHALL fire on every INSERT and UPDATE to `profiles` and enforce that `tier`, `subscription_status`, `trial_ends_at`, and `ever_paid` are managed exclusively by SECURITY DEFINER functions. The trigger recognizes `current_user = 'postgres'` (the SECURITY DEFINER owner) and allows the write; every other role is rejected. INSERT guards: `tier` must be `'free'` (the default), `subscription_status` must be `'none'`, `trial_ends_at` must be NULL, `ever_paid` must be false. UPDATE guards: none of the four columns may change. The `profiles_update_own` RLS policy (0008) allows authenticated users to update their own profile row with `auth.uid() = id` — but the trigger blocks any change to the server-managed columns, so only non-server-managed fields (e.g., `full_name`, `monthly_budget`) pass through.

(REQ-SYNC-5, REQ-PROF-1..3)

#### Scenario: Authenticated user updates allowed field

- GIVEN an authenticated user updating their own profile
- WHEN the user sets `full_name = 'New Name'`
- THEN the update succeeds
- AND the trigger allows it (server-managed columns are unchanged)

#### Scenario: Authenticated user rejected on tier

- GIVEN an authenticated user
- WHEN the user attempts to set `tier = 'pro'` on their own profile
- THEN the trigger raises `'tier is managed server-side'`

#### Scenario: Authenticated user rejected on subscription_status

- GIVEN an authenticated user
- WHEN the user attempts to set `subscription_status = 'active'`
- THEN the trigger raises `'subscription_status is managed server-side'`

#### Scenario: Authenticated user rejected on ever_paid

- GIVEN an authenticated user
- WHEN the user attempts to set `ever_paid = true`
- THEN the trigger raises `'ever_paid is managed server-side'`

#### Scenario: Raw service_role UPDATE rejected

- GIVEN a direct service_role UPDATE of `profiles.tier`
- WHEN the UPDATE executes
- THEN the trigger fires with `current_user = 'service_role'` (not 'postgres')
- AND the trigger rejects the write

### Requirement: Monthly Totals Cache Integration

The pro-subscription smoke test (0011 + 0015) SHALL verify that `monthly_user_totals` cache table and `recalculate_monthly_totals` RPC exist as catalog objects. The `monthly_user_totals` table provides materialized spend totals maintained by a Postgres trigger on `purchases`. The cache is NOT written by the quota or tier system — it is maintained independently by the `trigger_recalculate_monthly_totals` trigger. The pro-subscription SQL smoke test covers the cache as a dependency check; the cache's full behavior is specified in the Monthly Totals Cache specification.

#### Scenario: Smoke test verifies cache exists

- GIVEN a scratch database with all migrations applied
- WHEN the pro-subscription smoke test runs
- THEN assertions confirm `monthly_user_totals` table exists
- AND assertions confirm `recalculate_monthly_totals` function exists
