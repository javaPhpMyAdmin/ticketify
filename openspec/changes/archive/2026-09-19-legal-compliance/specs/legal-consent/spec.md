# Legal Consent Specification

## Purpose

Versioned, auditable acceptance of the Privacy Policy and Terms: a mandatory consent checkbox on sign-up, a blocking consent gate for OAuth first-time users and existing users without a current-version acceptance, deferred client-side flush for email-confirmation sign-up, and the `legal_acceptances` table + SECURITY DEFINER RPC (0036 pattern).

## Requirements

### Requirement: Acceptance Record

The system MUST store acceptances append-only in `legal_acceptances (user_id, document, version, accepted_at)` with primary key `(user_id, document, version)`, `document` constrained to `'privacy' | 'terms'`, and RLS allowing select/insert of own rows only (no update/delete policies). Rows MUST be written only through the SECURITY DEFINER RPC `record_legal_acceptance(document, version)`, granted to `authenticated` (revoked from `PUBLIC`/`anon`), deriving `user_id` from `auth.uid()` and idempotent for duplicate `(document, version)` pairs.

#### Scenario: Duplicate record is a no-op

- GIVEN an authenticated user with an existing `('privacy', '2026-09-18')` row
- WHEN the RPC runs again with the same document and version
- THEN it succeeds and no second row is created

#### Scenario: Unprivileged roles are denied

- GIVEN an `anon` or `PUBLIC` role
- WHEN it attempts to execute the RPC
- THEN the call is rejected

#### Scenario: Rows are immutable

- GIVEN an acceptance row
- WHEN the owning user attempts to update or delete it
- THEN no policy permits the statement and zero rows change

### Requirement: Current-Version Gate

A client constant MUST define the current legal version as an ISO date string shared by both documents. A user MUST be consent-complete only when acceptance rows exist for BOTH documents at exactly that version; absence of either row SHALL gate the user. When the constant changes, older versions MUST NOT satisfy the gate.

#### Scenario: Partial acceptance still gates

- GIVEN a user accepted privacy but not terms at the current version
- WHEN the app opens
- THEN the consent gate is shown

#### Scenario: Version bump re-gates existing users

- GIVEN acceptance rows at `2026-09-18` and the constant bumped to `2026-10-01`
- WHEN the app opens
- THEN the gate is shown until both documents are re-accepted at the new version

### Requirement: Sign-Up Consent Checkbox

The sign-up screen MUST show a consent checkbox linking to both in-app documents; submit MUST be blocked until the user accepts, and an unchecked submit MUST surface a validation message. The links MUST be tappable before acceptance. Acceptance SHALL be recorded via the RPC at the first `SIGNED_IN` after accepting: without a session (email confirmation) the acceptance MUST persist in a local pending flag until that event; with a session the flush runs immediately.

#### Scenario: Submit is blocked until accepted

- GIVEN valid email and password but an unchecked checkbox
- WHEN the user taps submit
- THEN no sign-up request is sent and a validation message is shown

#### Scenario: Links work before the checkbox is checked

- GIVEN the checkbox is unchecked
- WHEN the user taps the Terms link
- THEN `/legal/terms` opens and the sign-up form state is preserved on back

### Requirement: Deferred Acceptance Flush

The app MUST flush any pending acceptance on the first `SIGNED_IN` after it was set — writing both documents at the current version via the RPC — then clear the flag. A failed flush MUST keep the flag, MUST NOT block `ensureProfile` or session initialization, and MUST leave the user at the consent gate until both rows exist. A pending flag MUST NOT be applied to a different user than the one who set it.

#### Scenario: Email-confirmation flush

- GIVEN a pending acceptance set at sign-up with email confirmation enabled
- WHEN the first `SIGNED_IN` fires after confirmation
- THEN the RPC writes both document rows and the flag clears

#### Scenario: Flush fails without breaking sign-in

- GIVEN the first `SIGNED_IN` fires while offline
- WHEN the RPC call fails
- THEN the flag survives, `ensureProfile` still runs, and the gate appears until both rows exist

#### Scenario: A different user signs in first

- GIVEN user A set a pending flag and user B signs in on the same device
- WHEN `SIGNED_IN` fires
- THEN no rows are written for B and user A's stale flag clears

#### Scenario: Reinstall or another device

- GIVEN a pending flag is lost (reinstall) or absent on a second device
- WHEN the user opens the app with a session and no rows
- THEN the consent gate is shown; consent is never assumed from missing data

### Requirement: Blocking Consent Gate

When a session exists but either document lacks a current-version acceptance row, the app MUST show a blocking gate on open — for fresh OAuth users and existing users alike. While gated, only the legal screens, the accept action, and sign-out MUST be accessible; all other navigation MUST be blocked. Accept MUST write both document rows idempotently and release the gate.

#### Scenario: Fresh OAuth user is gated on first open

- GIVEN a new OAuth user with no acceptance rows
- WHEN the app opens after sign-in
- THEN the gate blocks the app content; accepting writes both rows and releases the gate

#### Scenario: No dead-ends while gated

- GIVEN the gate is showing
- WHEN the user opens a legal document or signs out
- THEN the document opens without acceptance, or the session ends
- AND the user is never trapped without an exit

#### Scenario: A failed flush surfaces as the gate

- GIVEN a previously failed flush left no rows
- WHEN the app opens
- THEN the gate appears and accepting retries the RPC, releasing on success

## Acceptance Gates

1. Sign-up submit is blocked until the checkbox is accepted; both rows exist after the first `SIGNED_IN`.
2. Fresh OAuth and existing users without current-version rows hit the gate; released only by accepting.
3. SQL smoke passes: append-only RLS, idempotent RPC, EXECUTE only for `authenticated`.
4. The gate offers legal documents, accept, and sign-out — no dead-ends.