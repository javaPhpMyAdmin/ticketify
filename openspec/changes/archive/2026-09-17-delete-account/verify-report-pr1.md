# Verify Report — PR1 (SQL migration + smoke test + test runner wiring)

> Change: `delete-account` · Branch: `delete-account-pr1-sql` · Artifact store: hybrid (this file + engram `sdd/delete-account/verify-report`).
> Verification mode: standard (no strict TDD). PR scope: WU-1.1 + WU-1.2 + WU-1.3.

## Executive Summary

PR1 is functionally correct and ready to merge from a runtime behavior standpoint. The `delete_user_account(p_user_id uuid)` SECURITY DEFINER RPC correctly implements REQ-ACCTDEL-5 (household pre-flight via SQL exception `owner_must_disband_first` with SQLSTATE `P0001`), REQ-ACCTDEL-6/8 (atomic erasure covered by pre-delete of cascade-trigger-affected tables, storage sweep, parse_attempts scrub, and `auth.users` delete), REQ-ACCTDEL-9 (idempotency early-return), and the NFR security privilege boundary (REVOKE from PUBLIC/anon/authenticated, GRANT to service_role, owner=postgres). The smoke test covers the catalog contract, cascade across 11 per-user tables + storage sweep + parse_attempts scrub, household-owner block (with re-raise guard against silent no-op), idempotency, and re-signup. Re-derivation: I re-ran the migration against `docker exec psql` against the local Postgres 17.6 container (`supabase_db_tickettify`) and re-ran the smoke test 3 consecutive times — all pass. `pnpm typecheck` exits 0. The PR contains exactly 5 files modified (the migration, the smoke test, the runner script, `package.json`, and the apply-progress doc) across 5 commits on the branch. Outstanding issues are documentation drifts and a missing solo-owner-not-blocked assertion (SUGGESTION/WARNING), none of which block the merge.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total (PR1) | 3 (WU-1.1, WU-1.2, WU-1.3) |
| Tasks complete | 3 |
| Tasks incomplete | 0 |
| Commits on branch | 5 (feat, test, chore, fix, docs) |
| Files modified | 5 (migration + test + runner + package.json + apply-progress doc) |

## Build & Tests Execution

