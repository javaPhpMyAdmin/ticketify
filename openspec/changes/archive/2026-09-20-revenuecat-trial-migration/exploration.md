# Exploration: RevenueCat Trial Migration

> **Goal**: replace the DB-driven `start_free_trial()` flow with RevenueCat's
> native introductory offers (`freeTrialPeriodType: FREE_TRIAL`), so Play
> Console / App Store Connect handle the trial window end-to-end (checkout,
> auto-charge after trial, eligibility). Strip the custom trial plumbing
> (`trial_ends_at`, `start_free_trial`, `expire_overdue_trials`, `frozen`
> state, `TrialBanner` countdown, 5-day paywall CTA).

---

## Current State

### Trial activation surface (CLIENT)
- `src/lib/supabase/feature-access.ts:876-884` — `startFreeTrial()` calls
  the `start_free_trial` RPC, which writes `trial_ends_at = now()+5d` and
  `subscription_status='trial'` to Supabase ONLY (no Play Store
  subscription is created). The user has Pro access for 5 days inside the
  app but Play/App Store never sees a subscription, so there is no
  auto-charge to migrate to.
- `src/lib/supabase/feature-access.ts:895-907` — `syncSubscriptionStatus()`
  client-side optimistic sync; called from the paywall after purchase
  (`src/app/pro/index.tsx:111-113, 136-138`).
- `src/lib/supabase/feature-access.ts:919-927` — `expireOverdueTrials()`
  client bootstrap call; called from `src/features/pro/pro-bootstrap.tsx:104-106`
  when DB says `'trial'` but `trial_ends_at <= now()`.

### Trial activation surface (DB)
- `supabase/migrations/0016_trial_subscription.sql` — adds
  `subscription_status text CHECK in ('none','trial','active','expired')` +
  `trial_ends_at timestamptz` to `profiles`. Creates `start_free_trial()`
  RPC (0016 §2), `sync_subscription_status()` RPC (0016 §3), extends
  `set_profile_tier()` to sync `subscription_status` (0016 §4), extends
  `protect_profile_tier()` trigger (0016 §5).
- `supabase/migrations/0020_trial_expiry.sql` — `expire_overdue_trials()`
  RPC + pg_cron `trial-expiry` job (every 6 hours). Flips overdue trials
  to `expired` + `free` + clears `trial_ends_at` + resets scan quota.
- `supabase/migrations/0021_ever_paid_and_save_consume.sql` — adds
  `profiles.ever_paid`; backfills from real payers + webhook_events
  ledger; re-creates `start_free_trial()` with the ever_paid guard
  (former paid users can never trial again); `mark_ever_paid()` RPC;
  `consume_scan_on_save()` RPC; `protect_profile_tier()` extended to
  guard `ever_paid`.
- `supabase/migrations/0034_household_gate_tier.sql` — gates
  `create_household` on `tier='pro'` ONLY (not `subscription_status`),
  removes `'active'` from `sync_client_subscription` allow-list (webhook-
  reserved). Trial access kept via `tier='pro'` flipped by `start_free_trial`
  and `expire_overdue_trials`.
- `supabase/migrations/0035_trial_freeze_guard.sql` — §1 adds the
  active-trial guard to `sync_client_subscription` (an active trial may
  only self-claim `'trial'`); §2 makes `expire_overdue_trials` status-
  independent (keys on `trial_ends_at <= now()` + `tier='pro'`, excluding
  `ever_paid=true` paid subscribers).

### Trial gate state (CLIENT)
- `src/features/pro/gate.ts:22-33` — `resolveGateState(isPro, isFrozen,
  isLoading)`: `'locked' | 'unlocked' | 'frozen'`. The `'frozen'` state
  exists ONLY for trial expiry.
- `src/stores/use-pro-store.ts:35-49, 84-106, 128-142` — Pro store keeps
  `subscriptionStatus`, `trialEndsAt`, `isTrialing`, `isFrozen`, `everPaid`.
  `deriveTrialState()` computes `isFrozen` from
  `(subscriptionStatus === 'expired' && trialEndsAt !== null) ||
  (subscriptionStatus === 'trial' && trialEndsAt in past)`.
