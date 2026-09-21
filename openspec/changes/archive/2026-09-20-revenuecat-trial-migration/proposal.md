# Proposal: RevenueCat Trial Migration

## Intent

The DB-driven trial (`start_free_trial()` RPC, `trial_ends_at`, `expire_overdue_trials` cron, `'frozen'` gate, `TrialBanner`) never reaches Play/App Store — users get a free Pro window with no scheduled charge, contradicting the legal-compliance copy ("Después se cobra automáticamente salvo que canceles antes") and exposing a frozen-state write surface. Replace the DB-trial plumbing with RevenueCat native introductory offers; collapse the gate to binary.

## Scope

### In Scope
- 7-day intro offer (Play default; replaces custom 5 days).
- Cutover migration `0039_rc_trial_cutover.sql` (next free after `0038_legal_acceptances`): backfill `subscription_status='trial'` → `('active','pro',trial_ends_at=NULL)`; drop `trial_ends_at`; narrow CHECK to `('none','active')`; drop `start_free_trial`, `expire_overdue_trials`, pg_cron job, 0021 §5 re-creation; revoke EXECUTE; simplify `set_profile_tier` + `protect_profile_tier`.
- Webhook slim: drop `mapTrialStatus` + `TRIAL_STARTED/ENDED` cases; `ever_paid` still flips on real grants.
- `src/lib/revenuecat.ts`: extend `getOfferings()` with intro phases (`introPrice`, `introPricePeriod`, `introCycles`, `trialEligibility`); add `checkTrialOrIntroEligibility`.
- Gate simplification: drop `subscriptionStatus`/`trialEndsAt`/`isTrialing`/`isFrozen`/`daysRemaining` from Pro store + `useProEntitlement`. Binary `'locked' | 'unlocked'` driven by `isPro`. Source a single `trialEndsAt` from `CustomerInfo` for the profile pill.
- Profile: collapse 5-branch subscription block to 2 (`active` / `free` + "Ver planes").
- Paywall: remove dashed "Empezar prueba gratis" CTA + billing note; extend `PlanButton` with intro caption above price (hidden when intro eligibility `INELIGIBLE`); keep compliance disclosure block.
- Delete `TrialBanner.tsx`; `useFrozenGuard` → no-op stub; drop all call sites.
- i18n: drop obsolete `trial*` keys; add `introCaption` with `{{trialDays}}` / `{{priceAfter}}`.
- Tests: update `scripts/test-pro-gating.mjs` (~15 assertions); delete `supabase/tests/trial-freeze-guard.sql`; extend `scripts/test-db-smoke.mjs` to assert narrowed CHECK. Update CI `db-smoke` step list.

### Out of Scope
- Prices, cancellation flow, account deletion, legal/terms content, multi-product, re-platforming, new analytics.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `subscription-trial`: RETIRE all requirements (DB trial flow, frozen state, `TrialBanner`, `start_free_trial`, `expire_overdue_trials`, `'trial'` transition). Reason: replaced by RC native intro offers.
- `pro-subscription`: webhook slims to `INITIAL_PURCHASE/RENEWAL/UNCANCELLATION/CANCELLATION/BILLING_ISSUE/EXPIRATION`; `set_profile_tier` grant normalizes `'active'` (no trial branch); CHECK narrows; `trial_ends_at` drops; new intro-offer surface.
- `data-access`: `profiles.trial_ends_at` removed; `subscription_status` becomes `'none' | 'active'`.

## Approach

- **DB cutover (one migration, reversible <1h)** — order matters: (1) backfill; (2) `ALTER COLUMN trial_ends_at DROP NOT NULL`; (3) revoke EXECUTE; (4) DROP RPCs; (5) narrow CHECK; (6) DROP COLUMN; (7) DROP pg_cron; (8) simplify trigger; (9) simplify `set_profile_tier`. Existing `'active'` users keep working throughout (column shape preserved until step 6).
- **`getOfferings()` extension**: Android → iterate `product.defaultOption.pricingPhases` filtering `offerPaymentMode === 'FREE_TRIAL'`; iOS → `product.discounts[]`.
- **PlanButton caption**: `"{{trialDays}} días gratis, después {{priceAfter}}"` ABOVE price. Hidden when `INELIGIBLE` / `NO_INTRO_OFFER_EXISTS`. On Android `UNKNOWN` (always returned) we still show — Play re-states at confirm.
- **Profile pill**: kept, sourced from `CustomerInfo.entitlements.all.pro`; degrades to plain "Pro" pill if clean trial-end date isn't derivable. Never reads DB.
- **Strict TDD**: tests first per slice (RED → GREEN). Migration rollback script committed alongside.

## Constraints

