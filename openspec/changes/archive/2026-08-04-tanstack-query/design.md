# Design: TanStack Query as the data-fetching layer

## Technical Approach

Install `@tanstack/react-query` v5 as the server-state layer. One module-scope `QueryClient` (`src/lib/query-client.ts`) holds freshness/retry defaults and AppState→focus wiring; a `QueryClientProvider` wraps the `Stack` in `src/app/_layout.tsx`. The read seam (`feature-access.ts` + feature `api.ts`) stays untouched and becomes the queryFn source. New throwing adapters (`src/lib/supabase/query-adapters.ts`) convert the seam's `FeatureReadResult` union into data-or-throw at the hook boundary so retry fires and failures never cache as success. Every key is userId-scoped via `src/lib/query-keys.ts`, with one shared UTC month derivation. All data hooks migrate to `useQuery`; `useScanTicket` to `useMutation`; the cache is cleared on SIGNED_OUT. In-memory only; no new test infra.

## Architecture Decisions

### D1: QueryClient — module-scope singleton

| Option | Tradeoff | Decision |
|---|---|---|
| Module-scope singleton in `src/lib/query-client.ts` | One cache/dedupe app-wide; one `clear()` target; stable new module (Fast-Refresh-safe); matches proposal | **Chosen** |
| Per-tree client via `useQueryClient` | Splits cache; no benefit — single provider site | Rejected |
| Per-feature clients | Fragments dedupe across profile/budget (same `profiles` row) | Rejected |

Rationale: one client gives cross-screen dedupe (Home budget + Profile share the `profiles` row) and a single sign-out clear target.

### D2: Query keys + shared month derivation (`src/lib/query-keys.ts`)

Factories (all userId-scoped per spec): `profile(userId) → ['profile', userId]`; `scanUsage(userId, ym) → ['scan-usage', userId, ym]`; `budget(userId) → ['budget', userId]`; `monthlyTotals(userId, ym) → ['analytics', 'monthly-totals', userId, ym]`; `homeFeed(userId) → ['home', 'feed', userId]`; `historyEntries(userId) → ['history', 'entries', userId]`.

`utcYearMonth(d = new Date())` → `` `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` `` — one derivation shared by scan-usage and analytics keys, replacing the duplicated `toISOString().slice(0, 7)` (useProfile.ts:47, useMonthlyTotals.ts:30). Deterministic within a day; the key changes exactly on month rollover, which is when a refetch is correct. The RPC is server-scoped to `auth.uid()`, but its key still embeds userId (defense-in-depth; spec mandates).

### D3: Adapter layer, error taxonomy, retry gating

New pure module `src/lib/supabase/query-adapters.ts`:

| Contract | Behavior |
|---|---|
| `FeatureQueryError extends Error` | `kind: 'missing-profile' \| 'unconfigured' \| 'error'` + user-safe message |
| `toQueryData(result)` | `ok` → data (ok-with-null scan usage stays successful null); every other status throws `FeatureQueryError` |
| `shouldRetry(failureCount, error)` | definitive kinds (`missing-profile`, `unconfigured`) → false; else `failureCount < 2` (v5 default retry=3 overridden) |
| `toQueryErrorMessage(error)` | kind `missing-profile` → `MISSING_PROFILE_MESSAGE`; else `error.message`; non-`FeatureQueryError` → `READ_ERROR_MESSAGE` |

Client default `retry: shouldRetry` — one gate covers every query (all queryFns throw `FeatureQueryError`). Alternatives rejected: per-hook retry options (duplicated, drift); discrimination via raw supabase-js error codes (seam already normalizes; raw codes must not cross it). Hooks compose at the boundary: `queryFn: () => fetchProfile(userId!).then(toQueryData)` — `api.ts` remains the untouched seam. `MISSING_PROFILE_MESSAGE` moves here (single source; currently duplicated in useProfile.ts:17 and useBudget.ts:23).

### D4: `useScanTicket` → `useMutation`

