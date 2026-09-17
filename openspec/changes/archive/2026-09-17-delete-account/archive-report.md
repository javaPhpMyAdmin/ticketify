# Archive Report — Delete Account (User-Account Deletion) — COMPLETE ARCHIVE

> **Change**: `delete-account`
> **Archive date**: 2026-09-17
> **Archive location**: `mobile/openspec/changes/archive/2026-09-17-delete-account/`
> **Artifact store**: hybrid (this file + engram `sdd/delete-account/archive-report`)
> **Archive type**: ✅ **COMPLETE ARCHIVE** — all 4 PRs landed and merged to `main`. Supersedes the prior partial archive.
> **SDD cycle status**: ✅ Fully complete. Change is shippable.

---

## 1. Executive Summary

The `delete-account` SDD change shipped end-to-end through four chained, stacked-to-main PRs (PR1 SQL → PR2 edge → PR3 client → PR4 tests). All 18 requirements — `REQ-ACCTDEL-1..13`, `REQ-AUTH-DEL-1..3`, and `REQ-HOUSE-DEL-1..2` — are implemented, verified, and merged to `main`. The verify reports confirm **PASS WITH WARNINGS** for the final PR (PR4), with one real spec gap (F1) and three cleanups (F2/F3/F4) documented as follow-ups. The change is ready to archive; this is the **complete** archive that supersedes the prior `2026-09-17-delete-account/` partial archive (which only covered PR1). Delta specs are merged into their parent specs (`user-auth`, `household-sharing`), the durable new spec (`user-account-deletion`) has had its PARTIAL IMPLEMENTATION overlay removed, and the entire change folder has been re-archived with the full PR1–PR4 artifact set preserved for audit. One outstanding manual item remains for the operator before the function is deployable: `REVENUECAT_SECRET_API_KEY` must be set as a Supabase function secret.

---

## 2. PR chain — all 4 merged to main

