# Design: RevenueCat Trial Migration

> **Migration id**: `0039_rc_trial_cutover.sql` (next free after `0038_legal_acceptances`).
> **External precondition (release-gate)**: per-product intro offer "Free trial, 7 days" configured in Play Console + App Store Connect + RevenueCat dashboard BEFORE merge. Owner action — documented in runbook.
> **Reversibility**: <1h via the reverse of the 9-step migration (rollback file `0040_rc_trial_rollback.sql`, shipped alongside).

## Technical Approach

One DB migration cuts the DB-trial plumbing over; one client slice (split per work-unit) drops the trial UI surface; the webhook and `getOfferings` get the smallest possible edits. The store shrinks to `{ isPro, isLoading, everPaid }`; the gate reverts to binary `'locked' | 'unlocked'`. The paywall `PlanButton` projects the Play/App-Store intro phase into a thin caption above the price; the profile pill reads the entitlement's `periodType === 'TRIAL'` from `CustomerInfo` (NOT the dropped DB column). Operational gating on the dashboards is the real release-gate.

## Architecture Decisions

### ADR-1: Caption visibility on Android `UNKNOWN`

| | |
|---|---|
| **Choice** | Show the intro caption on Android when `introPhase !== null`, regardless of `INTRO_ELIGIBILITY_STATUS` (Android always returns `UNKNOWN`). Hide when `INELIGIBLE` / `NO_INTRO_OFFER_EXISTS` (iOS only). |
| **Alternatives** | (a) Always hide on `UNKNOWN` — duplicates nothing, but hides the 7-day message from first-time users. (b) Always show — duplicates Play's native sheet but stays consistent across platforms. |
| **Rationale** | The Android SDK cannot tell us trial eligibility — Play owns that decision and re-states terms in its native checkout sheet. Hiding on `UNKNOWN` would suppress a true 7-day trial from every first-time Android user. Worst case is duplicate copy; worst case for hiding is a hidden upgrade signal. Accept the duplicate, suppress only when we KNOW the user is ineligible. |

### ADR-2: Backfill semantics

| | |
|---|---|
| **Choice** | Step 1 backfill `UPDATE profiles SET subscription_status='active', tier='pro', trial_ends_at=NULL WHERE subscription_status='trial' AND trial_ends_at > now()` — preserve in-window trials, leave past-window rows to expire naturally. |
| **Alternatives** | (a) Backfill ALL `'trial'` rows (in + out of window) — keeps Pro access past `trial_ends_at`, but they have no scheduled charge. (b) Leave rows alone — the CHECK narrowing in step 5 then fails. |
| **Rationale** | Step (a) gives in-window users exactly the experience RC will give them (Pro until their window closes) PLUS the option to subscribe via Play if they want to keep it. The alternative is leaving them free mid-trial, which is a worse UX. Past-window users: cron already flipped them to `'expired'` (0020/0035). The narrow window where `status='trial' AND trial_ends_at <= now()` is the cron-lag edge; backfilling those too is consistent with the cutover intent (no DB trial exists anymore) and the user's task explicitly calls this out. |

### ADR-3: Gate simplification scope (drop the 3rd state)

| | |
|---|---|
| **Choice** | Drop `'frozen'` from `GateState`. `resolveGateState(isPro, isLoading)` becomes 2-arg. `useFrozenGuard` becomes a no-op stub. All call sites in `settings/{category-budgets,budget,household}.tsx` and `(tabs)/index.tsx` drop the import + `guard()` calls. |
| **Alternatives** | (a) Keep `'frozen'` as a synonym for "blocked during an RC-managed trial" — adds complexity (RC state must flow into the gate), no UX gain. (b) Re-purpose `'frozen'` to mean "ever_paid + not Pro" — different semantics, would mask the upgrade CTA from a returning free user. |
| **Rationale** | The frozen window existed to block writes between DB trial expiry and a paid subscription. With no DB trial, the freeze window does not exist. A user mid-RC-trial is `isPro === true` (entitlement active) — gate unlocks normally. After conversion (paid), still `isPro === true`. After expiry (cancel), `isPro === false`, gate locks. No state falls through the cracks; the 2-state gate is sufficient and simpler. |

