# Exploration: TanStack Query as the data-fetching layer

> Status: success. Research + mapping only — no code written, no source files edited.
> Artifact store: hybrid (this file + engram `sdd/tanstack-query/explore`).

## Executive summary

Add `@tanstack/react-query` v5 as the server-state layer for the native Expo app (no SSR).
The app's reads already funnel through a single, well-tested seam (`src/lib/supabase/feature-access.ts`
→ feature `api.ts`), but the hooks above it are hand-rolled `useEffect`+`useState` with no cache, no
dedup, no retry, and no cross-screen sharing. The concrete DB-bottleneck wins are: (1) the `profiles`
row is fetched twice per app session (Home budget card + Profile screen), (2) the analytics RPC has a
duplicate query seam (`useMonthlyTotals` + dead `useCategoryBreakdown`), (3) no focus/foreground
refetch policy exists today and none will exist correctly without React Query. Recommended first slice:
provider + query-key factory + migrate the three real read hooks (`useProfile`, `useBudget`,
`useMonthlyTotals`), keeping the existing seam as the queryFn layer; persistence and mutation flows
deferred.

## A. Current data-fetching architecture

### The seams (what exists today)

| Layer | File | Role |
|-------|------|------|
| Client | `src/lib/supabase.ts` | `createClient` + `isSupabaseConfigured` const (placeholder-key guard, L97-101). Never throws on import. |
| Read seam | `src/lib/supabase/feature-access.ts` | `readProfileRow` (L38), `readScanUsageRow` (L60), `readMonthlyBudgetRow` (L79), `readCategoryTotals` (L105 — RPC `monthly_category_totals`). All return discriminated `FeatureReadResult<T>` = `ok \| missing-profile \| unconfigured \| error`; never throw; `console.warn` on PostgREST errors. |
| Feature APIs | `src/features/{profile,budget,analytics}/api.ts` | Thin wrappers over the seam (`fetchProfile`, `fetchScanUsage`, `fetchMonthlyBudget`, `fetchMonthlyTotals`, `fetchCategoryBreakdown`). `setHouseholdSharing` and all of `tickets/api.ts` (`uploadToStorage`, `parseTicket`, `saveReceipt`) are stubs/no-ops. |
| Hooks | `src/features/*/hooks/*.ts` | Hand-rolled `useEffect`+`useState` with a `cancelled` flag, `isLoading`/`error` state, status-union mapping in JSX. |
| Session | `src/features/auth/use-session-store.ts` (zustand) + `use-session-user.ts` | Hooks gate reads on `userId` (null → "Sign in to load…" error). Store fires SIGNED_OUT → `session: null`; root gate unmounts app screens. |
| Provider layer | `src/app/_layout.tsx` | **No provider exists today.** Zustand stores are module-level. Root gate is `Stack.Protected guard={session != null}` (L58). A `QueryClientProvider` wraps the `Stack` here. |

### The hooks (state shapes today)

- `useProfile` (profile/hooks/useProfile.ts:26-89) — `Promise.all([fetchProfile(userId), fetchScanUsage(userId, yearMonth)])`; `yearMonth` computed in-hook (L47); maps all 4 statuses; couples two reads so one failure/blocking read delays both.
- `useBudget` (budget/hooks/useBudget.ts:28-68) — single read of `profiles.monthly_budget`; `NEUTRAL_BUDGET` fallback; `spent` hardcoded 0 (no purchase reads yet).
- `useMonthlyTotals` (analytics/hooks/useMonthlyTotals.ts:13-62) — RPC read; `yearMonth` in-hook (L30, **UTC-based**); `useMemo` total derivation. Consumed by `analytics.tsx:9`.
- `useCategoryBreakdown` (analytics/hooks/useCategoryBreakdown.ts:13-55) — same RPC, parameterized by `yearMonth`. **Dead hook: exported in the barrel, consumed nowhere.** Both it and `useMonthlyTotals` wrap the same `readCategoryTotals` (analytics/api.ts:19-30) — a latent duplicate-query seam.
- `useHomeFeed` (home/hooks/useHomeFeed.ts:31) / `useHistoryEntries` (history/hooks/useHistoryEntries.ts:19) — static empty returns, no reads yet. No migration needed now.
- `useScanTicket` (tickets/hooks/useScanTicket.ts:28-74) — mutation-shaped: manual `isLoading`/`error`/`draftId`, upload+parse pipeline, seeds the zustand `useReceiptsStore`. Review screen adds a fake 2 s delay + `setTimeout` (ticket/review/[id].tsx:46-52). Defer to `useMutation` until the write/parse stubs become real.

