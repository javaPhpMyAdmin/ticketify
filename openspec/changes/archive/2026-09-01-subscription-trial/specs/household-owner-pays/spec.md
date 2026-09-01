# Household Owner-Pays Specification

## Purpose

Owner-only subscription requirement for household creation; members participate free of charge; household frozen when owner subscription expires.

## Requirements

### Requirement: Owner Subscription Required for Household Creation

The `create_household` RPC MUST check that the requesting user has `subscription_status = 'active'` OR (`subscription_status = 'trial'` AND `trial_ends_at > now()`). If the owner does not meet this requirement, the RPC MUST reject with a descriptive error. Trial users MAY create households — trial status satisfies the owner-pays rule for the trial duration.

#### Scenario: Active subscriber creates household

- GIVEN a user with `subscription_status = 'active'`
- WHEN the user calls `create_household`
- THEN a household is created with the user as owner

#### Scenario: Trialing user creates household

- GIVEN a user with `subscription_status = 'trial'` and `trial_ends_at` in the future
- WHEN the user calls `create_household`
- THEN a household is created with the user as owner

#### Scenario: Free user cannot create household

- GIVEN a user with `subscription_status = 'none'`
- WHEN the user calls `create_household`
- THEN the RPC rejects with a message indicating Pro is required

#### Scenario: Expired trial user cannot create household

- GIVEN a user with `subscription_status = 'expired'`
- WHEN the user calls `create_household`
- THEN the RPC rejects

### Requirement: Members Join Without Subscription

The `join_household` RPC MUST NOT check the joining user's subscription status. Any authenticated user with a valid invite token MUST be able to join regardless of `subscription_status`. The household membership row is created with the joining user's current tier, but the tier check on the joiner is removed entirely.

#### Scenario: Free user joins household

- GIVEN a free user (`subscription_status = 'none'`) with a valid invite token
- WHEN the user calls `join_household`
- THEN membership is created successfully
- AND the user's `subscription_status` is unaffected

#### Scenario: Expired user joins household

- GIVEN a user with `subscription_status = 'expired'` and a valid invite token
- WHEN the user calls `join_household`
- THEN membership is created successfully

### Requirement: Owner Expiry Freezes Household

When the household owner's `subscription_status` transitions from active/trial to `'expired'`, all household members MUST experience a frozen state: data is visible (reads work), but no member can perform write operations within the household scope. The freeze applies to household-scoped writes (disband, edit settings, remove members) but does NOT affect the member's individual app features.

#### Scenario: Owner trial expires, household freezes

- GIVEN a household with an owner whose `subscription_status` transitions from `'trial'` to `'expired'`
- WHEN any member views the household
- THEN data is visible (members, settings)
- AND write actions (disband, edit, remove) are blocked with a frozen overlay
- AND individual features (scans, profile) for members are unaffected by the household freeze

#### Scenario: Owner renews, household unfreezes

- GIVEN a frozen household whose owner transitions `subscription_status` to `'active'`
- WHEN a member views the household
- THEN write actions are restored

#### Scenario: Non-owner member expiry does not freeze household

- GIVEN a household whose owner is active
- WHEN a non-owner member's individual subscription expires
- THEN the household remains fully functional
- AND only the non-owner member's individual gated features are frozen

### Requirement: Price Differentiation

RevenueCat offerings MUST support both individual and household plan variants. The paywall MUST display the correct price based on the user's context (individual vs household owner). The spec does NOT define pricing — only that the system MUST distinguish between the two plan types for offering display and purchase flow.

#### Scenario: Individual plan shown to standalone user

- GIVEN a user who is not a household owner
- WHEN the paywall renders
- THEN individual plan pricing is displayed

#### Scenario: Household plan shown to household owner

- GIVEN a user who owns a household
- WHEN the paywall renders
- THEN household plan pricing is displayed
