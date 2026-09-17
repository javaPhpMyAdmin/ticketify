# Delta for Household Sharing

> ⚠️ **ARCHIVED DELTA — NOT merged into the parent spec.** This change was partially archived on 2026-09-17. Only `REQ-HOUSE-DEL-1` (Account Deletion Owner Pre-Flight) was implemented in PR1 (server-side enforced in the RPC, merged to `main` as commit `0d6dd18`). `REQ-HOUSE-DEL-2` (Cross-Route Progress Preservation) remains pending in PR3 (depends on the client wrapper in PR2). This file is preserved for design context only; the parent `openspec/specs/household-sharing/spec.md` does NOT yet contain these requirements. See `openspec/changes/archive/2026-09-17-delete-account/archive-report.md` for the full status.

This delta modifies `openspec/specs/household-sharing/spec.md` to add the household-owner pre-flight check that blocks account deletion when the caller is a household `created_by` with at least one other active member, and to specify the client behavior that preserves the user's progress across the route trip to disband.

## ADDED Requirements

### Requirement: Account Deletion Owner Pre-Flight

A household `created_by` with at least one other active member MUST be blocked from completing account deletion through the `user-account-deletion` flow (see `REQ-ACCTDEL-5` of that capability). The block MUST be enforced server-side in the `delete_user_account` SECURITY DEFINER RPC — NOT client-side — and MUST return the stable error code `household_owner_with_members`. When the block fires, no row in `auth.users`, `profiles`, `purchases`, `storage.objects`, or any per-user table MAY be removed; the operation is a no-op rejection.

#### Scenario: Owner with active members is blocked

- GIVEN the authenticated caller is the `created_by` of household `h1`
- AND `household_members` has at least one row for `h1` whose `user_id` is different from the caller
- WHEN the caller invokes the deletion flow
- THEN the server returns error code `household_owner_with_members`
- AND every per-user row for the caller remains intact
- AND the client routes the caller to `/settings/household` to disband or transfer ownership

#### Scenario: Solo owner is not blocked

- GIVEN the authenticated caller is the `created_by` of household `h1`
- AND `household_members` has exactly one row for `h1` (the caller, with role `owner`)
- WHEN the caller invokes the deletion flow
- THEN the deletion proceeds without the pre-flight error

#### Scenario: Non-owner member is not blocked

- GIVEN the authenticated caller is a non-owner member of household `h1`
- WHEN the caller invokes the deletion flow
- THEN the deletion proceeds
- AND the caller's profile, purchases, and receipts are removed
- AND household `h1`, its owner, and all other members remain intact

#### Scenario: Block is enforced server-side

- GIVEN a malicious or compromised client that omits the household pre-flight check
- WHEN the client calls the `delete_user_account` RPC directly with the owner user_id
- THEN the RPC raises `household_owner_with_members` regardless of what the client did or did not check
- AND no data is removed

### Requirement: Cross-Route Progress Preservation

When the client routes a blocked owner to `/settings/household` to disband or transfer ownership, the typed-confirmation value the user entered on the delete-account screen (the literal `ELIMINAR` word and surrounding state) MUST be preserved so the user can complete the deletion flow on return without restarting the screen. After the owner disbands the household, the user MUST be able to retry the deletion from the same screen state and complete the flow.

#### Scenario: Typed value persists across the household detour

- GIVEN the user has typed `ELIMINAR` on the delete-account screen
- AND the server returns `household_owner_with_members`
- WHEN the client navigates to `/settings/household` and the user completes the disband
- AND the user navigates back to `/settings/delete-account`
- THEN the typed-confirmation value is preserved
- AND the user can confirm the final action without retyping `ELIMINAR`

#### Scenario: User can complete deletion after disband

- GIVEN the user has disbanded the household (owner is now sole member, or no household)
- WHEN the user confirms the delete-account screen
- THEN the deletion proceeds without the `household_owner_with_members` error
- AND the existing `REQ-ACCTDEL-*` contract (atomic erasure, sign-out, etc.) applies unchanged
