# Data Access Specification

## Purpose

Authenticated reads for the existing feature APIs (profile, budget, tickets, analytics): real database rows for the signed-in user whenever a session exists. Purchase/receipt writes remain out of scope.

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

Profile reads MUST return the authenticated user's profile row and MUST surface a missing-profile state when the row does not exist.

#### Scenario: Profile read

- GIVEN a signed-in user
- WHEN the profile is read
- THEN the database row for the signed-in user is returned

### Requirement: Budget Reads

Budget reads MUST return the monthly budget and currency from the signed-in user's profile row.

#### Scenario: Budget read

- GIVEN a signed-in user
- WHEN the monthly budget is read
- THEN the value stored in the profile row is returned

### Requirement: Ticket and Analytics Reads

Ticket (scan usage) and analytics (monthly category totals) reads MUST return data for the signed-in user. The system MUST support one scan usage row per user and month, and category totals MUST be scoped to the signed-in user (`monthly_category_totals` RPC).

#### Scenario: Scan usage read

- GIVEN a signed-in user
- WHEN scan usage is read for a month
- THEN the signed-in user's row for that month is returned

#### Scenario: Category totals read

- GIVEN a signed-in user
- WHEN monthly category totals are read
- THEN only the signed-in user's totals are returned

### Requirement: Purchase Writes Out of Scope

Purchase and receipt writes MUST remain no-ops in this change: the save action MUST NOT persist data and MUST NOT crash.

#### Scenario: Purchase save attempt

- GIVEN a signed-in user
- WHEN the user triggers purchase save
- THEN no data is persisted
- AND the app responds without crashing
