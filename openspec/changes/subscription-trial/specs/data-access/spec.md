# Delta for Data Access

## MODIFIED Requirements

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
