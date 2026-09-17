// supabase/functions/delete-account/lib/responses.ts
//
// Stable error envelope + signal-level constants for the delete-account
// edge function. Pure types and string constants — no runtime code.
//
// The client (`src/lib/supabase/feature-access.ts`) maps the `error`
// field of the response to a discriminated `DeleteAccountResult.code`
// union. Adding a new code means: (a) add it to `DeleteAccountErrorCode`,
// (b) add a constant for the SQLSTATE / message the RPC raises, and
// (c) wire the mapping in `index.ts`. Renaming any value here is a
// BREAKING CHANGE for the client.

// ---------------------------------------------------------------------------
// Error codes — the wire-level stable string set. Every value MUST
// match the union in `src/lib/supabase/feature-access.ts` and the
// switch in `src/app/settings/delete-account.tsx`.
// ---------------------------------------------------------------------------

export type DeleteAccountErrorCode =
  | 'unauthenticated'
  | 'household_owner_with_members'
  | 'revenuecat_revoke_failed'
  | 'internal';

/** Stable string identifier for each error code (debug + tests). */
export const ERROR_UNAUTHENTICATED = 'unauthenticated' as const;
export const ERROR_HOUSEHOLD_OWNER_WITH_MEMBERS =
  'household_owner_with_members' as const;
export const ERROR_REVENUECAT_REVOKE_FAILED = 'revenuecat_revoke_failed' as const;
export const ERROR_INTERNAL = 'internal' as const;

// ---------------------------------------------------------------------------
// RPC signal-level constants — the SQLSTATE and message text that
// migration 0036_delete_account.sql raises from the household-owner
// pre-flight. The edge function matches on BOTH the SQLSTATE (stable
// across i18n) and the literal message (also stable; the migration
// pins the exact string with `raise exception 'owner_must_disband_first'`).
// Matching on the SQLSTATE is the durable contract; the message
// match is a belt-and-suspenders guard against a future migration
// accidentally dropping the errcode clause.
// ---------------------------------------------------------------------------

/**
 * SQLSTATE for `raise_exception` (PL/pgSQL RAISE without an
 * explicit errcode). Pinned in migration 0036 via
 * `raise exception 'owner_must_disband_first' using errcode = 'P0001'`.
 */
export const HOUSEHOLD_OWNER_SQLSTATE = 'P0001';

/** Exact literal message text the RPC raises. */
export const HOUSEHOLD_OWNER_MESSAGE = 'owner_must_disband_first';

// ---------------------------------------------------------------------------
// Wire envelope — the shape the function returns. Every field is
// optional EXCEPT `ok` (which discriminates success from failure).
// ---------------------------------------------------------------------------

export interface DeleteAccountResponse {
  ok: boolean;
  /**
   * True iff the RPC returned 'already_deleted' (idempotent
   * re-call). Client treats this as a normal success — the
   * destructive path already happened on a prior call.
   */
  already_deleted?: boolean;
  /** Stable error code (omitted on success). */
  error?: DeleteAccountErrorCode;
  /**
   * Operator-facing message. NEVER surfaced to the end user (the
   * screen renders its own localized copy keyed off `error`).
   * Kept on the wire for dashboard debugging only.
   */
  message?: string;
}
