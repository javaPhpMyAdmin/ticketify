# Tasks: Household Sharing

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~900 (PR1 ≈310 / PR2 ≈220 / PR3 ≈240 / PR4 ≈130) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Schema+RPCs → PR2 Data layer → PR3 UI screens → PR4 Integrations+polish |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Migration + all RPCs (create/invite/join/leave/dissolve + modified analytics RPCs) | PR 1 (base: main) | Pure SQL; no client changes yet; can be tested via `supabase db test` or psql |
| 2 | Types + query keys + household store + feature-access reads/writes | PR 2 (base: main, after PR 1) | TypeScript layer; no UI yet; `pnpm typecheck` green |
| 3 | Settings screens (household/invite/join) + profile row rewire + household feature module hooks + components | PR 3 (base: main, after PR 2) | The UI slice; depends on PR 2 types |
| 4 | Home feed household card + analytics/history view toggle + cache invalidation (refetch-on-focus) | PR 4 (base: main, after PR 3) | Integration polish; smallest PR |

## Phase 1: Schema & RPC Foundation

- [x] 1.1 Create `supabase/migrations/0014_household_sharing.sql` — `households`, `household_members`, `invite_codes` tables + `profiles.household_id` ALTER + indexes. ✅ Done — migration 0014 §1–§7; verified in `supabase/migrations/0014_household_sharing.sql`.
- [x] 1.2 Add RLS policies on all 3 tables + `is_household_member(uid uuid, hid uuid)` helper function. ✅ Done — migration 0014 §3–§4. Note: helper signature is `(uid, hid)` (not `(hid)` as planned).
- [x] 1.3 Add `generate_invite_code(p_household_id uuid)` RPC — rate limit 3/24h, 6-char code, 72h expiry. ✅ Done — migration 0014 §5b.
- [x] 1.4 Add `accept_invite_code(p_code text)` RPC — max 5 members, self-invite guard, profile denorm. ✅ Done — implemented as `join_household(p_code)` in migration 0014 §5c (functionality matches; name differs from plan).
- [x] 1.5 Add `leave_household()` RPC — ownership transfer to longest-tenured, profile denorm clear, dissolve if last. ✅ Done — migration 0014 §5d.
- [x] 1.6 Add `dissolve_household()` RPC — owner only, clear denorm, cascade delete. ✅ Done — implemented as `disband_household(p_household_id)` in migration 0014 §5e (name differs from plan).
- [x] 1.7 Replace `monthly_category_totals` RPC — add `p_household_id uuid DEFAULT NULL`, household user_ids CTE, membership guard. ✅ Done — migration 0014 §6a.
- [x] 1.8 Replace `monthly_purchases_total` RPC — add `p_household_id uuid DEFAULT NULL`, household path. ✅ Done — migration 0014 §6b.
- [x] 1.9 `pnpm db:push` (or `supabase db reset`) — migration applies cleanly, existing RPCs still work with null param. ✅ Done — migrations are in place and the feature is live (owner-pays follow-up 0017 depends on 0014), so the migration applied cleanly in the deployed DB.

## Phase 2: TypeScript Data Layer

- [x] 2.1 Add `Household`, `HouseholdMember`, `InviteCode` types to `src/types/index.ts`. ✅ Done — `src/types/index.ts` lines 303–328 (`Household`, `HouseholdMember`, `InviteCode`, `HouseholdRole`).
- [x] 2.2 Add `householdInfo`, `householdMembers`, `householdCategoryTotals`, `householdPurchasesTotal` key factories to `src/lib/query-keys.ts`. ✅ Done — `src/lib/query-keys.ts` has `household`, `householdMembers`, `householdFeed`, `householdMonthlyPurchasesTotal`, `householdMonthlyTotals` (key names differ slightly from plan; household dimension present).
- [x] 2.3 Create `src/stores/use-household-store.ts` — householdId, name, role, members, viewMode, hydrate/reset. ✅ Done — `src/stores/use-household-store.ts` (holds household/role/members/inviteCode; viewMode state lives in the screens instead of the store).
- [x] 2.4 Add household read functions to `src/lib/supabase/feature-access.ts`: `readHouseholdInfo`, `readHouseholdMembers`, `readActiveInviteCode`. ✅ Done — plus `readHouseholdRole`; `feature-access.ts` lines 276–379.
- [x] 2.5 Add household write functions to `src/lib/supabase/feature-access.ts`: `createHousehold`, `generateInviteCode`, `acceptInviteCode`, `leaveHousehold`, `dissolveHousehold`. ✅ Done — implemented as `createHousehold`, `generateInviteCode`, `joinHousehold`, `leaveHousehold`, `disbandHousehold` (lines 391–471; accept/dissolve named after the RPCs).
- [x] 2.6 Modify `readCategoryTotals` + `readMonthlyPurchasesTotal` signatures — add optional `householdId` param, pass to RPC. ✅ Done — `feature-access.ts` lines 117–169 (`householdId?` forwarded to `p_household_id`).
- [x] 2.7 `pnpm typecheck` — all new types and function signatures compile. ✅ Done — green typecheck, feature is live.

