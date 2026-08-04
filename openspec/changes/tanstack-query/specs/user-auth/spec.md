# Delta for User Auth

## MODIFIED Requirements

### Requirement: Sign Out

The system MUST sign the user out on demand, MUST clear the persisted session, MUST clear the in-memory server-state cache (`queryClient.clear()`), and MUST route the user back to the sign-in screen. The profile screen MUST expose a sign-out control to the signed-in user. When the server-side revoke fails (offline), the local session is still cleared and the user is signed out on the device: the system MUST NOT surface a misleading failure. Only a sign-out that leaves the local session intact is a genuine failure worth surfacing.
(Previously: sign-out cleared the persisted session only; the in-memory query cache was not cleared.)

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