- `src/features/pro/hooks/useProEntitlement.ts:23-69` — surface for
  screens.
- `src/features/pro/hooks/useFrozenGuard.ts:36-57` — write-blocking dialog
  when frozen. Mounted in `src/app/settings/category-budgets.tsx:70`,
  `src/app/settings/budget.tsx:50`, `src/app/settings/household.tsx:69`,
  `src/app/(tabs)/index.tsx:96`.
- `src/features/pro/ProRouteGuard.tsx:54-55` — uses the gate; `'frozen'`
  renders children with the dialog guard.
- `src/features/pro/components/TrialBanner.tsx` — countdown banner
  rendered on the home tab (`src/app/(tabs)/index.tsx:218`).

### Paywall UI
- `src/app/pro/index.tsx:148-170` — `handleStartTrial()` calls
  `startFreeTrial()`, sets the store optimistically
  (`setSubscriptionState('trial', trialEnd.toISOString())`). Hard-codes
  `5 * 24 * 60 * 60 * 1000` ms = 5 days locally.
- `src/app/pro/index.tsx:230-265` — dashed-border CTA
  "Empezar prueba gratis" + `trialStartSubtitle` "5 días gratis" +
  `trialBillingNote` "Después se cobra automáticamente salvo que canceles
  antes." This is the conflict surface with legal-compliance copy: today
  NOTHING automatically charges the user.
- `src/app/pro/index.tsx:174-178` — `canStartTrial = status==='none' &&
  trialEndsAt===null && !isFrozen && !everPaid`.
- `src/app/pro/index.tsx:399-464` — `PlanButton` shows
  `priceString + period` only. Does NOT surface introductory-price info.
- `src/app/pro/index.tsx:314-350` — autoRenewal + cancellation + Terms/Privacy
  disclosure block (already Play-compliant; mostly unchanged by migration
  — just the trial CTA above the disclosure goes away).

### Profile screen
- `src/app/(tabs)/profile.tsx:34, 236-372` — full 4-branch status block:
  active / active-trial (badge + days remaining) / frozen (expired trial)
  / expired-but-normalized (free plan, "Ver planes") / free (with
  ever_paid check). The trial-countdown branch and the "Empezar prueba
  gratis" link are the migration removal targets.

### Webhook flow
- `supabase/functions/revenuecat-webhook/index.ts:343-398` — webhook maps
  `INITIAL_PURCHASE / RENEWAL / UNCANCELLATION / TRIAL_STARTED` →
  `set_profile_tier('pro')`; then for `TRIAL_STARTED / TRIAL_ENDED` it
  ALSO calls `sync_subscription_status('trial'|'expired')`.
  `TRIAL_CONVERTED` is NOT in the map; trial → paid conversion lands as
  `INITIAL_PURCHASE` (already paid) and `set_profile_tier('pro')` flips
  status to `'active'`.
- `supabase/functions/revenuecat-webhook/lib/event-types.ts:70-73` —
  `TRIAL_EVENT_TYPES = { TRIAL_STARTED, TRIAL_ENDED }`. `mapTrialStatus`
  maps these to `'trial'` / `'expired'`. `isRealGrant` excludes trial —
  `ever_paid` only flips on real INITIAL_PURCHASE/RENEWAL/UNCANCELLATION.
- Today the webhook already speaks "trial" (TRIAL_STARTED / TRIAL_ENDED).
  After migration the **store** should still see `subscriptionStatus` for
  UI parity (so the countdown banner / status pill keep working), but the
  source of truth moves from our DB to RevenueCat.

### RevenueCat SDK surface (verified against installed types)
- `node_modules/@revenuecat/purchases-typescript-internal/dist/offerings.d.ts`
  - `INTRO_ELIGIBILITY_STATUS` enum (UNKNOWN/INELIGIBLE/ELIGIBLE/NO_INTRO_OFFER_EXISTS).
  - `IntroEligibility { status, description }`.
  - `SubscriptionOption { id, storeProductId, productId, pricingPhases, ... }`.
  - `PricingPhase { billingPeriod: Period, recurrenceMode, billingCycleCount, price, offerPaymentMode }`.
  - `Period { unit: PERIOD_UNIT (DAY/WEEK/MONTH/YEAR/UNKNOWN), value, iso8601 }`.
  - `OFFER_PAYMENT_MODE.FREE_TRIAL = 'FREE_TRIAL'` (Google Play only).
  - `PurchasesStoreProductDiscount` — iOS introductory discount fields.