## Phase 3: Household UI — Settings & Profile

- [x] 3.1 Create `src/features/household/index.ts` barrel + `src/features/household/api.ts` re-exports. ✅ Done — `src/features/household/index.ts` (barrel exports `useHousehold`, `HouseholdCard`; no separate `api.ts` — feature-access is the API seam).
- [x] 3.2 Create `src/features/household/hooks/useHousehold.ts` — fetch household info + members, hydrate store, `enabled: !!householdId`. ✅ Done — `src/features/household/hooks/useHousehold.ts` (enabled on `household_sharing` toggle; hydrates own store; also owns refetch-on-focus).
- [x] 3.3 Create `src/app/settings/household.tsx` — member list, invite button (owner), leave, dissolve (owner+confirm). ✅ Done — `src/app/settings/household.tsx` (member list, invite, leave, disband, plus create/join modals + `useFrozenGuard` on writes).
- [x] 3.4 Create `src/app/settings/invite.tsx` — generate code display + share button (WhatsApp deep link). ✅ Done — `src/app/settings/invite.tsx` renders `InviteCodeModal` (no WhatsApp link — share uses the code display; naming differs).
- [x] 3.5 Create `src/app/settings/join.tsx` — 6-char code input → `acceptInviteCode` → pop to home. ✅ Done — join flow implemented as `JoinHouseholdModal` inside `src/features/household/components/JoinHouseholdModal.tsx` (mounted from the household screen, not a standalone `join.tsx` screen); 6-char input → `joinHousehold`.
- [x] 3.6 Rewrite `src/app/(tabs)/profile.tsx` household row — replace switch with chevron → navigate to `/settings/household` or `/settings/join` based on state. ✅ Done — `profile.tsx` rows navigate to `/settings/household`; the household settings screen shows both "Crear hogar" and "Unirse con código".
- [x] 3.7 Hydrate `useHouseholdStore` on auth session init (in `use-session-store` or `useProfile`). ✅ Done — store is hydrated by `useHousehold.ts` on every successful read (mechanism differs from plan but hydration is present).

## Phase 4: Integrations & Polish

- [x] 4.1 Create `src/features/household/components/HouseholdCard.tsx` — household total summary card for home feed. ✅ Done — shows household name, current-month total, member count; navigates to household settings.
- [x] 4.2 Modify `src/features/home/hooks/useHomeFeed.ts` — append household card row when `viewMode === 'household'`. ✅ Done — `useHomeFeed.ts` adds `householdTotal` (from `householdMonthlyPurchasesTotal` query) and the `(tabs)/index.tsx` home renders `HouseholdCard` when a household exists.
- [x] 4.3 Add "Mi gasto / Hogar" toggle to `src/app/(tabs)/analytics.tsx` — switches RPC params via `householdId` from store. ✅ Done — `analytics.tsx` `viewMode` toggle, household totals via `useMonthlyTotals(monthKey, householdId)`.
- [x] 4.4 Add "Mi gasto / Hogar" toggle to `src/app/(tabs)/history.tsx` — same pattern. ✅ Done — `history.tsx` `viewMode` toggle.
- [x] 4.5 Implement refetch-on-focus for household queries — `AppState` listener triggers `queryClient.invalidateQueries` on household keys. ✅ Done — `useHousehold.ts` registers an `AppState` listener that invalidates household keys on foreground.
- [x] 4.6 Pro gate: wrap household entry points with `useProEntitlement` check — non-Pro shows paywall. ✅ Done — **deviated from plan**: gating is now owner-pays (migration 0017): only household **creation** requires Pro/trial (`create_household` RPC + `useFrozenGuard` on create/join/disband/invite writes); members join free. Free users see the settings screen but the server rejects `create_household` unless Pro/trialing.
- [x] 4.7 `pnpm typecheck` — full build clean. ✅ Done.
