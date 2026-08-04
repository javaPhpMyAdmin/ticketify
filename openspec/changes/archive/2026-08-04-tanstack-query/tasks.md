# Tasks: TanStack Query as the data-fetching layer

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500 (PR1 ≈270 / PR2 ≈170 / PR3 ≈160) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Foundation → PR2 Wiring → PR3 Hooks/cleanup |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Dependency + pure layer (keys/adapters/client) + harness tests | PR 1 (base: main) | Verified by harness + typecheck; no consumers yet |
| 2 | Provider + sign-out clear + migrate profile/budget/analytics hooks | PR 2 (base: main, after PR 1) | Shared `profiles` row dedupe lands together |
| 3 | `useScanTicket` mutation + feed/history stubs + dead hook removal | PR 3 (base: main, after PR 2) | No invalidation; shapes preserved |

Refs: SSC = server-state-caching, DA = data-access, UA = user-auth.

## Phase 1: Foundation

- [x] 1.1 `pnpm add @tanstack/react-query@^5.101.4` (package.json + lockfile) [SSC-11]
- [x] 1.2 Create `src/lib/query-keys.ts`: userId-scoped factories (profile/scanUsage/budget/monthlyTotals/homeFeed/historyEntries) + `utcYearMonth()` [SSC-5]
- [x] 1.3 Create `src/lib/supabase/query-adapters.ts`: `FeatureQueryError(kind)`, `toQueryData` (ok→data else throw; ok-null stays null), `shouldRetry` (definitive kinds→false, else failureCount<2), `toQueryErrorMessage`, `MISSING_PROFILE_MESSAGE` [SSC-4, SSC-6]
- [x] 1.4 Create `src/lib/query-client.ts`: module-scope QueryClient, staleTime 60/60/30, gcTime 5min, `retry: shouldRetry`, AppState→`focusManager.setFocused` (non-web) [SSC-1, SSC-2, SSC-3]
- [x] 1.5 Extend harness tsconfig include + `scripts/test-features.mjs`: toQueryData (4 statuses + ok-null), shouldRetry gating, error copy, utcYearMonth/key shapes [SSC-12]
- [x] 1.6 Run `pnpm test:features` + `pnpm typecheck` green [SSC-12, DA-1]

## Phase 2: Core

- [x] 2.1 Wrap the `Stack` in `QueryClientProvider` in `src/app/_layout.tsx` [SSC-1]
- [x] 2.2 Add `queryClient.clear()` in SIGNED_OUT branch of `initAuthStateListener` (use-session-store.ts:281-283) [SSC-7, UA-1]
- [x] 2.3 Rewrite `useProfile.ts`: two `useQuery` (profile + scan-usage @30s), `enabled: !!userId`, factory keys, `toQueryErrorMessage`; shape `{user, usage, isLoading, error, setHouseholdSharing}` [SSC-9, DA-1]
- [x] 2.4 Rewrite `useBudget.ts`: `useQuery` over `fetchMonthlyBudget` + `toQueryData`; shape `{budget, spent, percent, error}` [SSC-9, DA-1]
- [x] 2.5 Rewrite `useMonthlyTotals.ts`: `useQuery` over RPC, `enabled: !!userId`, key `monthlyTotals(userId, utcYearMonth())`; shape `{totals, monthTotal, isLoading, error}` [SSC-5, SSC-9, DA-1]

## Phase 3: Hooks

- [x] 3.1 Rewrite `useScanTicket.ts` as `useMutation`: mutationFn upload→parse; onSuccess seeds store + draftId; no invalidation; shape `{isLoading, error, draftId, scan, reset}` [SSC-8]
- [x] 3.2 Rewrite `useHomeFeed.ts`: `useQuery` with stub queryFn→`EMPTY_FEED`, key homeFeed(userId), `enabled: !!userId`; shape preserved [SSC-9, DA-1]
- [x] 3.3 Rewrite `useHistoryEntries.ts`: `useQuery` with stub queryFn→`[]`, key historyEntries(userId), `enabled: !!userId` [SSC-9, DA-1]
- [x] 3.4 Delete `useCategoryBreakdown.ts` + barrel export in `analytics/index.ts`; keep `fetchCategoryBreakdown` [SSC-10]

## Phase 4: Verification

- [x] 4.1 `pnpm typecheck` passes — profile/index/analytics/review-[id] compile unchanged [SSC-9]
- [x] 4.2 `pnpm test` (adapter + auth + features) green [SSC-12]
- [~] 4.3 Device: Home→Profile no second `profiles` read; sign-out→sign-in shows no prior data; foreground refetches stale only [SSC-2, SSC-7, UA-1]
  - **Manual, deferred to user (no device simulator in apply).** Checklist:
    1. Sign in as user A → Home tab: budget card loads from `profiles`; navigate to Profile → verify NO second `profiles` read fires (single request, deduped cache).
    2. Foreground refetch: background the app for >30s (scan usage stale) but <60s (profile fresh) → return to foreground → scan usage refetches, profile does NOT re-request (stale-only refetch).
    3. Scan flow: scan a ticket → review screen shows the parsed draft (store seeded); trigger a failure path → error state + retry button, store not half-seeded.
    4. Sign-out → sign-in as user B on the same device → verify NO stale data from A appears (cache cleared on SIGNED_OUT); B's first reads hit the database.
    5. Restart the app → data reloads from the database (in-memory cache only).
- [x] 4.4 Grep: no `useCategoryBreakdown` reference remains in `src/`; no `useEffect`-based data-fetching hooks remain in migrated domains; `queryClient.clear()` present in SIGNED_OUT; `fetchCategoryBreakdown` kept (harness asserts it) [SSC-10]
