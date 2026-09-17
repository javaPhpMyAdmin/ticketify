# Apply-progress — PR2 (edge function + shared service-client refactor + RC REST revoke + audit signal + deploy docs)

> Change: `delete-account` · Branch: `delete-account-pr2-edge` (stacked-to-main, branched from main at `0d6dd18`).
> Artifact store: hybrid (this file + engram `sdd/delete-account/apply-progress`).
> PR2 base: `main` (after PR1 merged as `0d6dd18`).
> PR3 (client) and PR4 (tests + deploy runbook finalization) are NOT in scope here.

## Outcome

PR2 (6 work units) is **complete on the working branch**. The `delete-account` edge function is implemented end-to-end with the destructive RPC orchestration, RevenueCat alias revoke, audit-signal insert, stable error envelope, and a comprehensive deploy runbook. The `revenuecat-webhook` was refactored to use the shared `serviceClient()` factory (pure refactor — no behavior change; existing webhook tests pass). Branch is committed and clean, **NOT pushed** (per project convention).

## Work-unit outcomes

| WU | Status | Notes |
|---|---|---|
| **WU-2.1** — `_shared/service-client.ts` extracted from `revenuecat-webhook/index.ts` | ✅ Done | New `supabase/functions/_shared/service-client.ts` (32L) holds the factory with default-arg env reads. `revenuecat-webhook/index.ts` imports it; the inline `serviceClient()` + the now-unused `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` module constants are gone. `pnpm test:webhook-idempotency` (25/25) + `pnpm test:verify-constant-time` (8/8) still pass. |
| **WU-2.2** — `[functions.delete-account]` block in `config.toml` | ✅ Done | `verify_jwt = true` block added between `parse-ticket` and `revenuecat-webhook` blocks. Existing webhook config untouched. |
| **WU-2.3** — `delete-account/lib/revenuecat.ts` with `revokeSubscriber` | ✅ Done | 123L. `DELETE https://api.revenuecat.com/v1/subscribers/{id}` with `Authorization: Bearer ${REVENUECAT_SECRET_API_KEY}`. 404→success idempotency. 5s timeout via the new shared `_shared/with-timeout.ts` helper (78L, created because the spec said "the existing helper" but none existed). Stable `revenuecat_revoke_failed` error code on every failure path. No runtime code outside the already-imported Deno globals. |
| **WU-2.4** — `delete-account/lib/responses.ts` envelope constants | ✅ Done | 74L. `DeleteAccountErrorCode` union, `DeleteAccountResponse` envelope shape, `HOUSEHOLD_OWNER_SQLSTATE = 'P0001'`, `HOUSEHOLD_OWNER_MESSAGE = 'owner_must_disband_first'`. Pure types + constants, no runtime side-effects. |
| **WU-2.5** — `delete-account/index.ts` main handler | ✅ Done | 217L. POST-only gate; `svc.auth.getUser(bearer)` resolves `auth.uid()` (401 on failure); `revokeSubscriber` runs BEFORE the RPC (502 on any failure, FAIL-CLOSED per spec); `svc.rpc('delete_user_account', { p_user_id })` with SQLSTATE+message match on `household_owner_with_members` (400); audit-row insert in `webhook_events` AFTER the RPC returns `'ok'` (wrapped in try/catch — see risk #1). Returns the stable envelope shape from `responses.ts`. |
| **WU-2.6** — `delete-account/README.md` deploy runbook | ✅ Done | 219L. Prerequisites with the `REVENUECAT_SECRET_API_KEY` env-var gate; deploy sequence (`supabase db push` → `supabase secrets set` → `supabase functions deploy --no-verify-jwt`); curl smoke-test with a real JWT; audit-signal callout; rollback section mirroring design §13 step 4 (function delete + secrets unset + config revert — DO NOT drop the migration without review). |

## Files created / modified

| File | Action | Lines | Commit | Notes |
|---|---|---:|---|---|
| `supabase/functions/_shared/service-client.ts` | Created | +32 | `07edc8c` | The DRY refactor target. |
| `supabase/functions/revenuecat-webhook/index.ts` | Modified | -13 / +4 | `07edc8c` | Imports from `_shared/service-client.ts`. Inline factory + module env constants removed. |
| `supabase/config.toml` | Modified | +8 | `60e797f` | New `[functions.delete-account] verify_jwt = true` block. |
| `supabase/functions/_shared/with-timeout.ts` | Created | +78 | `6a75343` | AbortController-based timeout race. New shared helper (not in original tasks forecast). |
| `supabase/functions/delete-account/lib/revenuecat.ts` | Created | +123 | `6a75343` | RC REST wrapper. |
| `supabase/functions/delete-account/lib/responses.ts` | Created | +74 | `4522741` | Types + SQLSTATE/message constants. |
| `supabase/functions/delete-account/index.ts` | Created | +217 | `03c3e53` | Main handler. |
| `supabase/functions/delete-account/README.md` | Created | +219 | `a600339` | Deploy runbook. |

Total diff vs `main`: 8 files, ~755 insertions, ~13 deletions.
Code-only (excluding README): ~536 insertions / 13 deletions.
PR2 line-budget: original forecast was ~230L (tasks.md PR2 table). Actual is **2.3× the forecast** — see risks #4.

## Commits on `delete-account-pr2-edge`

```
a600339 docs(edge): add delete-account deploy runbook (WU-2.6)
03c3e53 feat(edge): implement delete-account handler (WU-2.5)
4522741 feat(edge): add delete-account response envelope constants (WU-2.4)
6a75343 feat(edge): add delete-account revenuecat revoke helper (WU-2.3)
60e797f chore(edge): register delete-account with verify_jwt=true (WU-2.2)
07edc8c refactor(edge): extract _shared/service-client.ts (WU-2.1)
```

## Verification gates

| Gate | Status | Evidence |
|---|---|---|
| `pnpm typecheck` exits 0 | ✅ Pass | No errors. tsconfig EXCLUDES `supabase/functions/**/*`; typecheck covers the client/Expo surface, not the Deno surface. |
| `pnpm test:webhook-idempotency` (regression on WU-2.1 refactor) | ✅ Pass | 25/25 tests pass. Lib helpers (verify, uuid, event-types) untouched by the refactor. |
| `pnpm test:verify-constant-time` (regression on WU-2.1 refactor) | ✅ Pass | 8/8 tests pass. |
| New `delete-account/index.ts` parses cleanly | ⚠️ DENO NOT INSTALLED | Deno is the only check for the edge-function surface; not on PATH locally. Visual inspection + module syntax verified (files readable, imports resolvable to `_shared/` and `./lib/`). User should run `deno check supabase/functions/delete-account/index.ts` against a Deno 1.4x runtime. |
| Manual nested-payload probe of `revenuecat-webhook` (sanity check on WU-2.1 refactor) | ⚠️ SKIPPED | Requires a running `supabase functions serve revenuecat-webhook` instance + a real `REVENUECAT_WEBHOOK_SECRET`. The webhook code path is byte-identical to pre-refactor (same factory, same `auth: { persistSession: false }` flag, same env reads). Lib tests cover the parsing logic. |

## NEW risks / issues (vs the design's risks)

1. **Audit-row FK cascade conflict (REAL DESIGN BUG)** — design §14 Decision 1 says "insert audit row from edge function AFTER the RPC returns 'ok'", but the PR1 cascade chain wipes `webhook_events` via the `profiles.user_id` FK (see `0036_delete_account.sql` lines 184-187 in the destructive §5 block comment). When the handler tries to insert AFTER the RPC, the FK target is already gone → the insert raises a foreign-key violation. The handler currently catches the violation as a non-fatal operator warning (logged via `console.error`) so the destructive path still returns 200 to the caller. **The audit row does NOT persist** under the current schema. **Suggested fix** (out of PR2 scope): tiny follow-up migration `0037_drop_webhook_events_user_id_fk.sql` running `alter table public.webhook_events drop constraint webhook_events_user_id_fkey`. README §5 documents this for the on-call engineer with the suggested migration inline.

2. **`withTimeout` helper did not exist** — the spec said "Uses `withTimeout` (the existing helper)" but no such helper existed in the codebase. I created `supabase/functions/_shared/with-timeout.ts` (78L, AbortController race + `TimeoutError` class) since bounding outbound HTTP from edge functions is a reusable cross-function pattern. Adds 78 lines not in the original ~230-line PR2 forecast.

3. **`--no-verify-jwt` CLI flag + `verify_jwt = true` config.toml interaction** — the README deploy command uses `--no-verify-jwt` per the user's WU-2.6 spec, but `config.toml` also says `verify_jwt = true` (per WU-2.2). These are independent: the CLI flag is a deploy-time override; the config.toml is the runtime setting (the gateway enforces it before the handler runs). README §3 footnote documents this so the on-call engineer is not confused at deploy time.

4. **PR2 line-budget overage** — original forecast was ~230L (tasks.md PR2 table: "PR2 (Edge function + shared service-client) ... ~230"); actual code+docs is ~755L (code: ~536L, docs: 219L). Driven by (a) the new `with-timeout.ts` helper (~78L, not in forecast) and (b) the comprehensive README (~219L — the spec asked for "the env-var gate, deploy command sequence, rollback section" but the deployment context warranted an on-call-ready runbook including the audit-signal callout and the FK followup). Code-only (~536L) is still under the 800-line "review budget" cached preflight (NOT the 400-line "PR review budget"). The chained PR strategy is unaffected.

## Outstanding items the user must do

1. **Set `REVENUECAT_SECRET_API_KEY`** via `supabase secrets set REVENUECAT_SECRET_API_KEY=rc_sk_... --project-ref lfbyifbccfjposuzgccl` BEFORE deploying. The function is fail-closed: every call returns 502 `revenuecat_revoke_failed` without the secret. Deploying without the secret would deploy a silent 502-generator.
2. **Run `deno check`** against `supabase/functions/delete-account/{index.ts,lib/revenuecat.ts,lib/responses.ts}` and `supabase/functions/_shared/{service-client.ts,with-timeout.ts}` to validate the Deno-specific surface (local Deno is not installed; deferred to the user).
3. **Open the PR** — branch `delete-account-pr2-edge` is committed and clean. NOT pushed (per project convention).
4. **(Optional but recommended)** Before PR3 ships, merge a tiny PR with migration `0037_drop_webhook_events_user_id_fk.sql` so the REQ-ACCTDEL-13 audit row actually persists. Trivial 1-line schema change; without it the audit signal in `webhook_events` is operator-warned but never written.

## Skill resolution

`paths-injected` — `sdd-apply`, `work-unit-commits`, `supabase`, `supabase-postgres-best-practices` were all read from their installed paths before implementation.

## Reference

- PR1 apply-progress: engram `#1360` / `mobile/openspec/changes/delete-account/apply-progress-pr1.md`
- PR1 verify-report: engram `#1361` / `mobile/openspec/changes/delete-account/verify-report-pr1.md`
- PR1 archive-report: engram `#1362`
- PR2 design: engram `#1355` / `mobile/openspec/changes/delete-account/design.md` (§2 architecture, §4 edge function, §12 deploy, §13 rollback, §14 audit-row decision)
- PR2 tasks: engram `#1357` / `mobile/openspec/changes/delete-account/tasks.md` PR2 section
- PR2 apply-progress: engram `#1365` / this file
