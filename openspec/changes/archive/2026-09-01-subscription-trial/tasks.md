# Tasks: Subscription & Free Trial

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

Estimated changed lines: ~580–720 total (6 PRs, ~100–120 each, all under 400).

| Unit | Goal | PR |
|------|------|----|
| 1 | DB schema + RPCs | 1 |
| 2 | Client store + gate | 2 |
| 3 | Paywall + trial UI | 3 |
| 4 | Frozen write guards | 4 |
| 5 | Household owner-pays | 5 |
| 6 | RevenueCat webhook | 6 |

---

## Phase 1: DB Schema + RPCs (PR 1)

- [x] 1.1 Create `supabase/migrations/0016_trial_subscription.sql` — add `subscription_status` (text, default `'none'`, CHECK) and `trial_ends_at` (timestamptz, nullable) to `profiles`. Backfill Pro users → `'active'`.
- [x] 1.2 Implement `start_free_trial()` RPC — SECURITY DEFINER, validates `trial_ends_at IS NULL` + `subscription_status != 'active'`, sets status=trial, trial_ends_at=now()+5d, tier=pro.
- [x] 1.3 Update `set_profile_tier` — accept pro with `subscription_status='active'` + `trial_ends_at=null`; free with `subscription_status='expired'` when current is trial.
- [x] 1.4 Update `protect_profile_tier` trigger — guard `subscription_status` and `trial_ends_at`; only SECURITY DEFINER may write.

## Phase 2: Client Store + Gate (PR 2)

- [x] 2.1 `src/types/index.ts` — add `SubscriptionStatus` type, extend `User` with `subscription_status` + `trial_ends_at`.
- [x] 2.2 `src/stores/use-pro-store.ts` — add `subscriptionStatus`, `trialEndsAt`, `isTrialing`; populate from DB on refresh.
- [x] 2.3 `src/features/pro/gate.ts` — expand `GateState` to `'locked' | 'unlocked' | 'frozen'`; `resolveGateState` returns `'frozen'` when `subscriptionStatus === 'expired'`.
- [x] 2.4 `src/features/pro/hooks/useProEntitlement.ts` — expose `subscriptionStatus`, `trialEndsAt`, `isTrialing`.
- [x] 2.5 `src/features/pro/pro-bootstrap.tsx` — fetch `subscription_status` + `trial_ends_at` from DB profile on bootstrap.

## Phase 3: Paywall + Trial UI (PR 3)

- [x] 3.1 Create `src/features/pro/components/TrialBanner.tsx` — countdown (days remaining + expiry) when `subscription_status === 'trial'`.
- [x] 3.2 `src/app/pro/index.tsx` — add "Start free trial" CTA; call `startFreeTrial()` RPC; hide when active or trial used.
- [x] 3.3 Add `startFreeTrial` to `src/lib/supabase/feature-access.ts` — wrapper around RPC; update store on success.
- [x] 3.4 `src/features/pro/ProRouteGuard.tsx` — handle `'frozen'`: render children + wrap with `FrozenGuard`.

## Phase 4: Frozen Write Guards (PR 4)

- [x] 4.1 Create `src/features/pro/components/FrozenGuard.tsx` — overlay blocking writes + upgrade CTA.
- [x] 4.2 Apply `FrozenGuard` to scan entry, profile edit, budget edit, and household manage write actions.
- [x] 4.3 `src/app/(tabs)/profile.tsx` — trial countdown banner + frozen-state banner with upgrade CTA.

## Phase 5: Household Owner-Pays (PR 5)

- [x] 5.1 Update `create_household` — check `tier='pro' OR subscription_status IN ('trial', 'active')`.
- [x] 5.2 Update `join_household` — remove Pro tier check; any authenticated user with valid invite joins.
- [x] 5.3 Update `generate_invite_code` — remove Pro tier check (owner validated at create).
- [x] 5.4 Remove client-side Pro gate on household toggle (profile.tsx) so free users can join households.

## Phase 6: RevenueCat Webhook (PR 6)

- [x] 6.1 Add webhook handler for `TRIAL_STARTED`/`TRIAL_ENDED` — call `set_profile_tier` with correct status.
- [x] 6.2 On `INITIAL_PURCHASE`: set `subscription_status='active'`, `trial_ends_at=null`, `tier='pro'`.
- [x] 6.3 Add `syncSubscriptionStatus` helper to `feature-access.ts` — manual sync on launch when RC SDK available.
