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
- Pro tier gating — decision pending (see Open Questions)

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

Before finalizing, these decisions need user input:

1. **Is household sharing a Pro-only feature?** Recommendation: yes — it's premium value that drives subscriptions.
2. **When owner deletes their account, what happens?** Options: (a) dissolve household, (b) transfer ownership to longest-tenured member, (c) prevent account deletion until household is dissolved.
3. **Should the household card show on home feed by default, or only when user taps into household view?** Current exploration suggests always-on card.
4. **Max household members?** Recommendation: 5 (covers couples, roommates, small families).
5. **V1 sharing level: Level B only, or include Level A toggle?** Level B is recommended as default — is Level A needed at all in V1?
