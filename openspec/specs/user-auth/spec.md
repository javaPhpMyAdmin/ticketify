# User Auth Specification

## Purpose

Email/password and Google/Apple OAuth authentication for the app: sign up, sign in, sign out, password reset, and session persistence across app restarts.

## Requirements

### Requirement: Email/Password Sign-Up

The system MUST register a new user via Supabase email/password auth on valid email and password submission. It MUST NOT sign the user in when registration fails and MUST surface a user-readable error for invalid input. A duplicate email MUST be indistinguishable from a fresh sign-up awaiting confirmation (anti-enumeration): the system MUST NOT reveal whether an address is already registered, so the same confirmation state is shown for both cases. The system SHOULD show a pending state while the request is in flight.

#### Scenario: Successful registration

- GIVEN a new email and a password meeting the minimum requirements
- WHEN the user submits the sign-up form
- THEN a Supabase account is created
- AND the app enters the authenticated session (or a confirmation state when email confirmation is enabled)

#### Scenario: Duplicate email

- GIVEN an email that is already registered
- WHEN the user submits the sign-up form
- THEN the account is not signed in
- AND the app responds with the same confirmation state as a fresh sign-up awaiting email confirmation
- AND no account-existence signal leaks to the user

> Anti-enumeration decision (reliability re-gate): a duplicate-account error maps to the same confirmation state as a new account waiting for confirmation instead of an "email already in use" error. Both cases show the identical screen, so an attacker cannot tell registered addresses apart. Other failures (weak password, network) surface generic copy and never a raw GoTrue message.

### Requirement: Email/Password Sign-In

The system MUST authenticate an existing user with email and password and MUST reject invalid credentials with a user-readable error. It SHOULD disable submit while the request is in flight. Every sign-in failure MUST surface the same generic message ("Invalid email or password") and MUST NOT render a raw GoTrue message: a wrong password, a nonexistent account, and an unconfirmed email are indistinguishable to the user (anti-enumeration, consistent with sign-up and password reset).

#### Scenario: Valid credentials

- GIVEN valid credentials for an existing account
- WHEN the user submits the sign-in form
- THEN the user is signed in
- AND is routed to the authenticated area

#### Scenario: Invalid credentials

- GIVEN an incorrect password
- WHEN the user submits the sign-in form
- THEN the generic invalid-credentials message is shown
- AND the user remains on the sign-in screen
- AND no raw GoTrue message is rendered

#### Scenario: Unconfirmed email

- GIVEN an account whose email is not confirmed
- WHEN the user submits valid credentials for that account
- THEN the same generic invalid-credentials message is shown
- AND the app does not reveal that the account exists or that confirmation is pending

### Requirement: OAuth Sign-In

The system MUST support sign-in via Google and Apple using a PKCE OAuth flow and MUST sign the user in when the flow completes. A cancelled or failed flow MUST NOT create a session. The flow id returned by the provider flow MUST be passed through to the code exchange (`exchangeCodeForSession(code, { flowId })`), with the callback URL's `sb_flow_id` as the fallback, so the code is exchanged against the correct stored verifier.

The callback deep link (`ticketify://oauth`) MUST be consumable outside the in-process flow: when the app was terminated during provider consent (cold start), the callback route MUST exchange the deep-link `code` itself, route to the app on success, and route to the sign-in screen with a user-readable error on failure. When the callback arrives while the in-process exchange is still running (warm race), the route MUST wait for that exchange instead of exchanging the same code again (PKCE codes are single-use) or flashing the sign-in screen.

#### Scenario: Provider consent completed (in-process)

- GIVEN the user selects Google or Apple and completes provider consent
- WHEN the OAuth flow finishes
- THEN the user is signed in

#### Scenario: Provider consent cancelled

- GIVEN the user cancels the provider consent
- WHEN the OAuth flow returns
- THEN no session is created
- AND the app remains on the sign-in screen

#### Scenario: Cold-start callback

- GIVEN the app was terminated during provider consent
- WHEN the OS delivers the callback as a launch deep link to `ticketify://oauth` carrying `code` (and `sb_flow_id`)
- THEN the callback route exchanges the code itself
- AND on success the user is routed to the app
- AND on failure the user is routed to the sign-in screen with a user-readable error

