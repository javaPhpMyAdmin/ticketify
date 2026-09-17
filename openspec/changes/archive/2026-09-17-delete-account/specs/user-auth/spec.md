# Delta for User Auth

> ⚠️ **ARCHIVED DELTA — NOT merged into the parent spec.** This change was partially archived on 2026-09-17. Only `REQ-AUTH-DEL-2` (Account Removal Primitive) was implemented in PR1 (SQL migration, merged to `main` as commit `0d6dd18`). `REQ-AUTH-DEL-1` (In-App Account-Deletion Entry Point) and `REQ-AUTH-DEL-3` (Post-Delete Sign-Out) remain pending in PR3. This file is preserved for design context only; the parent `openspec/specs/user-auth/spec.md` does NOT yet contain these requirements. See `openspec/changes/archive/2026-09-17-delete-account/archive-report.md` for the full status.

This delta modifies `openspec/specs/user-auth/spec.md` to add the in-app account-deletion entry point and the destructive-primitive contract that backs it. Existing sign-up, sign-in, sign-out, password-reset, session-persistence, mandatory-authentication, and bounded-restore requirements are unchanged.

## ADDED Requirements

### Requirement: In-App Account-Deletion Entry Point

The system MUST provide an in-app entry point to a destructive account-erasure flow that an authenticated user can complete without leaving the app or contacting support. The entry point MUST be reachable from the authenticated profile area in a single tap and MUST lead to a screen where the user can confirm and trigger deletion. The destructive primitive underlying this entry point is described in `REQ-AUTH-DEL-2` (Account Removal Primitive) and the behavioral contract of the entry point — including typed-confirmation gating, subscription disclosure, and post-delete sign-out — is defined in the `user-account-deletion` capability (specifically `REQ-ACCTDEL-1`, `REQ-ACCTDEL-2`, and `REQ-ACCTDEL-10`).

#### Scenario: Authenticated user reaches the deletion entry point

- GIVEN an authenticated session
- WHEN the user opens the profile area
- THEN a discoverable, danger-toned control labelled with the current locale's account-deletion copy is visible
- AND tapping the control navigates to the delete-account screen without leaving the app or contacting support

#### Scenario: Unauthenticated user does not see the entry point

- GIVEN no active session
- WHEN any screen renders
- THEN the delete-account entry point is not visible

### Requirement: Account Removal Primitive

The system MUST remove a user's `auth.users` row — and every row that cascades from it on the `profiles → auth.users` chain — when invoked through the security-controlled server-side primitive defined by the `user-account-deletion` capability. This primitive is the single destructive authority for personal-data erasure (see `REQ-ACCTDEL-6`, `REQ-ACCTDEL-7`, `REQ-ACCTDEL-8`, and `REQ-ACCTDEL-9` of `user-account-deletion`). The primitive MUST be invoked exclusively through the `delete-account` edge function under a `service_role` client and MUST NOT be exposed to `anon` or `authenticated` roles directly.

#### Scenario: Hard delete removes auth.users and cascades

- GIVEN a user with rows in `profiles`, `stores`, `purchases`, `purchase_items`, `scan_usage`, `monthly_user_totals`, `category_budgets`, `webhook_events`, `categories` (user rows), `households` (if owner), `household_members`, `invite_codes`, `parse_attempts`, and `<user_id>/*` objects in `storage.objects` (bucket `receipts`)
- WHEN the `delete_user_account(p_user_id)` primitive is invoked
- THEN the `auth.users` row for `p_user_id` is removed
- AND every cascading row is removed in the same transaction
- AND the storage sweep and `parse_attempts` scrub have already run within the same transaction

#### Scenario: RPC privilege boundary is enforced

- GIVEN the `delete_user_account` SECURITY DEFINER function
- WHEN the migration is applied
- THEN EXECUTE is revoked from `PUBLIC`, `anon`, and `authenticated`
- AND EXECUTE is granted only to `service_role`
- AND any `anon` or `authenticated` invocation attempt returns a privilege error

### Requirement: Post-Delete Sign-Out

After the server-side deletion primitive succeeds, the client MUST perform the same local cleanup chain that a normal sign-out would trigger (`queryClient.clear()`, `useReceiptsStore.resetAll()`, `useProStore.reset()`, optional `useHouseholdStore.reset()`, `useSessionStore.session = null`) and MUST route the user to `/auth/sign-in`. The existing `SIGNED_OUT` event listener does NOT fire on hard delete because `supabase.auth.signOut()` is never called; the client MUST therefore run the cleanup chain manually rather than rely on the listener (see `REQ-ACCTDEL-10` of `user-account-deletion`).

#### Scenario: Local cleanup runs after a successful deletion

- GIVEN the server returns `{ ok: true }` from the deletion primitive
- WHEN the client observes the success response
- THEN `useSessionStore.session` becomes `null`
- AND every React Query cache is cleared
- AND every per-user Zustand store is reset
- AND the user lands on `/auth/sign-in`

#### Scenario: SIGNED_OUT listener is not relied upon

- GIVEN a successful deletion where the local `logOutRevenueCat()` and `queryClient.clear()` are wired to the existing SIGNED_OUT listener
- WHEN `supabase.auth.signOut()` is NOT called (because `auth.users` no longer exists, so the JWT is already invalid)
- THEN the SIGNED_OUT listener does not fire
- AND the client invokes the cleanup chain explicitly as part of `deleteAccount()`

#### Scenario: Best-effort local SDK cleanup does not surface errors

- GIVEN the deletion primitive has succeeded
- WHEN the local `logOutRevenueCat()` call throws (network unavailable, SDK error)
- THEN the error is swallowed silently
- AND the user is still routed to `/auth/sign-in`
