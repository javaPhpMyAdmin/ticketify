# Server-State Caching Specification

## Purpose

TanStack Query v5 is the app's server-state layer: one client + provider, userId-scoped keys, throwing adapters over the read seam, freshness/retry policy, focus refetch, and an in-memory cache cleared on sign-out. Offline persistence is deferred.

## Requirements

### Requirement: Provider Availability

The system MUST create a single module-scope QueryClient with configured defaults and MUST wrap the route tree (the `Stack` in `src/app/_layout.tsx`) in a `QueryClientProvider` so every screen can query. No feature hook MAY run without the provider. Queries MUST be disabled (`enabled: !!userId`) until a signed-in user exists, so no read ever runs without a session.

#### Scenario: All routes under one provider

- GIVEN the root layout renders
- WHEN the app launches
- THEN the Stack is wrapped by the QueryClientProvider
- AND auth and signed-in screens share one client (one cache, one dedupe)

#### Scenario: No session issues no request

- GIVEN no signed-in user
- WHEN a data hook mounts
- THEN no fetch is issued
- AND the hook reports its no-user state

### Requirement: Focus Refetch Policy

The system MUST wire AppState to `focusManager.setFocused(status === 'active')` on non-web. On foreground the system MUST refetch only stale queries; fresh queries MUST NOT re-request.

#### Scenario: Foreground refetch is stale-only

- GIVEN a stale query and a fresh query are cached
- WHEN the app returns to foreground
- THEN the stale query refetches
- AND the fresh query issues no request

### Requirement: Freshness and Retention Contracts

The client MUST configure staleTime 60s (profile, budget), 60s (analytics), and 30s (scan usage), and gcTime 5min for all queries.

| Read | staleTime |
|------|-----------|
| profile, budget | 60s |
| analytics (monthly totals) | 60s |
| scan usage | 30s |

A fresh query MUST NOT re-request on remount or refocus. An unmounted query past gcTime MUST be evicted.

#### Scenario: Fresh read skips the network

- GIVEN a profile read completed < 60s ago
- WHEN the profile screen remounts
- THEN no new `profiles` read is issued

#### Scenario: Scan usage goes stale sooner

- GIVEN scan usage cached 45s ago
- WHEN the screen remounts
- THEN scan usage refetches while the still-fresh profile does not

#### Scenario: GC eviction

- GIVEN a query unmounted and untouched for > 5min
- WHEN it mounts again
- THEN a new request is issued

### Requirement: Retry Contract

Transient read failures MUST be retried up to 2 times before an error surfaces. Retry gating MUST key off the error kind thrown by the adapters: definitive kinds (missing-profile, unconfigured) MUST NOT be retried.

#### Scenario: Transient failure retries then surfaces

- GIVEN a read fails transiently twice
- WHEN the query settles
- THEN two retries occurred and the error state surfaces

#### Scenario: Definitive failure never retries

- GIVEN a read resolves missing-profile (or unconfigured)
- WHEN the query runs
- THEN exactly one attempt is made and the error state surfaces

### Requirement: User-Scoped Query Keys and Month Derivation

Every query key MUST include the userId. Analytics keys MUST include the userId and the shared UTC year-month, derived by one shared UTC function used by both scan-usage and analytics keys.

#### Scenario: Cross-user isolation

- GIVEN users A and B query the same feature
- WHEN both have cached entries
- THEN the entries differ and neither serves the other's data

#### Scenario: One month derivation

- GIVEN the shared derivation returns "2026-08"
- WHEN scan-usage and analytics keys are built
- THEN both embed "2026-08"

### Requirement: Throwing Adapters

The seam (`feature-access.ts` + feature `api.ts`) MUST remain the queryFn source, unchanged. Adapters at the hook boundary MUST throw a typed error for every non-ok status so a failure MUST NEVER cache as success. The thrown error MUST carry an error kind (`missing-profile` | `unconfigured` | `error`) and the seam's user-safe message. An ok-with-null result (scan usage for a fresh month) MUST resolve as successful null data.

#### Scenario: Failure never caches as success

- GIVEN a read resolves status `error`
- WHEN the adapter runs as the queryFn
- THEN the query rejects
- AND no success entry is cached for the key

#### Scenario: Definitive kind maps to copy

- GIVEN a read resolves missing-profile
- WHEN the adapter throws
- THEN the hook maps the kind to the user-safe missing-profile message

#### Scenario: Null data is success

- GIVEN scan usage for a fresh month resolves ok-with-null
- WHEN the query settles
- THEN the query is successful with null data and no error

### Requirement: Sign-Out Cache Clear

On SIGNED_OUT the system MUST clear the in-memory cache (`queryClient.clear()`), so no previous user's rows survive to the next session.

#### Scenario: Cache emptied on sign-out

- GIVEN cached reads for user A
- WHEN SIGNED_OUT fires
- THEN the cache is empty
- AND user B's first reads hit the database

### Requirement: Scan-Ticket Mutation

The scan flow MUST run as a `useMutation`. A failed mutation MUST NOT seed the receipt store. `reset` MUST clear `error` and `draftId`.

#### Scenario: Successful scan seeds the draft

- GIVEN a valid image
- WHEN `scan(imageUri)` resolves
- THEN the store is seeded and `draftId` is set

#### Scenario: Failed scan leaves the store untouched

- GIVEN upload or parse fails
- WHEN `scan(imageUri)` rejects
- THEN the store is not seeded
- AND `error` carries the message and `draftId` stays null

#### Scenario: Reset clears mutation state

- GIVEN a prior failure
- WHEN `reset()` runs
- THEN `error` and `draftId` clear

### Requirement: Stable Hook Return Shapes

Migrated hooks MUST keep the public shapes consumers depend on:

| Hook | Shape |
|------|-------|
| useProfile | { user, usage, isLoading, error, setHouseholdSharing } |
| useBudget | { budget, spent, percent, error } |
| useMonthlyTotals | { totals, monthTotal, isLoading, error } |
| useScanTicket | { isLoading, error, draftId, scan, reset } |
| useHomeFeed | { categories, receipts, wantsSnacksTotal } |
| useHistoryEntries | HistoryEntry[] |

#### Scenario: Consumer screens compile unchanged

- GIVEN the migration is applied
- WHEN `pnpm typecheck` runs
- THEN profile.tsx, index.tsx, analytics.tsx, and review/[id].tsx compile against the same shapes

### Requirement: Dead Hook Removal

`useCategoryBreakdown` and its barrel export MUST be removed; no module MAY reference it.

#### Scenario: No references remain

- GIVEN the change is applied
- WHEN the codebase is searched
- THEN no reference to useCategoryBreakdown exists

### Requirement: In-Memory Only

The cache MUST be in-memory only. No persistence layer (persist-client, AsyncStorage, kv-store) MAY be introduced.

#### Scenario: Restart clears the cache

- GIVEN cached data in memory
- WHEN the app restarts
- THEN the cache is empty and reads hit the database

### Requirement: Verification Without New Test Infra

The hook migration MUST NOT add a test framework or runner: hook wiring is gated by `pnpm typecheck` and manual device verification. Node harnesses for the api layer MUST keep running; only `scripts/test-features.mjs` MAY be adapted for the throwing adapters.

#### Scenario: Typecheck gates the migration

- GIVEN the migration is applied
- WHEN `pnpm typecheck` runs
- THEN it passes and no new test infra is added

#### Scenario: Harness assertions survive

- GIVEN api-layer node harnesses pass before the change
- WHEN the change lands
- THEN the same harness assertions still run and pass
