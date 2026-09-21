# Delta for Pro Subscription

> **External Dependency (release precondition)** — Play Console + App Store Connect must each have intro offer "Free trial, 7 days" configured per product (monthly + annual). Owner action, gates release. No code task. Rollback: disable intro offers in store dashboards; existing paid users unaffected.

## MODIFIED Requirements

### Requirement: Tier Model

The system SHALL expose a `profiles.tier` column with exactly two allowed values: `'free'` and `'pro'`. Tier is a server-authoritative access-control primitive — it MUST NOT be written by the client. The `set_profile_tier(uuid, text)` RPC is the sole legitimate tier writer and MUST be SECURITY DEFINER, owned by `postgres`. The RPC MUST validate the tier value against the allowlist `('free', 'pro')` and reject anything else before touching either table. On grant (`p_tier = 'pro'`), the RPC MUST atomically set `profiles.tier = 'pro'`, `profiles.subscription_status = 'active'`, and normalize `scan_usage.scans_limit = NULL` for current and future months. On revoke (`p_tier = 'free'`), the RPC MUST set `profiles.tier = 'free'`, `profiles.subscription_status = 'none'`, and set `scan_usage.scans_limit = 15` for current and future months. Past months are historical snapshots and MUST NOT be rewritten.

(Previously: Grant also cleared `profiles.trial_ends_at`; revoke set `'expired'` if current was `'trial'`, else `'none'`.)
(REQ-PRO-1..5, REQ-SYNC-5)

#### Scenario: Pro grant normalizes scan limit

- GIVEN a free user with `scans_limit = 15` for the current month
- WHEN `set_profile_tier(user_id, 'pro')` is called via service_role
- THEN `profiles.tier = 'pro'` and `scan_usage.scans_limit = NULL` for current and future months
- AND `profiles.subscription_status = 'active'`
- AND the `protect_profile_tier` trigger allows the write (current_user = 'postgres')

#### Scenario: Revoke re-imposes free cap

- GIVEN a Pro user with `scans_limit = NULL` for the current month
- WHEN `set_profile_tier(user_id, 'free')` is called
- THEN `profiles.tier = 'free'` and `scan_usage.scans_limit = 15` for current and future months
- AND `subscription_status = 'none'`

#### Scenario: Invalid tier rejected

- GIVEN any user
- WHEN `set_profile_tier(user_id, 'invalid')` is called
- THEN the RPC raises an exception before touching either table

#### Scenario: Missing profile raises P0002

- GIVEN a user_id with no corresponding row in `profiles` (never-signed-in user)
- WHEN `set_profile_tier(user_id, 'pro')` is called
- THEN the RPC raises an exception with SQLSTATE `P0002`

### Requirement: Subscription Lifecycle

The system SHALL maintain `profiles.subscription_status` with exactly two states: `'none'` and `'active'`. The `sync_subscription_status(user_id, status)` RPC SHALL be called by the RevenueCat webhook (service-role only) to update `subscription_status` and is SECURITY DEFINER (bypasses the `protect_profile_tier` trigger). The RPC MUST validate the `status` argument against the allowlist `('none', 'active')` and reject anything else before touching the row. The DB-driven `start_free_trial()` RPC is removed; trial activation is performed exclusively via Play Console / App Store Connect intro offers, surfaced in the app via `REQ-PRO-INTRO-CAPTION`. The `expire_overdue_trials()` RPC is removed; expiry is reconciled from the RevenueCat webhook.

(Previously: Maintained four states `'none' | 'trial' | 'active' | 'expired'`; exposed `start_free_trial()` for a 5-day DB trial with one-trial-per-user enforcement; accepted `trial_ends_at` as an optional `sync_subscription_status` argument.)

#### Scenario: Webhook syncs subscription status to active

- GIVEN a user with `subscription_status = 'none'`
- WHEN the RevenueCat webhook calls `sync_subscription_status(user_id, 'active')`
- THEN `subscription_status` becomes `'active'`

#### Scenario: Webhook rejects out-of-allowlist status

- GIVEN any user
- WHEN the RevenueCat webhook calls `sync_subscription_status(user_id, 'trial')`
- THEN the RPC raises an exception before touching the row

#### Scenario: Webhook revokes to none on expiration

- GIVEN a user with `subscription_status = 'active'`
- WHEN the RevenueCat webhook calls `sync_subscription_status(user_id, 'none')`
- THEN `subscription_status` becomes `'none'`

### Requirement: RLS Posture — Server-Managed Columns

