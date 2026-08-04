# Delta for Data Access

## MODIFIED Requirements

### Requirement: Authenticated Data Reads

Each feature read API (profile, budget, tickets, analytics) MUST read real Supabase data for the signed-in user through the server-state layer when a session exists. There MUST be no fixture fallback and no demo branch: reads are authenticated-only, cached per user under user-scoped keys, deduplicated across concurrent mounts, and retried on transient failure per the server-state retry policy. Feature hooks MUST NOT hardcode a user id. A failed read MUST surface a detectable error state and MUST NOT cache as success.
(Previously: reads were hand-rolled per-hook `useEffect` + state with no caching, deduplication, or retry.)

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