- `node_modules/react-native-purchases/dist/purchases.d.ts:453-455` —
  `checkTrialOrIntroductoryPriceEligibility(productIdentifiers)` (iOS
  only; Android always returns UNKNOWN).
- `node_modules/react-native-purchases/dist/purchases.d.ts` (general) —
  `getOfferings()` returns `PurchasesOffering.current.{monthly,annual,
  ...}`; each `PurchasesPackage` has `product: PurchasesStoreProduct`
  with `defaultOption` / `subscriptionOptions` (Android) or
  `discounts[]` (iOS). Pricing phase iteration is the canonical way to
  read intro offer terms client-side.

### Tests that touch trial
- `scripts/test-pro-gating.mjs` — truth table for `resolveGateState`:
  asserts the `'frozen'` state exists. After migration `isFrozen` is
  removed; `resolveGateState(isPro, isLoading)` becomes a 2-arg function.
  Every frozen-state assertion in this file must drop or be reworked.
- `scripts/test-delete-account.mjs:152-160` — resets the pro store with
  `subscriptionStatus: 'none', trialEndsAt: null, isTrialing: false,
  isFrozen: false, everPaid: false`. The shape stays if we keep
  `everPaid` (we should); the trial fields drop.
- `scripts/test-stubs/pro.ts` — `useFrozenGuard` stub for budget-month-
  local harness. Stays (we keep the guard for the case where a trial-
  active user is mid-edit, but the trigger becomes "trial still active in
  RC", not "trial expired").
- `supabase/tests/pro-subscription.sql:54-70` — asserts `subscription_status`,
  `trial_ends_at`, `ever_paid` columns exist. After migration
  `trial_ends_at` drops; the others stay.
- `supabase/tests/trial-freeze-guard.sql` — entire file (295 lines)
  becomes obsolete: `sync_client_subscription` no longer has the active-
  trial guard (no client-writable trial status), `expire_overdue_trials`
  no longer exists, fixture identities `e0000000-...-f*` drop.
- `scripts/test-db-smoke.mjs:151-152` — runs
  `supabase/tests/trial-freeze-guard.sql`; the line and the file drop.

### i18n surface (3 locales × `pro.json`)
- `src/i18n/locales/{es-AR,en,pt-BR}/pro.json` lines that change vs
  become obsolete:
  - KEPT: `chartsTitle`, `paywallTitle`, `lockTitle`, `lockBody`,
    `lockActionLabel`, `manageSubscription`, `manageSubscriptionHint`,
    `paywallHeaderTitle`, `benefitUnlimitedScans`, `benefitAdvancedStats`,
    `benefitExportTickets`, `benefitPriceAlerts`, `paywallHeaderSubtitle`,
    `planMonthly`, `planAnnual`, `planPerMonth`, `planPerYear`,
    `subscribeAction`, `loadingPlans`, `noPlansAvailable`,
    `restorePurchases`, `cancelBack`, `autoRenewalNotice`,
    `cancellationNotice`, `termsAndConditionsLink`, `privacyPolicyLink`,
    `legalPrefix`, `errorPurchaseFailed`, `errorRestoreFailed`,
    `errorRestoreNone`, `errorSyncDelayed`, `errorPurchaseCancelled`,
    `errorNetwork`, `errorGeneric`. (`errorSyncDelayed` wording may want
    a tweak — it currently implies the purchase should be reflected
    immediately; with native trial the wording is "trial or subscription
    syncing".)
  - OBSOLETE: `trialActiveDays_one/_other`, `trialBannerDays_one/_other`,
    `trialExpiredTitle`, `trialExpiredSubtitle`, `trialStartCTA`,
    `trialStartSubtitle`, `trialStartBillingNote`,
    `errorTrialAlreadyUsed`, `errorTrialStartFailed`.
  - NEW: an introductory-offer surface if we choose to show "7 days free,
    then $X.XX/month" in the paywall. Play/App Store already shows this in
    the native checkout sheet — duplicating it is redundant but may be
    desired for the in-app paywall before the user taps. Optional — see
    open questions.
- `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` keys:
  - `trialActive`, `trialExpired`, `startFreeTrial` — drop
    (or stay as dead copy if the screen surface stays for a few weeks).
- `src/i18n/locales/{es-AR,en,pt-BR}/common.json` —
  `subscription.daysRemaining_one/_other` — keep (may be reused by the
  countdown if any; or drop if banner goes).

---

## Affected Areas

### REMOVE
- `src/lib/supabase/feature-access.ts:876-884` — `startFreeTrial()`
- `src/lib/supabase/feature-access.ts:919-927` — `expireOverdueTrials()`
- `src/features/pro/hooks/useFrozenGuard.ts` — write-blocking on
  `'frozen'`. The frozen state disappears; if we keep the guard for
  write-gating during an RC-managed trial, the implementation changes.
- `src/features/pro/components/TrialBanner.tsx` — countdown banner
  (RC shows its own countdown in the native sheet; we can keep a simpler
  "trial ends on {{date}}" pill on the profile if desired).
- `src/app/pro/index.tsx:148-170` (`handleStartTrial`), `174-178`
  (`canStartTrial`), `230-265` (dashed trial CTA), `220-228` (active
  trial countdown).
- `src/app/(tabs)/profile.tsx:269-295` (active-trial branch with badge),
  `297-316` (expired-trial branch), `359-372` (start-free-trial CTA).
- `src/app/(tabs)/index.tsx:218` (TrialBanner mount).
- `src/app/(tabs)/index.tsx:96` (frozen guard).
- `src/app/settings/{category-budgets,budget,household}.tsx` frozen-guard
  imports (the `useFrozenGuard()` call sites — these need to either be
  removed or re-pointed).
- `src/features/pro/pro-bootstrap.tsx:94-106` (the
  `expireOverdueTrials()` self-heal call on overdue trial).
- `src/features/pro/hooks/useProEntitlement.ts:30-38, 49-58` (the
  trial-only fields `subscriptionStatus`, `trialEndsAt`, `isTrialing`,
  `isFrozen`, `daysRemaining`). `everPaid` stays.
- `src/stores/use-pro-store.ts:35-49, 84-106, 128-142, 152-155` — store
  shrinks back to `isPro`, `isLoading`, `everPaid`. The
  `deriveTrialState` helper goes.
- `src/types/index.ts:33-42, 60-68` — `SubscriptionStatus` becomes a
  non-exported detail (or collapses to `'active' | 'none'` internally);
  `subscription_status` and `trial_ends_at` drop from `User`.
- `supabase/migrations/0016_trial_subscription.sql` —
  ENTIRE migration becomes a no-op-equivalent (or rolled into the new
  migration as a delta). `start_free_trial`, `sync_subscription_status`
  RPCs drop. `subscription_status` CHECK narrows to `('none','active')`;
  `trial_ends_at` column drops. `set_profile_tier()` simplified (no
  status case branch).
- `supabase/migrations/0020_trial_expiry.sql` — drop
  `expire_overdue_trials()` + pg_cron job.
- `supabase/migrations/0021_ever_paid_and_save_consume.sql` —
  `start_free_trial()` re-creation §5 drops. `ever_paid` stays.
- `supabase/migrations/0034_household_gate_tier.sql` — §2 reverts
  `sync_client_subscription` allow-list back to
  `('none','active','expired')` (or removes the RPC entirely if nothing
  else calls it). The `create_household` tier='pro' gate stays (paid-only
  households).
- `supabase/migrations/0035_trial_freeze_guard.sql` — entire migration
  becomes obsolete (the freeze vector doesn't exist).
- `supabase/tests/trial-freeze-guard.sql` — entire smoke test.
- `scripts/test-db-smoke.mjs:151-152` — register line.
- i18n keys listed under OBSOLETE above × 3 locales.

### KEEP
- `src/lib/revenuecat.ts` — wrapper, including `getOfferings()`. We
  extend `getOfferings()` to surface intro-price phase info
  (`introPrice`, `introPricePeriod`, `introPriceCycles`).
- `supabase/functions/revenuecat-webhook/index.ts` — keeps handling
  `INITIAL_PURCHASE / RENEWAL / UNCANCELLATION / CANCELLATION /
  EXPIRATION / BILLING_ISSUE`. `TRIAL_STARTED / TRIAL_ENDED` branches
  become no-ops (or drop entirely) since there is no `subscription_status`
  column to update. `ever_paid` still flips on real grants.
- `src/features/pro/ProRouteGuard.tsx`, `src/features/pro/gate.ts` —
  gate logic, but `resolveGateState` loses the `isFrozen` parameter.
- `src/features/pro/components/ProLock.tsx`.
- `src/features/pro/pro-bootstrap.tsx` — per-user resolution path; the
  trial self-heal call drops.
- `src/lib/supabase/feature-access.ts:895-907` —
  `syncSubscriptionStatus()` (still useful post-purchase optimistic sync
  to surface `'active'` immediately). The RPC may need to be renamed or
  its allow-list updated.
- `profiles.ever_paid` — still authoritative for "former paid user" UI
  branches.
- `supabase/functions/revenuecat-webhook/lib/event-types.ts` — grant /
  revoke classification, minus the trial event entries.

### CHANGE
- `src/lib/revenuecat.ts:381-401` — `getOfferings()` returns
  `{ monthly, annual }` packages; extend each with intro-offer
  descriptors: `introPrice?: string`, `introPeriodUnit?: 'DAY'|'WEEK'|'MONTH'|'YEAR'`,
  `introCycles?: number`. Source: for Android iterate
  `product.defaultOption.pricingPhases` filtering `offerPaymentMode ===
  'FREE_TRIAL'`; for iOS inspect `product.discounts[]`.
- `src/lib/revenuecat.ts` — add `checkTrialOrIntroEligibility(identifier)`
  wrapper (iOS only) so the paywall can decide whether to show
  "X days free" before tapping.
- `src/app/pro/index.tsx:399-464` — `PlanButton` shows
  `introPricePeriod`/`introCycles` as a small "7 días gratis, después $X.XX/mes"
  caption ABOVE the price (above-the-faux-button label is the natural
  spot — Play shows this in the native sheet on tap; we show it
  pre-tap). Hide the caption when eligibility is INELIGIBLE / NO_INTRO.
- `src/app/pro/index.tsx:74` — drop `trialLoading` state and the
  dashed-border CTA block.
- `src/app/pro/index.tsx:51` — drop `startFreeTrial` import.
- `src/app/pro/index.tsx:58` — drop `subscriptionStatus, trialEndsAt,
  isFrozen, daysRemaining, everPaid` reads (keep `everPaid` if the
  profile screen still needs it elsewhere).
- `src/app/(tabs)/profile.tsx:34, 232, 270, 287, 298, 311, 318-340,
  346, 367-372` — collapse the 5-branch block back to 2 branches
  (`active` / `free` or `free` + "Ver planes"). The "Ver planes" link
  stays (paid upgrade CTA). The PRO tier label chip stays.
- `supabase/migrations/0036_delete_account.sql` (existing) — re-verify
  the cascade deletes still work after the schema narrowing (no
  `trial_ends_at` references).
- `scripts/test-pro-gating.mjs` — drop every frozen-state assertion;
  `resolveGateState` becomes 2-arg.
- `scripts/test-delete-account.mjs:152-160` — drop `trialEndsAt`,
  `isTrialing`, `isFrozen` from the reset call.
- `scripts/test-stubs/pro.ts` — `useFrozenGuard` becomes a no-op stub
  (no frozen state in the model).
- `supabase/tests/pro-subscription.sql:60-64` — drop the `trial_ends_at`
  column assertion; keep `subscription_status` (narrowed) and `ever_paid`.

---

## Approaches

### 1. Hard cutover in one PR (recommended)
- Migration `0039_remove_trial_columns.sql` drops `trial_ends_at`,
  narrows the `subscription_status` CHECK to `('none','active')`, drops
  `start_free_trial`, `expire_overdue_trials`, simplifies
  `set_profile_tier`. Webhook removes `TRIAL_STARTED / TRIAL_ENDED`
  branches. Client removes the trial CTA, banner, frozen guard, the
  derived `isFrozen/isTrialing` state.
- Paywall relies entirely on the Play/App Store native checkout sheet
  for trial messaging. `PlanButton` adds a small "X días gratis, después
  $X.XX" caption ABOVE the price so users see intro terms without
  having to tap.
- Pros: cleanest end state; no dual code paths; matches the compliance
  copy we just added ("Después se cobra automáticamente"); eliminates
  the freeze-guard attack surface (0035 is no longer needed); the
  webhook flow becomes a single `set_profile_tier` call per event.
- Cons: requires Play Console + App Store Connect operational setup
  BEFORE merge (intro offers must be configured in the dashboard and
  the products must reference them); any in-flight trial users
  (status='trial', trial_ends_at>now()) become Pro users with no
  charge scheduled — but Play/App Store never saw the subscription,
  so they effectively had a "free Pro" window that ends on the DB
  timestamp. A one-time backfill SQL clears `trial_ends_at` and
  flips status to `'active'` for users who are still in-window.

### 2. Phased (deprecate → cut over after N weeks)
- Phase 1: hide the in-app trial CTA + banner behind a feature flag,
  add the Play intro offer, keep the DB columns + RPCs for a few
  weeks. Phase 2: drop the columns and the RPC.
- Pros: zero risk of leaving a user stranded mid-trial.
- Cons: dual code paths for weeks; the legal-compliance copy is
  already live and contradicts the still-present trial CTA.

### 3. Webhook-only (keep DB, add RC native trial in parallel)
- Configure intro offers in Play/App Store, BUT keep the in-app trial
  CTA for users who don't reach the checkout. Two parallel trial
  mechanisms.
- Cons: creates the very dual-trial problem this change exists to fix;
  RevenueCat eligibility is per-store, so a user could chain both and
  get two free trials; rejected.

**Recommendation**: Approach 1. The DB-backed trial is the source of the
legal-vs-behavior mismatch; keeping it parallel to a native trial
guarantees two conflicting stories. The "in-flight trial users" risk
is small (a backfill query resolves it in one line) and Play's
intro-trial eligibility naturally prevents re-trial for returning
users anyway.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Play Console intro offer not configured in prod at merge time | High | Document the manual Play/App Store Connect steps in the proposal; gate rollout with a feature flag if needed; ship PR1 (Play-side config) before PR2 (code cutover). |
| In-flight DB-backed trial users (`subscription_status='trial'`, `trial_ends_at > now()`) become "Pro with no scheduled charge" | Med | One-time SQL: for users in the trial window, keep them Pro (tier='pro', status='active', clear `trial_ends_at`). Users past the window are already expired by `expire_overdue_trials()`. No new trial is ever granted by the DB. |
| RevenueCat eligibility: a user who once used a trial in Play/App Store sees NO "X días gratis" caption in our paywall | Low | The caption is hidden by `INTRO_ELIGIBILITY_STATUS !== ELIGIBLE`; user taps, sees Play's native sheet with the right copy. |
| `delete-account` cascade or `set_profile_tier` regression after schema narrowing | Low | `pnpm test:sql` covers both (`delete-account.sql`, `pro-subscription.sql`); keep the smoke tests updated. |
| Trial/freeze regression test (`trial-freeze-guard.sql`) accidentally left in CI | Low | `scripts/test-db-smoke.mjs` registration line dropped together with the file. |
| `ever_paid` semantics change: today a `TRIAL_STARTED` does NOT flip `ever_paid`. After migration, only the very first non-trial purchase flips it; if a user does trial → never converts → trial again on a different account, this is fine. | Low | No code change needed; `isRealGrant` already excludes trial. |
| Compliance copy `trialStartBillingNote` becomes redundant (Play/App Store native sheet already shows the auto-charge language). | Low | Drop the key. The legal-compliance disclosure block (`autoRenewalNotice`, `cancellationNotice`, Terms/Privacy) stays verbatim and is now the only compliance surface. |

---

## Open Questions (for the proposal phase)

1. **Trial length & cadence**: 7 days vs 5 days vs configurable? The
   current custom flow is 5 days; the Play intro offer can be 7, 14, 30
   days. Recommendation: pick 7 (Play's recommended default for
   subscription apps) so the legal copy "Después se cobra automáticamente
   salvo que canceles antes" stays accurate.
2. **PlanButton intro caption above the price**: do we render the
   intro terms in-app pre-tap (better conversion clarity, slight UI
   duplication with the native sheet), or rely on Play/App Store's
   native sheet entirely (less duplication, slightly less clear at a
   glance)? Recommendation: render a thin caption; hide when ineligible.
3. **Profile "Trial" pill**: do we show a countdown / "trial ends on
   {{date}}" pill on the profile while a user is mid-trial? Today
   `TrialBanner` + profile branch do this; after migration the
   information comes from `CustomerInfo` (entitlements don't directly
   expose the trial-end date — `getCustomerInfo` returns
   `entitlements.all.pro.periodType` etc). Recommendation: keep a
   minimal "Te queda {N} días de prueba" pill sourced from
   `CustomerInfo` if RevenueCat exposes it; otherwise drop the pill.
4. **`syncSubscriptionStatus` client-side post-purchase**: keep the
   optimistic DB write so the store flips to `isPro=true` immediately?
   Today `void syncSubscriptionStatus('active')` is fire-and-forget in
   `src/app/pro/index.tsx:111-113, 136-138`. With `'active'` removed
   from the client allow-list (0034 §2), it fails silently and the
   webhook reconciles. Recommendation: keep the call (no-op or
   no-op-equivalent) so the webhook lag stays invisible. The RPC's
   allow-list needs to allow `'active'` again OR we drop the call.
5. **iOS App Store Connect intro offer setup**: identical to Play but
   on the iOS side — confirm the migration's plan covers it. Apple
   calls it "Free Trial" under the subscription's pricing
   configuration; the RC dashboard mirrors it.

---

## Recommended Design Direction

1. **Schema cutover (one migration)**: drop `trial_ends_at`, narrow
   `subscription_status` CHECK to `('none','active')`, drop
   `start_free_trial`, `sync_subscription_status` (the webhook one),
   `expire_overdue_trials`, the pg_cron job, the §5 start_free_trial
   re-creation in 0021, the §1 guard in 0035, and the §2
   sync_client_subscription allow-list tweak in 0034. `ever_paid`
   stays. `set_profile_tier` simplifies.
2. **Webhook slimming**: drop `TRIAL_STARTED / TRIAL_ENDED` from
   `event-types.ts`. `ever_paid` still flips on real grants. The
   webhook becomes the simple `set_profile_tier` mapper it was before
   the trial feature shipped.
3. **Paywall intro-offer caption**: extend `getOfferings()` to project
   the intro phase (`pricingPhases[offerPaymentMode='FREE_TRIAL']` for
   Android, `discounts[].price` for iOS). `PlanButton` renders a thin
   caption above the price when `introPrice !== null`. The caption is
   hidden when `checkTrialOrIntroEligibility(identifier)` returns
   non-ELIGIBLE.
4. **State surface cut**: drop `subscriptionStatus, trialEndsAt,
   isTrialing, isFrozen, daysRemaining` from the Pro store and the
   entitlement hook. Keep `everPaid` (still gates the "no trial for
   former paid" UI). The gate reverts to 2-arg
   `resolveGateState(isPro, isLoading)`.
5. **Profile simplification**: collapse the 5-branch subscription block
   back to 2 (active / free + Ver planes). Drop the countdown badge.
   The PRO tier chip in `ProfileHeader` stays.

---

## Ready for Proposal

**Yes**. The exploration surfaces every artifact (column, RPC, trigger,
component, i18n key, test) that needs to change. The proposal phase owns
the 5 open questions above and writes the proposal that picks concrete
answers (Play intro offer length, plan-button caption policy,
profile-pill policy, `syncSubscriptionStatus` allow-list decision, iOS
mirror).
