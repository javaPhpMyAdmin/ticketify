# Proposal: Household Sharing

## Intent

Uruguayan couples and roommates who share expenses currently manage Ticketify independently — scanning their own receipts with no visibility into each other's spending. This forces manual reconciliation via WhatsApp ("¿cuánto gastaste en supermercado?"). Household sharing lets them see aggregated spending per category, per store, and per month, reducing coordination friction while preserving per-person privacy.

## Scope

### In Scope (V1)
- Household creation (owner) and join (invite code)
- Code-based invite flow: 6-char alphanumeric, 72h expiry, single-use, max 3 active/24h
- Two-role model: Owner (manages household) vs Member (scans, views)
- Default sharing Level B: totals + categories + store names (no individual items)
- Shared household monthly budget alongside existing per-user budgets
- "Hogar" card on home feed showing household total
- "Mi gasto / Hogar" toggle on History and Analytics screens
- Household settings screen (members, codes, budget, leave/dissolve)
- Modified RPCs (`monthly_category_totals`, `monthly_purchases_total`) with household scope

### Out of Scope
- Level C full sharing (receipt images, individual items) — V2
- Owner confirmation of new members — V2
- Co-owner role — V2
- Multi-currency households — V2
- Realtime push for member receipt sync — V2 (V1 uses focus-triggered refetch)
- Pro tier gating — resolved to **owner-pays** (see Proposal Question Round, Q1)

## Capabilities

### New Capabilities
- `household-sharing`: Household CRUD, invite code lifecycle, member management, permissions, shared feed views

### Modified Capabilities
- `data-access`: RPCs gain optional `p_household_id` parameter for household-scoped reads; query keys extend with household dimension
- `category-budgets`: Household total budget stored on `households.monthly_budget`, displayed in household card

## Approach

RPC-only household queries — existing user-scoped RLS stays untouched. New tables (`households`, `household_members`, `household_invites`) with RLS policies via `is_household_member()` helper. Client decides personal vs household query path based on active household state.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | 3 tables, 3 RPCs, modified 2 RPCs, RLS policies |
| `src/lib/supabase/feature-access.ts` | Modified | Household-scoped read paths |
| `src/lib/query-keys.ts` | Modified | Household dimension on relevant keys |
| `src/features/home/api.ts` | Modified | Household feed queries |
| `src/features/home/hooks/useHomeFeed.ts` | Modified | Merged personal + household feed |
| `src/stores/use-settings-store.ts` | Modified | Household state (id, members, role) |
| `src/features/profile/api.ts` | Modified | Household write operations |
| `src/app/(tabs)/profile.tsx` | Modified | Toggle triggers create/join/settings |
| `src/types/index.ts` | Modified | Household, Member, InviteCode types |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cache staleness across members | Med | Focus-triggered refetch (V1), Realtime (V2) |
| Code forwarding / unintended joins | Low | Single-use + 72h expiry |
| RPC parameter backward compat | Low | Optional param with null default, existing callers unaffected |

## Rollback Plan

Household sharing is additive. Rollback: disable household toggle (feature flag or remove toggle), drop new tables/migration. Existing data and queries are untouched — new tables and columns are isolated.

## Dependencies

- Supabase RPC security invoker pattern (already established)
- Existing TanStack Query cache architecture

## Success Criteria

- [ ] Owner creates household, generates code, shares via WhatsApp
- [ ] Invitee enters code, joins household, sees household data
- [ ] Home feed shows "Hogar" card with aggregated household total
- [ ] History/Analytics toggle switches between personal and household views
- [ ] Household members cannot see each other's individual items (Level B)
- [ ] Leave/dissolve household works correctly with no orphaned data

## Proposal Question Round

Decisions below were resolved in the implementation where noted. Unresolved
items remain open for product input.

1. **Is household sharing a Pro-only feature?** → **Resolved: owner-pays, not all-Pro-only.** Migration `0017_household_owner_pays.sql` requires only the household **creator** to be Pro or trialing (`tier='pro'` OR `subscription_status IN ('trial','active')`); members join and participate free. Client gates creation via `create_household` RPC + `useFrozenGuard`, and lets free users reach the join flow.
2. **When owner deletes their account, what happens?** → **Pending.** Ownership transfer on manual leave is implemented (`leave_household` promotes the longest-tenured member), but no automatic account-deletion hook (trigger or webhook) exists yet. See design.md Open Questions.
3. **Should the household card show on home feed by default, or only when user taps into household view?** → **Resolved: always-on when a household is active.** `HouseholdCard` renders on the home feed whenever `household_sharing` is enabled and a household exists.
4. **Max household members?** → **Resolved: 5** (owner + 4), enforced server-side in `generate_invite_code`/`join_household` and surfaced as `MAX_MEMBERS = 5` in the settings UI.
5. **V1 sharing level: Level B only, or include Level A toggle?** → **Resolved: Level B only.** `get_household_feed` returns totals + category + store names, never individual items. Level A is not in V1.
