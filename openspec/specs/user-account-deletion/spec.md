# User Account Deletion Specification

> **Archived 2026-09-17** from change `delete-account`. All 13 requirements (REQ-ACCTDEL-1..13) and the four NFR sections are implemented and verified. See `openspec/changes/archive/2026-09-17-delete-account/archive-report.md` for the merge history (PR1 SQL → PR2 edge → PR3 client → PR4 tests) and the four follow-up items (F1 WARNING + F2/F3/F4 SUGGESTIONs).

## Purpose

A self-service, in-app, irreversible account-erasure flow for ticketify that removes every byte of personal data attached to the caller from local DB, Supabase Storage, and the external RevenueCat identity alias within a single request lifecycle. The capability exists to satisfy the Google Play Data Deletion policy (mandatory before next Play Console submission) and the GDPR Art. 17 right-to-erasure. The action is idempotent, gated behind typed-confirmation, and atomic: either every personal-data surface is removed or none is.

## Requirements

### Requirement: In-App Entry Point

The system MUST expose a discoverable, danger-toned row at the bottom of the authenticated user's profile settings list that opens the account-deletion screen. The entry point MUST be reachable from the signed-in home in a single tap and MUST NOT require leaving the app, contacting support, or visiting an external URL.

#### Scenario: User opens delete-account screen from profile

- GIVEN an authenticated user on the profile tab
- WHEN the user taps the "Eliminar cuenta" / "Delete account" / "Excluir conta" row at the bottom of the settings list
- THEN the app routes to `/settings/delete-account`
- AND no external URL is opened and no support contact is initiated

#### Scenario: Entry point is present for every authenticated user

- GIVEN any authenticated session regardless of tier, subscription state, household membership, or locale
- WHEN the profile screen renders
- THEN the delete-account row is visible and labelled in the user's current locale

### Requirement: Typed-Confirmation Gating

The destructive final action MUST be gated by typed-confirmation: the user must type a literal word (`ELIMINAR` in the es-AR canonical locale; locale-equivalent word for `en` and `pt-BR`) into a text field, case-insensitive and trimmed, before the final button is enabled. The final button MUST be visually danger-toned.

#### Scenario: Final button disabled until typed value matches

- GIVEN the user on the delete-account screen with an empty text field
- WHEN the user taps the final delete button without typing the confirmation word
- THEN the tap is a no-op and the button is visually disabled

#### Scenario: Final button enables only on match

- GIVEN the user has typed a non-matching value (or whitespace-only, or different casing only)
- WHEN the user types the literal confirmation word and trims surrounding whitespace
- THEN the final button becomes enabled
- AND a trailing whitespace, differing casing, or extra characters re-disables the button

#### Scenario: Cancel is always available

- GIVEN the user on the delete-account screen at any state of the typed-confirmation field
- WHEN the user taps the cancel/back control
- THEN the app returns to the profile screen without sending a delete request

### Requirement: Subscription Disclosure

The screen MUST display, before the typed-confirmation step, an informational banner that explains whether the user's Google Play subscription survives deletion. The copy MUST exist in three locales (`en`, `es-AR` canonical, `pt-BR`). For users with an active Pro subscription identified through the existing revenuecat SDK, the banner MUST include a deep-link button that invokes `showManageSubscriptions()` from the existing `mobile/src/lib/revenuecat.ts` module. Free users MUST see the banner without the deep-link button.

#### Scenario: Pro user sees banner with manage-subscriptions link

- GIVEN an authenticated Pro user (`subscription_status` is `active` or `trial`)
- WHEN the delete-account screen renders
- THEN the subscription banner is visible
- AND a "Manage subscription" button is present
- AND tapping that button invokes `showManageSubscriptions()` and does not advance the deletion flow

#### Scenario: Free user sees banner without the link

- GIVEN an authenticated Free user (`subscription_status` is `none`)
- WHEN the delete-account screen renders
- THEN the subscription banner is visible
- AND no "Manage subscription" button is present

### Requirement: Pre-Delete Export Nudge (Pro Only)

For Pro users only, the screen MUST offer a non-destructive primary action "Exportá tus datos antes de eliminar" / equivalent, positioned ABOVE the destructive typed-confirmation flow, that navigates to the existing `/settings/export` route. Free users MUST NOT see the nudge.

#### Scenario: Pro user sees export nudge