- `mutationFn: async (imageUri) => { const { url } = await uploadToStorage(userId ?? 'anon', imageUri); const parsed = await parseTicket(url); return { url, parsed }; }`
- `onSuccess`: seed `useReceiptsStore` (`startDraft(url)` + store/date/total/items setters) and set `draftId` (local `useState`).
- Shape preserved: `isLoading = mutation.isPending`; `error = mutation.error message`; `reset = mutation.reset() + setDraftId(null)`; `scan` stays `(imageUri) => Promise<void>` (review/[id].tsx `await scan(...)`).
- **Invalidation: none on success.** Parsing writes nothing server-side (purchase writes are stubs); `scan_usage` increments only when a purchase is saved (Phase 5). Pattern to follow when `saveReceipt` becomes real: invalidate `scanUsage`, `monthlyTotals`, `budget`.

### D5: Focus wiring + refetch policy

Module-scope in `query-client.ts` (non-web): `AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'))`. `refetchOnWindowFocus: true` (v5 default) — foreground refetches only *stale* queries because staleTime is non-zero (60/60/30). Options: component `useEffect` with cleanup (docs pattern; Fast-Refresh safe but moves wiring out of the module and diverges from the proposal) vs registry module (auth-listener pattern; overkill) vs **module-scope (chosen)** — a stacked AppState listener is harmless because `setFocused` is idempotent, unlike auth listeners that fired duplicate network upserts.

### D6: Sign-out clear

`queryClient.clear()` in the SIGNED_OUT branch of `initAuthStateListener` (use-session-store.ts:281-283), where `session: null` is set. Alternatives rejected: root-layout effect watching `session` — misses events fired before the effect subscribes (bootstrap discard of an expired token) and duplicates the store's source of truth. Store-side is co-located, synchronous, lifecycle-independent. Import direction auth → lib; no cycle (`query-client.ts` imports only `@tanstack/react-query`, `react-native`, `query-adapters`).

### D7: `useHomeFeed` / `useHistoryEntries`

Become `useQuery` with a stub queryFn resolving the current empty state (`EMPTY_FEED` / `[]`), `enabled: !!userId`, keyed `homeFeed(userId)` / `historyEntries(userId)`. Public shapes preserved (`{ categories, receipts, wantsSnacksTotal }` / `HistoryEntry[]`). Satisfies "ALL data hooks → useQuery" and no-session-no-request; Phase 5 purchase reads swap only the queryFn. Rejected: keep static — violates the provider mandate.

### D8: `useCategoryBreakdown` removal

Delete `hooks/useCategoryBreakdown.ts` + its barrel export (analytics/index.ts:2). **Keep** `fetchCategoryBreakdown` (api.ts + barrel): its only consumer was the dead hook, but the node harness asserts it (test-features.mjs:228) and the spec requires the same harness assertions to keep passing; removing it would force harness edits.

### D9: Dependency

`@tanstack/react-query` `^5.101.4` (caret, repo convention; latest v5 line, verified against React 19.1 / RN 0.81 / Expo 54). Installed via `pnpm add` → `pnpm-lock.yaml`.

## Data Flow

```
Screen → useProfile ── useQuery(['profile', userId], { enabled: !!userId })
           │  queryFn: fetchProfile(userId) [seam, unchanged]
           │    → FeatureReadResult ── toQueryData → data | throw FeatureQueryError
           │  retry gate: shouldRetry(kind, failureCount)   [client default]
           ▼
   QueryClient (module scope, staleTime 60s/30s, gcTime 5min)
           ▲                    ▲
   focusManager.setFocused      clear()
   ← AppState 'active'          ← SIGNED_OUT (session store)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/query-keys.ts` | Create | Key factories + `utcYearMonth` (pure) |