### Hotspots (file:line evidence)

1. **Same-row duplicate read** — Home mounts `useBudget` → `readMonthlyBudgetRow` (profiles, select `monthly_budget, currency`) while Profile mounts `useProfile` → `readProfileRow` (profiles, select `*`). Same table, same user, two round-trips, zero sharing (feature-access.ts:38 vs :79).
2. **Duplicate RPC seam** — `fetchMonthlyTotals` and `fetchCategoryBreakdown` both call `readCategoryTotals` (analytics/api.ts:19-30); only one is consumed today, so mounting both = 2 RPCs for identical data.
3. **No retry/backoff** — one attempt per mount; a transient network blip is a permanent error until remount. The seam's never-throw contract also means React Query's retry won't fire unless the adapter throws (see B).
4. **No focus/foreground policy** — nothing refetches on app foreground today; when React Query lands with `refetchOnWindowFocus: true` + AppState wiring, every foreground will refetch **all stale** queries. Without a non-zero default `staleTime` this is the focus storm the user is trying to avoid.
5. **Cross-user cache risk (future)** — safe today only because sign-out unmounts everything. With a cache, keys MUST include `userId` and the cache MUST be cleared on SIGNED_OUT (use-session-store.ts:281-283) or user B sees user A's rows.
6. **UTC month drift** — `useMonthlyTotals` and `useProfile` derive `yearMonth` with `new Date().toISOString().slice(0, 7)` while screens hardcode display months ("August 2026" analytics.tsx:14, history.tsx:100). Query keys must use one consistent derivation, or cache hits will be missed near month boundaries.

## B. TanStack Query fit (v5, Expo/RN, Supabase)

### Package and version

- `@tanstack/react-query` **v5** (latest 5.9x line, verified against current docs). Compatible with React 19.1 / RN 0.81 / Expo SDK 54 (new arch). **Not installed** — package.json has zero `@tanstack` deps.
- Companion packages only if needed later: `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` (offline persistence); `@tanstack/react-query-devtools-rn` (devtools).

### RN/Expo gotchas (verified against TanStack v5 docs)

- **focusManager**: RN has no `window` focus events. Must wire `AppState` → `focusManager.setFocused(status === 'active')` (guarded `Platform.OS !== 'web'`). Without it `refetchOnWindowFocus` never fires; with it, foreground triggers refetch — of *stale* queries only, which is exactly the desired behavior once `staleTime` is set.
- **onlineManager / `refetchOnReconnect`**: needs NetInfo (`@react-native-community/netinfo`) or `expo-network` — **neither installed**. Without wiring, RN always reports online. Optional; defer with NetInfo to a follow-up (the app is not offline-first today).
- **networkMode**: keep the default `'online'`. `'always'` is only for polling (`refetchInterval`) — not used here.
- **Offline persistence**: persister requires an AsyncStorage-compatible storage. The app has **no AsyncStorage** and SecureStore is the wrong tool for a cache (2048-byte values, secrets only). Options, if/when wanted: install `@react-native-async-storage/async-storage`, or `expo-sqlite/kv-store` (verified: official AsyncStorage drop-in, works in Expo Go, SDK 54). **Recommend deferring persistence out of slice 1** — in-memory cache + `gcTime` already kills the round-trip problem across screens/tab switches.
- **Screen-focus refetch**: expo-router's `useFocusEffect` + `refetchQueries({ stale: true, type: 'active' })` pattern exists if per-screen focus refetch is ever wanted. Not needed in slice 1.