| PR | Title | Branch | Merge commit | Scope | Files |
|----|-------|--------|--------------|-------|-------|
| **PR1** | SQL migration + smoke test + F1/F2 fixup | `delete-account-pr1-sql` | **`0d6dd18`** | Migration `0036_delete_account.sql` (RPC), smoke test `delete-account.sql`, test wiring, REQ cross-ref fix, solo-owner assertion | `mobile/supabase/migrations/0036_delete_account.sql` (new), `mobile/supabase/tests/delete-account.sql` (new), `mobile/scripts/test-db-smoke.mjs` (modified), `mobile/package.json` (modified) |
| **PR2** | Edge function + shared service-client + audit FK fix + auto-refresh + Manage subscription button + webhook nested-envelope fix | `delete-account-pr2-edge` | **`ceadd52`** | `_shared/service-client.ts` extraction, `delete-account` edge function with `verify_jwt=true`, RC revoke helper, response constants, handler, deploy runbook, webhook FK drop for audit-persistence, profile Manage subscription button, tier-transition sync, revenuecat-webhook nested-envelope unwrap | `mobile/supabase/functions/_shared/service-client.ts` (new), `mobile/supabase/functions/delete-account/index.ts` (new), `mobile/supabase/functions/delete-account/lib/revenuecat.ts` (new), `mobile/supabase/functions/delete-account/lib/responses.ts` (new), `mobile/supabase/functions/delete-account/README.md` (new), `mobile/supabase/config.toml` (modified), `mobile/supabase/migrations/0037_drop_webhook_events_user_id_fk.sql` (new), `mobile/src/features/profile/components/AccountSettingsList.tsx` (modified), `mobile/src/features/profile/hooks/useProfile.ts` (modified), `mobile/src/i18n/locales/{es-AR,en,pt-BR}/{settings,profile}.json` (modified), `mobile/supabase/functions/revenuecat-webhook/index.ts` (modified) |
| **PR3** | Client UI (wrapper + store + TypedConfirmation + screen + profile row + i18n 19 keys × 3 locales) | `delete-account-pr3-client` | **`1b4c829`** | `deleteAccount()` wrapper, `useSessionStore.deleteAccount` action with manual cleanup chain, `TypedConfirmation` organism, `settings/delete-account` screen, danger-toned profile row, `AccountSettingsList` `tone` prop, i18n keys (es-AR canonical + en + pt-BR), PR3 verification typecheck pass | `mobile/src/lib/supabase/feature-access.ts` (modified), `mobile/src/features/auth/use-session-store.ts` (modified), `mobile/src/components/organisms/TypedConfirmation/{index.tsx,types.ts,lib/match.ts}` (new), `mobile/src/components/organisms/index.ts` (modified), `mobile/src/app/settings/delete-account.tsx` (new), `mobile/src/app/(tabs)/profile.tsx` (modified), `mobile/src/features/profile/components/AccountSettingsList.tsx` (modified), `mobile/src/i18n/locales/{es-AR,en,pt-BR}/settings.json` (modified), `mobile/src/i18n/locales/{es-AR,en,pt-BR}/auth.json` (modified) |
| **PR4** | Tests (`test-delete-account.mjs` harness + master-chain wiring + `test-features.mjs` envelope invariants) + runbook §5 finalization | `delete-account-pr4-tests` | **`ad34876`** (final branch tip; merged to main as `ad34876`) | `test-delete-account.mjs` (27 assertions: 12 matchesTypedConfirmation + 10 envelope + 5 cleanup-chain), `test-stubs/revenuecat.ts`, `tsconfig.delete-account-test.json`, `test-features.mjs` (+4 envelope-invariant pins), `package.json` master-chain wiring, `delete-account/README.md` §5 finalization (audit-signal query + annotated smoke test + RC alias verification + Storage sweep verification), plus 3 PR3 retrofits (wrapper rewrite with try/catch + body-error preference + HTTP-status fallback, matchesTypedConfirmation null guard, use-session-store logOutRevenueCat try/catch) | `mobile/scripts/test-delete-account.mjs` (new), `mobile/scripts/test-stubs/revenuecat.ts` (new), `mobile/scripts/tsconfig.delete-account-test.json` (new), `mobile/scripts/test-features.mjs` (modified), `mobile/package.json` (modified), `mobile/supabase/functions/delete-account/README.md` (modified), `mobile/src/lib/supabase/feature-access.ts` (PR3 retrofit #1), `mobile/src/features/auth/use-session-store.ts` (PR3 retrofit #3), `mobile/src/components/organisms/TypedConfirmation/lib/match.ts` (PR3 retrofit #2) |

---

## 3. REQ implementation status — all 18 ✅

Every requirement across all three capability specs is implemented and verified. Merge commits reference the PR that introduced the production code that satisfies each requirement.

### `user-account-deletion` capability (REQ-ACCTDEL-*)

| REQ ID | Title | PR / Merge | Status |
|--------|-------|------------|--------|
| **REQ-ACCTDEL-1** | In-App Entry Point | PR3 (`1b4c829`) | ✅ Implemented — danger-toned profile row navigates to `/settings/delete-account` |
| **REQ-ACCTDEL-2** | Typed-Confirmation Gating | PR3 (`1b4c829`) | ✅ Implemented — `TypedConfirmation` organism + `matchesTypedConfirmation` helper (trim + lowercase + non-empty, with PR4 null-guard retrofit) |
| **REQ-ACCTDEL-3** | Subscription Disclosure | PR3 (`1b4c829`) | ✅ Implemented — banner with Pro/Free branches; Pro branch invokes `showManageSubscriptions()` |
| **REQ-ACCTDEL-4** | Pre-Delete Export Nudge (Pro Only) | PR3 (`1b4c829`) | ✅ Implemented — Pro-only `Pressable` → `/settings/export` |
| **REQ-ACCTDEL-5** | Household Owner Pre-Flight | PR1 (`0d6dd18`) | ✅ Implemented — RPC raises SQLSTATE `P0001` with `owner_must_disband_first`; client routes to `/settings/household` |
| **REQ-ACCTDEL-6** | Atomic Erasure | PR1 (`0d6dd18`) | ✅ Implemented — single transaction: Storage sweep → `parse_attempts` scrub → cascade → `auth.users`; pre-delete ordering handles `trg_monthly_totals_recalculate` AFTER-trigger FK race |
| **REQ-ACCTDEL-7** | RevenueCat Alias Revoke | PR2 (`ceadd52`) | ✅ Implemented — edge function calls `DELETE /v1/subscribers/{id}` with `REVENUECAT_SECRET_API_KEY` BEFORE `auth.users` delete; fail-closed on non-2xx |
| **REQ-ACCTDEL-8** | Storage Sweep | PR1 (`0d6dd18`) | ✅ Implemented — `delete from storage.objects where bucket_id='receipts' and (storage.foldername(name))[1] = p_user_id::text` inside RPC transaction with `storage.allow_delete_query` GUC scoped LOCAL |
| **REQ-ACCTDEL-9** | Idempotency | PR1 (`0d6dd18`) | ✅ Implemented — RPC returns `'already_deleted'` on second call without exception; smoke test §6 asserts |
| **REQ-ACCTDEL-10** | Post-Delete Client State | PR3 (`1b4c829`) | ✅ Implemented — `useSessionStore.deleteAccount()` runs manual cleanup chain (`queryClient.clear` → `useReceiptsStore.resetAll` → `useProStore.reset` → `useHouseholdStore.reset` → `setState({session:null})`); `logOutRevenueCat` try/catch-wrapped (PR4 retrofit) |
| **REQ-ACCTDEL-11** | Error Mapping | PR3 (`1b4c829`) | ⚠️ Implemented with one spec gap (F1 below) — `feature-access.deleteAccount` wrapper handles envelope mapping; screen-side switch on `result.code` covers all 4 codes |
| **REQ-ACCTDEL-12** | Internationalization | PR3 (`1b4c829`) | ✅ Implemented — 21 keys (19 design + `deleteAccountInputHint` + `couldNotDeleteAccount` in auth.json) across `en`, `es-AR`, `pt-BR` |
| **REQ-ACCTDEL-13** | Audit Signal | PR2 (`ceadd52`) | ✅ Implemented — edge function inserts `webhook_events` row AFTER RPC returns; FK dropped via `0037_drop_webhook_events_user_id_fk.sql` so ledger row persists post-cascade |

### `user-auth` delta (REQ-AUTH-DEL-*)

| REQ ID | Title | PR / Merge | Status |
|--------|-------|------------|--------|
| **REQ-AUTH-DEL-1** | In-App Account-Deletion Entry Point | PR3 (`1b4c829`) | ✅ Implemented — same profile-row wiring as REQ-ACCTDEL-1; merged into parent `user-auth` spec |
| **REQ-AUTH-DEL-2** | Account Removal Primitive | PR1 (`0d6dd18`) | ✅ Implemented — `public.delete_user_account(uuid)` SECURITY DEFINER RPC; EXECUTE granted only to `service_role`; merged into parent `user-auth` spec |
| **REQ-AUTH-DEL-3** | Post-Delete Sign-Out | PR3 (`1b4c829`) | ✅ Implemented — manual cleanup chain runs because `supabase.auth.signOut()` is not called (hard delete invalidates JWT); merged into parent `user-auth` spec |

### `household-sharing` delta (REQ-HOUSE-DEL-*)

| REQ ID | Title | PR / Merge | Status |
|--------|-------|------------|--------|
| **REQ-HOUSE-DEL-1** | Account Deletion Owner Pre-Flight | PR1 (`0d6dd18`) | ✅ Implemented — server-side enforced in the RPC; smoke test asserts block + no per-user row removed; merged into parent `household-sharing` spec |
| **REQ-HOUSE-DEL-2** | Cross-Route Progress Preservation | PR3 (`1b4c829`) | ✅ Implemented — `useSessionStore.deleteAccountDraft` transient field preserves typed `ELIMINAR` across the trip to `/settings/household`; merged into parent `household-sharing` spec |

### NFR sections (Latency, RPC Privilege Boundary, No Residual Local State, Accessibility)

| NFR | PR / Merge | Status |
|-----|------------|--------|
| **Latency** (end-to-end ≤ 10s) | PR2 (`ceadd52`) | ✅ Implemented — RC revoke + Storage sweep + cascade + RPC return; client surfaces non-cancellable progress |
| **Security: RPC Privilege Boundary** | PR1 (`0d6dd18`) | ✅ Implemented — `SECURITY DEFINER` + `owner to postgres` + `REVOKE FROM PUBLIC,anon,authenticated` + `GRANT TO service_role`; smoke test §1 asserts |
| **Privacy: No Residual Local State** | PR3 (`1b4c829`) | ✅ Implemented — secure-store session clear, queryClient.clear, all 3 per-user Zustand stores reset, transient draft cleared, RC SDK alias cleared locally (best-effort) |
| **Accessibility** | PR3 (`1b4c829`) | ✅ Implemented — WCAG AA contrast (theme-aware), screen-reader labels, destructive button announces "Eliminar cuenta — acción irreversible", typed-confirmation field announces match state |

---

## 4. Open follow-ups (from `verify-report-pr4.md`)

These are documented for future maintainers. None block the archive or shippability.

### WARNING

**F1 — `unauthenticated` envelope doesn't re-route to `/sign-in` per REQ-ACCTDEL-11 spec table**
- **Severity**: WARNING
- **Files**: `mobile/src/app/settings/delete-account.tsx` (lines 102-118), `mobile/openspec/specs/user-account-deletion/spec.md` (line 233-234)
- **Evidence**: The spec table maps `unauthenticated` → "Re-route to `/sign-in`" (was `/auth/sign-in` — see F4). The screen implementation groups `unauthenticated` together with `revenuecat_revoke_failed` and `internal` and shows a danger dialog. Design §8 also omits an explicit `unauthenticated` branch — its switch falls through to `default → useDialogStore.show(...)`. So the divergence is between (spec, source-of-truth) and (design, implementation).
- **Recommendation**: Either (a) align the implementation to the spec by adding a `case 'unauthenticated': router.replace('/sign-in')` branch, or (b) amend the spec to reflect the design's defensive-dialog behavior. Impact is low in practice (the screen mounts inside the auth gate; an `unauthenticated` envelope typically means the JWT expired between mount and confirm — the `SIGNED_OUT` listener would already have routed the user out).
- **Source**: PR4 (`ad34876`) verify-report-pr4.md §Issues Found → WARNING

### SUGGESTION

**F2 — WU-4.3 acceptance criterion (storage-scope invariant) was not implemented as specified**
- **Severity**: SUGGESTION
- **Files**: `mobile/scripts/test-features.mjs` (lines 2336-2446), `mobile/openspec/changes/archive/2026-09-17-delete-account/tasks.md` (WU-4.3)
- **Evidence**: Tasks.md WU-4.3 says: "add a parallel to the existing `deleteReceipt` check that asserts the new wrapper never calls the storage delete endpoint directly (it routes through the edge function)". The 4 new tests in `test-features.mjs` pin the envelope shape (4-code union + field-probe tolerance + alreadyDeleted-omit + unknown-code-demote), but do NOT assert that `deleteAccount` never touches `storage.remove` / `storage-upload` / `storage-signed`. The wrapper correctly only calls `supabase.functions.invoke` today, but a future refactor that adds a direct storage call would not be caught.
- **Recommendation**: Add a single assertion alongside the 4 envelope tests: stub a `storage.remove` call counter and assert `log.filter(e => e.kind === 'storage-remove').length === 0` after a successful `deleteAccount` invocation. Mirrors the existing `deleteReceipt` foreign-object guard at line 2264-2270.
- **Source**: PR4 (`ad34876`) verify-report-pr4.md §Issues Found → SUGGESTION

**F3 — `deleteAccountErrorHouseholdBody` design key was renamed to `deleteAccountErrorHouseholdOwnerBody` in implementation**
- **Severity**: SUGGESTION
- **Files**: `mobile/src/i18n/locales/{es-AR,en,pt-BR}/settings.json`, `mobile/openspec/changes/archive/2026-09-17-delete-account/design.md` (§10)
- **Evidence**: Design §10 lists the key as `deleteAccountErrorHouseholdBody`. All 3 locale JSONs use `deleteAccountErrorHouseholdOwnerBody`. The name is more specific (clarifies it's the household-Owner pre-flight, distinct from a generic household error) but creates a spec/implementation drift.
- **Recommendation**: Update design §10 to match the implementation key name. Implementation is correct and self-consistent across all 3 locales; this is documentation drift only.
- **Source**: PR4 (`ad34876`) verify-report-pr4.md §Issues Found → SUGGESTION

**F4 — Spec path `/auth/sign-in` doesn't match codebase route `/sign-in`**
- **Severity**: SUGGESTION
- **Files**: `mobile/openspec/specs/user-account-deletion/spec.md` (3 references), `mobile/openspec/specs/user-auth/spec.md` (1 reference)
- **Evidence**: Spec text uses `/auth/sign-in` consistently (REQ-ACCTDEL-10 scenario, REQ-ACCTDEL-11 line, REQ-AUTH-DEL-3 scenario). Codebase uses `/sign-in` (the `(auth)` route group is URL-suppressed in Expo Router). Implementation correctly uses `/sign-in`. **Note**: this archive has already updated the merged `user-auth` delta to use `/sign-in` (see REQ-AUTH-DEL-3 in the merged parent spec). The durable `user-account-deletion` spec still says `/auth/sign-in` in REQ-ACCTDEL-10 scenario and REQ-ACCTDEL-11 mapping table.
- **Recommendation**: Update the remaining `/auth/sign-in` references in `user-account-deletion/spec.md` to `/sign-in` to match the Expo Router convention.
- **Source**: PR4 (`ad34876`) verify-report-pr4.md §Issues Found → SUGGESTION

---

## 5. Pre-existing gate failure (NOT a delete-account regression)

The master `pnpm test` chain surfaces a pre-existing `pnpm test:sql` failure on `user-categories.sql` with `permission denied for table categories` against the local Supabase DB. This is **not** a delete-account regression:

- PR1 verify-report-pr1.md documents the failure as pre-existing (apply-progress-pr4.md risk #5).
- PR4 does not touch SQL, migrations, or the test runner. The PR4 `delete-account.sql` smoke test runs cleanly in isolation (PR1 verify report ran it 3 consecutive times against `supabase_db_tickettify` (Postgres 17.6) with no failures).
- The failure is unrelated to any of the 18 delete-account requirements.

**Recommendation**: track and fix `user-categories.sql` test isolation as a separate change. Do not block `delete-account` shipping on this.

---

## 6. Outstanding manual items for the operator

### A. Set `REVENUECAT_SECRET_API_KEY` as a Supabase function secret BEFORE deploying

The `delete-account` edge function requires the RevenueCat secret API key to revoke subscriber aliases. Without it, every delete attempt returns `revenuecat_revoke_failed` (HTTP 502) and the user's data is NOT deleted.

```bash
# 1. Get the secret from the RevenueCat dashboard:
#    https://app.revenuecat.com/settings/api-keys
#    (use the "Secret" key, NOT the public key)

# 2. Set it as a Supabase function secret:
npx supabase secrets set REVENUECAT_SECRET_API_KEY=REVENUECAT_SECRET_KEY_HERE \
  --project-ref lfbyifbccfjposuzgccl

# 3. Verify the secret is set:
npx supabase secrets list --project-ref lfbyifbccfjposuzgccl | grep REVENUECAT
```

### B. Deploy the function

The function is already registered in `supabase/config.toml` with `verify_jwt = true`, so the deploy command does NOT need `--no-verify-jwt`:

```bash
# 1. Apply the SQL migrations first (if not already applied):
npx supabase db push --project-ref lfbyifbccfjposuzgccl

# 2. Deploy the function:
npx supabase functions deploy delete-account --project-ref lfbyifbccfjposuzgccl

# 3. Smoke test against the deployed function:
#    (see supabase/functions/delete-account/README.md §5.2 for full curl invocations)

# 4. Verify the audit signal:
#    (see §5.1 of the README — webhook_events query)

# 5. Verify the RevenueCat alias is revoked:
#    (see §5.3 of the README — curl against /v1/subscribers/{id})

# 6. Verify Storage sweep:
#    (see §5.4 of the README — storage.objects query)
```

> **If `--no-verify-jwt` is required for any reason** (e.g., JWT validation is failing for the deployed function), use the override:
> `npx supabase functions deploy delete-account --project-ref lfbyifbccfjposuzgccl --no-verify-jwt`

### C. (Optional) Resolve the 4 follow-ups F1-F4

See §4 above. None are required for shipping, but F1 (the `unauthenticated` envelope spec drift) is the most material — a future maintainer should either align the implementation to the spec or amend the spec to match the defensive-dialog behavior.

---

## 7. How to verify the full chain locally

```bash
# 1. TypeScript typecheck (client/Expo surface)
pnpm typecheck

# 2. The 7 test suites that cover delete-account:
pnpm test:delete-account     # 27/27 — matchesTypedConfirmation + wrapper envelope + cleanup chain
pnpm test:features           # 131/131 — including 4 envelope-invariant pins from PR4
pnpm test:profile-hook       # 6/6 — profile integration
pnpm test:auth               # 57/57 — auth regression check
pnpm test:i18n-detector      # 11/11 — all new keys present in es-AR/en/pt-BR
pnpm test:pro-gating         # 20/20 — pro store gating
pnpm test:webhook-idempotency # 25/25 — PR2 service-client refactor regression check
pnpm test:verify-constant-time # 8/8 — security verification helper

# 3. (Optional) Full master chain — note pnpm test:sql will fail on user-categories.sql
#    (pre-existing failure, NOT a delete-account regression — see §5 above):
# pnpm test

# 4. SQL smoke test for delete-account (must run in isolation due to §5):
docker exec -i supabase_db_tickettify psql -U postgres -d postgres \
  < supabase/tests/delete-account.sql
#    Expected: 8 sections all pass (catalog, cascade, storage sweep, parse_attempts,
#    scrub, solo-owner-not-blocked, idempotency, household-owner-blocked, re-signup).
```

---

## 8. Resume instructions

**Empty — the change is archived, not paused.**

The SDD cycle is complete. Future work on the delete-account flow (F1-F4 follow-ups, the audit-signal FK migration if re-introduced, RC secret rotation, etc.) should be tracked as **new SDD changes** with their own explore/proposal/spec/design/tasks/apply/verify/archive cycle. Do not resume this archive.

---

## 9. What / Why / Where / Learned

**What**: Complete archive of the `delete-account` SDD change after all 4 PRs (PR1 SQL, PR2 edge, PR3 client, PR4 tests) merged to `main`. Merged `REQ-AUTH-DEL-*` into `openspec/specs/user-auth/spec.md` and `REQ-HOUSE-DEL-*` into `openspec/specs/household-sharing/spec.md`. Removed the PARTIAL IMPLEMENTATION overlay from `openspec/specs/user-account-deletion/spec.md` and stripped the `⏳ PRN` markers from every requirement heading. Moved the entire change folder to `openspec/changes/archive/2026-09-17-delete-account/` (overwriting the prior partial archive).

**Why**: The user explicitly requested a COMPLETE archive now that all 4 PRs are landed. The prior partial archive (`archive-report.md` revision of 2026-09-17 16:18) was a stop-gap after PR1 only. The complete archive closes the SDD cycle and supersedes the partial one with a durable record of the full chain + outstanding follow-ups.

**Where**:
- `mobile/openspec/specs/user-account-deletion/spec.md` — durable new spec, overlay removed, 13 requirements intact
- `mobile/openspec/specs/user-auth/spec.md` — parent spec gained REQ-AUTH-DEL-1, REQ-AUTH-DEL-2, REQ-AUTH-DEL-3 (with source annotation)
- `mobile/openspec/specs/household-sharing/spec.md` — parent spec gained REQ-HOUSE-DEL-1, REQ-HOUSE-DEL-2 (with source annotation)
- `mobile/openspec/changes/archive/2026-09-17-delete-account/` — full change folder (proposal.md, explore.md, design.md, tasks.md, specs/, apply-progress-pr{1,2,3,4}.md, verify-report-pr{1,4}.md, this archive-report.md)
- Engram `sdd/delete-account/archive-report` (project `coronatracker`, type `architecture`, topic_key upserted from prior partial #1362)

**Learned**:
1. **The PARTIAL IMPLEMENTATION overlay was correctly designed for a paused SDD session, but its removal here was mechanical** — every `⏳ PRN` marker had a corresponding ✅ implementation in main. The overlay's `Status: ` suffix on Requirement headings was safe because the requirement text itself was unchanged; removing the suffix preserved all scenarios (Given/When/Then) verbatim.
2. **The delta specs survived the partial archive with explicit warnings at the top** ("⚠️ ARCHIVED DELTA — NOT merged into the parent spec"). This made the merge step unambiguous: strip the warning, append the REQ-*-DEL-* sections to the parent spec with a `> Source: change `delete-account` (archived 2026-09-17)` annotation, and the parent spec now reflects the implemented contracts.
3. **The four follow-ups (F1 WARNING + F2/F3/F4 SUGGESTIONs) are all real but none are blockers** — F1 is a spec/implementation drift on the `unauthenticated` envelope that the screen mounts inside the auth gate so it's low-frequency; F2 is a missing test assertion for an invariant the code already satisfies; F3/F4 are pure documentation drift. Each is a small, surgical follow-up — none require re-opening the SDD cycle.
4. **The pre-existing `pnpm test:sql` `user-categories.sql` failure is tracked separately and is NOT a delete-account regression** — the delete-account SQL smoke test runs cleanly in isolation. Including it in this archive report protects future maintainers from confusing it with a delete-account bug.
5. **The cross-spec REQ ID mapping (e.g., REQ-ACCTDEL-1 ↔ REQ-AUTH-DEL-1, REQ-ACCTDEL-5 ↔ REQ-HOUSE-DEL-1) is now self-consistent across all three durable specs** — each capability spec cross-references the other by REQ ID rather than by file path, which survives future refactors that move requirements between files. The 13 `REQ-ACCTDEL-*` in the durable spec, the 3 `REQ-AUTH-DEL-*` in user-auth, and the 2 `REQ-HOUSE-DEL-*` in household-sharing together form the complete contract surface.

---

**Change archived.** SDD cycle complete.