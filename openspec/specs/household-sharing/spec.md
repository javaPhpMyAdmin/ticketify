# Household Sharing Specification

## Purpose

Multi-user shared expense tracking: household creation, invite-code join flow, member management, ownership transfer, Level B aggregated reads (totals + categories + store names, no individual items), and the owner-pays subscription rule. Covers the database schema, RPCs, RLS policies, and the server-side aggregation functions that support the household view modes on Home, Analytics, and History screens.

## Requirements

### Requirement: Household Schema

The system SHALL maintain three tables: `households` (id uuid PK, name text, created_by uuid FK→profiles, created_at timestamptz), `household_members` (household_id uuid + user_id uuid composite PK, role text check `('owner','member')` default `'member'`, joined_at timestamptz), and `invite_codes` (id uuid PK, household_id uuid FK→households, code text, created_by uuid FK→profiles, expires_at timestamptz, consumed_by uuid nullable FK→profiles, consumed_at timestamptz, created_at timestamptz). The `profiles` table SHALL have a nullable `household_id uuid` FK→households column (ON DELETE SET NULL). All FKs cascade on parent delete. A `is_household_member(uid uuid, hid uuid)` SECURITY DEFINER helper function returns boolean for RLS policy use.

#### Scenario: Profile linked on join

- GIVEN a user with `profiles.household_id = NULL`
- WHEN the user joins a household via `join_household`
- THEN `profiles.household_id` is set to the household's id

#### Scenario: Profile cleared on leave

- GIVEN a user with `profiles.household_id = 'h1'`
- WHEN the user leaves or the household is disbanded
- THEN `profiles.household_id` becomes NULL (via explicit UPDATE and ON DELETE SET NULL)

### Requirement: RLS Policies

All three household tables SHALL have Row Level Security enabled. `households`: SELECT for members (`is_household_member`), UPDATE/DELETE for owner only (`created_by = auth.uid()`). `household_members`: SELECT for members, INSERT/DELETE for owner. `invite_codes`: INSERT/SELECT for the code creator (`auth.uid() = created_by`), UPDATE for consumption (`consumed_by is null and expires_at > now()` on USING, `auth.uid() = consumed_by` on WITH CHECK). No anonymous access is permitted on any household table.

#### Scenario: Member reads household

- GIVEN a user who is a member of household `h1`
- WHEN the user queries `households` filtered by `h1`
- THEN the row is returned

#### Scenario: Non-member cannot read household

- GIVEN a user who is NOT a member of household `h1`
- WHEN the user queries `households` filtered by `h1`
- THEN zero rows are returned

#### Scenario: Owner can update household

- GIVEN the owner of household `h1`
- WHEN the owner updates `households.name`
- THEN the update succeeds

#### Scenario: Member cannot update household

- GIVEN a non-owner member of household `h1`
- WHEN the member attempts to update `households.name`
- THEN the RLS policy denies the write

### Requirement: Owner-Pays Subscription Rule

Household creation SHALL require the owner to have an active Pro subscription or trial. The `create_household` RPC checks `tier = 'pro' OR subscription_status IN ('trial', 'active')`. If not met, the RPC rejects. Members joining via `join_household` have NO subscription requirement — any authenticated user with a valid invite code may join regardless of tier or subscription_status. The `generate_invite_code` RPC requires ownership of the household but has no subscription check (owner already validated at creation time).

#### Scenario: Active Pro owner creates household

- GIVEN a user with `subscription_status = 'active'`
- WHEN the user calls `create_household('Mi hogar')`
- THEN a household is created with the user as owner

#### Scenario: Trialing user creates household

- GIVEN a user with `subscription_status = 'trial'` and `trial_ends_at` in the future
- WHEN the user calls `create_household('Mi hogar')`
- THEN a household is created

#### Scenario: Free user cannot create household

- GIVEN a user with `subscription_status = 'none'` and `tier = 'free'`
- WHEN the user calls `create_household('Mi hogar')`
- THEN the RPC rejects with `'Pro subscription required to create a household'`

#### Scenario: Free user joins household

- GIVEN a free user (`subscription_status = 'none'`) with a valid invite code
- WHEN the user calls `join_household('ABC123')`
- THEN membership is created successfully

### Requirement: Invite Code Lifecycle

The `generate_invite_code(household_id)` RPC SHALL be owner-only and rate-limited: max 3 unconsumed codes created in the last 24 hours, max 5 members total (owner + 4). The code is a 6-character alphanumeric string (uppercase + digits, ambiguous chars removed). Codes expire after 72 hours. The `join_household(code)` RPC SHALL validate the code is unconsumed and non-expired, enforce the 5-member cap, mark the code as consumed, insert the membership row, and set `profiles.household_id`. Self-invite is prevented by the `household_id IS NOT NULL` guard (the owner already has a household).

#### Scenario: Owner generates code

- GIVEN the owner of a household with 2 members
- WHEN the owner calls `generate_invite_code(household_id)`
- THEN a 6-character code is returned
- AND the code expires in 72 hours

#### Scenario: Rate limit exceeded

- GIVEN the owner with 3 active (unconsumed, < 24h) codes
- WHEN the owner calls `generate_invite_code`
- THEN the RPC rejects with `'too many active invite codes (max 3 per 24h)'`

#### Scenario: Household full

- GIVEN a household with 5 members (owner + 4)
- WHEN any code is used to join
- THEN `join_household` rejects with `'household is full'`

#### Scenario: Expired code rejected

- GIVEN an invite code created 73 hours ago
- WHEN `join_household` is called with that code
- THEN the RPC rejects with `'invalid or expired invite code'`

### Requirement: Leave and Ownership Transfer

