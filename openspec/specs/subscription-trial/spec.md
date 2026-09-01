# Subscription Trial Specification

## Purpose

Trial activation, lifecycle management, DB state, gate expansion with frozen-state write blocking, and trial status display for the Ticketify paywall.

## Requirements

### Requirement: Trial Activation

The system MUST expose a `start_free_trial()` RPC that sets `trial_ends_at = now() + 5 days` and `subscription_status = 'trial'` on the user's profile. The RPC MUST validate one-trial-per-user: if `trial_ends_at IS NOT NULL` (any previous trial exists), the RPC MUST reject with an error. On success, the client store MUST update `isTrialing = true`, `trialEndsAt`, and `subscriptionStatus` immediately.

#### Scenario: First-time trial activation

- GIVEN a user with `trial_ends_at = null` and `subscription_status = 'none'`
- WHEN the user taps "Start free trial" on the paywall
- THEN `start_free_trial()` RPC is called
- AND `trial_ends_at` is set to 5 days from now
- AND `subscription_status` becomes `'trial'`
- AND the client store reflects `isTrialing = true`

#### Scenario: One-trial-per-user constraint

- GIVEN a user with `trial_ends_at` already set (prior trial started or completed)
- WHEN the user taps "Start free trial"
- THEN the RPC rejects with a descriptive error
- AND `subscription_status` and `trial_ends_at` remain unchanged

#### Scenario: Existing Pro user cannot start trial

- GIVEN a user with `subscription_status = 'active'` (paid subscriber)
- WHEN the user views the paywall
- THEN the "Start free trial" CTA is not shown
- AND the paywall displays the current active subscription status

### Requirement: Trial Expiry Detection

The system MUST detect trial expiry at three points: (1) on every app launch, (2) when the app returns to foreground, and (3) via periodic check while the app is active. Expiry is computed by comparing `trial_ends_at` against the current server time. When `now() >= trial_ends_at` and `subscription_status = 'trial'`, the system MUST transition `subscription_status` to `'expired'`.

#### Scenario: Expiry detected on launch

- GIVEN a user with `subscription_status = 'trial'` and `trial_ends_at` in the past
- WHEN the app launches
- THEN `subscription_status` transitions to `'expired'`
- AND the client store reflects `isTrialing = false`

#### Scenario: Expiry detected on foreground

- GIVEN a user mid-trial whose `trial_ends_at` passes while the app is backgrounded
- WHEN the app returns to foreground
- THEN `subscription_status` transitions to `'expired'`

#### Scenario: Active trial remains valid

- GIVEN a user with `subscription_status = 'trial'` and `trial_ends_at` in the future
- WHEN any expiry check runs
- THEN `subscription_status` remains `'trial'`
- AND no state transition occurs

### Requirement: Frozen Gate State

The gate system MUST expand `GateState` to include `'frozen'`. When `subscription_status = 'expired'`, the gate MUST return `'frozen'`. Frozen state allows all reads to succeed without restriction. All writes within gated features MUST be blocked.

#### Scenario: Frozen state blocks writes

- GIVEN a user with `subscription_status = 'expired'`
- WHEN the user attempts a write action in a gated feature (scan, edit profile, edit budgets, manage household)
- THEN the write is blocked
- AND a frozen-state overlay is displayed with an upgrade CTA

#### Scenario: Frozen state allows reads

- GIVEN a user with `subscription_status = 'expired'`
- WHEN the user views analytics, profile, or household data
- THEN all data loads and displays normally

### Requirement: Trial Status Display

The profile screen MUST display a trial countdown when `subscription_status = 'trial'` showing days remaining and an expiry date. The paywall screen MUST show the current trial status and remaining time.

#### Scenario: Active trial countdown

- GIVEN a user with `subscription_status = 'trial'` and 3 days remaining
- WHEN the profile screen renders
- THEN a trial status banner shows days remaining and expiry date

#### Scenario: Frozen user sees upgrade prompt

- GIVEN a user with `subscription_status = 'expired'`
- WHEN the profile screen renders
- THEN a frozen-state banner is displayed with upgrade CTA
- AND the banner clearly communicates that writes are restricted

### Requirement: State Transitions

The `subscription_status` field MUST support exactly these transitions: `none → trial` (via `start_free_trial` RPC), `trial → active` (via RevenueCat INITIAL_PURCHASE webhook), `trial → expired` (via expiry detection or RevenueCat webhook), `none → active` (direct purchase, existing flow). No other transitions are permitted. A `NONE → expired` transition MUST NOT occur.

#### Scenario: Trial-to-paid conversion

- GIVEN a user with `subscription_status = 'trial'`
- WHEN RevenueCat sends INITIAL_PURCHASE webhook
- THEN `subscription_status` transitions to `'active'`
- AND `trial_ends_at` is preserved but no longer relevant to gating

#### Scenario: Invalid transition rejected

- GIVEN a user with `subscription_status = 'active'`
- WHEN `start_free_trial()` is called
- THEN the RPC rejects (cannot start trial from active subscription)
