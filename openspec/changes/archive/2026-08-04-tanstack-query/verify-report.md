# Verify Report — tanstack-query

**Change**: tanstack-query
**Version**: spec v1 (server-state-caching 11 req / data-access 1 MODIFIED / user-auth 1 MODIFIED)
**Mode**: Standard (strict_tdd disabled, openspec/config.yaml)
**Branch**: feat/tanstack-query (origin/main + 9 commits: c15bb13, ebc92fa, bb23cec, d8c51a8, 18048af, a494e06, a6510cc, 61269e3, 21ada56)

## Summary

The tanstack-query change implements the server-state layer: one module-scope QueryClient + provider, userId-scoped key factories with a shared UTC month derivation, throwing adapters over the untouched read seam, freshness/retry defaults (60/60/30 staleTime, gcTime 5min, retry 2 gated by error kind), AppState→focusManager wiring, cache clear on SIGNED_OUT, scan flow as a mutation, feed/history useQuery stubs, and dead-hook removal. Implementation matches spec (SSC-1..12, DA-1, UA-1), design (D1-D9), and tasks. All runnable gates re-executed green. Sole open item: task 4.3 manual device verification (environmental — no simulator in this environment; checklist documented in tasks.md).

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 18 (Phases 1-4, incl. 4.3 checklist) |
| Tasks complete | 17 |
| Tasks incomplete | 1 — 4.3 manual device verification (deferred to user by design; spec SSC-12 gates device scenarios on manual verification) |

## Build & Tests Execution (fresh evidence, re-run by verifier)

**Typecheck**: ✅ Passed
```text
> pnpm typecheck
> tsc --noEmit          → exit 0, 0 errors
```

**Lint**: ✅ Passed (0 errors, 2 pre-existing warnings)
```text
> pnpm lint
src/stores/use-receipts-store.ts:10:9   warning  Array type using 'Array<T>' is forbidden  @typescript-eslint/array-type
src/types/index.ts:106:10              warning  Array type using 'Array<T>' is forbidden  @typescript-eslint/array-type
✖ 2 problems (0 errors, 2 warnings)
```
Both warnings pre-existing (files untouched by this change — neither appears in the branch diff).

**Tests**: ✅ 89 passed, 0 failed
```text
test:adapter  → 14 passed, 0 failed
test:auth     → all 50 tests passed
test:features → all 25 tests passed
TOTAL         → 89/89
```

**Coverage**: ➖ Not available (no coverage tooling; harness assertions are the gate per SSC-12).

## Diff Scope

`git diff origin/main...HEAD --stat` → 27 files, +1280/−249, all tanstack-query work:
- New: `src/lib/query-client.ts`, `src/lib/query-keys.ts`, `src/lib/supabase/query-adapters.ts`, `scripts/test-stubs/react-native.ts`
- Modified: `package.json` (+1 dep `@tanstack/react-query@^5.101.4`), `pnpm-lock.yaml`, `src/app/_layout.tsx`, `src/features/auth/use-session-store.ts` (+7), hooks (profile/budget/monthly-totals/scan/home/history), `analytics/index.ts`, harness scripts/tsconfigs
- Deleted: `src/features/analytics/hooks/useCategoryBreakdown.ts`
- ✅ No auth-chain re-diffs, no unrelated files in the committed change. Working tree WIP (sign-in.tsx, auth-supabase-connection/design.md, untracked config) is unstaged and excluded.

## Spec Compliance Matrix

