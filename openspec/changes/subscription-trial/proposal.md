# Proposal: Subscription & Free Trial

## Intent

Ticketify currently has a binary Pro/Free model. Users need a risk-free way to evaluate PRO features before committing. Without a trial, conversion relies on trust alone — the paywall is a hard wall. Adding a user-activated 5-day trial with a "freeze" expiry model (read-only, no data loss) lets users experience full PRO value while preserving a clear upgrade path.

## Scope

### In Scope
- 5-day user-activated free trial (one per user, tracked in DB)
- `subscription_status` field (`none | trial | active | expired`) on profiles
- Trial-aware gate states including `frozen` (expired trial: reads work, writes blocked)
- Paywall "Start free trial" CTA
- Trial countdown/status display on profile
- Frozen-state write guards (scan, edit profile, edit budgets, manage household)
- Household owner-only-pays rule (members participate free)
- RevenueCat webhook sync for trial lifecycle events

### Out of Scope
- RevenueCat dashboard offering setup (operational, not code)
- Device/install-level trial abuse prevention (deferred — RevenueCat eligibility handles this)
- Trial expiry push notifications
- Trial-to-paid conversion nudges or marketing screens

## Capabilities

### New Capabilities
- `subscription-trial`: Trial activation, lifecycle, DB state, RPC, gate expansion, frozen-state writes
- `household-owner-pays`: Owner-only subscription requirement, member-free participation rule

### Modified Capabilities
- `data-access`: Subscription state reads (trial_ends_at, subscription_status) added to profile reads

## Approach

**Hybrid (DB-authoritative + RevenueCat sync):**
1. DB migration adds `trial_ends_at` and `subscription_status` columns to `profiles`
2. `start_free_trial()` RPC: sets trial end = now() + 5 days, status = 'trial', validates one-trial-per-user
3. Client store (`use-pro-store`) expands with `isTrialing`, `trialEndsAt`, `subscriptionStatus`
4. `gate.ts` gains `'frozen'` GateState — expired trial shows data, blocks writes
5. RevenueCat webhook syncs `trial_started` / `trial_ended` / `INITIAL_PURCHASE` → updates subscription_status
6. Household SQL functions updated: `create_household` checks owner tier only, `join_household` removes tier check

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | trial_ends_at, subscription_status columns + start_free_trial RPC |
| `src/stores/use-pro-store.ts` | Modified | Trial state fields |
| `src/features/pro/gate.ts` | Modified | Frozen GateState |
| `src/features/pro/hooks/useProEntitlement.ts` | Modified | Trial-aware entitlement |
| `src/app/pro/index.tsx` | Modified | Trial CTA button |
| `src/lib/revenuecat.ts` | Modified | Trial event handling |
| `src/types/index.ts` | Modified | subscription fields on User |
| `src/lib/supabase/feature-access.ts` | Modified | Subscription state reads |
| `src/features/household/` | Modified | Owner-only pays rule |
| `src/app/(tabs)/profile.tsx` | Modified | Trial status display + frozen overlay |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Trial abuse (multiple accounts) | Med | RevenueCat trial eligibility + DB one-trial-per-user constraint |
| Frozen-state UX confusion | Med | Clear overlay messaging, disabled buttons, "Upgrade to unlock" CTA |
| Migration backward compatibility | Low | Existing Pro users: trial_ends_at=null, subscription_status='active' |
| Offline trial expiry | Low | Graceful degradation — client checks trial_ends_at locally on launch |
| RevenueCat webhook delay | Low | DB is fast-read source; webhook is sync, not real-time gate |

## Rollback Plan

- Drop `trial_ends_at` and `subscription_status` columns (no data loss — trial users revert to free)
- Revert `start_free_trial` RPC
- Revert gate.ts to binary locked/unlocked
- Revert household SQL to member-requires-Pro
- RevenueCat webhook: skip trial events (no-op)
- All changes are additive — no existing Pro user behavior affected

## Dependencies

- RevenueCat dashboard: trial-eligible offerings configured (operational prerequisite)
- Existing `set_profile_tier` RPC and `protect_profile_tier` trigger (already built)

## Success Criteria

- [ ] User can activate trial via paywall CTA; DB reflects trial_ends_at + subscription_status='trial'
- [ ] During trial: full PRO access (all gated features unlocked)
- [ ] On trial expiry: data visible, all writes blocked with clear frozen-state UX
- [ ] Household members can participate without subscription; only owner requires Pro
- [ ] Existing Pro users unaffected (subscription_status='active', no trial state)
- [ ] RevenueCat webhook correctly syncs trial lifecycle to DB