The `leave_household()` RPC SHALL remove the caller from their household. If the caller is the owner and other members exist, ownership MUST transfer to the longest-tenured member (lowest `joined_at`): the new owner's role is promoted to `'owner'`, the departing owner's role is demoted to `'member'` before removal, and `households.created_by` is updated. If the caller is the owner and the sole member, the household is disbanded: all `household_members` and `invite_codes` rows for the household are deleted, and the `households` row is deleted. In all cases, `profiles.household_id` is cleared for the departing user.

#### Scenario: Member leaves household

- GIVEN a non-owner member of household `h1`
- WHEN the member calls `leave_household()`
- THEN the membership row is deleted and `profiles.household_id` is cleared

#### Scenario: Owner leaves with members remaining

- GIVEN the owner of household `h1` with 2 other members (longest-tenured joined first)
- WHEN the owner calls `leave_household()`
- THEN the longest-tenured member is promoted to owner
- AND `households.created_by` is updated to the new owner
- AND the departing owner's membership is removed

#### Scenario: Sole owner disbands

- GIVEN the sole owner of household `h1`
- WHEN the owner calls `leave_household()`
- THEN the household, all members, and all invite codes are deleted
- AND `profiles.household_id` is cleared

### Requirement: Disband Household

The `disband_household(household_id)` RPC SHALL be owner-only. It clears `profiles.household_id = NULL` for all members, then deletes `household_members`, `invite_codes`, and `households` rows. The caller must be the household owner; non-owners are rejected.

#### Scenario: Owner disbands household

- GIVEN the owner of household `h1` with 3 members
- WHEN the owner calls `disband_household(h1)`
- THEN all members' `profiles.household_id` become NULL
- AND all `household_members`, `invite_codes`, and the `households` row are deleted

#### Scenario: Non-owner cannot disband

- GIVEN a non-owner member of household `h1`
- WHEN the member calls `disband_household(h1)`
- THEN the RPC rejects with `'only the owner can disband a household'`

### Requirement: Household-Scoped Aggregation RPCs

The `monthly_category_totals(p_year_month, p_household_id DEFAULT NULL)` RPC SHALL accept an optional `p_household_id` parameter. When NULL (default), behavior is unchanged — totals are scoped to `auth.uid()`. When set and the caller is a member (`is_household_member`), totals aggregate across all household members' purchases. `budget_limit` is only shown in personal mode (NULL in household mode). The `monthly_purchases_total(p_year_month, p_household_id DEFAULT NULL)` RPC SHALL follow the same pattern: personal when NULL, household-scoped when set. Non-members calling household-scoped RPCs get zero results (not an error).

#### Scenario: Personal category totals unchanged

- GIVEN a user calling `monthly_category_totals('2026-08')` without `p_household_id`
- WHEN the RPC is called
- THEN only the caller's purchases are aggregated

#### Scenario: Household category totals aggregate members

- GIVEN household `h1` with members `abc` and `def`
- WHEN `monthly_category_totals('2026-08', 'h1')` is called by `abc`
- THEN totals aggregate purchases from both `abc` and `def`
- AND `budget_limit` is NULL for all rows (household mode)

#### Scenario: Non-member gets zero results

- GIVEN a user NOT in household `h1`
- WHEN the user calls `monthly_category_totals('2026-08', 'h1')`
- THEN zero rows are returned

### Requirement: Household Feed

The `get_household_feed(household_id, p_year_month DEFAULT NULL)` RPC SHALL return Level B household receipt data: purchase id, store_name, purchase_date, total, member_name, and category_totals (jsonb per-category breakdown). Individual purchase items are NOT exposed. The caller must be a household member. Results are ordered by `purchase_date desc`. An optional `p_year_month` parameter filters by month.

#### Scenario: Member reads household feed

- GIVEN household `h1` with 2 members, each with purchases in `2026-08`
- WHEN `get_household_feed('h1', '2026-08')` is called by a member
- THEN both members' purchases are returned with store_name, total, member_name, and category_totals
- AND individual purchase items are not included

#### Scenario: Non-member rejected

- GIVEN a user NOT in household `h1`
- WHEN the user calls `get_household_feed('h1')`
- THEN the RPC raises `'Not a household member'`

### Requirement: Client-Side Household State

The client SHALL maintain a Zustand household store (`use-household-store`) with `householdId`, `householdName`, `role`, `members`, and `inviteCode`. The `useHousehold` hook SHALL fetch household info and members, hydrate the store, and be enabled only when `household_sharing` is active. The home feed SHALL render a `HouseholdCard` showing the household name, current-month total, and member count when a household exists. The Analytics and History screens SHALL support a personal/household view toggle that passes `householdId` to the aggregation RPCs. Refetch-on-focus is implemented via an `AppState` listener that invalidates household query keys on foreground.

#### Scenario: Household card on home feed

- GIVEN a user with an active household
- WHEN the home feed renders
- THEN a `HouseholdCard` shows the household name, current-month total, and member count

#### Scenario: Analytics household toggle

- GIVEN a user with an active household viewing Analytics
- WHEN the user taps the household toggle
- THEN `monthly_category_totals` is called with `p_household_id`
- AND the chart and overview reflect household-scoped data

#### Scenario: Settings screen shows household management

- GIVEN a user with an active household
- WHEN the user navigates to Settings > Household
- THEN the member list, invite code, leave, and disband (owner) actions are displayed

### Requirement: Indexes

The system SHALL create the following indexes for household query performance: `idx_household_members_user_id` on `household_members(user_id)`, `idx_invite_codes_household_consumed` on `invite_codes(household_id, consumed_by)`, and `idx_invite_codes_creator_time` on `invite_codes(created_by, created_at)`.
