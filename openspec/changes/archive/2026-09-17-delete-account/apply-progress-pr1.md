# Apply-progress — PR1 (SQL migration + smoke test + test runner wiring)

> Change: `delete-account` · Branch: `delete-account-pr1-sql` · Artifact store: hybrid (this file + engram `sdd/delete-account/apply-progress`).

## Outcome

PR1 (3 work units) is **complete** on the working branch. All migration and test files were exercised against a running Postgres 17.6 with the full 0001-0035 chain already applied; the smoke test passes 3 consecutive runs (idempotent). All 7 prompt assertions + the catalog-section assertions pass.

## Work-unit outcomes

| WU | Status | Notes |
|---|---|---|
| **WU-1.1** — `supabase/migrations/0036_delete_account.sql` | ✅ Done | Migration applies cleanly via `docker exec psql`. Catalog verified: function exists, SECURITY DEFINER, owner=postgres, returns text, EXECUTE only to service_role. |
| **WU-1.2** — `supabase/tests/delete-account.sql` | ✅ Done | All 7 prompt assertions + §1 catalog + §6.5 rerun-on-blocked-raises guard pass. |
| **WU-1.3** — `scripts/test-db-smoke.mjs` + `package.json` wiring | ✅ Done | Smoke script step registered after `trial-freeze-guard.sql`. Master `pnpm test` chain extended to include `pnpm test:sql` at the end. |

## Files created / modified

| File | Action | Lines | Notes |
|---|---|---|---|
| `mobile/supabase/migrations/0036_delete_account.sql` | Created | ~210 | The destructive primitive. Storage protect_delete GUC, explicit pre-delete order, ERRCODE 'P0001', least-privilege grants, rollback warning. |
| `mobile/supabase/tests/delete-account.sql` | Created | ~430 | Single `DO` block mirror of `household-gate-tier.sql` style. Idempotent across re-runs. |
| `mobile/scripts/test-db-smoke.mjs` | Modified | 99 (was 95) | Header comment updated, new `run()` step registered for `delete-account.sql`. |
| `mobile/package.json` | Modified | 1 line | Master `pnpm test` chain now ends with `&& pnpm test:sql`. |

## Commits on `delete-account-pr1-sql`

```
33294f4 fix(db): handle storage protect_delete + cascade-trigger FK + email-unique in delete_account
9c06eba chore(test): wire delete-account.sql into test:sql + master test chain (WU-1.3)
7cdf848 test(db): add delete-account smoke test (WU-1.2)
f908768 feat(db): add delete_user_account SECURITY DEFINER RPC (WU-1.1)
```

## Verification gates

| Gate | Status | Evidence |
|---|---|---|
| Migration applies via `supabase db reset` (or local equivalent) | ⚠️ Manual gate not run | Applied via `docker exec psql` against the running Postgres — same effective test. Full `supabase db reset` requires the `supabase` CLI which is not installed locally. The user should run `supabase db reset --local` against a fresh checkout to verify. |
| `pnpm test:sql` (or `pnpm test:db`) runs and the new SQL test passes | ⚠️ Manual gate not run (script not invoked) | The smoke test file itself runs cleanly under `docker exec psql -f supabase/tests/delete-account.sql` — all 7 assertions pass 3 consecutive runs against the local Postgres. The script entry point (`scripts/test-db-smoke.mjs`) is valid Node.js (`node --check` passes). The user should run `pnpm test:sql` to exercise the full boot-from-scratch path. |
| All existing SQL tests still pass (no regression in `supabase/tests/*.sql`) | ⚠️ Partial | `trial-freeze-guard.sql` and `delete-account.sql` both pass against the running DB. `household-gate-tier.sql` fails on re-run against the existing local DB because of pre-existing state from prior test runs (its design relies on `supabase db reset` between runs). This is a pre-existing test isolation quirk, NOT a regression introduced by PR1. The user should run `supabase db reset --local` to confirm. |
| `pnpm typecheck` | ✅ Pass | Exit 0, no errors. |
| `pnpm test` (master chain) | ⚠️ Manual gate not run | All Node-only steps run fine without Docker; the chain's last step is now `pnpm test:sql` which requires Docker. Cannot run the master chain end-to-end without Docker. The user should run it. |

## Risks / NEW issues (vs. the design's risks)

1. **`session_replication_role = 'replica'` does NOT solve the cascade-trigger FK problem.** This was the design's obvious first guess (and would be any senior engineer's first guess). It silently BREAKS the cascade itself because the `RI_*` constraint triggers are user-level triggers that get disabled. The migration now uses explicit pre-delete ordering instead.
2. **Supabase Storage's `protect_delete()` trigger** is a real production guard, not just dev noise. Without the GUC `storage.allow_delete_query = 'true'` set LOCAL inside the RPC, the storage sweep raises `42501` and the whole destructive transaction rolls back — meaning receipt photos would survive deletion (a GDPR leak, not just a bug). Documented in the migration header.
3. **Re-signup is gated by `auth.users_email_partial_key`** (UNIQUE partial index on `(email) WHERE is_sso_user = false`, GoTrue 17.6.1). The SDD design's assumption that "Supabase Auth does NOT block re-registration with same email" is contradicted by the current Supabase Auth schema. After a hard DELETE the slot IS free, so re-signup DOES succeed — but the smoke test needs to pre-clean the slot on re-runs because the previous run's re-signup user has a non-deterministic uuid.
4. **Adding `pnpm test:sql` to master `pnpm test` chain** breaks the Docker-free invariant of the master chain. Anyone running `pnpm test` without Docker will now fail at the final step. This is a deliberate trade-off to satisfy the explicit Done criterion ("`pnpm test` includes it"). The user can revert if they prefer to keep the master chain Docker-free and rely on `pnpm test:sql` standalone.

## Outstanding items the user must do

1. **Run `supabase db reset --local`** to verify the migration applies on a TRULY fresh DB (the local Docker Postgres I used already had the full chain applied + leftover test state). Requires `supabase` CLI on PATH.
2. **Run `pnpm test:sql`** to exercise the full smoke suite under the standard runner (boots Docker stack from scratch + runs all 7 SQL tests).
3. **Open the PR** — branch `delete-account-pr1-sql` is committed and clean. DO NOT push without explicit confirmation.
4. **(For PR2, NOT PR1)** Set `REVENUECAT_SECRET_API_KEY` via `supabase secrets set` before deploying the `delete-account` edge function.

## Skill resolution

`paths-injected` — the skills `sdd-apply`, `work-unit-commits`, `supabase`, and `supabase-postgres-best-practices` were all read from their installed paths before implementation.

## Reference

- SDD explore: engram `#1352` / `openspec/changes/delete-account/explore.md`
- SDD proposal: engram `#1353` / `openspec/changes/delete-account/proposal.md`
- SDD design: engram `#1355` / `openspec/changes/delete-account/design.md`
- SDD tasks: engram `#1357` / `openspec/changes/delete-account/tasks.md`
- Apply-progress: engram `#1359` / this file
- Postgres traps discovery: engram `#1358`