| Req | Scenario | Evidence | Result |
|-----|----------|----------|--------|
| SSC-1 Provider | All routes under one provider | `src/app/_layout.tsx:52` `QueryClientProvider client={queryClient}` wraps the Stack (54-72); module-scope client `query-client.ts:29` | ✅ COMPLIANT (static; runtime on device via 4.3) |
| SSC-1 | No session issues no request | `enabled: !!userId` in all 6 hooks (useProfile:36,42; useBudget:36; useMonthlyTotals:34; useHomeFeed:46; useHistoryEntries:31) | ✅ COMPLIANT (static) |
| SSC-2 Focus | Foreground refetch is stale-only | `query-client.ts:40-43` non-web AppState→`focusManager.setFocused(status==='active')`; `refetchOnWindowFocus: true` (:35); non-zero staleTime ⇒ stale-only | ✅ COMPLIANT (static; device step 4.3.2) |
| SSC-3 Freshness | Fresh read skips network / scan-usage stales sooner / GC eviction | `query-client.ts:20,23,26` DEFAULT 60s / SCAN_USAGE 30s / GC 5min; 30s override `useProfile.ts:43` | ✅ COMPLIANT (static; device steps 4.3.1-2, 4.3.5) |
| SSC-4 Retry | Transient retries then surfaces / definitive never retries | `shouldRetry` `query-adapters.ts:67-74`; harness `shouldRetry retries transient errors up to 2 failures`, `never retries definitive kinds` (features 25/25) | ✅ COMPLIANT (runtime tests) |
| SSC-5 Keys+month | Cross-user isolation / one month derivation | `query-keys.ts` all factories embed userId; `utcYearMonth` :16-18; harness `two users never share a key`, `scan-usage and analytics keys embed the same shared year-month` | ✅ COMPLIANT (runtime tests) |
| SSC-6 Adapters | Failure never caches as success / definitive kind maps to copy / null is success | `toQueryData` `query-adapters.ts:46-57` (ok→data, ok-null→null success, else throw FeatureQueryError); seam diff empty (feature-access.ts + all api.ts untouched); harness `toQueryData throws …`, `treats ok-null as success`, `toQueryErrorMessage maps missing-profile…` | ✅ COMPLIANT (runtime tests) |
| SSC-7 Sign-out | Cache emptied on sign-out | `use-session-store.ts:288` `queryClient.clear()` in SIGNED_OUT branch (co-located w/ session null at :289, fires on bootstrap discards too); harness test seeds `['profile','user-1']` and asserts `findAll().length === 0` after SIGNED_OUT | ✅ COMPLIANT (runtime test; device step 4.3.4) |
| SSC-8 Scan mutation | Success seeds draft / failure leaves store untouched / reset clears | `useScanTicket.ts:42` useMutation; onSuccess seeds store + draftId (:51-59); **no invalidation** (grep: 0 `invalidateQueries`); reset clears error+draftId (:66-69); shape `{isLoading,error,draftId,scan,reset}` | ✅ COMPLIANT (static; device step 4.3.3) |
| SSC-9 Shapes | Consumer screens compile unchanged | typecheck 0 errors; profile.tsx:17 `{user,usage,error,setHouseholdSharing}`, index.tsx:13 `{budget,spent}` + :14 `{categories,receipts,wantsSnacksTotal}`, analytics.tsx:9 `{totals,error}`, review/[id].tsx:41 `{scan,error,reset}`, history.tsx:58 array `.filter` | ✅ COMPLIANT (typecheck gate per SSC-12) |
| SSC-10 Dead hook | No references remain | grep `useCategoryBreakdown` in src/ → 0 matches; `fetchCategoryBreakdown` kept (analytics/index.ts:4, harness assertion test-features.mjs:251) | ✅ COMPLIANT (static + harness) |
| SSC-11 In-memory | Restart clears the cache | no `persist(`/`AsyncStorage`/`kv-store`/`createPersist` in the change; package.json adds only react-query; AsyncStorage hits are pre-existing comments in storage-adapter.ts (file not in diff) | ✅ COMPLIANT (static; device step 4.3.5) |
| SSC-12 No new infra | Typecheck gates / harness assertions survive | no test framework added (test = pre-existing node harness chain); typecheck 0; adapter 14 + auth 50 + features 25 all green; only test-features.mjs/test-auth.mjs adapted | ✅ COMPLIANT (runtime) |
| DA-1 | Signed-in reads / failed read / definitive failure / cached within window / dedupe | useProfile/useBudget/useMonthlyTotals all useQuery + toQueryData + enabled + user-scoped keys; shared `profiles` row deduped (Home budget + Profile share key domain via one client, D1); no fixture fallback; error surfaced via toQueryErrorMessage | ✅ COMPLIANT (static + harness; device step 4.3.1) |
| UA-1 | Sign out / offline revoke / next sign-in sees no previous data | cache clear :288 + session null :289 + root gate (session != null) → sign-in; signOut() offline-revoke handling intact (use-session-store.ts:238-254); harness SIGNED_OUT clear test; userId keys ⇒ B's reads hit DB | ✅ COMPLIANT (runtime test + static; device step 4.3.4) |