- GIVEN an authenticated Pro user on the delete-account screen
- WHEN the screen renders
- THEN an export-nudge control labelled in the user's locale is visible above the typed-confirmation step
- AND tapping the nudge navigates to `/settings/export` without initiating deletion

#### Scenario: Free user does not see export nudge

- GIVEN an authenticated Free user on the delete-account screen
- WHEN the screen renders
- THEN no export-nudge control is visible

### Requirement: Household Owner Pre-Flight

If the caller is the `created_by` of a household that has at least one other active member, the server-side deletion logic MUST reject the operation with the stable error code `household_owner_with_members` and MUST NOT delete any data. The client MUST route the user to `/settings/household` to disband or transfer ownership before retrying. A solo owner (no other active members) MUST NOT be blocked.

#### Scenario: Owner with active members is blocked

- GIVEN an authenticated user who is the household `created_by`
- AND the household has at least one other member in `household_members`
- WHEN the user attempts to delete their account
- THEN the server returns error code `household_owner_with_members`
- AND no row in `auth.users`, `profiles`, `purchases`, `storage.objects`, or any per-user table is removed
- AND the client routes the user to `/settings/household`

#### Scenario: Solo owner is not blocked

- GIVEN an authenticated user who is the household `created_by`
- AND the household has no other members (owner is sole member)
- WHEN the user attempts to delete their account
- THEN the deletion proceeds normally without the pre-flight error

#### Scenario: Non-owner household member is not blocked

- GIVEN an authenticated user who is a non-owner member of a household
- WHEN the user attempts to delete their account
- THEN the deletion proceeds without the household pre-flight error
- AND the user's profile is removed; the household and other members remain intact

### Requirement: Atomic Erasure

The deletion MUST be atomic across every personal-data surface: `auth.users`, every per-user table that cascades from `profiles`, every object under the user's folder in the `receipts` Storage bucket, every row in `parse_attempts` for that user, and the external RevenueCat alias mapped to the user's `app_user_id`. Either all surfaces are removed or none is, within a single transactional scope on the server. The end-to-end RPC invocation MUST complete before the client returns success.

#### Scenario: Cascading tables are wiped in one call

- GIVEN an authenticated user with rows in `profiles`, `stores`, `purchases`, `purchase_items`, `scan_usage`, `monthly_user_totals`, `category_budgets`, `webhook_events`, `households` (where owner), `household_members`, `invite_codes`, `categories`, `parse_attempts`, and `<user_id>/*` objects in `storage.objects` (bucket `receipts`)
- WHEN the user successfully completes the deletion flow
- THEN after the server response all of these rows and objects are gone
- AND the user can no longer authenticate

#### Scenario: Failure leaves no partial state

- GIVEN an authenticated user with the same data set as above
- WHEN the deletion RPC fails mid-flight (e.g. Storage sweep fails, RevenueCat revoke times out)
- THEN the system leaves no partial state visible to the user
- AND the user's session, profile, and data remain intact
- AND the user can retry the flow

### Requirement: RevenueCat Alias Revoke

Before the `auth.users` row is deleted, the server-side deletion logic MUST revoke the RevenueCat alias by calling `DELETE https://api.revenuecat.com/v1/subscribers/{app_user_id}` with `Authorization: Bearer ${REVENUECAT_SECRET_API_KEY}`. If the revoke fails (non-2xx response, network error, or timeout), the entire deletion flow MUST fail closed and MUST NOT proceed to the local DB deletion. The error code returned to the client MUST be `revenuecat_revoke_failed`.

#### Scenario: Successful revoke

- GIVEN an authenticated user with a RevenueCat alias mapped to `app_user_id = supabaseUserId`
- WHEN the user completes the deletion flow
- THEN the edge function calls RevenueCat DELETE before the `auth.users` delete
- AND `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` returns 404 immediately after

#### Scenario: Revoke failure blocks deletion

- GIVEN an authenticated user
- WHEN the RevenueCat revoke call returns a non-2xx status, network error, or times out
- THEN the edge function returns error code `revenuecat_revoke_failed`
- AND the `auth.users` row is NOT deleted
- AND the user data remains intact for retry

### Requirement: Storage Sweep

