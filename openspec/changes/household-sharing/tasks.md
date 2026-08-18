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

- [ ] 1.1 Create `supabase/migrations/0014_household_sharing.sql` — `households`, `household_members`, `invite_codes` tables + `profiles.household_id` ALTER + indexes [~80 lines]
- [ ] 1.2 Add RLS policies on all 3 tables + `is_household_member(hid uuid)` helper function [~50 lines]
- [ ] 1.3 Add `generate_invite_code(p_household_id uuid)` RPC — rate limit 3/24h, 6-char code, 72h expiry [~30 lines]
- [ ] 1.4 Add `accept_invite_code(p_code text)` RPC — max 5 members, self-invite guard, profile denorm [~45 lines]
- [ ] 1.5 Add `leave_household()` RPC — ownership transfer to longest-tenured, profile denorm clear, dissolve if last [~40 lines]
- [ ] 1.6 Add `dissolve_household()` RPC — owner only, clear denorm, cascade delete [~15 lines]
- [ ] 1.7 Replace `monthly_category_totals` RPC — add `p_household_id uuid DEFAULT NULL`, household user_ids CTE, membership guard [~30 lines]
- [ ] 1.8 Replace `monthly_purchases_total` RPC — add `p_household_id uuid DEFAULT NULL`, household path [~20 lines]
- [ ] 1.9 `pnpm db:push` (or `supabase db reset`) — migration applies cleanly, existing RPCs still work with null param

## Phase 2: TypeScript Data Layer

- [ ] 2.1 Add `Household`, `HouseholdMember`, `InviteCode` types to `src/types/index.ts` [~30 lines]
- [ ] 2.2 Add `householdInfo`, `householdMembers`, `householdCategoryTotals`, `householdPurchasesTotal` key factories to `src/lib/query-keys.ts` [~15 lines]
- [ ] 2.3 Create `src/stores/use-household-store.ts` — householdId, name, role, members, viewMode, hydrate/reset [~40 lines]
- [ ] 2.4 Add household read functions to `src/lib/supabase/feature-access.ts`: `readHouseholdInfo`, `readHouseholdMembers`, `readActiveInviteCode` [~55 lines]
- [ ] 2.5 Add household write functions to `src/lib/supabase/feature-access.ts`: `createHousehold`, `generateInviteCode`, `acceptInviteCode`, `leaveHousehold`, `dissolveHousehold` [~50 lines]
- [ ] 2.6 Modify `readCategoryTotals` + `readMonthlyPurchasesTotal` signatures — add optional `householdId` param, pass to RPC [~10 lines]
- [ ] 2.7 `pnpm typecheck` — all new types and function signatures compile

## Phase 3: Household UI — Settings & Profile

- [ ] 3.1 Create `src/features/household/index.ts` barrel + `src/features/household/api.ts` re-exports [~10 lines]
- [ ] 3.2 Create `src/features/household/hooks/useHousehold.ts` — fetch household info + members, hydrate store, `enabled: !!householdId` [~50 lines]
- [ ] 3.3 Create `src/app/settings/household.tsx` — member list, invite button (owner), leave, dissolve (owner+confirm) [~90 lines]
- [ ] 3.4 Create `src/app/settings/invite.tsx` — generate code display + share button (WhatsApp deep link) [~45 lines]
- [ ] 3.5 Create `src/app/settings/join.tsx` — 6-char code input → `acceptInviteCode` → pop to home [~50 lines]
- [ ] 3.6 Rewrite `src/app/(tabs)/profile.tsx` household row — replace switch with chevron → navigate to `/settings/household` or `/settings/join` based on state [~20 lines]
- [ ] 3.7 Hydrate `useHouseholdStore` on auth session init (in `use-session-store` or `useProfile`) [~15 lines]

## Phase 4: Integrations & Polish

- [ ] 4.1 Create `src/features/household/components/HouseholdCard.tsx` — household total summary card for home feed [~45 lines]
- [ ] 4.2 Modify `src/features/home/hooks/useHomeFeed.ts` — append household card row when `viewMode === 'household'` [~20 lines]
- [ ] 4.3 Add "Mi gasto / Hogar" toggle to `src/app/(tabs)/analytics.tsx` — switches RPC params via `householdId` from store [~25 lines]
- [ ] 4.4 Add "Mi gasto / Hogar" toggle to `src/app/(tabs)/history.tsx` — same pattern [~20 lines]
- [ ] 4.5 Implement refetch-on-focus for household queries — `AppState` listener triggers `queryClient.invalidateQueries` on household keys [~15 lines]
- [ ] 4.6 Pro gate: wrap household entry points with `useProEntitlement` check — non-Pro shows paywall [~15 lines]
- [ ] 4.7 `pnpm typecheck` — full build clean