### Recommended patterns (the "avoid DB bottlenecks" recipe)

- One module-scope `QueryClient` in a new `src/lib/query-client.ts` with defaults: `staleTime: 30_000–60_000` (the single biggest round-trip lever), `gcTime: 5 * 60_000` (default), `retry: 2` (backoff default), `refetchOnWindowFocus: true`, `refetchOnMount: true`. Per-query overrides for freshness-sensitive data.
- **Query key factory per feature**, keys include every queryFn variable **and the userId** (session isolation): e.g. `['profile', userId]`, `['scan-usage', userId, yearMonth]`, `['budget', userId]`, `['analytics', 'monthly-totals', yearMonth]`.
- **`enabled: !!userId`** from `useSessionUser()` — replaces the `useEffect` guard declaratively.
- **queryFn adapter that throws**: the seam's discriminated union must be converted at the hook boundary — non-`ok` statuses become a typed thrown error carrying the user-safe message. If the union is kept as *data*, React Query caches `error` results as successes and never retries. Throwing also lets `retry` be gated by error kind (`missing-profile`/`unconfigured` are definitive — never retry; transient/network — retry).
- **Mutations** (`useMutation` + `queryClient.invalidateQueries`): today only no-op writes exist (`setHouseholdSharing`, `saveReceipt`); the invalidation pattern should be established when the first real write lands (Phase 5 purchase insert → invalidate `['analytics', ...]`, `['budget', userId]`, future `['history', ...]`).
- **Sign-out**: `queryClient.clear()` in the SIGNED_OUT listener (use-session-store.ts:281-283) — cross-user cache bleed prevention, with `userId` in keys as defense-in-depth.

### Concrete bottleneck risks found (current architecture)

Ranked by round-trip cost: (1) profiles row fetched twice per session (Home + Profile) — eliminated by shared `['profile', userId]`/`['budget', userId]` keys; (2) analytics RPC duplicated in the api seam — single key fixes the latent duplicate; (3) no retry on transient failures → user-facing errors on one-off blips; (4) no focus policy → either stale data forever (today) or a foreground refetch storm (if wired without `staleTime`). React Query solves all four; the storm risk is managed by the default `staleTime`.

## C. Migration surface

### Consumers (verified by grep)

| Hook | Consumer | Notes |
|------|----------|-------|
| `useProfile` | `src/app/(tabs)/profile.tsx:17` | 2 queries (profile + scan-usage). Migrate. |
| `useBudget` | `src/app/(tabs)/index.tsx:13` | Same `profiles` row as profile — must migrate in the same slice or the duplicate round-trip survives. Migrate. |
| `useMonthlyTotals` | `src/app/(tabs)/analytics.tsx:9` | Migrate. |
| `useCategoryBreakdown` | none (dead export) | Proposal decision: remove, or wire a future per-month screen. |
| `useHomeFeed` / `useHistoryEntries` | `index.tsx:14`, `history.tsx:58` | Static — untouched. |
| `useScanTicket` | `ticket/review/[id].tsx:41` | Defer to `useMutation` when parse/save stubs become real. |
| `useTransactionBreakdown` | `history.tsx:41` | Pure derived hook — untouched. |

### Seam decision

**Keep** `feature-access.ts` + feature `api.ts` as the queryFn seam (recommended). It is the single
place enforcing the "never crash on a failed read" policy, already harness-tested, and its
discriminated union is a clean transport contract. The new throwing adapters live at the hook
boundary (new small module, e.g. `src/lib/supabase/query-adapters.ts`), so the seam stays pristine
and the existing `scripts/test-features.mjs` keeps passing unchanged. Do **not** bypass the seam.

### Files for slice 1

- `package.json` — add `@tanstack/react-query` (v5).
- `src/lib/query-client.ts` (new) — client + defaults + AppState/focus wiring.
- `src/lib/supabase/query-adapters.ts` (new) — union → value-or-throw adapters per read.
- `src/lib/query-keys.ts` (new) — key factories (or fold into adapters module).
- `src/app/_layout.tsx` — wrap the `Stack` in `QueryClientProvider`.
- `src/features/auth/use-session-store.ts` — `queryClient.clear()` on SIGNED_OUT.
- `src/features/{profile,budget,analytics}/hooks/*.ts` — rewrite to `useQuery` (public return shapes can stay the same so screens barely change).
- `scripts/` — extend the node harness (see testing).