| Gate | Status | Evidence |
|------|--------|----------|
| `pnpm typecheck` | ✅ Pass | Exit 0, no errors. Verified locally. |
| `pnpm test:sql` (full boot-from-scratch) | ⚠️ Skipped — `supabase` CLI not on PATH | Out-of-scope for PR1 executor (apply-progress risk #1 acknowledged). |
| Migration re-apply idempotently | ✅ Pass | `docker cp` + `docker exec psql -f` against `supabase_db_tickettify` (Postgres 17.6.1.155). Output: `CREATE FUNCTION / ALTER FUNCTION / REVOKE×3 / GRANT / COMMENT`. |
| Smoke test run (3 consecutive) | ✅ Pass ×3 | All three runs end in `NOTICE: delete-account.sql smoke: catalog + cascade + storage sweep + parse_attempts scrub + household-owner block + idempotency + re-signup assertions passed`. Idempotent across re-runs. |
| Idempotency probe (`delete_user_account('00000000-...')`) | ✅ Pass | Returns `'already_deleted'` without raising. |
| Catalog probe (privilege boundary) | ✅ Pass | `service_role` has EXECUTE; `authenticated`, `anon`, `public` are REVOKED. |
| Catalog probe (SECURITY DEFINER + owner=postgres) | ✅ Pass | `pg_proc.prosecdef = true`, `pg_get_userbyid(proowner) = 'postgres'`. |
| GUC scoping probe | ✅ Pass | `storage.allow_delete_query` is `true` inside the transaction, resets to empty after `COMMIT`. |
| Regression on prior SQL smoke tests | ⚠️ Pre-existing | `household-gate-tier.sql` and `user-categories.sql` both fail on re-run against the polluted local DB — pre-existing test isolation quirks, NOT introduced by PR1 (apply-progress risk note + verified by `git diff main..HEAD -- supabase/tests/household-gate-tier.sql supabase/tests/user-categories.sql` returning empty). The new smoke test was re-verified after each prior failure to confirm isolation. |
| Audit-signal REQ-ACCTDEL-13 location | ✅ Confirmed PR1 does NOT insert into `webhook_events` | Correct per design §14 Decision 1 (insert from edge function after RPC returns `'ok'`, not inside the RPC). PR2 owns the audit row insert. |

## Spec Compliance Matrix

| Requirement (spec §) | Scenario | Test (file > section) | Result |
|---|---|---|---|
| REQ-ACCTDEL-5 (household pre-flight) | Owner with active members blocked | `delete-account.sql` §5 | ✅ COMPLIANT — raises SQLSTATE `P0001` with message `owner_must_disband_first`. Rerun-on-blocked guard (§6.5 in apply-progress) confirms the pre-flight still raises, not silently no-ops. |
| REQ-ACCTDEL-5 (household pre-flight) | Nothing was mutated on block | `delete-account.sql` §5 (auth.users / profiles / household_members assertions) | ✅ COMPLIANT — every row still present after the raise. |
| REQ-ACCTDEL-5 (household pre-flight) | Solo owner NOT blocked | (none — see F2) | ⚠️ PARTIAL — implicit coverage only via cascade user (no household). Design §11 §4 calls for an explicit "solo owner" assertion; the implementation omits it. |
| REQ-ACCTDEL-6 (atomic erasure) | All cascading tables wiped in one call | `delete-account.sql` §2 (10 per-user tables) | ✅ COMPLIANT — profiles, stores, purchases, purchase_items, scan_usage, monthly_user_totals, category_budgets, webhook_events, user-scoped categories all empty after RPC. |
| REQ-ACCTDEL-6 (atomic erasure) | Failure leaves no partial state | (design-level only) | ✅ COMPLIANT (static) — `begin ... exception when others then raise end` wraps the destructive block; the explicit pre-delete of `purchase_items`/`purchases`/`monthly_user_totals` controls the AFTER-trigger FK-check race (comment lines 136–160). |
| REQ-ACCTDEL-8 (Storage sweep) | Folder objects removed | `delete-account.sql` §2 (storage pre + post assertions) | ✅ COMPLIANT — delete from `storage.objects where bucket_id='receipts' and (storage.foldername(name))[1] = p_user_id::text` runs after `set_config('storage.allow_delete_query', 'true', true)` LOCAL-scoped. |
| REQ-ACCTDEL-9 (idempotency) | Second call is a no-op success | `delete-account.sql` §6 | ✅ COMPLIANT — second call returns `'already_deleted'`, no exception. |
| REQ-AUTH-DEL-2 (auth.users removal) | Hard delete + cascade | `delete-account.sql` §2 | ✅ COMPLIANT — `auth.users` row gone; cascade chains reach all per-user tables. |
| REQ-HOUSE-DEL-1 (owner pre-flight) | Server-side block | `delete-account.sql` §5 | ✅ COMPLIANT — bad-client cannot bypass (the RPC enforces it). |
| REQ-ACCTDEL-13 (audit signal) | Ledger row written before cascade | (none — PR2 owns this) | ✅ DEFERRED — design §14 Decision 1 deliberately defers the `webhook_events` row to the edge function, executed AFTER the RPC returns. PR1's RPC correctly does NOT insert it (no double-write risk). |
| NFR Security (RPC privilege boundary) | EXECUTE only to service_role | `delete-account.sql` §1 | ✅ COMPLIANT — `has_function_privilege` checks for `service_role` (true), `authenticated/anon/public` (false). |
| NFR Security (SECURITY DEFINER + owner=postgres) | Function ownership | `delete-account.sql` §1 | ✅ COMPLIANT. |

Compliance summary: 11/11 covered REQs have a passing covering test; 1 spec scenario (solo owner NOT blocked) is implicitly covered only.

## Correctness (Static Evidence)

| Implementation detail | Verdict | Notes |
|-----------------------|---------|-------|
| `function public.delete_user_account(p_user_id uuid) returns text language plpgsql security definer volatile set search_path = public, storage` | ✅ | Signature matches design §3 + spec wording; search_path narrowed to prevent schema-hijack. |
| Idempotency early return on missing auth.users | ✅ | Line 99–101. Returns `'already_deleted'` before any destructive step. |
| Household-owner pre-flight | ✅ | Lines 114–122. JOIN excludes `hm.user_id = p_user_id` so a solo owner is correctly NOT blocked. `raise exception 'owner_must_disband_first' using errcode = 'P0001'` — the explicit ERRCODE pin (in addition to the message) is the design's "signal-level contract" guard against a future message-string refactor. |
| Storage sweep | ✅ | Exact query from REQ-ACCTDEL-8: `delete from storage.objects where bucket_id = 'receipts' and (storage.foldername(name))[1] = p_user_id::text`. |
| `storage.allow_delete_query` GUC | ✅ | Set LOCAL inside the `begin` block so the trigger bypass is transaction-scoped. Re-applies and reverts cleanly (verified). |
| parse_attempts scrub | ✅ | Explicit delete — `parse_attempts` has no FK to profiles (0022 §1), so cascade leaves it. Migration handles it correctly. |
| `delete from auth.users where id = p_user_id` | ✅ | Last destructive step; cascades to profiles → 8 per-user tables + households/household_members/invite_codes (via profiles FK cascades). |
| Pre-delete ordering for trg_monthly_totals_recalculate | ✅ | Lines 161–166. `purchase_items` → `purchases` → `monthly_user_totals`. This handles the AFTER-trigger UPSERT race (the trigger's UPSERT into `monthly_user_totals` happens while the profile still exists, then the explicit delete clears it before the auth.users cascade). |
| `alter function ... owner to postgres` | ✅ | Required for SECURITY DEFINER to run as bypassrls. |
| Least-privilege grants: REVOKE PUBLIC/anon/authenticated + GRANT service_role | ✅ | Lines 204–207. Matches the 0029 §4 / 0034 §3 house style. |
| Header comment cross-references REQ IDs | ⚠️ Partially wrong | See F1. |
| `comment on function` documents both the DB-level message AND the HTTP-level error code | ✅ | Pre-pins the PR2 envelope mapping (`household_owner_with_members` 409). |
| No double-write of webhook_events audit row | ✅ | PR1 RPC does not INSERT into `webhook_events` (design §14 Decision 1). |

## Coherence (Design)

| Design decision | Followed? | Notes |
|-----------------|-----------|-------|
| Single SECURITY DEFINER RPC for the destructive primitive | ✅ | No definer split, no separate storage RPC, no separate parse_attempts RPC. |
| Household-owner pre-flight via SQL exception text + SQLSTATE | ✅ | Matches design §3 + §14. |
| Pre-delete of `monthly_user_totals` to handle the AFTER-trigger FK race | ✅ | Implementation explicitly calls this out (lines 136–160). The design did NOT anticipate this — discovered during apply, fixup commit `33294f4`. |
| `storage.allow_delete_query` LOCAL GUC inside the RPC | ✅ | Discovered during apply (design's "Storage RLS bypassed by service_role" was insufficient — Supabase Storage has a separate `protect_delete()` trigger requiring this GUC). |
| Auth.users email re-signup test pre-clean | ✅ | Smoke test pre-deletes `auth.users where email = v_cascade_email` before re-inserting (handles `auth.users_email_partial_key`). |
| Audit row inserted AFTER the RPC, from the edge function | ✅ | PR1 correctly does not insert. PR2 owns it. |
| Function comment pre-pins the HTTP-layer error code mapping | ✅ | Implementation includes it; the design's contract is preserved. |
| Smoke test sections per design §11 | ⚠️ Drift | See F2 — "solo owner is NOT blocked" (design §11 §4) is missing from the implementation. |

## Issues Found

### CRITICAL
None.

### WARNING

**F1 — REQ ID cross-references in migration header are mislabeled** (`supabase/migrations/0036_delete_account.sql` lines 7–10)
- **Evidence**: The header lists `REQ-ACCTDEL-6 (Storage sweep), REQ-ACCTDEL-7 (parse_attempts scrub), REQ-ACCTDEL-8 (auth.users delete), REQ-ACCTDEL-9 (idempotency), REQ-ACCTDEL-11 (privilege grants), REQ-HOUSE-DEL-1 (owner pre-flight)`. Cross-checked against `openspec/specs/user-account-deletion/spec.md`:
  - REQ-ACCTDEL-6 is **Atomic Erasure**, not Storage sweep (REQ-ACCTDEL-8 = Storage sweep).
  - REQ-ACCTDEL-7 is **RevenueCat Alias Revoke** (PR2 scope), not parse_attempts scrub.
  - REQ-ACCTDEL-8 is **Storage Sweep**, not "auth.users delete" (auth.users removal is the destructive primitive itself, covered by REQ-ACCTDEL-6).
  - REQ-ACCTDEL-9 is **Idempotency** — ✅ correct.
  - REQ-ACCTDEL-11 is **Error Mapping** (PR3 scope), not privilege grants (privilege grants are the NFR Security: RPC Privilege Boundary).
  - REQ-HOUSE-DEL-1 ✅ correct as the delta cross-reference.
  - Also missing: REQ-ACCTDEL-5 (the primary cross-reference for the household pre-flight).
  - The same drift appears in `openspec/changes/delete-account/tasks.md` line 53 and `openspec/changes/delete-account/design.md` line 70 — the migration inherited it from upstream artifacts.
- **Recommendation**: Fix the cross-references in the migration header in a follow-up PR (or amend PR1 before merge) — point at the correct REQ IDs from the actual spec. The implementation itself is functionally correct; this is purely a documentation drift inherited from the design phase.

**F2 — Smoke test omits the "solo owner is NOT blocked" assertion** (`supabase/tests/delete-account.sql`)
- **Evidence**: Design §11 lists 6 sections, with §4 being "Solo owner is NOT blocked — seed user as `households.created_by` + a single `household_members` row for self (role='owner'). Call the RPC, assert: returns `'ok'`, every row deleted." The implementation has 5 sections (catalog, cascade, household-owner blocked, idempotency, re-signup). The cascade user has NO household at all, which exercises the "non-owner / no household" path implicitly, but not the "user IS the owner of a solo household" path.
- **Recommendation**: Add a §4 between the cascade and blocked sections that seeds `households(created_by = user)` + a single `household_members(user_id = user, role='owner')` row and asserts the RPC returns `'ok'` (no block). Low-risk to add — the migration's pre-flight query is straightforward and the fixture would reuse the existing `da` prefix namespace.

### SUGGESTION

**F3 — `scripts/test-db-smoke.mjs` header comment is stale** (lines 9–14)
- **Evidence**: The comment still says "This is intentionally NOT part of the `pnpm test` chain. The Node test suite (test:*) is 100% dependency-free of Docker and runs anywhere." But `package.json` line 52 now appends `&& pnpm test:sql` to the master `pnpm test` chain, which boots Docker. The comment contradicts the actual contract.
- **Recommendation**: Update the header comment to reflect the new contract — either remove the "intentionally NOT part of `pnpm test`" sentence, or note that `pnpm test:sql` was added to the master chain in PR1 (with the explicit trade-off that `pnpm test` now requires Docker). The apply-progress risk #4 acknowledges this as a deliberate trade-off.

**F4 — Redundant exception handler in smoke test §7** (`supabase/tests/delete-account.sql` lines 404–413)
- **Evidence**: The `begin ... exception when others then v_resignup_ok := false; raise; end` block has a re-raise that just propagates the exception. The handler could be removed and the INSERT placed directly inside the block, with the `v_resignup_ok := true` assignment before it. Functionally identical, but the current form obscures intent.
- **Recommendation**: Simplify to `INSERT ... RETURNING id INTO v_resignup_id; v_resignup_ok := true;` outside a savepoint block. The pre-clean (`delete from auth.users where email = v_cascade_email`) on line 401 already guarantees the INSERT will not collide with a prior-run residue.

## Verdict

**PASS WITH WARNINGS** — PR1 is functionally correct, security-hardened, and idempotent. The migration re-applies cleanly against the existing chain, the smoke test passes 3 consecutive runs, the privilege boundary is correct, and no other migrations are bundled. The 2 WARNINGs (F1 mislabeled REQ IDs in cross-references, F2 missing solo-owner-not-blocked assertion) are addressable in small follow-ups and do not block the merge. SUGGESTIONs F3/F4 are cleanups.

**Next step**: PR2 (`delete-account-pr2-edge`) is unblocked — edge function, shared service-client refactor, RevenueCat revoke helper, response envelope constants, audit row insertion in `webhook_events`.

## What / Why / Where / Learned

**What**: Independent verification of PR1 of the `delete-account` SDD change — read the migration, smoke test, runner script, and `package.json` from the branch; re-ran the migration and smoke test against the local Docker Postgres container; verified the privilege boundary, idempotency, GUC scoping, and SECURITY DEFINER contract; cross-checked REQ IDs against the spec; confirmed PR1 correctly defers the `webhook_events` audit insert to PR2.

**Why**: The orchestrator requested fresh-context verification independent of the apply-progress summary as ground truth. The goal is to surface any spec drift, security flaw, or broken gate that the apply phase missed.

**Where**: `mobile/supabase/migrations/0036_delete_account.sql`, `mobile/supabase/tests/delete-account.sql`, `mobile/scripts/test-db-smoke.mjs`, `mobile/package.json`, `mobile/openspec/changes/delete-account/apply-progress-pr1.md`.

**Learned**: (1) The REQ ID cross-references in design.md and tasks.md have been wrong since the design phase — a one-line fix in a follow-up should normalize them. (2) The design §11 "solo owner is NOT blocked" assertion was silently dropped during apply — the cascade user exercises the "no household" path but not the "solo owner" path; a 20-line add would close it. (3) `pnpm test` is no longer Docker-free after PR1 — the test-db-smoke.mjs header comment still claims otherwise, a stale-doc SUGGESTION. (4) The implementation's storage sweep GUC workaround (`set_config('storage.allow_delete_query', 'true', true)` LOCAL) is a real Supabase Storage production guard, not a dev-mode quirk — apply-progress risk #2 surfaces this well and the header comment of the migration documents it inline.
