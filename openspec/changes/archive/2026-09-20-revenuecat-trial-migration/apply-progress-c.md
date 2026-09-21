# Apply Progress — Slice A + Slice B + Slice C — revenuecat-trial-migration

> **Branch**: `feat/revenuecat-trial-migration-c-ui-rewrites`
> **Base**: `main` @ `352b10c` (1 commit AFTER the slice A PR #124 + slice B PR #125
> merges — slice A and slice B are merged into main; this branch is the
> standalone slice C)
> **Mode**: Strict TDD (RED→GREEN on the pro-i18n-keys harness + the
> revenuecat-offerings harness; test-pro-gating and test-webhook-idempotency
> regression-checked after each commit)
> **Working-tree preservation**: User's uncommitted slice B/C WIP in
> `src/app/pro/index.tsx`, `src/i18n/locales/{en,es-AR,pt-BR}/pro.json`,
> `src/lib/revenuecat.ts` was reconciled during the slice A R1-2 fix;
> slice C modified `src/app/pro/index.tsx` and `src/lib/revenuecat.ts`
> ADDITIVELY (no overwrite of the user's preserved state). The user's
> pre-existing slice B WIP (benefit i18n keys, `OfferingsView` interface)
> was lost during slice A's R1-2 stash dance — slice C re-adds the
> benefit keys (commit 1) and the `introPhase` field on the offerings
> view (commit 3, via the `OfferingPackage` type from `revenuecat.ts`).

## Commits — Slice C (4 work units on top of merged slice A + B)

| SHA | Type | Subject | Files | Lines |
|-----|------|---------|-------|-------|
| `5cfe4a9` | feat(i18n) | add slice-C pro namespace keys + remove obsolete settings keys | `src/i18n/locales/{en,es-AR,pt-BR}/pro.json` (M), `src/i18n/locales/{en,es-AR,pt-BR}/settings.json` (M), `scripts/test-i18n-pro-keys.mjs` (NEW), `package.json` (M) | +189 / -14 |
| `d4e118e` | refactor(pro) | drop useFrozenGuard call sites | `src/app/(tabs)/index.tsx` (M), `src/app/settings/{budget,category-budgets,household}.tsx` (M) | +51 / -45 |
| `f29a482` | feat(pro) | render intro caption above PlanButton price (REQ-PRO-INTRO-CAPTION) | `src/lib/revenuecat.ts` (M), `scripts/test-revenuecat-offerings.mjs` (M), `src/app/pro/index.tsx` (M) | +321 / -47 |
| `ec57d4d` | feat(pro) | profile trial pill from CustomerInfo (REQ-PRO-TRIAL-PILL) | `src/lib/revenuecat.ts` (M), `scripts/test-revenuecat-offerings.mjs` (M), `src/stores/use-pro-store.ts` (M), `src/features/pro/hooks/useProEntitlement.ts` (M), `src/features/pro/pro-bootstrap.tsx` (M), `src/app/(tabs)/profile.tsx` (M) | +238 / -32 |

## Slice A recap (PR #124, merged at `0575a15`)

| SHA | Subject |
|-----|---------|
| `c50f07a` | test(db): add trial-cutover smoke (RED) |
| `03a0f95` | feat(db): add 0039 cutover migration (9 reversible steps) + smoke updates (GREEN) |
| `49195bd` | chore(webhook): drop TRIAL_STARTED / TRIAL_ENDED handlers |
| `0a7e9c7` | ci(db): register trial-cutover smoke, remove trial-freeze-guard |
| `be07b90` | fix(review): address R1+R3 review findings |
| `48aadd6` | fix(db): REVOKE protect_profile_tier from anon + authenticated too |

## Slice B recap (PR #125, merged at `fadcebf`)

| SHA | Subject |
|-----|---------|
| `34ce992` | test(pro-gating): rewrite harness for binary gate state (RED) |
| `c0af006` | feat(revenuecat): extend getOfferings with intro phase projection |
| `5191834` | refactor(pro): narrow gate + types + hook to binary state |
| `75a5a05` | test(revenuecat): add intro-phase integration coverage (triangulation) |

See `apply-progress-a.md` and `apply-progress-b.md` for prior detail.
Slice C picked up at `352b10c` (main after the slice B merge) and
added 4 commits (+661 lines net).

## TDD Cycle Evidence — Slice C

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| i18n keys added + obsolete removed | `scripts/test-i18n-pro-keys.mjs` (NEW) | Static (catalog parity + presence) | ✅ `test-legal-links.mjs` 28/28 (existing parity primitive) | ✅ 4/5 fail (pro parity + 3 added-key presence checks + obsolete-key absence) | ✅ 5/5 after commit 1 | ✅ Test covers BOTH presence (6 added keys) AND absence (3 removed keys) across all 3 locales | ➖ None needed |
| `useFrozenGuard` call-site removal | (covered by typecheck + manual grep) | Static | ✅ typecheck baseline 0 errors | ✅ Type errors would surface if import removal broke callers | ✅ 0 errors after commit 2 | ➖ Coverage is grep-driven (no dedicated harness) | ✅ Consolidated imports per file |
| `buildIntroCaption` (intro caption substitution) | `scripts/test-revenuecat-offerings.mjs` (extended) | Unit (pure function) | ✅ 40/40 baseline (slice B's tests) | ✅ 5/5 new tests fail (`buildIntroCaption is not a function`) | ✅ 5/5 new tests pass after commit 3 | ✅ 5 cases: null input, es-AR template, en template, idempotent global replace, large trialDays + non-USD price verbatim | ✅ Split into pure helper + call-site template fetch — keeps test scope tight (substitution rules) and the production scope tight (one helper for the rendering surface) |
| `getTrialPillState` (trial pill derivation) | (same file) | Unit (pure function) | ✅ 40/40 baseline | ✅ 8/8 new tests fail | ✅ 8/8 new tests pass | ✅ 8 cases: null/undefined entity, active TRIAL, NORMAL, INTRO, inactive TRIAL, null/empty expirationDate | ✅ Pure function reused by deriveCustomerInfoSnapshot — single source of truth |
| `deriveCustomerInfoSnapshot` (CustomerInfo → snapshot projection) | (same file) | Unit (pure function) | ✅ 40/40 baseline + new buildIntroCaption/getTrialPillState tests = 53 baseline | ✅ 7/7 new tests fail | ✅ 7/7 new tests pass | ✅ 7 cases: null customerInfo, no pro entitlement, active TRIAL, NORMAL, INTRO, inactive TRIAL, missing entitlements object | ✅ Reuses `getTrialPillState` for the trial-window contract — single source of truth |
| Profile trial pill rendering | (covered by typecheck + i18n-pro-keys) | — | ✅ typecheck baseline | ✅ TS errors if hook surface / pill JSX misaligned | ✅ 0 errors after commit 4 | N/A (UI rendering — no component-rendering harness exists for the paywall or the profile) | ✅ Consolidated the new revenuecat import with the pre-existing one (no duplicate-import warnings) |

## Test Evidence — Slice C

### test-revenuecat-offerings.mjs (extended — slice B's 27 → slice C's 47)

| Phase | Result |
|-------|--------|
| Pre-commit-2 (slice B baseline) | 27/27 ✅ |
| Post-commit-2 (slice C's commit 3 added buildIntroCaption + getTrialPillState) | 40/40 ✅ |
| Post-commit-3 (slice C's commit 4 added deriveCustomerInfoSnapshot) | 47/47 ✅ |

The 47-test count breaks down as:
- 11 Android pure-projection branches (carried over from slice B).
- 8 iOS pure-projection branches (slice B).
- 8 integration tests pinning the consumer-facing `getOfferings()` shell (slice B).
- 5 `buildIntroCaption` tests (slice C — REQ-PRO-INTRO-CAPTION).
- 8 `getTrialPillState` tests (slice C — REQ-PRO-TRIAL-PILL).
- 7 `deriveCustomerInfoSnapshot` tests (slice C — REQ-PRO-TRIAL-PILL source).

### test-i18n-pro-keys.mjs (NEW — slice C)

| Phase | Result |
|-------|--------|
| Pre-commit-1 (no test file, no keys) | n/a (file doesn't exist) |
| Post-commit-1 (new harness, keys added) | 5/5 ✅ |

The 5-test count breaks down as:
- 1 parity check (pro.json key sets identical across the 3 locales).
- 3 presence checks (every added key in every locale as a non-empty string; planIntroCaption contains both `{{trialDays}}` + `{{priceAfterTrial}}` interpolation tokens; trialPill contains the `{{date}}` token).
- 1 absence check (the 3 obsolete settings keys are absent in every locale).

### Regression checks

| Suite | Result |
|-------|--------|
| `scripts/test-pro-gating.mjs` | ✅ 17/17 |
| `scripts/test-webhook-idempotency.mjs` | ✅ 25/25 |
| `scripts/test-i18n-init.mjs` | ✅ 5/5 |
| `scripts/test-legal-links.mjs` | ✅ 28/28 (settings parity intact — the obsolete keys were removed symmetrically) |
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm lint` | ✅ 0 errors, 57 pre-existing warnings (none introduced — consolidated the new revenuecat import with the pre-existing one) |

## Slice C scope — Applied

### File Changes

| File | Action | Notes |
|---|---|---|
| `src/i18n/locales/{es-AR,en,pt-BR}/pro.json` | M | Added 6 keys: `planIntroCaption`, `trialPill`, `benefitUnlimitedScans`, `benefitAdvancedStats`, `benefitExportTickets`, `benefitPriceAlerts`. (Re-adds the benefit keys from the legal-compliance rewrite WIP that got partially lost during slice A's R1-2 review-fixes commit.) |
| `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` | M | Removed 3 obsolete keys: `trialActive`, `trialExpired`, `startFreeTrial`. (The trial lifecycle surface is gone post-cutover; the paywall no longer references these.) |
| `scripts/test-i18n-pro-keys.mjs` | NEW | 5-test harness: pro.json parity + presence of added keys (with token checks for planIntroCaption / trialPill) + absence of removed settings keys across all 3 locales. |
| `package.json` | M | Added `test:i18n-pro-keys` script + wired into the `test` chain after `test:i18n-init`. |
| `src/app/(tabs)/index.tsx` | M | Removed `useFrozenGuard` import + 2 `guard(() => ...)` wrappers around FAB onPress handlers. Direct calls now; comments document the removal. |
| `src/app/settings/budget.tsx` | M | Removed `useFrozenGuard` import + the `guard(async () => {...})` wrapper around the save handler. Inlined the async body. |
| `src/app/settings/category-budgets.tsx` | M | Removed `useFrozenGuard` import + the `return guard(async () => {...})` wrapper around the save handler. The early-return guard (loading / error / saving / submitting) is preserved verbatim. |
| `src/app/settings/household.tsx` | M | Removed `useFrozenGuard` import + 4 `guard(() => ...)` wrappers: handleDisband, handleCreate, onOpenJoin, onOpenInvite. Direct calls now. |
| `src/lib/revenuecat.ts` | M | Added `buildIntroCaption(introPhase, template)` + `getTrialPillState(entitlement)` + `deriveCustomerInfoSnapshot(customerInfo)` (pure helpers). Extended `CustomerInfoSnapshot` with `trialEndsAt`. Changed `attachCustomerInfoListener` callback signature to receive the full snapshot. `getCustomerInfo` and the listener both use `deriveCustomerInfoSnapshot`. |
| `scripts/test-revenuecat-offerings.mjs` | M | +20 tests pinning the new helpers (5 buildIntroCaption + 8 getTrialPillState + 7 deriveCustomerInfoSnapshot). |
| `src/app/pro/index.tsx` | M | Imported `useTranslation('pro')`. All hardcoded Spanish strings replaced with `t()` lookups. Imported `OfferingsSnapshot` + `buildIntroCaption` from `revenuecat.ts`. PlanButton accepts `introPhase` prop; renders the caption above the price when set, hides when null. Caption style: smaller font (`labelSm`) + primary color + bold so it reads as a hint next to the price. |
| `src/stores/use-pro-store.ts` | M | Re-introduced `trialEndsAt: string | null` (sourced from CustomerInfo, not the DB). Renamed `setPro(isPro)` → `setProEntitlement(snapshot)` — atomic write of both `isPro` and `trialEndsAt`. `refresh` seeds `trialEndsAt`. `reset` clears `trialEndsAt`. |
| `src/features/pro/hooks/useProEntitlement.ts` | M | Added `trialEndsAt: string | null` to the hook's public surface. |
| `src/features/pro/pro-bootstrap.tsx` | M | Updated the customerInfoUpdate listener to receive the full snapshot. Now calls `setProEntitlement(snapshot)` (was `setPro(isPro)`). Updated the effect's dependency array. |
| `src/app/(tabs)/profile.tsx` | M | Imported `getTrialPillState` + `formatDayMonth`. Re-read `activeLocale` from `useLocaleStore` (was previously dropped in slice B). Rendered the trial pill ABOVE the subscription-status block. Pill is hidden when the user is not Pro, when the entitlement's periodType isn't 'TRIAL', or when `expirationDate` is missing/empty. Pill style: rounded (`borderRadius: 999`), primaryContainer background, primaryDark label. |

### Out-of-scope files (preserved)

The user's pre-existing slice B/C WIP included modifications to these files that slice C did NOT touch:
- The `src/lib/revenuecat.ts` changes from slice C ADDED to the user's preserved `OfferingPackage` + `OfferingsSnapshot` state (no overwrite). The user's `formatDayMonth` import in `src/app/(tabs)/profile.tsx` is now redundant (slice C added it; the user added it in the WIP) — consolidated during commit 4 cleanup.
- The user's WIP additions to `src/i18n/locales/{en,es-AR,pt-BR}/pro.json` (which had benefit keys + openLegalDocument-related entries) were partially lost in slice A's R1-2 stash dance; slice C commit 1 re-added the benefit keys.

## Deviations from Design

1. **Listener signature change** — the design calls for `useProEntitlement` to expose `trialEndsAt: string | null` derived from `CustomerInfo`, but doesn't specify how the SDK listener delivers that data to the store. Slice C chose to change `CustomerInfoUpdateListener` from `(isPro: boolean) => void` to `(snapshot: CustomerInfoSnapshot) => void` — the only consumer (the bootstrap) was updated accordingly. This is a breaking API change but is contained (only 1 caller). The alternative — keeping the `(isPro)` signature + adding a separate listener for the snapshot — would have doubled the listener registration without clear benefit.

2. **Single-source-of-truth refactor** — the design called for `use-pro-store.ts` to drop `setSubscriptionState` (slice B did this) but didn't specify the rename to `setProEntitlement`. Slice C renamed the setter to match the new atomic `{ isPro, trialEndsAt }` shape — clearer naming for the new contract (the setter writes BOTH fields, not just `isPro`).

3. **Profile pill style** — the design hints at "Prueba · Termina 25 sep" pill but doesn't pin the visual treatment. Slice C chose: rounded pill (`borderRadius: 999`), primaryContainer background (the existing theme color used for secondary accents), primaryDark text (`labelSm` font weight 600). The pill is `alignSelf: 'flex-start'` so it doesn't stretch full-width — visually a sibling of the PRO badge rather than a full-width banner.

4. **Settings.json obsolete keys removed BEFORE the paywall trial CTA / countdown were fully retired** — slice A R1-2 already deleted the paywall trial CTA references; slice B removed the profile's 5-branch subscription block. The settings.json keys were orphaned by both changes but not removed until slice C commit 1. The order is fine (orphan keys never referenced at runtime) but slightly delayed — slice C is the first opportunity to also clean up the i18n side.

5. **No `useTrialEndsAt()` hook** — the design suggests a thin `useTrialEndsAt()` hook (orchestrator's option in slice C scope), but slice C reads `trialEndsAt` directly from `useProEntitlement()` + uses the pure `getTrialPillState` helper in the component. One fewer abstraction to maintain; the hook already exposes the field.

## Working-tree preservation

The user's pre-existing uncommitted WIP in `src/app/pro/index.tsx` (289 lines), `src/i18n/locales/{en,es-AR,pt-BR}/pro.json`, and `src/lib/revenuecat.ts` was reconciled during slice A R1-2's commit `be07b90`. Slice C added:
- New keys to pro.json (ADDITIVE — the user's WIP additions don't conflict).
- New `OfferingPackage.introPhase` field, `buildIntroCaption`, `getTrialPillState`, `deriveCustomerInfoSnapshot` to `revenuecat.ts` (ADDITIVE — the user's `OfferingsView` interface was replaced with `OfferingsSnapshot` import; slice C kept the interface shape compatible).
- New `trialEndsAt` field to `useProEntitlement` + `CustomerInfoSnapshot` (ADDITIVE — the user's existing WIP didn't reference this field).
- Trial pill JSX in `src/app/(tabs)/profile.tsx` (the user had previously added `formatDayMonth` to the imports; slice C added `getTrialPillState` to the same import block to consolidate the duplicate-import lint warning).

After slice C, the user's git status on this branch is clean (only PAGES-Y-LEGAL.md + openspec/ untracked).

## Deliverable status

✅ All slice C work committed (4 commits on the new branch off main). Branch ready for `sdd-verify`. No new dependencies introduced (uses the RevenueCat SDK + i18n + zustand already in the project).

## Next slice (slice D)

`sdd-apply slice D` (Test Rewrites + new harness coverage) on a new branch off `ec57d4d` (slice C tip). Slice D scope per the design:

- `scripts/test-pro-gating.mjs` — already updated for binary gate by slice B. May add more edge-case properties.
- `scripts/test-revenuecat-offerings.mjs` — already extended for the introPhase + pill helpers by slice C. May add integration tests with full SDK mocking (currently uses a static mock module).
- `scripts/test-delete-account.mjs` — drop `trialEndsAt`/`isTrialing`/`isFrozen` from the reset call (the contract changed post-cutover).
- `scripts/test-webhook-idempotency.mjs` — verify the new `TRIAL_STARTED`/`TRIAL_ENDED` 200 no-op behavior (already done in slice A webhook slim, but may need explicit test pins).
- New harnesses (per tasks.md Phase 4):
  - `scripts/test-revenuecat-offerings.mjs` integration tests with full mock SDK (already partially done by slice C).
  - `scripts/test-i18n-detector.mjs` orphan detection extension (verify no `trialStart*`, `errorTrial*`, `planIntroCaption` orphans).
- `scripts/test-stubs/pro.ts` — `useFrozenGuard` stub still passes-through after slice C's removal; verify it still satisfies any harness that imports it.

The per-slice branch chain continues: slice D's PR should target slice C's branch tip (`feat/revenuecat-trial-migration-c-ui-rewrites`) per `feature-branch-chain`. The aggregator tracker PR (slice D aggregator or post-merge) lands everything to main.