The deletion MUST remove every object in the `receipts` storage bucket whose first folder segment equals the deleted user's UUID: `DELETE FROM storage.objects WHERE bucket_id = 'receipts' AND (storage.foldername(name))[1] = p_user_id::text`. The sweep MUST run as `service_role` (which bypasses Storage RLS) so that the absence of an `auth.uid()` for the deleted user does not block the DELETE. The sweep MUST run before `auth.users` is removed.

#### Scenario: User folder objects are removed

- GIVEN a user with receipt photos in `<user_id>/` under the `receipts` bucket
- WHEN the deletion completes
- THEN every object under that prefix is removed
- AND no other user's folder is touched

#### Scenario: Sweep runs under service_role

- GIVEN an authenticated user
- WHEN the deletion sweep executes
- THEN it executes with `service_role` privileges (bypassing RLS)
- AND does not depend on `auth.uid()` being non-null for the deleted user

### Requirement: Idempotency

Calling the deletion RPC twice in succession MUST both succeed. The first call MUST remove the user's data and return `{ ok: true }`. The second call MUST detect the no-op state and return `{ ok: true, already_deleted: true }` without throwing, without surfacing an error code, and without producing a duplicate cascade or storage sweep.

#### Scenario: Second call is a no-op success

- GIVEN a user has been deleted via the flow and the session is cleared
- WHEN the deletion RPC is invoked again with the same user_id (e.g. a duplicate network retry, a double-tap)
- THEN the server returns `{ ok: true, already_deleted: true }` with HTTP 200
- AND no additional DELETE statements execute against personal-data tables

### Requirement: Post-Delete Client State

After the server confirms successful deletion, the client MUST clear the local session, invalidate every React Query cache, reset every Zustand store (`useReceiptsStore`, `useProStore`, `useHouseholdStore` if present), unmount the root `Stack.Protected` gate, and route the user to `/sign-in`. The RevenueCat SDK alias MUST be cleared locally as a best-effort follow-up; failure of the local SDK call MUST NOT surface to the user because the server-side revoke is authoritative.

#### Scenario: Successful deletion signs the user out

- GIVEN a user who completes the deletion flow
- WHEN the server returns `{ ok: true }`
- THEN the local session is cleared (`useSessionStore.session === null`)
- AND `queryClient.clear()` runs
- AND `useReceiptsStore`, `useProStore`, and any other per-user Zustand stores reset
- AND the app routes to `/sign-in`

#### Scenario: Local SDK cleanup is best-effort

- GIVEN a user who completes the deletion flow
- WHEN the server has returned success and the local session is cleared
- AND the local `logOutRevenueCat()` call throws (e.g. network unavailable)
- THEN the error is swallowed silently
- AND the user still lands on `/sign-in`
- AND no error dialog is presented

### Requirement: Error Mapping

Each stable server-side error code MUST map to a user-safe message displayed via `useDialogStore.show()` with `tone: 'danger'` and a single primary button (using `t('common:ok')`). The mapping MUST be:

| Error code | UX routing |
|---|---|
| `unauthenticated` | Re-route to `/sign-in` |
| `household_owner_with_members` | Route to `/settings/household` with a locale-appropriate toast explaining the disband step |
| `revenuecat_revoke_failed` | Single-button error dialog with retry copy |
| `internal` | Single-button error dialog saying "No se pudimos eliminar la cuenta. Inténtalo de nuevo." |

Raw error text from the server MUST NOT be rendered to the user.

#### Scenario: household_owner_with_members routes to household settings

- GIVEN the deletion call returns error code `household_owner_with_members`
- WHEN the client receives the response
- THEN the user is routed to `/settings/household` without a blocking error dialog
- AND a locale-appropriate toast explains: "Tenés que disolver el hogar antes de eliminar tu cuenta."

#### Scenario: revenuecat_revoke_failed shows error dialog with retry

- GIVEN the deletion call returns error code `revenuecat_revoke_failed`
- WHEN the client receives the response
- THEN a single-button danger dialog is shown with retry copy in the user's locale
- AND the user can dismiss the dialog and the app remains on the delete-account screen

#### Scenario: internal shows generic error dialog

- GIVEN the deletion call returns error code `internal`
- WHEN the client receives the response
- THEN a single-button danger dialog is shown: "No se pudimos eliminar la cuenta. Inténtalo de nuevo."
- AND the user can retry the flow

### Requirement: Internationalization

