# Delta for Subscription Trial

## REMOVED Requirements

### Requirement: Trial Activation

(Reason: DB-driven 5-day trial writes a Pro window with no scheduled charge and contradicts the legal-compliance copy "Después se cobra automáticamente salvo que canceles antes". Replaced by RevenueCat native introductory offers whose checkout, eligibility, and auto-charge are owned by Play Console / App Store Connect.)
(Migration: Per-product intro offer "Free trial, 7 days" configured in Play Console + App Store Connect (operational precondition — flagged in `pro-subscription` spec as external dependency). Client `getOfferings()` projects the intro phase to the paywall via `REQ-PRO-INTRO-CAPTION`. Webhook slim drops `TRIAL_STARTED` / `TRIAL_ENDED` branches in `pro-subscription`.)

### Requirement: Trial Expiry Detection

(Reason: Native intro offers expire inside Play/App Store; there is no DB trial to expire. App-side expiry detection was a stop-gap for the DB-only window.)
(Migration: Expiry detected on every webhook delivery (`EXPIRATION` event) and reconciled into `profiles.subscription_status = 'none'` via `sync_subscription_status`. Client `useProEntitlement` derives `isPro` from `CustomerInfo.entitlements.all.pro`.)

### Requirement: Frozen Gate State

(Reason: The `'frozen'` state existed only to block writes during the gap between DB trial expiry and a paid subscription; with no DB trial there is no frozen window.)
(Migration: Gate collapses to binary `'locked' | 'unlocked'`. `resolveGateState(isPro, isLoading)` drops the `isFrozen` parameter. `useFrozenGuard` becomes a no-op stub; all `settings/{category-budgets,budget,household}.tsx` and `(tabs)/index.tsx` call sites drop.)

### Requirement: Trial Status Display

(Reason: DB countdown banner reads `profiles.trial_ends_at`; with the column removed there is no DB source for a countdown. The active-trial and expired-trial profile branches are dropped.)
(Migration: `TrialBanner.tsx` is deleted. Profile trial pill rendered from `CustomerInfo.entitlements.all.pro` when the introductory-price phase is active — `REQ-PRO-TRIAL-PILL` in `pro-subscription`. Profile subscription block collapses to 2 branches (`active` / `free + Ver planes`). The paywall compliance disclosure block (`autoRenewalNotice`, `cancellationNotice`, Terms/Privacy links) stays verbatim per `legal-content` — native intro offers make the wording accurate.)

### Requirement: State Transitions

(Reason: `subscription_status` narrows to `'none' | 'active'`; the `'trial'` and `'expired'` values are no longer representable and all transitions involving them are deleted.)
(Migration: `subscription_status` transitions reduce to `none → active` (paid grant via webhook) and `active → none` (revoke via webhook or `set_profile_tier('free')`). `REQ-DATA-PROFILES-TRIAL-COLS` narrows the CHECK; `REQ-DATA-RPC-TRIAL-REMOVAL` drops `start_free_trial`; `REQ-DATA-CRONS-TRIAL-REMOVAL` removes the `expire_overdue_trials` pg_cron job. `REQ-DATA-TRIAL-CUTOVER` performs the one-shot backfill of in-flight `'trial'` rows.)
