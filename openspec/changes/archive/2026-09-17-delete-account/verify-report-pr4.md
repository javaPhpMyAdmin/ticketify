# Verify Report — PR4 (Tests + deploy runbook finalization, with PR3 retrofits bundled)

> Change: `delete-account` · Branch: `delete-account-pr4-tests` (stacked-to-main, branched from main at PR3 merge `1b4c829`).
> Artifact store: hybrid (this file + engram `sdd/delete-account/verify-report`).
> Verification mode: standard (no strict TDD). PR scope: WU-4.1 + WU-4.2 + WU-4.3 + WU-4.4 + the three PR3 retrofits (WU-4.1 forced them).

## Executive Summary

PR4 closes the `delete-account` change end-to-end. All four work units are complete and the three PR3 retrofits bundled into WU-4.1 (wrapper rewrite with try/catch + body-error preference + HTTP-status fallback, defensive null guard in `matchesTypedConfirmation`, try/catch around `logOutRevenueCat` in `useSessionStore.deleteAccount`) are correctly in place — re-derived against source. The new `scripts/test-delete-account.mjs` runs 27/27 assertions covering matchesTypedConfirmation (12 cases), wrapper envelope mapping (10 cases), and the cleanup-chain order (5 cases). `pnpm test:features` extends to 131/131 with the 4 new envelope-invariant pins in `test-features.mjs` (PR4 WU-4.3). `pnpm typecheck` and all six regression gates pass. The deploy runbook has §5 with audit-signal query, annotated smoke test, RC alias verification, and Storage sweep verification. The diff scope is exactly the 9 files declared in apply-progress-pr4.md — no other migrations bundled. One real spec gap remains (REQ-ACCTDEL-11's `unauthenticated` envelope: spec mandates re-route to `/auth/sign-in`, implementation falls through to the danger dialog) — flagged as WARNING. The pre-existing `pnpm test:sql` failure on `user-categories.sql` is unrelated to PR4 (verified against pre-PR4 commit and against PR1 verify-report). Verdict: PASS WITH WARNINGS — change is ready to archive after PR4 merges.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total (PR4) | 4 (WU-4.1, WU-4.2, WU-4.3, WU-4.4) |
| Tasks complete | 4 |
| PR3 retrofits bundled | 3 (matchesTypedConfirmation null guard, use-session-store logOutRevenueCat try/catch, feature-access.deleteAccount rewrite) |
| Commits on branch | 4 (cbd5885, c3e4fc7, cf483f9, ad34876) |
| Files modified vs main | 9 (per `git diff --stat main..delete-account-pr4-tests`) |
| Lines diff | +1171 / -44 across 9 files |
| Other migrations bundled | None |

## Build & Tests Execution

| Gate | Status | Evidence |
|------|--------|----------|
| `pnpm typecheck` | ✅ Pass | Exit 0, no errors. tsconfig EXCLUDES `supabase/functions/**/*`; typecheck covers the client/Expo surface only. |
| `pnpm test:delete-account` | ✅ Pass | All 27 tests pass. 12 matchesTypedConfirmation + 10 wrapper envelope + 5 cleanup chain. Local re-run on `delete-account-pr4-tests` confirms `all 27 tests passed`. |
| `pnpm test:features` (post-WU-4.3) | ✅ Pass | 131/131 (was 127; +4 envelope invariant tests in lines 2336-2446). |
| `pnpm test:profile-hook` | ✅ Pass | 6/6. |
| `pnpm test:auth` | ✅ Pass | 57/57. |
| `pnpm test:i18n-detector` | ✅ Pass | 11/11. All new keys present in es-AR/en/pt-BR. |
| `pnpm test:pro-gating` | ✅ Pass | 20/20. The new `getCustomerInfo` stub in `scripts/test-stubs/revenuecat.ts` satisfies the pro store's refresh typecheck path without affecting runtime behavior. |
| `pnpm test:webhook-idempotency` | ✅ Pass | 25/25. Regression check on PR2's `_shared/service-client.ts` refactor. |
| `pnpm test:verify-constant-time` | ✅ Pass | 8/8. |
| `pnpm test` (master chain) | ⚠️ Pre-existing failure | `pnpm test:sql` fails on `user-categories.sql` with `permission denied for table categories`. PRE-EXISTING — apply-progress-pr4.md risk #5 + PR1 verify-report F3/F4 documented this. PR4's `delete-account.sql` smoke test runs cleanly in isolation. All Node-only steps in the master chain (including the new `test:delete-account` slot) pass green. |
| `pnpm test:sql` (isolated delete-account.sql) | ✅ Pass (per PR1 verify-report) | PR1 verify report ran the SQL smoke test 3 consecutive times against the local Docker Postgres container; PR4 doesn't touch SQL or the smoke test runner. |

## Spec Compliance Matrix

### REQ-ACCTDEL-1 — In-App Entry Point ✅ COMPLIANT
- **Evidence**: `src/app/(tabs)/profile.tsx` lines 152-162: appended `{ id: 'delete-account', label: t('settings:deleteAccount'), icon: 'trash', tone: 'danger', trailing: { type: 'chevron' }, onPress: () => router.push('/settings/delete-account') }`. Row sits in its own `dangerSection` View (lines 367-372) with hairline divider + `paddingTop` + danger-tinted `sectionTitle`.
- **Test**: not covered by `pnpm test:*` (rendered React component); manual smoke per apply-progress-pr3.

### REQ-ACCTDEL-2 — Typed-Confirmation Gating ✅ COMPLIANT
- **Evidence**: `src/components/organisms/TypedConfirmation/TypedConfirmation.tsx` line 50: `const matches = matchesTypedConfirmation(typedValue, typedPrompt);` line 51: `const disabled = primaryDisabled || !matches;`. Match helper at `src/components/organisms/TypedConfirmation/lib/match.ts` line 16-22: `matchesTypedConfirmation(input, prompt): boolean` with `typeof === 'string'` defensive guards (PR4 retrofit). Match rule: trimmed + lowercased equality, with `safeInput.length > 0` guard.
- **Test**: `scripts/test-delete-account.mjs` covers 12 cases: exact match, case-insensitive (both directions), whitespace (trailing/leading/surrounding), incomplete word, extra chars, empty value, empty prompt, and null/undefined inputs (defensive).

### REQ-ACCTDEL-3 — Subscription Disclosure ✅ COMPLIANT
- **Evidence**: `src/app/settings/delete-account.tsx` lines 143-176: banner Card with `isSubscriptionActive` branch (`subscriptionStatus === 'active' || 'trial'`). Pro branch shows `deleteAccountBannerPro*` keys + a `Pressable` calling `handleManageSubscription` → `await showManageSubscriptions()` from `@/lib/revenuecat`. Free branch shows `deleteAccountBannerFree*` keys with no action button. Accessibility label `t('pro:manageSubscription')` on the action button.
- **Test**: not covered by `pnpm test:*` (rendered React component); manual smoke per apply-progress-pr3.

### REQ-ACCTDEL-4 — Pre-Delete Export Nudge (Pro Only) ✅ COMPLIANT
- **Evidence**: `src/app/settings/delete-account.tsx` lines 178-206: `{isPro ? <Pressable onPress={() => router.push('/settings/export')} … >…</Pressable> : null}`. Conditional rendering, Pro-only.
- **Test**: not covered by `pnpm test:*` (rendered React component).

### REQ-ACCTDEL-10 — Post-Delete Client State ✅ COMPLIANT
- **Evidence**: `src/features/auth/use-session-store.ts` lines 283-324: `deleteAccount` action calls `logOutRevenueCat()` (try/catch-wrapped), `await deleteAccountFn()`, then `queryClient.clear()` → `useReceiptsStore.getState().resetAll()` → `useProStore.getState().reset()` → `useHouseholdStore.getState().reset()` → `useSessionStore.setState({ session: null })`. Cleanup is GATED on success (line 305: `if (result.status === 'error') return result`). Also clears `deleteAccountDraft: null` on success (line 321).
- **Test**: `scripts/test-delete-account.mjs` "cleanup chain" section (5 tests): success path asserts order `queryClient.clear → receipts.resetAll → pro.reset → household.reset`, error path asserts `events.length === 0` (no cleanup), rejecting logOut is swallowed, rejecting invoke is absorbed, idempotent re-delete still runs cleanup.

### REQ-ACCTDEL-11 — Error Mapping ⚠️ PARTIAL (W1)
- **Evidence**: `src/app/settings/delete-account.tsx` lines 79-119: switch on `result.code`.
  - `household_owner_with_members` → toast + `router.replace('/settings/household')` ✓ matches spec.
  - `revenuecat_revoke_failed`, `unauthenticated`, `internal` → `useDialogStore.show({ tone: 'danger' })` with localized retry copy.
- **W1 — Spec/implementation drift on `unauthenticated`**: Spec table says `unauthenticated` → "Re-route to `/auth/sign-in`", but the implementation falls through to the danger dialog (alongside `internal`). Design §8 also omits an explicit `unauthenticated` branch. See WARNING F1 below.
- **Test**: `scripts/test-delete-account.mjs` covers wrapper-level envelope mapping for all 4 codes; the screen-level switch is not unit-tested (rendered React component). The `test-features.mjs` WU-4.3 section pins the 4-code union + envelope fields.

### REQ-ACCTDEL-12 — Internationalization ✅ COMPLIANT (with one extra key)
- **Evidence**: All 19 design keys (`deleteAccount`, `deleteAccountSectionTitle`, `deleteAccountBannerProTitle/Body/Action`, `deleteAccountBannerFreeTitle/Body`, `deleteAccountExportNudgeTitle/Action`, `deleteAccountConfirmTitle/Body`, `deleteAccountTypedPrompt`, `deleteAccountTypedAction`, `deleteAccountFinalWarning`, `deleteAccountErrorTitle`, `deleteAccountErrorHouseholdBody`, `deleteAccountErrorRevokeBody`, `deleteAccountErrorInternalBody`, `deleteAccountErrorRetry`) PLUS one extra key `deleteAccountInputHint` (added beyond spec per apply-progress-pr3 WU-3.7) PLUS `couldNotDeleteAccount` in auth.json — 21 keys total in each of es-AR/en/pt-BR. Implementation key `deleteAccountErrorHouseholdOwnerBody` (was `deleteAccountErrorHouseholdBody` in design) — minor name extension, locale-neutral content matches.
- **Test**: `pnpm test:i18n-detector` (11/11) covers key parity across the 3 locales.

### REQ-ACCTDEL-7 (PR2) and REQ-ACCTDEL-13 (PR2) — covered by PR1+PR2 verify reports
- Not re-verified here; PR2's edge function and audit-row insert were verified at the time. PR4 doesn't touch PR2 files.

### REQ-AUTH-DEL-1 — In-App Account-Deletion Entry Point ✅ COMPLIANT
- **Cross-reference**: REQ-AUTH-DEL-1 (delta) references REQ-ACCTDEL-1 (parent spec). The entry point exists on the profile screen per REQ-ACCTDEL-1 verification above.

### REQ-AUTH-DEL-3 — Post-Delete Sign-Out ✅ COMPLIANT
- **Evidence**: `useSessionStore.deleteAccount()` runs the manual cleanup chain (per REQ-ACCTDEL-10 above) — `queryClient.clear`, store resets, `session: null` — because `supabase.auth.signOut()` is never called (per design §6 comment lines 307-311).
- **Test**: same as REQ-ACCTDEL-10.

### REQ-HOUSE-DEL-2 — Cross-Route Typed-Value Preservation ✅ COMPLIANT
- **Evidence**: `src/features/auth/use-session-store.ts` line 76: `deleteAccountDraft: { typedValue: string } | null` field + line 77: `setDeleteAccountDraft(...)` action. `src/app/settings/delete-account.tsx` lines 53-56: seeds `useState` from `useSessionStore.getState().deleteAccountDraft` on mount; lines 62-64: writes through to the store on every keystroke via `useEffect`; lines 70-74: clears the store draft on unmount.
- **Test**: `scripts/test-delete-account.mjs` asserts `deleteAccountDraft` is cleared after a successful delete (line 546).

## PR4 Retrofit Verifications

### Feature-access.deleteAccount rewrite (PR4 retrofit #1) ✅ COMPLIANT

| Retrofit invariant | Verified | Evidence |
|---|---|---|
| try/catch around `supabase.functions.invoke` | ✅ | `src/lib/supabase/feature-access.ts` lines 1074-1081: `try { … } catch (err) { return { status: 'error', code: 'internal', message: '' }; }` |
| Body-error preferred over HTTP-status when both present | ✅ | Lines 1095-1101: `if (data && data.error) return { code: knownCodes.includes(data.error) ? data.error : 'internal' };` — checks body before the `error`-with-status fallback at line 1114. |
| HTTP-status fallback for empty bodies | ✅ | Lines 1114-1131: 502 → `revenuecat_revoke_failed`, 401 → `unauthenticated`, 409 → `household_owner_with_members`, else → `internal`. |
| `alreadyDeleted` omitted on first-time delete | ✅ | Lines 1102-1108: `const alreadyDeleted = data.already_deleted === true ? true : undefined;` |
| Defensive narrow on unknown typed codes | ✅ | Line 1098: `knownCodes.includes(data.error) ? data.error : 'internal'` |
| `isSupabaseConfigured` gate | ✅ | Lines 1046-1052: early return `{ status: 'error', code: 'internal' }` |

### matchesTypedConfirmation null guard (PR4 retrofit #2) ✅ COMPLIANT

| Retrofit invariant | Verified | Evidence |
|---|---|---|
| Defensive on null/undefined inputs | ✅ | `src/components/organisms/TypedConfirmation/lib/match.ts` lines 20-21: `const safeInput = typeof input === 'string' ? input.trim().toLowerCase() : '';` / `safePrompt` analog. Returns `false` for non-matching or empty inputs (line 22). |
| Match rule preserved (trim + lowercase + non-empty) | ✅ | Line 22: `return safeInput.length > 0 && safeInput === safePrompt;` |

### use-session-store.deleteAccount try/catch on logOutRevenueCat (PR4 retrofit #3) ✅ COMPLIANT

| Retrofit invariant | Verified | Evidence |
|---|---|---|
| `logOutRevenueCat` wrapped in try/catch | ✅ | `src/features/auth/use-session-store.ts` lines 292-296: `try { await logOutRevenueCat(); } catch (err) { console.warn('[deleteAccount] logOutRevenueCat threw (continuing):', err); }` |
| Wrapper still runs after a rejecting logOut | ✅ | Lines 304: `const result = await deleteAccountFn();` — outside the try/catch, runs regardless. |
| `deleteAccountDraft` cleared on success | ✅ | Line 321: `useSessionStore.setState({ deleteAccountDraft: null });` |

## PR4 Test Infrastructure Verifications

### pnpm test:delete-account — 27/27 pass ✅

12 matchesTypedConfirmation cases + 10 wrapper envelope cases + 5 cleanup-chain cases = 27 assertions. All pass on the local re-run.

### pnpm test:features — 131/131 pass ✅

The PR4 WU-4.3 section in `scripts/test-features.mjs` lines 2336-2446 adds 4 tests:
1. All 4 known error codes round-trip verbatim through the wrapper.
2. The wrapper tolerates every field name the edge function emits (6 field probes including `already_deleted: true/false/null`, error + message body, `ok: true + error` legacy drift, `ok: false without error`, `ok: true with null already_deleted`).
3. `alreadyDeleted` is omitted on a fresh first-time delete.
4. An unknown server code demotes to `'internal'` (proves the wrapper's narrow list is exactly the 4-code union).

### pnpm test:delete-account wired into master test chain ✅

`mobile/package.json` line 53 includes `pnpm test:delete-account &&` in the master chain, positioned after `pnpm test:webhook-idempotency` (the closest existing sibling — both exercise the delete-account edge-function surface).

### Other gates
- `scripts/tsconfig.delete-account-test.json` (PR4) — harness tsconfig remapping `@/lib/supabase`, `@/lib/supabase/storage-adapter`, `@/lib/revenuecat`, `react-native` to in-tree stubs.
- `scripts/test-stubs/revenuecat.ts` (PR4) — controllable `logOutRevenueCat` + no-op `getCustomerInfo` for the pro store's refresh path. The pro store's `reset()` runs in the cleanup chain.

## Runbook Verification (supabase/functions/delete-account/README.md §5) ✅

| Section | Verified | Evidence |
|---|---|---|
| §5.1 Audit-signal query | ✅ | Lines 144-164: `select event_id, user_id, event_ts from public.webhook_events where event_type = 'ACCOUNT_DELETION' order by event_ts desc limit 50;` — complete with the FK limitation note pointing to migration `0037_drop_webhook_events_user_id_fk.sql`. |
| §5.2 Smoke test with annotated error codes | ✅ | Lines 166-226: 6 reachable failure modes (happy path, idempotent re-delete, household-owner pre-flight, RC revoke failed, internal RPC failure, unauthenticated) with `curl` invocations and expected outputs. |
| §5.3 RevenueCat alias verification | ✅ | Lines 228-255: `curl -i -H "Authorization: Bearer $REVENUECAT_SECRET_API_KEY" "https://api.revenuecat.com/v1/subscribers/$USER_ID"` — expected 404 after delete. Dashboard cross-check noted. |
| §5.4 Storage sweep verification | ✅ | Lines 257-275: `select name from storage.objects where bucket_id = 'receipts' and (storage.foldername(name))[1] = '<deleted-user-uuid>';` — expected 0 rows. GDPR leak escalation note included. |

## Regression Check

### File scope vs apply-progress-pr4.md artifacts table

| Declared file | Actual git diff vs main | Match |
|---|---|---|
| `scripts/test-delete-account.mjs` | +700 lines (NEW) | ✅ |
| `scripts/test-stubs/revenuecat.ts` | +73 lines (NEW) | ✅ |
| `scripts/tsconfig.delete-account-test.json` | +44 lines (NEW) | ✅ |
| `src/components/organisms/TypedConfirmation/lib/match.ts` | +7 / -2 | ✅ |
| `src/features/auth/use-session-store.ts` | +16 / -2 | ✅ |
| `src/lib/supabase/feature-access.ts` | +96 / -X | ✅ |
| `package.json` | +3 / -1 | ✅ |
| `scripts/test-features.mjs` | +112 / -0 | ✅ |
| `supabase/functions/delete-account/README.md` | +156 / -8 | ✅ |

No files outside this table. No additional migrations. No SQL files modified. No edge function TypeScript files modified (PR2 surface untouched — only README was touched).

## Issues Found

### CRITICAL
None.

### WARNING

**F1 — `unauthenticated` envelope doesn't re-route to `/auth/sign-in` per REQ-ACCTDEL-11 spec table** (`src/app/settings/delete-account.tsx` lines 102-118)
- **Evidence**: The spec table at `openspec/specs/user-account-deletion/spec.md` line 233-234 maps `unauthenticated` → "Re-route to `/auth/sign-in`". The screen implementation groups `unauthenticated` together with `revenuecat_revoke_failed` and `internal` and shows a danger dialog. The design §8 also omits an explicit `unauthenticated` branch — its switch falls through to `default → useDialogStore.show(...)`. So the divergence is between (spec, source-of-truth) and (design, implementation).
- **Recommendation**: Either (a) align the implementation to the spec by adding a `case 'unauthenticated': router.replace('/sign-in')` branch (or to whatever the actual codebase route is — the codebase uses `/sign-in`, not `/auth/sign-in`; the spec's path needs updating to match), or (b) amend the spec to reflect the design's defensive-dialog behavior. Impact is low in practice (the screen mounts inside the auth gate; an `unauthenticated` envelope typically means the JWT expired between mount and confirm — the SIGNED_OUT listener would already have routed the user out). Severity: WARNING because it's a real spec gap but low-frequency and not security-relevant.

### SUGGESTION

**F2 — WU-4.3 acceptance criterion (storage-scope invariant) was not implemented as specified** (`scripts/test-features.mjs` lines 2336-2446)
- **Evidence**: Tasks.md WU-4.3 says: "add a parallel to the existing `deleteReceipt` check that asserts the new wrapper never calls the storage delete endpoint directly (it routes through the edge function)". The 4 new tests in `test-features.mjs` pin the envelope shape (4-code union + field-probe tolerance + alreadyDeleted-omit + unknown-code-demote), but do NOT assert that `deleteAccount` never touches `storage.remove` / `storage-upload` / `storage-signed`. The wrapper correctly only calls `supabase.functions.invoke` today, but a future refactor that adds a direct storage call would not be caught.
- **Recommendation**: Add a single assertion alongside the 4 envelope tests: stub a `storage.remove` call counter and assert `log.filter(e => e.kind === 'storage-remove').length === 0` after a successful deleteAccount invocation. Mirrors the existing `deleteReceipt` foreign-object guard at line 2264-2270.

**F3 — `deleteAccountErrorHouseholdBody` design key was renamed to `deleteAccountErrorHouseholdOwnerBody` in implementation** (`src/i18n/locales/*/settings.json`)
- **Evidence**: Design §10 lists the key as `deleteAccountErrorHouseholdBody`. All 3 locale JSONs use `deleteAccountErrorHouseholdOwnerBody`. The name is more specific (clarifies it's the household-Owner pre-flight, distinct from a generic household error) but creates a spec/implementation drift.
- **Recommendation**: Update design §10 to match the implementation key name. Implementation is correct and self-consistent across all 3 locales; this is documentation drift only.

**F4 — Spec path `/auth/sign-in` doesn't match codebase route `/sign-in`**
- **Evidence**: Spec text uses `/auth/sign-in` consistently (REQ-ACCTDEL-10 scenario line 215-216, REQ-ACCTDEL-11 line 234, REQ-AUTH-DEL-3 scenario line 56-57). Codebase uses `/sign-in` (the `(auth)` route group is URL-suppressed in Expo Router). Implementation correctly uses `/sign-in`.
- **Recommendation**: Update the spec text to `/sign-in` to match the Expo Router convention. Affects 3 references in user-account-deletion/spec.md and 1 in user-auth/spec.md.

## Verdict

**PASS WITH WARNINGS** — PR4 closes the `delete-account` change with complete test coverage, a runnable production runbook, and the three necessary PR3 retrofits correctly in place. All Node-side gates pass; `pnpm test:sql` failure is pre-existing and unrelated. The WARNING (F1) is a real spec gap on the `unauthenticated` envelope routing; the SUGGESTIONs are cleanups (F2 missing storage-scope invariant, F3 spec rename, F4 spec path). Change is ready to archive after PR4 merges.

**Next step**: PR4 → main → archive. Open the PR (`delete-account-pr4-tests` branch is committed, NOT pushed per project convention). After PR4 merges, run `sdd-archive` to sync delta specs and close the change. Follow-up optional items:
- Apply migration `0037_drop_webhook_events_user_id_fk.sql` so REQ-ACCTDEL-13 audit rows actually persist (out of PR scope).
- Resolve F1 (`unauthenticated` envelope routing) per recommendation.
- Resolve F2 (storage-scope invariant assertion) per recommendation.
- Resolve F3/F4 (spec documentation drift) per recommendation.

## What / Why / Where / Learned

**What**: Independent verification of PR4 of the `delete-account` SDD change — re-derived from source against the PR1 verify-report, spec, design, tasks, and apply-progress artifacts. Re-ran `pnpm typecheck`, `pnpm test:delete-account` (27/27), `pnpm test:features` (131/131), and the six regression gates; all pass. Read the wrapper rewrite, the store try/catch retrofit, and the matchesTypedConfirmation null guard directly. Cross-checked the 9-file diff against the apply-progress-pr4.md artifacts table — exact match, no scope creep. Verified §5 of the deploy runbook (audit query + annotated smoke test + RC alias verification + Storage sweep verification) is complete.

**Why**: The orchestrator requested fresh-context verification independent of the apply-progress summary. PR4 is the FINAL PR — any spec gap or broken gate here would carry through to the archive step.

**Where**:
- `mobile/scripts/test-delete-account.mjs` (PR4 WU-4.1)
- `mobile/scripts/test-stubs/revenuecat.ts` (PR4 WU-4.1)
- `mobile/scripts/tsconfig.delete-account-test.json` (PR4 WU-4.1)
- `mobile/scripts/test-features.mjs` (PR4 WU-4.3)
- `mobile/package.json` (PR4 WU-4.2)
- `mobile/supabase/functions/delete-account/README.md` (PR4 WU-4.4)
- `mobile/src/lib/supabase/feature-access.ts` (PR4 retrofit #1 — wrapper rewrite)
- `mobile/src/features/auth/use-session-store.ts` (PR4 retrofit #3 — logOutRevenueCat try/catch)
- `mobile/src/components/organisms/TypedConfirmation/lib/match.ts` (PR4 retrofit #2 — null guard)
- `mobile/openspec/changes/delete-account/verify-report-pr4.md` (this file)

**Learned**:
1. **The PR3 retrofits were correctly identified and applied during PR4 implementation.** The apply-progress-pr4.md `NEW risks` #1, #2, #3 document three real gaps that surfaced only when the PR4 harness tried to drive the contract end-to-end: (a) wrapper threw on transport rejection, (b) typed-error body was demoted to `'internal'` by the HTTP-status short-circuit, (c) logOutRevenueCat was not try/catch-wrapped. All three are real and would have been latent bugs in PR3. The PR4 implementation correctly fixed them in scope (same file, same function, same envelope contract).
2. **`pnpm test:sql` failure on `user-categories.sql` is a pre-existing test isolation issue, NOT introduced by PR4.** The failure is `permission denied for table categories` against the local Supabase DB. PR4 doesn't touch SQL, migrations, or the test runner. The same failure was already documented in PR1 verify-report-pr1.md and apply-progress-pr4.md risk #5.
3. **The PR4 spec for `unauthenticated` envelope routing is internally inconsistent across the change's artifacts.** The spec mandates re-route to `/auth/sign-in`, the design §8 omits the case, and the implementation falls through to a danger dialog. This is a real spec gap that needs resolution (spec needs amendment or implementation needs an explicit branch), but it's low-impact because the screen mounts inside the auth gate.
4. **The WU-4.3 acceptance criterion (storage-scope invariant) was not implemented as specified in tasks.md.** The 4 new tests pin the envelope shape, not the "wrapper never calls storage.delete directly" invariant. A future refactor that adds a direct storage call would not be caught. Worth a follow-up SUGGESTION to add the parallel assertion to the existing `deleteReceipt` foreign-object guard.
5. **The test-delete-account harness runs 27 tests, not 19 or 21.** 12 matchesTypedConfirmation + 10 wrapper + 5 cleanup chain. The breakdown matters: the cleanup-chain section (5 tests) is the highest-value coverage because it pins the manual cleanup behavior — the SIGNED_OUT listener does NOT fire on hard delete, so the manual chain is the only path that gets the user's session/caches cleared.