**Compliance summary**: 12/12 requirements verified — 9 fully COMPLIANT with runtime/static evidence; the device-runtime aspects of SSC-1/2/3/7/8/11 and UA-1 are COMPLIANT per the spec's own verification contract (SSC-12 explicitly gates hook wiring on `pnpm typecheck` + manual device verification) and pending the 4.3 checklist.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Provider wraps Stack (SSC-1) | ✅ | `_layout.tsx:52` |
| AppState→focusManager non-web (SSC-2) | ✅ | `query-client.ts:40-43` |
| staleTime 60/60/30, gcTime 5min (SSC-3) | ✅ | constants `query-client.ts:20-26`; scan-usage override `useProfile.ts:43` |
| retry 2 gated by kind (SSC-4) | ✅ | `shouldRetry` `query-adapters.ts:67-74` |
| userId-scoped keys + clear on SIGNED_OUT (SSC-5/7, UA-1) | ✅ | `query-keys.ts`; `use-session-store.ts:288` |
| Seam untouched (SSC-6) | ✅ | `git diff` on feature-access.ts + feature api.ts = empty |
| utcYearMonth shared; no `toISOString().slice(0,7)` in hooks (SSC-5) | ✅ | `query-keys.ts:16-18`; remaining slice(0,7) is a doc comment; slice(0,10) hits are pre-existing date-only code in files outside the change |
| Scan as mutation, no invalidation (SSC-8) | ✅ | `useScanTicket.ts`; 0 `invalidateQueries` |
| useCategoryBreakdown gone, fetchCategoryBreakdown kept (SSC-10) | ✅ | 0 refs; `analytics/index.ts:4`; test-features.mjs:251 |
| Hook shapes preserved (SSC-9) | ✅ | all consumers compile; destructures match |
| Feed/history empty-safe stubs (DA-1) | ✅ | `data ?? EMPTY_FEED` (`useHomeFeed.ts:50`), `data ?? []` (`useHistoryEntries.ts:35`) |
| No new test infra; harnesses green (SSC-12) | ✅ | 89/89 re-run |
| No offline persistence (SSC-11) | ✅ | grep clean; dep diff = react-query only |

## Coherence (Design D1-D9)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 module-scope QueryClient singleton | ✅ Yes | `query-client.ts:29` |
| D2 keys + shared utcYearMonth | ✅ Yes | `query-keys.ts` |
| D3 adapter layer + error taxonomy + retry gating | ✅ Yes | `query-adapters.ts`; MISSING_PROFILE_MESSAGE single source (grep: 1 definition) |
| D4 useScanTicket → useMutation, no invalidation | ✅ Yes | documented deviation: `scan` is an async `Promise<void>` wrapper (TS strictness) — public shape unchanged |
| D5 focus wiring + stale-only policy | ✅ Yes | `query-client.ts:40-43` |
| D6 clear in SIGNED_OUT store branch | ✅ Yes | `use-session-store.ts:288` |
| D7 feed/history stubs | ✅ Yes | empty-safe defaults |
| D8 useCategoryBreakdown removal, keep fetchCategoryBreakdown | ✅ Yes | stale doc line ref (see SUGGESTION 1) |
| D9 dependency ^5.101.4 | ✅ Yes | package.json + lockfile |

## Issues Found

**CRITICAL**: None.

**WARNING**:
1. Task 4.3 — manual device verification open (marked `[~]` in tasks.md). Device-runtime confirmation of SSC-2 (stale-only foreground refetch), SSC-3 (freshness/GC on device), SSC-7/UA-1 (cache cleared across sign-out/sign-in), SSC-8 (scan flow seeding + failure path), SSC-11 (restart reloads from DB), and the proposal success criteria remain pending. Not a code defect — no simulator in this environment. Remediation: user runs the 5-item checklist documented in tasks.md (4.3) and records the result.

**SUGGESTION**:
1. `openspec/changes/tanstack-query/design.md` D8 cites "test-features.mjs:228"; the actual `fetchCategoryBreakdown` assertion is `scripts/test-features.mjs:251` (line drift after slice-1 harness extension). Update the line ref for accuracy.
2. Repo hygiene: the working tree carries unrelated unstaged WIP — `src/app/(auth)/sign-in.tsx` (M) and `openspec/changes/auth-supabase-connection/design.md` (D), plus untracked `.agents/`, `opencode.json`, `openspec/config.yaml`, `openspec/specs/`, `supabase/.temp/`, `skills-lock.json`. Keep these out of any PR built from this branch; the committed diff is clean (27 files, all tanstack-query).
3. The scan mutation returns `Promise<void>` via an async wrapper instead of `Promise<{url, parsed}>` (documented D4 deviation, forced by TS object-literal assignability). Public shape unchanged — no action required, recorded for traceability.

## Verdict

**PASS WITH WARNINGS** — implementation fully matches spec/design/tasks on fresh evidence (typecheck 0, lint 0 errors/2 pre-existing warnings, tests 89/89, diff scoped to the change); the only open item is the user-owned manual device checklist (task 4.3), which the spec's verification contract (SSC-12) explicitly delegates to manual device verification. Archive may proceed once 4.3 is run and recorded.