- Existing `'active'` users MUST keep working through the migration.
- Reversible <1h: no `DROP COLUMN` without prior `DROP NOT NULL`; backfill FIRST.
- 7-day trial only. Strict TDD.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/0039_rc_trial_cutover.sql` | New | Backfill + schema narrow + RPC/cron drops + trigger simplify |
| `supabase/functions/revenuecat-webhook/{index.ts,lib/event-types.ts}` | Modified | Drop trial branches + entries |
| `src/lib/revenuecat.ts` | Modified | Intro-phase projection + eligibility |
| `src/stores/use-pro-store.ts`, `src/features/pro/gate.ts`, `useProEntitlement.ts`, `pro-bootstrap.tsx`, `useFrozenGuard.ts` | Modified | Drop trial fields; binary gate; no-op guard |
| `src/features/pro/components/TrialBanner.tsx` | Removed | Countdown banner |
| `src/app/pro/index.tsx`, `(tabs)/profile.tsx`, `(tabs)/index.tsx`, `settings/{category-budgets,budget,household}.tsx` | Modified | Drop CTA/banner/guards; collapse branches |
| `src/types/index.ts` | Modified | `subscription_status` narrows; `trial_ends_at` drops |
| `src/i18n/locales/{es-AR,en,pt-BR}/{pro,settings}.json` | Modified | Drop `trial*`; add `introCaption` |
| `scripts/test-pro-gating.mjs`, `test-delete-account.mjs`, `test-db-smoke.mjs` | Modified | Truth table rework; reset; drop freeze-guard line |
| `supabase/tests/trial-freeze-guard.sql` | Removed | Whole file |
| `supabase/tests/pro-subscription.sql`, `.github/workflows/ci.yml` | Modified | Drop `trial_ends_at` assertion; update step list |
| **Operational (NOT code)** | — | Play Console intro offer per product + App Store Connect parity |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Play / App Store Connect intro offer not configured at merge | High | Config PR BEFORE code PR; gate release on offer confirmation; rollback = revert code (offers stay live, no double-charge) |
| In-flight DB-trial users become "Pro with no scheduled charge" | Med | Step 1 backfill flips status to `'active'`; past-window users already expired by `expire_overdue_trials()` |
| Regression in `delete-account` or `set_profile_tier` after narrow | Low | `pnpm test:sql` covers both; cutover reversible <1h |
| `trial-freeze-guard.sql` left in CI | Low | File deleted + `test-db-smoke.mjs` line dropped in same PR |
| `ever_paid` drift after webhook slim | Low | `isRealGrant` already excludes trial; grant paths unchanged |
| Caption shows on Android when eligibility is `UNKNOWN` (SDK returns UNKNOWN) | Low | Play re-states terms at confirm; duplicate-but-not-contradictory; already-tried users see no intro phase → caption suppressed |
| Compliance copy redundant (native sheet re-states) | Low | `legal-compliance` disclosure block stays verbatim; only paywall CTA goes away |

## Rollback Plan

- **Code**: revert PR — restores dashed CTA, banner, `'frozen'` gate. Re-mergeable since step 1 of migration is backfill-only.
- **Schema (if 0039 applied)**: ship `0040_rc_trial_rollback.sql` <1h — (1) re-add `trial_ends_at` (nullable); (2) restore CHECK; (3) re-create RPCs from `0016`/`0020`; (4) restore pg_cron; (5) re-add webhook trial branches. ~30 min.
- **Operational**: disable intro offers in Play / App Store Connect → reverts to paid-only. Existing paid users unaffected. Webhook idempotency means reverted code reconciles cleanly.

## Dependencies

- **Operational (blocks release)**: Play Console + App Store Connect intro offer "Free trial, 7 days" per product. Owner action — surfaced in runbook, gates release.
- RC SDK types already support `pricingPhases` + `OFFER_PAYMENT_MODE.FREE_TRIAL` (verified in `@revenuecat/purchases-typescript-internal`).
- Existing `set_profile_tier` + `protect_profile_tier` (pro-subscription) — grant already flips `'active'`, no trial branch needed.

## Success Criteria

- [ ] `pnpm test` green; `test:db-smoke` runs without `trial-freeze-guard.sql`; `test:pro-gating` binary truth table passes.
- [ ] Migration applies cleanly on mixed-status DB; backfill flips all `trial` → `active`; column drops; CHECK narrows; cron removed.
- [ ] Paywall: no dashed CTA; `PlanButton` shows `"7 días gratis, después $X.XX/mes"` above price when `ELIGIBLE`; hidden otherwise.
- [ ] Webhook handles the 6 retained event types; `TRIAL_STARTED/ENDED` returns 200 no-op.
- [ ] Profile: 2-branch block; trial pill from `CustomerInfo`, not DB.
- [ ] Existing `'active'` users keep full access throughout (verified on snapshot DB).
- [ ] Compliance disclosure block renders verbatim (legal-compliance copy unchanged).
- [ ] Manual: tapping intro-eligible Plan launches Play's native sheet showing "Free trial, 7 days, then $X.XX/month" — matches in-app caption.

## Open Questions

- None — all exploration open questions resolved by user-locked decisions.