### Testing approach

- The node harness (`scripts/test-features.mjs`) compiles real TS modules with tsc and remaps `@/lib/supabase` → `scripts/test-stubs/supabase.ts` (`__setTableRead`, `__setRpcResult`, `__setSupabaseConfigured`, `__getCallLog`). It tests the **api layer, not the hooks**.
- **Slice 1**: keep that harness untouched; add harness tests for the new adapters (pure functions — union → value-or-throw, error-message mapping). No React runtime needed.
- **Hook wiring** (enabled gating, keys, staleTime) is **not node-testable today**: no test runner, React 19 deprecated `react-test-renderer`, `@testing-library/react-native` not installed, `config.yaml` says `Testing: None configured` with `verify: build_command: pnpm typecheck`. Recommend accepting typecheck + manual device verification for hook wiring in slice 1 (consistent with project posture); adding jest + `@testing-library/react-native` is a separate change (open question).
- Deterministic `initialData`/`placeholderData` are available for renderer-based tests later.

### First-slice scope (with tradeoffs)

| Option | Scope | Effort | Pros | Cons |
|--------|-------|--------|------|------|
| **A — recommended** | Provider + focus wiring + key factory + adapters + migrate `useProfile`/`useBudget`/`useMonthlyTotals` + cache clear on sign-out | ~250–350 changed lines | Kills the concrete duplication hotspots; establishes keys/invalidation patterns; seam + harness untouched; trivial rollback; fits review budget | Mutations and persistence untouched; `useScanTicket` stays hand-rolled (fine — its writes are stubs) |
| B — full | A + `useScanTicket`→`useMutation` + `persistQueryClient` + NetInfo/onlineManager + devtools | ~600–900 lines | Everything | New deps (persister + storage), larger diff, higher risk, beyond this bottleneck goal |
| C — do nothing | — | 0 | No new dep | Round-trip problems persist and multiply when real purchase reads (history/home feed) land |

**Recommendation: Option A.** The task suggested "provider + migrate analytics reads"; expand that to
include profile + budget because they share the `profiles` row — leaving `useBudget` hand-rolled while
`useProfile` moves to React Query would keep the biggest duplicate round-trip alive.

## Open questions for the proposal round

1. **staleTime defaults per data type** — what staleness is acceptable for profile/budget, scan-usage, and the analytics RPC in a receipt app? (Suggestion: 60 s profile/budget, 60 s analytics, 30 s scan-usage; all can be longer while writes are stubs.)
2. **Dead hook `useCategoryBreakdown`** — remove it (dead export), or is a per-month breakdown screen planned that should consume it with a `yearMonth` key?
3. **Offline persistence** — in this change (needs a storage decision: `@react-native-async-storage/async-storage` vs `expo-sqlite/kv-store`) or deferred to a follow-up? (Recommend defer; SecureStore is the wrong tool for a cache.)
4. **Sign-out cache policy** — `clear()` all vs `removeQueries` scoped by `userId`, and should USER_UPDATED/TOKEN_REFRESHED invalidate profile reads?
5. **Testing posture** — keep hook wiring on typecheck + manual device verification (current posture), or add jest + `@testing-library/react-native` as part of this change?

## Risks

- Cross-user cache leak if sign-out clearing is missed (mitigate: key by userId + clear on SIGNED_OUT).
- Focus-refetch storm if `staleTime` is left at 0 with AppState wiring.
- Adapter layer must preserve the user-safe message contract (raw PostgREST text must never reach the UI — the seam's policy).
- Hook return-shape churn: keep `isLoading`/`error`/data field names stable so screens are minimally touched.

## Ready for proposal

Yes. Concrete seam, hooks, hotspots, fit, and a bounded first slice are mapped. Send the 5 open
questions above to the user with the proposal round.