#### Scenario: Warm-race callback

- GIVEN the callback deep link arrives while the in-process exchange is still running
- WHEN the callback route renders
- THEN it waits for the in-process exchange instead of exchanging the code again or flashing the sign-in screen
- AND the user lands on the app once the session is set

### Requirement: Sign Out

The system MUST sign the user out on demand, MUST clear the persisted session, MUST clear the in-memory server-state cache (`queryClient.clear()`), and MUST route the user back to the sign-in screen. The profile screen MUST expose a sign-out control to the signed-in user. When the server-side revoke fails (offline), the local session is still cleared and the user is signed out on the device: the system MUST NOT surface a misleading failure. Only a sign-out that leaves the local session intact is a genuine failure worth surfacing.

#### Scenario: User signs out

- GIVEN an authenticated session with cached reads
- WHEN the user triggers sign out
- THEN the session is cleared locally and on Supabase
- AND the in-memory query cache is cleared
- AND the sign-in screen is shown

#### Scenario: Offline revoke failure

- GIVEN no network connectivity
- WHEN the user triggers sign out
- THEN the local session is cleared and SIGNED_OUT fires
- AND the server-state cache is cleared
- AND the user is signed out on the device with no misleading error

#### Scenario: Next sign-in sees no previous user's data

- GIVEN user A signed out and user B signs in on the same device
- WHEN B's screens query
- THEN no cached row from A is served
- AND B's reads hit the database

### Requirement: Password Reset

The system MUST send a password reset email for a provided address and MUST NOT disclose whether the address has an account. It SHOULD show a confirmation message.

#### Scenario: Registered address

- GIVEN a registered email address
- WHEN the user requests a password reset
- THEN a reset email is sent
- AND a confirmation message is shown

#### Scenario: Unregistered address

- GIVEN an unregistered email address
- WHEN the user requests a password reset
- THEN the system still reports that the email was sent
- AND no account enumeration occurs

### Requirement: Session Persistence

The system MUST persist the session across app restarts using a SecureStore-backed adapter and MUST restore it on launch. An expired or invalid stored token MUST be discarded without crashing, returning the user to the sign-in screen.

#### Scenario: Valid stored session

- GIVEN a valid session stored on the device
- WHEN the app is launched
- THEN the user is restored to the authenticated state without signing in again

#### Scenario: Expired stored session

- GIVEN a stored session whose token has expired
- WHEN the app is launched
- THEN the session is cleared
- AND the sign-in screen is shown

### Requirement: Mandatory Authentication

Authentication is required from the moment the app starts: there is no mode to reconcile and no fixtures path. On launch the system MUST show the sign-in screen unless a valid session is restored, and MUST NEVER show app data without a session.

#### Scenario: Fresh install requires sign-in

- GIVEN a fresh install with no stored session
- WHEN the app launches
- THEN the sign-in screen is shown
- AND no app data or demo content is exposed

#### Scenario: Sign-in required after sign-out

- GIVEN the user has signed out
- WHEN the app relaunches
- THEN the sign-in screen is shown
- AND no session-less content is exposed

### Requirement: Bounded Session Restore

The launch restore MUST be bounded: if the storage availability probe or the session read exceeds the bound, restore settles to a safe no-session state and finishes bootstrapping rather than leaving the splash up forever. Results from a read that outlived the bound MUST NOT clobber or destroy state that appeared while the read was in flight (e.g. a session created by an OAuth cold-start exchange): late session writes and late sign-outs are no-ops once bootstrap completed.

#### Scenario: Hung session read

- GIVEN a storage backend whose session read never resolves
- WHEN the app launches
- THEN restore settles within the bound
- AND bootstrapping finishes in the safe no-session state (sign-in screen)

#### Scenario: Late read after a concurrent sign-in

- GIVEN the session read outlives the bound and the user signs in meanwhile (e.g. an OAuth cold-start exchange)
- WHEN the late read finally resolves with a stale or errored result
- THEN the fresh session is neither clobbered nor signed out