Every user-facing string introduced by this capability MUST exist in three locales: `en`, `es-AR` (canonical source of truth), and `pt-BR`. The strings MUST live in `mobile/src/i18n/locales/<locale>/settings.json` for settings-flow copy and `mobile/src/i18n/locales/<locale>/auth.json` for destructive-error copy. A key-coverage lint MUST pass for every new key across all three locales.

#### Scenario: All new keys exist in all three locales

- GIVEN the new i18n keys introduced for delete-account
- WHEN the key-coverage check runs as part of `pnpm test`
- THEN every key in `es-AR/settings.json` for delete-account is also present in `en/settings.json` and `pt-BR/settings.json`
- AND every key in `es-AR/auth.json` for delete-account is also present in `en/auth.json` and `pt-BR/auth.json`

### Requirement: Audit Signal

The deletion MUST be recorded in `webhook_events` (the existing ledger table) with `event_type = 'ACCOUNT_DELETION'` and the deleted `user_id` captured, for internal observability. Because `webhook_events.user_id` cascades on profile delete, the ledger row becomes orphaned but harmless: the row remains readable only to `service_role` and is not exposed to any client.

#### Scenario: Deletion writes a ledger row before the cascade

- GIVEN an authenticated user who initiates deletion
- WHEN the server-side flow runs
- THEN a row is inserted into `webhook_events` with `event_type = 'ACCOUNT_DELETION'`, the deleted `user_id`, and a server timestamp
- AND the row is visible to `service_role` after the cascade (orphaned but retained)

#### Scenario: Ledger row is not visible to any authenticated client

- GIVEN an orphaned `webhook_events` row after a user deletion
- WHEN any non-`service_role` role queries `webhook_events` filtered by that `user_id`
- THEN zero rows are returned (RLS denies the read)

## Non-Functional Requirements

### Latency

The end-to-end deletion flow (RevenueCat REST revoke + Storage sweep + `parse_attempts` scrub + cascading DB delete + RPC return) MUST complete in under 10 seconds for a typical user with fewer than 100 receipt photos, measured from when the client sends the final invocation to when the server returns `{ ok: true }`. The client MUST surface a non-cancellable progress indicator throughout this window.

### Security: RPC Privilege Boundary

The `delete_user_account(p_user_id uuid)` function MUST be declared `SECURITY DEFINER` and owned by `postgres`. The migration that defines it MUST `REVOKE EXECUTE ON FUNCTION delete_user_account(uuid) FROM PUBLIC, anon, authenticated;` and `GRANT EXECUTE ON FUNCTION delete_user_account(uuid) TO service_role;`. A CI check (`supabase db advisors` or equivalent) MUST fail if `PUBLIC`, `anon`, or `authenticated` holds EXECUTE on this function after the migration applies.

### Privacy: No Residual Local State

After the deletion flow completes successfully, the device MUST NOT retain any personal data the user previously had access to:

- The secure-store session MUST be cleared.
- Every React Query cache MUST be cleared (`queryClient.clear()`).
- Every per-user Zustand store MUST be reset (`useReceiptsStore`, `useProStore`, `useHouseholdStore`).
- The typed-confirmation screen state (the typed `ELIMINAR` value, the subscription banner visibility flag) MUST NOT persist if the user navigates away before completing the flow.
- The RevenueCat SDK alias MUST be cleared locally (best-effort; server-side revoke is authoritative).

### Accessibility

The typed-confirmation `TextInput` and the destructive final button MUST meet WCAG AA contrast in both light and dark themes. Both MUST expose a screen-reader label in Spanish (and the user's current locale), describing the irreversible nature of the action, and the destructive button MUST announce "Eliminar cuenta — acción irreversible" when focused. The typed-confirmation field MUST announce whether the typed value matches the required word as the user types.

## Cross-References

- `REQ-ACCTDEL-1` (entry point) is referenced from `user-auth` as `REQ-AUTH-DEL-1`.
- `REQ-ACCTDEL-5` (household pre-flight) is referenced from `household-sharing` as `REQ-HOUSE-DEL-1`.
- `REQ-ACCTDEL-6` (atomic erasure, the `auth.users` removal) is referenced from `user-auth` as `REQ-AUTH-DEL-2`.
- `REQ-ACCTDEL-10` (post-delete sign-out) is referenced from `user-auth` as `REQ-AUTH-DEL-3`.
- The "preserves typed value across the route trip" behavior implied by `REQ-ACCTDEL-5` is referenced from `household-sharing` as `REQ-HOUSE-DEL-2`.