| `src/lib/supabase/query-adapters.ts` | Create | `FeatureQueryError`, `toQueryData`, `shouldRetry`, `toQueryErrorMessage`, `MISSING_PROFILE_MESSAGE` (pure) |
| `src/lib/query-client.ts` | Create | Module-scope client, defaults, focus wiring |
| `package.json`, `pnpm-lock.yaml` | Modify | Add `@tanstack/react-query@^5.101.4` |
| `src/app/_layout.tsx` | Modify | `QueryClientProvider` wraps the `Stack` |
| `src/features/auth/use-session-store.ts` | Modify | `queryClient.clear()` on SIGNED_OUT |
| `src/features/profile/hooks/useProfile.ts` | Modify | Two `useQuery` (profile + scan-usage, 30s staleTime) |
| `src/features/budget/hooks/useBudget.ts` | Modify | `useQuery` over `fetchMonthlyBudget` |
| `src/features/analytics/hooks/useMonthlyTotals.ts` | Modify | `useQuery` over RPC; `enabled: !!userId` added |
| `src/features/home/hooks/useHomeFeed.ts` | Modify | `useQuery` + stub queryFn |
| `src/features/history/hooks/useHistoryEntries.ts` | Modify | `useQuery` + stub queryFn |
| `src/features/tickets/hooks/useScanTicket.ts` | Modify | Rewrite as `useMutation` |
| `src/features/analytics/index.ts` | Modify | Remove `useCategoryBreakdown` export |
| `scripts/tsconfig.feature-test.json`, `scripts/test-features.mjs` | Modify | Include + assert adapters/keys (pure) |
| `src/features/analytics/hooks/useCategoryBreakdown.ts` | Delete | Dead hook (no consumers) |

## Interfaces / Contracts

```ts
// src/lib/supabase/query-adapters.ts — non-obvious retry-gating pattern
export function toQueryData<T>(result: FeatureReadResult<T>): T {
  switch (result.status) {
    case 'ok': return result.data;                       // ok-with-null = success
    case 'missing-profile': throw new FeatureQueryError('missing-profile', READ_ERROR_MESSAGE);
    case 'unconfigured': throw new FeatureQueryError('unconfigured', READ_ERROR_MESSAGE);
    case 'error': throw new FeatureQueryError('error', result.message);
  }
}
// query-client.ts defaultOptions.queries.retry: shouldRetry
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit (node, pure) | `toQueryData` (4 statuses + ok-null), `shouldRetry` gating (definitive → 0 attempts; transient → 2), `toQueryErrorMessage` copy mapping, `utcYearMonth` + key shapes | Extend `scripts/test-features.mjs` (add both files to harness tsconfig include; no React runtime). Existing api-layer assertions untouched |
| Hook wiring | `enabled` gating, keys, staleTime overrides, mutation shape | `pnpm typecheck` + manual device verification (spec: no new test infra) |
| Provider / focus / clear | Provider wraps Stack; foreground stale-only refetch; sign-out wipes cache | Device pass per success criteria (call-log: no second `profiles` read; sign-in B sees no A data) |

## Migration / Rollout

Dependency-safe order (bottom-up; pure modules verified before UI):
1. `pnpm add @tanstack/react-query@^5.101.4`.
2. `query-keys.ts` → 3. `query-adapters.ts` → 4. `query-client.ts`.
5. Extend harness; `pnpm test:features` green (pure layer proven before any hook change).
6. Provider in `_layout.tsx`; `clear()` in session store.
7. Migrate `useProfile`, `useBudget`, `useMonthlyTotals` in one batch (shared `profiles` row — the duplicate round-trip dies together).
8. `useScanTicket` → `useMutation`.
9. `useHomeFeed` / `useHistoryEntries`; delete `useCategoryBreakdown`.
10. `pnpm typecheck`; device pass. Rollback: revert the PR commit (pure code revert, per proposal).

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Cross-user leak | Low | userId in every key + `clear()` on SIGNED_OUT (defense-in-depth) |
| Focus-refetch storm | Med | non-zero staleTime 60/60/30; fresh queries skip network |
| `isLoading` semantics (v5 = pending && fetching) | Low | consumers read `user`/`usage`/`error`/`totals`; matches initial-load behavior |
| Adapter drops message contract | Low | typed errors carry seam copy only; mapping node-tested |
| Non-adapter rejection skips gate | Low | `shouldRetry` falls through to `failureCount < 2` for unknown errors |
| Month rollover mid-session | Low | key changes exactly at rollover → correct refetch |

## Open Questions

None — all forks from proposal/spec resolved (D1–D9).
