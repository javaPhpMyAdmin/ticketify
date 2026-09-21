# Apply Progress — Slice A + Slice B — revenuecat-trial-migration

> **Branch**: `feat/revenuecat-trial-migration-b-client-surface`
> **Base**: `feat/revenuecat-trial-migration-a-db-webhook` @ `be07b90`
> **Upstream**: chain slice B off slice A per the design's
> `feature-branch-chain` strategy (each slice's PR targets the
> previous slice's branch). Slice A is at PR #124.
> **Mode**: Strict TDD (RED→GREEN cycle on `test-pro-gating.mjs` +
> `test-revenuecat-offerings.mjs`)
> **Working-tree preservation**: User's uncommitted slice B/C WIP in
> `src/app/pro/index.tsx`, `src/i18n/locales/{en,es-AR,pt-BR}/pro.json`,
> `src/lib/revenuecat.ts` is preserved (slice B narrowed `revenuecat.ts`
> but did not overwrite the user's WIP).

## Commits — Slice B (4 work units on top of slice A's 5)

| SHA | Type | Subject | Files | Lines |
|-----|------|---------|-------|-------|
| `34ce992` | test(pro-gating) | rewrite harness for binary gate state (RED) | `scripts/test-pro-gating.mjs` (M) | +44 / -41 |
| `c0af006` | feat(revenuecat) | extend getOfferings with intro phase projection | `src/lib/revenuecat.ts` (M), `scripts/test-revenuecat-offerings.mjs` (NEW), `scripts/tsconfig.revenuecat-offerings-test.json` (NEW), `package.json` (M) | +607 / -8 |
| `5191834` | refactor(pro) | narrow gate + types + hook to binary state | `gate.ts`, `useProEntitlement`, `use-pro-store`, `useFrozenGuard`, `ProRouteGuard`, `types/index.ts`, `pro-bootstrap.tsx`, `profile.tsx`, `delete-account.tsx` (9 files) | +151 / -335 |
| `75a5a05` | test(revenuecat) | add intro-phase integration coverage (triangulation) | `scripts/test-revenuecat-offerings.mjs` (M) | +274 / -15 |

## Slice A recap (already merged at PR #124)

| SHA | Subject |
|-----|---------|
| `c50f07a` | test(db): add trial-cutover smoke (RED) |
| `03a0f95` | feat(db): add 0039 migration + smoke updates (GREEN) |
| `49195bd` | chore(webhook): drop TRIAL_STARTED / TRIAL_ENDED handlers |
| `0a7e9c7` | ci(db): register trial-cutover smoke, remove trial-freeze-guard |
| `be07b90` | fix(review): address R1+R3 review findings |

See `apply-progress-a.md` for the slice A detail. Slice B picked up
at `be07b90` and added 4 commits (+677 lines net).

## TDD Cycle Evidence — Slice B

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| Binary gate rewrite | `scripts/test-pro-gating.mjs` | Unit | ✅ 20/20 baseline | ✅ 7/17 fail (arg-count misalignment) | ✅ 17/17 pass (after commit 3) | ✅ Added 2 anti-properties (return-type guard + "frozen never appears" 1000-iter) | ➖ None needed |
| introPhase projection (pure) | `scripts/test-revenuecat-offerings.mjs` | Unit (pure functions) | N/A (new file) | ✅ 19/19 fail (exports don't exist) | ✅ 19/19 pass (after commit 2) | ➖ 4 unit_to_days branches × Android/iOS covered in the first pass; commit 4 adds INTEGRATION coverage | ✅ Extracted `projectIntroPhase` dispatcher + 2 unit helpers (`iso8601ToDays`, `periodUnitToDays`) |
| Integration triangulation | (same file) | Unit (mocked SDK) | N/A | ✅ None needed (pure projections were tested) | ✅ 27/27 pass | ✅ 8 integration tests pinning: null return paths, platform routing, defensive catch, mixed Android+iOS | ➖ None needed |
| Binary gate narrowing | (covered by the binary-gate rewrite row) | — | — | — | — | — | ✅ Dropped `frozen` case; updated JSDoc + truth-table comments |
| Type narrowing + hook slim | typecheck (no dedicated test) | Static | ✅ typecheck baseline | ✅ Compile errors from callers (profile, delete-account, pro-bootstrap) | ✅ 0 errors | N/A | ✅ Updated collateral callers in commit 3 |

## Test Evidence — Slice B

### test-pro-gating.mjs (binary gate)

| Phase | Result |
|-------|--------|
| Pre-commit-1 (against 3-arg gate) | 20/20 ✅ (baseline, the OLD contract) |
| Post-commit-1 (against 3-arg gate, 2-arg calls) | 7 failed / 10 passed (RED — arg count misalignment) |
| Post-commit-3 (against 2-arg gate, 2-arg calls) | 17/17 ✅ (GREEN — binary contract) |

The 17-test count includes:
- 4 explicit truth-table cases (`isLoading × isPro`).
- 4 exhaustive truth-table cases (2 × 2).
- 2 negative assertions ("only isLoading=false AND isPro=true yields unlocked").
- 1 return-type guard (`{locked, unlocked}` only).
- 1 1000-iter property (isLoading=true → locked).
- 1 1000-iter property (isLoading=false → unlocked iff isPro=true).
- 1 1000-iter anti-property (`'frozen'` never appears).
- 1 purity assertion (re-call returns same result).
- 1 EXPO_PUBLIC_PRO_OVERRIDE override test block (5 assertions).

### test-revenuecat-offerings.mjs (introPhase projection)

| Phase | Result |
|-------|--------|
| Pre-commit-2 (no exports) | 19 failed / 0 passed (RED — `projectAndroidIntroPhase is not a function`) |
| Post-commit-2 (with pure projections) | 19/19 ✅ |
| Post-commit-4 (with integration coverage) | 27/27 ✅ |

The 27-test count includes:
- 11 Android pure-projection branches (null pkg, no product, no defaultOption, empty phases, P1D/P1W/P1M/P1Y × 1, P7D × 2, non-FREE_TRIAL, FREE_TRIAL in second position).
- 8 iOS pure-projection branches (null pkg, no product, no introPrice, DAY/WEEK/MONTH/YEAR units, multi-cycle intro).
- 8 integration tests pinning the consumer-facing `getOfferings()` shell (null return paths, platform routing, defensive catch, mixed Android+iOS in the same snapshot).

### Regression checks

| Suite | Result |
|-------|--------|
| `scripts/test-webhook-idempotency.mjs` | ✅ 25/25 (slice A webhook slim unaffected) |
| `scripts/test-quota-tier.mjs` | ✅ 13/13 |
| `scripts/test-delete-account.mjs` | ✅ 27/27 |
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm lint` | ✅ 0 errors, 57 pre-existing warnings (none introduced) |

## Slice B scope — Applied

### File Changes

| File | Action | Notes |
|---|---|---|
| `src/lib/revenuecat.ts` | M | Added `IntroPhase` interface + extended `OfferingPackage` with `introPhase`. Added `projectIntroPhase` (dispatcher) + `projectAndroidIntroPhase` + `projectIosIntroPhase` (pure projection helpers). Added `iso8601ToDays` + `periodUnitToDays` unit helpers. Wired `introPhase` into `getOfferings()`. |
| `src/features/pro/gate.ts` | M | `GateState = 'locked' \| 'unlocked'` (dropped `'frozen'`). `resolveGateState(isPro, isLoading)` 2-arg. Updated JSDoc + truth-table comments. |
| `src/types/index.ts` | M | `SubscriptionStatus = 'none' \| 'active'` (dropped `'trial'` and `'expired'`). Dropped `User.trial_ends_at`. |
| `src/stores/use-pro-store.ts` | M | Dropped `subscriptionStatus`, `trialEndsAt`, `isTrialing`, `isFrozen`, `daysRemaining`, `setSubscriptionState`, `deriveTrialState`. Kept `isPro`, `isLoading`, `everPaid`, `refresh`, `setPro`, `setEverPaid`, `reset`. |
| `src/features/pro/hooks/useProEntitlement.ts` | M | Dropped trial fields from `ProEntitlement`. Kept `isPro`, `isLoading`, `refresh`, `everPaid`. |
| `src/features/pro/hooks/useFrozenGuard.ts` | M | Stubbed to no-op (`{ isFrozen: false, guard: (action) => action() }`). Preserved the export shape so existing call sites in `(tabs)/index.tsx` + settings screens continue to compile. Slice C removes the call sites entirely. |
| `src/features/pro/ProRouteGuard.tsx` | M | Dropped the `'frozen'` branch from the gate evaluation (binary post-cutover). |
| `scripts/test-pro-gating.mjs` | M | Rewritten for binary gate contract: dropped frozen-state assertions, 4-row truth table (was 2 × frozen × loading), tightened return-type guard, added anti-property (`'frozen'` never appears), added purity assertion. 17 tests total (was 20). |
| `scripts/test-revenuecat-offerings.mjs` | NEW | 27-test harness for the intro-phase projection. 19 pure-function tests (Android/iOS × every branch) + 8 integration tests (`getOfferings()` end-to-end with mocked SDK). |
| `scripts/tsconfig.revenuecat-offerings-test.json` | NEW | Harness tsconfig mirroring the sibling tests (strict mode, `@/*` paths, includes `revenuecat.ts` + `with-timeout.ts` + globals stub). |
| `package.json` | M | Added `test:revenuecat-offerings` script + wired into the `test` chain after `test:pro-gating`. |

### Collateral cleanup (forced by the type narrowing)

These were NOT in the orchestrator's commit plan but were necessary for typecheck to pass once the type surface was narrowed:

| File | Action | Notes |
|---|---|---|
| `src/features/pro/pro-bootstrap.tsx` | M | `syncSubscriptionFromDB()` no longer calls `setSubscriptionState` (gone). Reads `ever_paid` from DB and calls `setEverPaid()`. The pre-cutover `expireOverdue_trials` self-heal is already gone (slice A). |
| `src/app/settings/delete-account.tsx` | M | Dropped `subscriptionStatus` destructure. `isSubscriptionActive` collapses to `isPro` (the binary active signal). |
| `src/app/(tabs)/profile.tsx` | M | Dropped `subscriptionStatus`, `trialEndsAt`, `daysRemaining`, `isFrozen` from destructure. Collapsed the pre-cutover 5-branch subscription block (active / trial / frozen / expired / free-ever-paid) to a 2-branch block: active → manage-subscription, otherwise → see-plans CTA. Slice C refines the inactive copy with the trial pill. ProfileHeader's `tierLabel` prop now always `undefined`. |

## Deviations from Design

1. **iOS intro signal** — the design hint referenced `pkg.product.discounts[].type === 'FREE_TRIAL'` for iOS, but the SDK's `PurchasesStoreProductDiscount` shape doesn't expose a `type` or `numberOfPeriods` field. The canonical iOS intro signal is `pkg.product.introPrice` (StoreKit 2's `PurchasesIntroPrice`). The implementation reads `introPrice` instead of `discounts[].type`. The behavioral contract ("introPhase projection, null when no intro offer") is preserved.

2. **`getOfferings()` null return semantics** — the wrapper has always returned `{ monthly: null, annual: null }` (the snapshot shape) when the SDK returns null offerings, NOT `null` itself. The `null` return path is reserved for "Purchases unavailable" (native module not linked) or "SDK threw" (defensive catch). Commit 4's integration test for the null SDK return asserts the snapshot shape, not a top-level null. Pre-cutover the test wasn't there to pin this; slice B's integration test makes it explicit.

3. **Slice B task list scope** — the orchestrator's commit plan listed 6 files in commit 3 (gate + useProEntitlement + use-pro-store + useFrozenGuard + ProRouteGuard + types/index.ts). The actual collateral cleanup touched 3 more callers (pro-bootstrap, profile, delete-account) because the type narrowing breaks them. Documented in commit 3's message as "Collateral cleanup (forced by the type narrowing)".

4. **`test-stubs/pro.ts`** — design task 2.9 listed updating the stub for `useFrozenGuard`. The stub was already authored pre-cutover with the same shape (`{ isFrozen: false, guard: pass-through }`) that the new no-op production hook returns. No modification needed.

5. **`pro-bootstrap.tsx` `CustomerInfo`-derived `trialEndsAt`** — design task 2.5 also asked for the listener to derive `trialEndsAt` from CustomerInfo entitlements (post-cutover the trial-end comes from the entitlement's `expirationDate` when `periodType === 'TRIAL'`). Deferred to slice C (when the trial pill lands on the profile screen — `REQ-PRO-TRIAL-PILL`).

## Working-tree preservation

The user's pre-existing uncommitted slice B/C WIP included changes to:
- `src/app/pro/index.tsx` (289-line diff)
- `src/i18n/locales/{en,es-AR,pt-BR}/pro.json` (4-line diffs each)
- `src/lib/revenuecat.ts` (42-line diff)

Slice B modified `src/lib/revenuecat.ts` to extend `OfferingPackage` with `introPhase`. The user's existing WIP (slice A commit `be07b90` had manually restored their `OfferingPackage` interface) was preserved — slice B's changes ADDED to the `OfferingPackage` interface, not replaced it. `git diff be07b90 HEAD -- src/lib/revenuecat.ts` shows both the user's WIP restored state AND the slice B additions, with no merge conflicts.

The user's `src/app/pro/index.tsx` and the pro.json WIP remained uncommitted throughout slice B (no slice B work touched them). They appear in `git status` as uncommitted changes — slice C will pick them up.

## Deliverable status

✅ All slice B work committed (4 commits on top of slice A). Branch ready for `sdd-verify`. No new dependencies introduced (the pure-function helpers + the mocked SDK in the test harness use Node built-ins + the existing TypeScript toolchain).

## Next slice (slice C)

`sdd-apply slice C` (UI Rewrites + i18n churn) on a new branch off `75a5a05` (slice B tip). Slice C scope per the design:

- `src/app/pro/index.tsx` — drop dashed trial CTA + billing note + trial blocks; extend `PlanButton` with `introPhase` prop + caption above price. Keep compliance disclosure block. (The user's WIP in this file is the slice C starting point — they already rewrote `OfferingsView` and added the i18n keys; slice C will land on top.)
- `src/app/(tabs)/profile.tsx` — collapse 5-branch → 2-branch (already partially done by slice B's collateral — slice C refines the inactive copy with the trial pill from CustomerInfo per `REQ-PRO-TRIAL-PILL`).
- `src/app/(tabs)/index.tsx` — drop `useFrozenGuard` import + `guard()` calls (no replacement — gate handles it).
- `src/app/settings/{category-budgets,budget,household}.tsx` — drop `useFrozenGuard` import + `guard()` calls.
- `src/i18n/locales/{es-AR,en,pt-BR}/pro.json` — add `planIntroCaption: "{{trialDays}} días gratis, después {{priceAfterTrial}}/mes"` + `trialPill: "Prueba · Termina {{date}}"`.
- `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` — drop `trialActive`, `trialExpired`, `startFreeTrial` (5-branch source keys).

The per-slice branch chain continues: slice C's PR should target slice B's branch tip (`feat/revenuecat-trial-migration-b-client-surface`) per `feature-branch-chain`. The aggregator tracker PR (slice D or post-merge) lands everything to main.