The `protect_profile_tier` trigger SHALL fire on every INSERT and UPDATE to `profiles` and enforce that `tier`, `subscription_status`, and `ever_paid` are managed exclusively by SECURITY DEFINER functions. The trigger recognizes `current_user = 'postgres'` (the SECURITY DEFINER owner) and allows the write; every other role is rejected. INSERT guards: `tier` must be `'free'` (the default), `subscription_status` must be `'none'`, `ever_paid` must be false. UPDATE guards: none of the three columns may change. The `profiles_update_own` RLS policy (0008) allows authenticated users to update their own profile row with `auth.uid() = id` — but the trigger blocks any change to the server-managed columns, so only non-server-managed fields (e.g., `full_name`, `monthly_budget`) pass through.

(Previously: `trial_ends_at` was also server-managed and rejected on UPDATE; INSERT required `trial_ends_at IS NULL`. The trigger now guards three columns instead of four.)
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
- WHEN the user attempts to set `ever_paid = true` on their own profile
- THEN the trigger raises `'ever_paid is managed server-side'`

#### Scenario: Raw service_role UPDATE rejected

- GIVEN a direct service_role UPDATE of `profiles.tier`
- WHEN the UPDATE executes
- THEN the trigger fires with `current_user = 'service_role'` (not 'postgres')
- AND the trigger rejects the write

## ADDED Requirements

### Requirement: Plan Button Intro Caption (REQ-PRO-INTRO-CAPTION)

The paywall `PlanButton` MUST render an intro-offer caption `"X días gratis, después $Y.YY"` ABOVE the recurring price when the package is intro-eligible. The caption source is `getOfferings()`, extended for Android via `product.defaultOption.pricingPhases` filtering `offerPaymentMode === 'FREE_TRIAL'`, and for iOS via `product.discounts[]`. The caption MUST be hidden when `checkTrialOrIntroEligibility(identifier)` returns `INELIGIBLE` or `NO_INTRO_OFFER_EXISTS` for that package. On Android, `UNKNOWN` (always returned by the SDK) keeps the caption visible — Play re-states the intro terms at checkout. The recurring price line below the caption is unchanged.

#### Scenario: Eligible user sees caption above price

- GIVEN an intro-eligible user with offerings loaded for the monthly package
- WHEN the paywall renders the monthly `PlanButton`
- THEN the caption `"7 días gratis, después $X.XX/mes"` appears above the price
- AND the price line shows the post-intro recurring price

#### Scenario: Already-tried user sees no caption

- GIVEN a user who previously used a Play/App Store intro offer
- WHEN the paywall renders the monthly `PlanButton`
- THEN the caption is hidden
- AND tapping the button still launches the native checkout sheet

#### Scenario: No intro offer configured

- GIVEN a product without an introductory offer configured in Play/App Store Connect
- WHEN the paywall renders the `PlanButton`
- THEN no caption is shown
- AND the price is the recurring price only

### Requirement: Profile Trial Pill (REQ-PRO-TRIAL-PILL)

The profile screen MUST display a "trial ends on {{date}}" pill sourced exclusively from `CustomerInfo.entitlements.all.pro` when the active entitlement is in an introductory-price phase. The pill MUST be hidden when the user is not on a trial or after trial conversion (entitlement is on the recurring phase). The pill MUST NOT read `profiles.trial_ends_at` — that column is removed. When the clean trial-end date is not derivable from `CustomerInfo`, the pill degrades to a plain "Pro" tier chip with no countdown.

#### Scenario: Active trial user sees pill

- GIVEN a user with `CustomerInfo.entitlements.all.pro` in introductory-price phase
- WHEN the profile screen renders
- THEN a "trial ends on {{date}}" pill is shown
- AND the date is derived from the entitlement's phase metadata

#### Scenario: Converted user sees no trial pill

- GIVEN a user whose trial has converted to a paid subscription (entitlement on recurring phase)
- WHEN the profile screen renders
- THEN no trial pill is shown
- AND the PRO tier chip is the only subscription indicator

#### Scenario: Non-trial Pro user sees no pill

- GIVEN a paid user whose subscription never had a trial
- WHEN the profile screen renders
- THEN no trial pill is shown

#### Scenario: Pill degrades gracefully when date is not derivable

- GIVEN a user with an active introductory-price phase but no derivable end date from `CustomerInfo`
- WHEN the profile screen renders
- THEN the pill degrades to a plain "Pro" chip (no countdown text)