### ADR-4: Profile pill source (`CustomerInfo`, never DB)

| | |
|---|---|
| **Choice** | Source the "trial ends on {{date}}" pill from `CustomerInfo.entitlements.all.pro` (`periodType === 'TRIAL'` + `expirationDate`). Degrade to a plain "Pro" chip when `expirationDate` is null or `periodType` is not `'TRIAL'`. Never read `profiles.trial_ends_at` — the column is dropped. |
| **Alternatives** | (a) Drop the pill entirely — cleaner UX but loses the in-trial affordance. (b) Project `periodType === 'TRIAL'` from a side-channel store subscription fetched on every bootstrap — redundant with the entitlement listener already wired up. |
| **Rationale** | The exploration surfaces `periodType === 'TRIAL'` + `expirationDate` as the canonical signals; RC types confirm both. We already attach `addCustomerInfoUpdateListener` once per process — the same listener that drives `isPro` can drive a derived `trialEndsAt` field on the store. No new SDK calls. Degradation is graceful (no count-down text when the date isn't derivable). |

### ADR-5: Operational gating as a release precondition (NOT code)

| | |
|---|---|
| **Choice** | Document the per-product intro offer "Free trial, 7 days" in Play Console + App Store Connect + RevenueCat dashboard as a release-gate item in the PR description. Merge is blocked until the operator confirms all three surfaces. No code-flag gates the rollout (Play offer controls eligibility, not our code). |
| **Alternatives** | (a) Build an in-app flag that hides intro caption until offer is confirmed — duplicate mechanism, Play still re-states terms, weak signal. (b) Add an env-gated `EXPO_PUBLIC_RC_TRIAL_ENABLED` flag — same as (a). |
| **Rationale** | The intro offer is a dashboard configuration on a per-product basis; the caption renders whether or not the offer exists (Play already shows "Free trial, 7 days" in the native sheet if the offer is configured). The release gate exists at the configuration layer, not the code layer. The PR description's release checklist + EAS internal-testing verification of the Play sheet IS the gate. Rollback = disable intro offers in dashboards; existing paid users unaffected. |

## Data Flow

### Cutover (one-shot, inside the migration)

```
                  ┌─────────────────────────────────────────┐
                  │ 0039_rc_trial_cutover.sql (single tx)    │
                  └─────────────────────────────────────────┘
                                       │
   ┌───────────────────────────────────┼────────────────────────────────────┐
   │  ① backfill: trial→active WHERE in_window                           │
   │  ② ALTER trial_ends_at DROP NOT NULL                                │
   │  ③ REVOKE EXECUTE start_free_trial, expire_overdue_trials           │
   │  ④ DROP FUNCTION start_free_trial, expire_overdue_trials             │
   │  ⑤ ALTER CHECK → ('none','active')                                  │
   │  ⑥ ALTER DROP COLUMN trial_ends_at                                   │
   │  ⑦ cron.unschedule('trial-expiry')                                  │
   │  ⑧ CREATE OR REPLACE sync_subscription_status('none'|'active' ONLY) │
   │  ⑨ CREATE OR REPLACE set_profile_tier (no trial case)               │
   │     + protect_profile_tier trigger (drop trial_ends_at guards)      │
   └─────────────────────────────────────────────────────────────────────┘
```

### Post-cutover purchase (no DB trial)

```
User taps PlanButton
        │
        ▼
RevenueCat.purchasePackage(identifier)
        │
        ├──[ Play Store shows "Free trial, 7 days, then $X.XX/month" ]──▶ user confirms
        │
        ▼
customerInfo.entitlements.all.pro.isActive = true
        │
        ▼
SDK customerInfoUpdate listener → store.setPro(true), store.setEverPaid(true)
        │
        ▼
RevenueCat webhook → set_profile_tier('pro')
        │
        ▼
DB profiles.tier='pro', subscription_status='active', scans_limit=NULL
```

### Post-cutover trial → conversion (no DB involvement)

```
User starts intro trial in Play Store (7-day window)
        │
        ▼
Play keeps the trial entitlement active for 7 days; charge scheduled at day 8
        │
        ▼
customerInfo.entitlements.all.pro.periodType = 'TRIAL'
        │                            .expirationDate = D+7
        ▼
SDK listener → store.isPro=true, derived store.trialEndsAt=D+7
        │
        ▼
Profile pill: "Prueba · Termina {{date}}" (sourced from CustomerInfo)
Paywall caption: "7 días gratis, después $X.XX/mes" (sourced from getOfferings.introPhase)
        │
        ├──[ D+7 ]──▶ Play auto-charges → INITIAL_PURCHASE webhook → set_profile_tier('pro')
        │             │ periodType flips to 'NORMAL' (or 'INTRO' if a discounted intro)
        │             │ pill hidden, caption stays for users who haven't tapped yet
        │
        └──[ user cancels before D+7 ]──▶ EXPIRATION webhook → set_profile_tier('free')
                                          │ isPro=false, gate locks, paywall CTA re-appears
```

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/0039_rc_trial_cutover.sql` | **Create** | 9-step cutover (diagram above) |
| `supabase/migrations/0040_rc_trial_rollback.sql` | **Create** | Reverse order (add column nullable → restore CHECK → recreate RPCs from 0016/0020/0021 → re-add pg_cron → restore webhook branches) |
| `supabase/tests/trial-cutover.sql` | **Create** | 4-scenario smoke: (a) backfill idempotent, (b) CHECK rejects `'trial'`/`'frozen'`/`'expired'`, (c) `start_free_trial` gone, (d) `expire_overdue_trials` gone |
| `supabase/tests/trial-freeze-guard.sql` | **Delete** | Whole file (295 lines) — the freeze vector doesn't exist post-cutover |
| `supabase/functions/revenuecat-webhook/index.ts` | Modify | Drop `mapTrialStatus` import + step 11 call. Keep `ever_paid` on `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION` (step 11b unchanged). |
| `supabase/functions/revenuecat-webhook/lib/event-types.ts` | Modify | Drop `TRIAL_STARTED`/`TRIAL_ENDED` from `ALLOWED_EVENT_TYPES`/`GRANT_EVENT_TYPES`/`REVOKE_EVENT_TYPES`/`TRIAL_EVENT_TYPES`; drop `mapTrialStatus`. `isRealGrant` unchanged. |
| `src/lib/revenuecat.ts` | Modify | Extend `OfferingPackage` with `introPhase: { priceAfterTrial, trialDays, cycles } \| null`. Extend `getOfferings()`: Android iterates `product.defaultOption.pricingPhases` filtering `offerPaymentMode === 'FREE_TRIAL'`; iOS reads `product.discounts[].type === 'FREE_TRIAL'`. Add `checkTrialOrIntroEligibility(identifier)` wrapper. |
| `src/features/pro/gate.ts` | Modify | `GateState = 'locked' \| 'unlocked'` (drop `'frozen'`). `resolveGateState(isPro, isLoading)` becomes 2-arg. |
| `src/features/pro/hooks/useProEntitlement.ts` | Modify | Drop `subscriptionStatus`/`trialEndsAt`/`isTrialing`/`isFrozen`/`daysRemaining`. Keep `isPro`/`isLoading`/`refresh`/`everPaid`. Add `trialEndsAt: string \| null` derived from `CustomerInfo.entitlements.all.pro.expirationDate` when `periodType === 'TRIAL'`. |
| `src/stores/use-pro-store.ts` | Modify | Drop `subscriptionStatus`/`trialEndsAt`/`isTrialing`/`isFrozen` fields + `deriveTrialState` helper. Add `trialEndsAt: string \| null` (CustomerInfo-sourced). `setSubscriptionState` becomes `setProEntitlement({ isPro, trialEndsAt, everPaid })`. |
| `src/features/pro/pro-bootstrap.tsx` | Modify | Drop `expireOverdueTrials` call (lines 56, 94-106) and the `syncSubscriptionFromDB` self-heal logic. The `customerInfoUpdate` listener also derives `trialEndsAt` from the entitlement. |
| `src/features/pro/hooks/useFrozenGuard.ts` | Modify | Stub: returns `{ isFrozen: false, guard: (action) => action() }`. Keeps the call-site shape so the migration is mechanical. |
| `src/features/pro/components/TrialBanner.tsx` | **Delete** | Whole file. |
| `src/features/pro/ProRouteGuard.tsx` | Modify | Drop `isFrozen` destructure; `resolveGateState(isPro, isLoading)`. |
| `src/app/pro/index.tsx` | Modify | Drop `handleStartTrial`/`canStartTrial`/`trialLoading`/`trialStartCTA`/`trialStartSubtitle`/`trialStartBillingNote`/`trialExpiredTitle`/`trialExpiredSubtitle`/`trialActiveDays` blocks. Extend `PlanButton` to accept `introPhase` prop and render caption above price. Keep compliance disclosure block. |
| `src/app/(tabs)/profile.tsx` | Modify | Collapse 5-branch subscription block to 2 (`active` → manage-subscription row; `inactive` → free + "Ver planes"). Render the trial pill when `trialEndsAt !== null`. Drop `subscriptionStatus`/`trialEndsAt`/`daysRemaining`/`isFrozen` reads. |
| `src/app/(tabs)/index.tsx` | Modify | Drop `useFrozenGuard` import + `TrialBanner` import + mount. |
| `src/app/settings/{category-budgets,budget,household}.tsx` | Modify | Drop `useFrozenGuard` import + `guard()` calls (no replacement — gate handles it). |
| `src/types/index.ts` | Modify | `SubscriptionStatus = 'none' \| 'active'` (drop `'trial'\|'expired'`). Drop `trial_ends_at` from `User` (keep `subscription_status`, `ever_paid`). |
| `src/lib/supabase/feature-access.ts` | Modify | Delete `startFreeTrial` (lines 870-884). Drop `expireOverdueTrials` (lines 909-927). Keep `syncSubscriptionStatus` but call it with `'active'` only (the RPC allow-list narrows in step ⑧). |
| `src/i18n/locales/{es-AR,en,pt-BR}/pro.json` | Modify | Drop `trialBannerDays_one/_other`, `trialStartCTA`, `trialStartSubtitle`, `trialStartBillingNote`, `trialExpiredTitle`, `trialExpiredSubtitle`, `errorTrialAlreadyUsed`, `errorTrialStartFailed`. Re-source `trialActiveDays_one/_other` to "Prueba · Termina {{date}}"-style pill (or keep the active-days copy as the trial-active fallback when no date is derivable). Add `planIntroCaption: "{{trialDays}} días gratis, después {{priceAfterTrial}}/mes"` (and locale parallels). Add `trialPill: "Prueba · Termina {{date}}"`. |
| `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` | Modify | Drop `trialActive`, `trialExpired`, `startFreeTrial` (5-branch source keys). |
| `scripts/test-pro-gating.mjs` | Modify | Drop the 5 frozen-state assertions. Rewrite the 1000-iteration properties for binary `resolveGateState(isPro, isLoading)`. Keep idempotency + return-type guard. |
| `scripts/test-delete-account.mjs` | Modify | Drop `trialEndsAt`/`isTrialing`/`isFrozen` from the reset call (lines 152-160). |
| `scripts/test-stubs/pro.ts` | Modify | `useFrozenGuard` stub returns `{ isFrozen: false, guard: (action) => action() }`. |
| `scripts/test-db-smoke.mjs` | Modify | Drop lines 151-152 (`trial-freeze-guard.sql` invocation). Add `supabase/tests/trial-cutover.sql` invocation. |
| `.github/workflows/ci.yml` | Modify | Drop the `trial-freeze-guard SQL smoke test` step (lines 97-106). Add `trial-cutover SQL smoke test` step. Update `pro-subscription.sql` smoke test expectations (drop `trial_ends_at` column assertion). |
| `supabase/tests/pro-subscription.sql` | Modify | Drop `trial_ends_at` column assertion (lines 60-64). Keep `subscription_status`, `ever_paid`, `set_profile_tier`, `webhook_events`, `protect_profile_tier` trigger, quota objects. |

## Component / Route Map

```
                        ┌─────────────────────┐
                        │  CustomerInfo (RC)   │
                        └──────────┬───────────┘
                                   │ addCustomerInfoUpdateListener
                                   ▼
                        ┌─────────────────────┐         ┌─────────────────────┐
                        │  useProStore         │────────▶│ useProEntitlement    │
                        │ { isPro, isLoading,  │         │ { isPro, isLoading,  │
                        │   trialEndsAt,       │         │   trialEndsAt,       │
                        │   everPaid }         │         │   refresh, everPaid }│
                        └──────────┬───────────┘         └──────────┬───────────┘
                                   │                              │
              ┌────────────────────┼──────────────────────────────┤
              ▼                    ▼                              ▼
   ┌─────────────────┐  ┌─────────────────────┐         ┌──────────────────┐
   │ ProRouteGuard   │  │ Profile             │         │ Paywall          │
   │ resolveGate     │  │ active/inactive row │         │ PlanButton +     │
   │ (binary)        │  │ + manageSubscription│         │ intro caption    │
   └─────────────────┘  │ + trial pill (RC)   │         └──────────────────┘
                        └─────────────────────┘
```

Removed: `TrialBanner`, `useFrozenGuard` (stub), the 5-branch profile block, the dashed trial CTA + billing note, the active-trial countdown card.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (gate) | `resolveGateState(isPro, isLoading)` binary truth table | `scripts/test-pro-gating.mjs`: 4-row enumeration + 1000-iteration loading-wins property. Drop all frozen-state assertions. |
| Unit (wrapper) | `getOfferings()` projects `introPhase` correctly per platform | Mock `Purchases` in a new `scripts/test-revenuecat-offerings.mjs` harness: fixture `product.defaultOption.pricingPhases` with `offerPaymentMode='FREE_TRIAL'`, fixture `product.discounts` with `type='FREE_TRIAL'`. Assert the projected shape per package. |
| Integration (webhook) | Slimmed event-type switch | `scripts/test-webhook-idempotency.mjs`: feed synthetic `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION`/`CANCELLATION`/`EXPIRATION`/`BILLING_ISSUE`/`SUBSCRIPTION_PAUSED`/`NON_RENEWING_PURCHASE` events; assert `set_profile_tier` called with right arg per event. Feed `TRIAL_STARTED`/`TRIAL_ENDED`; assert 200 no-op. |
| DB smoke | Cutover migration | `supabase/tests/trial-cutover.sql`: 4 scenarios from task description. Runs in `db-smoke` CI job alongside `pro-subscription.sql` (drop `trial_ends_at` assertion) and `household-gate-tier.sql` (unchanged). |
| i18n | Drop dead keys, add new | `scripts/test-i18n-detector.mjs`: assert no orphan `trialStartCTA`/`trialStartSubtitle`/`trialStartBillingNote`/`trialBannerDays`/`trialExpiredTitle`/`trialExpiredSubtitle`/`errorTrialAlreadyUsed`/`errorTrialStartFailed` keys remain; assert `planIntroCaption` + `trialPill` present in all 3 locales with `{{trialDays}}` + `{{priceAfterTrial}}` / `{{date}}` interpolation tokens. |
| Manual (release gate) | Play + App Store intro offer visible in native sheet | EAS internal-testing build → Play "Manage subscription" → tap intro-eligible Plan → assert Play sheet shows "Free trial, 7 days, then $X.XX/month". Documented in PR checklist. |

## Migration / Rollout

**Cutover** (`0039_rc_trial_cutover.sql`):

1. **Backfill** — `UPDATE profiles SET subscription_status='active', tier='pro', trial_ends_at=NULL WHERE subscription_status='trial' AND trial_ends_at > now()`. Idempotent: re-running matches no rows.
2. **`ALTER COLUMN trial_ends_at DROP NOT NULL`** — preserves column for rollback; no data loss.
3. **`REVOKE EXECUTE`** on `start_free_trial`, `expire_overdue_trials` from `anon`/`authenticated`.
4. **`DROP FUNCTION IF EXISTS start_free_trial`**, `expire_overdue_trials`.
5. **Narrow CHECK**: `ALTER TABLE profiles DROP CONSTRAINT …, ADD CONSTRAINT … CHECK (subscription_status IN ('none', 'active'))`. Step 1 ensures no `'trial'`/`'frozen'` rows; CHECK rejects `'trial'`/`'expired'` from this point forward.
6. **`ALTER TABLE profiles DROP COLUMN trial_ends_at`** — irreversible without backup.
7. **`SELECT cron.unschedule('trial-expiry')`** — kills the 6-hourly job.
8. **Refactor `sync_subscription_status(uuid, text)`** to accept only `'none' | 'active'` (the `(uuid, text, timestamptz)` overload becomes `(uuid, text)` with a narrowed allow-list).
9. **Drop trial guards in `protect_profile_tier`** trigger (trial_ends_at INSERT/UPDATE guards go away). `set_profile_tier` simplifies (no `'trial' → 'expired'` case branch).

**Operational gating (NOT in the migration)**:
- Play Console: per-product intro offer "Free trial, 7 days" BEFORE merge (release-gate item).
- App Store Connect: per-product "Free Trial" intro pricing.
- RevenueCat dashboard: mirror the intro offers per product.
- EAS build + Play internal testing → verify trial in checkout → promote to production.

**Migration of users (one-time, in step 1)**: in-flight trial users become Pro with no scheduled charge. If a user is on day 4 of 5, they keep Pro until day 5 (no renewal). After cutover they subscribe via Play if they want to continue. No email/notification — users don't lose anything they paid for; they gain a clearer "subscribe via Play" path.

## Rollback Runbook (<1h)

**Code rollback**:
1. `git revert <merge-sha>` — restores dashed CTA, banner, `'frozen'` gate. Re-mergeable since step 1 of migration is backfill-only.

**Schema rollback** (if 0039 applied; ship `0040_rc_trial_rollback.sql`):
1. `ALTER TABLE profiles ADD COLUMN trial_ends_at timestamptz DEFAULT NULL` — nullable.
2. `ALTER TABLE profiles DROP CONSTRAINT …_none_active_check, ADD CONSTRAINT … CHECK (subscription_status IN ('none', 'trial', 'active', 'expired'))` — restore CHECK.
3. Re-create `start_free_trial()` from `0016 §2` (verbatim).
4. Re-create `expire_overdue_trials()` from `0020` (or `0035 §2` if you want status-independence).
5. Re-schedule pg_cron: `cron.schedule('trial-expiry', '0 */6 * * *', 'select public.expire_overdue_trials();')`.
6. Re-add `webhook` branches for `TRIAL_STARTED` / `TRIAL_ENDED` (the existing 4-arg allow-list version of `sync_subscription_status`).
7. Restore `protect_profile_tier` `trial_ends_at` guards (0021 §6 shape).

**Operational rollback**:
- Disable intro offers in Play Console + App Store Connect + RevenueCat dashboard. Existing paid users unaffected. Webhook idempotency means reverted code reconciles cleanly on next event.

## Open Questions

None — the design follows the task's locked decisions. The only operator judgment is the dashboard intro offer setup (release-gate, documented in runbook).
