# Tasks: RevenueCat Trial Migration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (total) | ~1100 (additions + deletions) |
| Slice A (DB + webhook + harness) | ~400 lines |
| Slice B (Client type surface) | ~200 lines |
| Slice C (UI rewrites + i18n) | ~350 lines |
| Slice D (Test rewrites + harness) | ~150 lines |
| 400-line budget risk | High |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | feature-branch-chain (slices NOT independently mergeable to main) |
| Delivery strategy | auto-chain → chained PR (no exception) |
| Chain strategy | feature-branch-chain |
| Decision needed before apply | No |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Work Units

| Unit | Goal | Base |
|------|------|------|
| PR 1 | DB cutover + webhook slim + smoke + CI | tracker |
| PR 2 | Client type surface (gate/store/revenuecat) | PR 1 |
| PR 3 | UI rewrites + i18n churn | PR 2 |
| PR 4 | Test rewrites + new harness | PR 3 |

## Phase 1 — DB + Webhook (PR 1)

- [x] 1.1 Create `0039_rc_trial_cutover.sql`: backfill → DROP NOT NULL → REVOKE → DROP RPCs → narrow CHECK → DROP COLUMN → cron unschedule → trigger simplify → set_profile_tier simplify.
- [x] 1.2 Create `0040_rc_trial_rollback.sql` (reverse order).
- [x] 1.3 Create `supabase/tests/trial-cutover.sql` (backfill idempotent, CHECK rejects trial/frozen/expired, RPCs gone).
- [x] 1.4 Delete `supabase/tests/trial-freeze-guard.sql`.
- [x] 1.5 Slim `event-types.ts` (drop `TRIAL_STARTED/ENDED` from all 4 lists + `mapTrialStatus`).
- [x] 1.6 Slim `webhook/index.ts` (drop `mapTrialStatus` import + step 11; keep `ever_paid` step 11b).
- [x] 1.7 Update `pro-subscription.sql` smoke (drop `trial_ends_at` assertion).
- [x] 1.8 Update `test-db-smoke.mjs` + `ci.yml` (drop freeze-guard, add trial-cutover).
- [x] 1.9 RED→GREEN: `pnpm test:db-smoke` + `pnpm test:sql` pass against fresh DB and idempotent re-run.

## Phase 2 — Client Type Surface (PR 2)

- [x] 2.1 RED: new `scripts/test-revenuecat-offerings.mjs` (fixtures for Android `pricingPhases` + iOS `discounts`).
- [x] 2.2 Extend `revenuecat.ts` (`getOfferings()` projects `introPhase`; add `checkTrialOrIntroEligibility`).
- [x] 2.3 `gate.ts`: `GateState = 'locked' | 'unlocked'`; 2-arg `resolveGateState`.
- [x] 2.4 `useProEntitlement.ts` + `use-pro-store.ts`: drop trial fields; add `trialEndsAt` from `CustomerInfo`.
- [x] 2.5 `pro-bootstrap.tsx`: drop `expireOverdueTrials` + self-heal; derive `trialEndsAt` in listener.
- [x] 2.6 `useFrozenGuard.ts` → no-op stub; `ProRouteGuard.tsx` drop `isFrozen`.
- [x] 2.7 `types/index.ts`: `SubscriptionStatus = 'none' | 'active'`; drop `trial_ends_at`.
- [x] 2.8 `feature-access.ts`: delete `startFreeTrial` + `expireOverdueTrials`; `syncSubscriptionStatus('active')` only.
- [x] 2.9 `scripts/test-stubs/pro.ts`: `useFrozenGuard` stub.
- [x] 2.10 GREEN: harness + typecheck pass.

## Phase 3 — UI Rewrites (PR 3)

- [x] 3.1 Delete `src/features/pro/components/TrialBanner.tsx`.
- [x] 3.2 `app/pro/index.tsx`: drop dashed CTA + billing note + trial blocks; extend `PlanButton` with `introPhase` prop + caption above price.
- [x] 3.3 `(tabs)/profile.tsx`: collapse 5-branch → 2; trial pill from `CustomerInfo`; drop DB-derived fields.
- [x] 3.4 `(tabs)/index.tsx`: drop `TrialBanner` + `useFrozenGuard` imports/mounts.
- [x] 3.5 `settings/{category-budgets,budget,household}.tsx`: drop `useFrozenGuard` imports + `guard()` calls.
- [x] 3.6 `i18n/locales/{es-AR,en,pt-BR}/pro.json`: drop `trial*`; add `planIntroCaption` + `trialPill` with `{{trialDays}}` / `{{priceAfterTrial}}` / `{{date}}`.
- [x] 3.7 `i18n/locales/{es-AR,en,pt-BR}/settings.json`: drop `trial*` keys.
- [x] 3.8 RED: extend `test-i18n-detector.mjs` (no orphan dropped keys; new keys present + interpolation tokens).
- [x] 3.9 GREEN: detector + i18n pass; manual paywall render verified.

## Phase 4 — Test Rewrites (PR 4)

- [x] 4.1 Rewrite `test-pro-gating.mjs`: binary truth table (4-row enum + 1000-iter property; idempotency + return-type kept).
- [x] 4.2 `test-delete-account.mjs`: drop `trialEndsAt`/`isTrialing`/`isFrozen` from reset.
- [x] 4.3 `test-webhook-idempotency.mjs`: 6 retained events + `TRIAL_STARTED/ENDED` 200 no-op.
- [x] 4.4 RED→GREEN: `pnpm test` green; `test:db-smoke` + `test:sql` cover cutover.

## Operational Runbook (release-gate, NOT code)

1. Play Console: per-product intro offer "Free trial, 7 days" (monthly + annual).
2. App Store Connect: per-product intro offer parity.
3. RevenueCat dashboard: mirror intro offers per product.
4. EAS internal-testing build → tap intro-eligible Plan → verify Play native sheet shows "Free trial, 7 days, then $X.XX/month".
5. Promote to production once #1-#4 signed off.

## Risk Register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | Dashboard intro offer not configured → users see no trial | High | Runbook #1-3 BEFORE merge; rollback = revert code (offers stay live) |
| R2 | In-flight DB trial users become Pro with no scheduled charge | Med | Step 1 backfill flips to `'active'`; past-window already expired by cron 0035 |
| R3 | `delete-account` / `set_profile_tier` regression after CHECK narrow | Low | `pnpm test:sql` covers both; reversible <1h |
| R4 | `trial-freeze-guard.sql` left in CI | Low | File + `test-db-smoke.mjs` line dropped in same PR 1 |
| R5 | `ever_paid` drift after webhook slim | Low | `isRealGrant` already excludes trial |
| R6 | Caption shows on Android when eligibility `UNKNOWN` | Low | Play re-states terms at confirm; already-tried users see no intro phase |
| R7 | Compliance copy redundant with native sheet | Low | `legal-compliance` disclosure block stays verbatim |
| R8 | Slice A at 400-line boundary; child diffs polluted | Med | Each child PR rebased on immediate parent; tracker stays draft |
