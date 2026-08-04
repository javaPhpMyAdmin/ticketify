# Proposal: TanStack Query as the data-fetching layer

## Intent

Add `@tanstack/react-query` v5 as the server-state layer to cut DB round-trips AND improve perceived UX. Evidence: `profiles` row read twice per session; analytics RPC duplicated in the seam; no retry; no focus-refetch policy; cross-user leak risk.

## Scope

### In Scope
- Install v5; `src/lib/query-client.ts` (module-scope client, defaults, AppState→focusManager wiring).
- `QueryClientProvider` wraps the `Stack` in `src/app/_layout.tsx`.
- `src/lib/query-keys.ts` — factories with `userId` in every key; one shared UTC `yearMonth` derivation.
- `src/lib/supabase/query-adapters.ts` — throwing adapters at the hook boundary; `feature-access.ts` + api.ts stay the queryFn seam.
- Migrate ALL data hooks: `useProfile` (profile+scan-usage), `useBudget`, `useMonthlyTotals`, `useHomeFeed`, `useHistoryEntries` → `useQuery`; `useScanTicket` → `useMutation`.
- `queryClient.clear()` on SIGNED_OUT (use-session-store.ts:281).
- Remove dead `useCategoryBreakdown` + barrel export.
- Freshness: staleTime 60s (profile/budget, analytics RPC), 30s (scan-usage); gcTime 5min; retry 2, gated (missing-profile/unconfigured never retry).

### Out of Scope
- Offline persistence (no persist-client / AsyncStorage — in-memory only).
- SSR, NetInfo/onlineManager, devtools; replacing the seam; schema changes; jest/RNTL; real purchase reads.

## Capabilities

### New Capabilities
- `server-state-caching`: provider, key factories, throwing adapters, freshness/retry policy, focus refetch, cache lifecycle.

### Modified Capabilities
- `data-access`: reads become cached/deduped/retried via the server-state layer.
- `user-auth`: sign-out MUST clear the in-memory cache (cross-user protection).

## Approach

1. v5 verified compatible (React 19.1 / RN 0.81 / Expo 54).
2. Defaults: per-type staleTime, gcTime 5min, retry 2; `focusManager.setFocused(status === 'active')` from AppState (non-web).
3. Adapters convert seam union → value-or-throw; retry gated by error kind.
4. Keys: `['profile', userId]`, `['scan-usage', userId, yearMonth]`, `['budget', userId]`, `['analytics', 'monthly-totals', yearMonth]`.
5. `enabled: !!userId`; hooks keep public return shapes (screens barely change).

## Affected Areas

| Area | Impact |
|------|--------|
| package.json, `src/app/_layout.tsx`, `use-session-store.ts` | Modified |
| `src/lib/query-client.ts`, `query-keys.ts`, `supabase/query-adapters.ts` | New |
| profile/budget/analytics/home/history/tickets hooks | Modified |
| analytics `useCategoryBreakdown` + barrel | Removed |
| `scripts/test-features.mjs` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Cross-user leak if clear missed | Low | userId keys + clear on SIGNED_OUT |
| Focus-refetch storm | Med | non-zero staleTime defaults |
| Adapter drops message contract | Low | typed errors carry user-safe copy only |
| UTC month drift | Low | single shared derivation |

## Rollback Plan

Revert the PR commit: drop provider/keys/adapters, restore hand-rolled hooks. Pure code revert; gated by `pnpm typecheck` + device pass.

## Dependencies

- `@tanstack/react-query` v5 (new; compatibility verified).

## Success Criteria

- [ ] `pnpm typecheck` + harness adapter tests pass.
- [ ] Device call log: Home→Profile shows no second `profiles` read.
- [ ] Sign-out → next sign-in shows no previous user's data; foreground refetches stale queries only.
