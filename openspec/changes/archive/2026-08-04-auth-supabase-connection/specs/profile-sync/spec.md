# Profile Sync Specification

## Purpose

Keeping `public.profiles` in sync with `auth.users`: automatic profile creation on sign-in and verified RLS access to the user's own profile row.

## Requirements

### Requirement: Profile Auto-Creation

On every sign-in (email/password and OAuth), the system MUST ensure a `public.profiles` row exists for the signed-in user, inserting one with `id = auth.uid()` using an upsert that does nothing when the row already exists.

#### Scenario: First sign-in

- GIVEN a user signs in for the first time
- WHEN the profile sync runs
- THEN a profile row with the user's id is created
- AND its default values are applied

#### Scenario: Returning sign-in

- GIVEN a user signs in who already has a profile row
- WHEN the profile sync runs
- THEN the existing row is left unchanged

### Requirement: Profile Read

The system MUST fetch the signed-in user's own profile and MUST surface a clear error state when the row is missing or unreadable. It MUST NOT fall back to fixtures or demo data.

#### Scenario: Profile exists

- GIVEN an authenticated user with a profile row
- WHEN the profile is fetched
- THEN the user's own row is returned

#### Scenario: Profile missing

- GIVEN an authenticated user without a profile row
- WHEN the profile is fetched
- THEN a missing-profile state is shown
- AND no fixture or demo data is shown

### Requirement: RLS Select Verification

The system MUST verify that row-level security permits each authenticated user to select only their own profile row (`auth.uid() = id`) and that selects of other users' rows are denied.

#### Scenario: Own row select

- GIVEN an authenticated user querying their own profile id
- WHEN a select runs
- THEN the user's row is returned

#### Scenario: Another user's row select

- GIVEN an authenticated user
- WHEN a query targets another user's profile id
- THEN no rows are returned
