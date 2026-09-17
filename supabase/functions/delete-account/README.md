# delete-account — Edge Function

> **Status**: PR2 of the `delete-account` SDD change (stacked-to-main).
> **Function**: Hard-delete an authenticated user's account and every
> byte of personal data attached to it (Storage receipts sweep,
> `parse_attempts` scrub, `auth.users` cascade, household-owner
> pre-flight, RevenueCat alias revoke) inside a single transactional
> server-side primitive. Irreversible, idempotent, fail-closed.

Cross-refs: spec `openspec/specs/user-account-deletion/spec.md`,
deltas under `openspec/changes/delete-account/specs/`,
design `openspec/changes/delete-account/design.md`,
tasks `openspec/changes/delete-account/tasks.md`.

---

## 1. What this function does

1. Validates the caller via the gateway-validated Supabase user JWT
   (`verify_jwt = true` in `config.toml` — no shared secret at the
   gateway, the Supabase session IS the credential).
2. Revokes the caller's RevenueCat alias via
   `DELETE https://api.revenuecat.com/v1/subscribers/{app_user_id}`
   (`REVENUECAT_SECRET_API_KEY`). **Fail-closed**: if the alias is
   not confirmed gone, the destructive path does NOT run.
3. Invokes the `public.delete_user_account(p_user_id uuid)` RPC
   (migration `0036_delete_account.sql`) which orchestrates the
   Storage sweep, `parse_attempts` scrub, household-owner pre-flight,
   and `auth.users` delete inside ONE transaction.
4. Returns a stable envelope: `{ ok, already_deleted?, error? }`.

| Status | Body |
|---|---|
| 200 | `{ ok: true, already_deleted?: true }` |
| 400 | `{ ok: false, error: 'household_owner_with_members', message }` |
| 401 | `{ ok: false, error: 'unauthenticated' }` |
| 405 | `{ error: 'method_not_allowed' }` (non-POST only) |
| 500 | `{ ok: false, error: 'internal' }` |
| 502 | `{ ok: false, error: 'revenuecat_revoke_failed', message }` |

---

## 2. Prerequisites

| What | Why | How |
|---|---|---|
| Migration `0036_delete_account.sql` applied | Provides the `delete_user_account` RPC + grants | `supabase db push` (CI) or `supabase db reset --local` (local) |
| `REVENUECAT_SECRET_API_KEY` env var set | The function revokes the alias via RevenueCat REST before the destructive path runs (REQ-ACCTDEL-7). **Without this secret, every call returns 502 with `revenuecat_revoke_failed`** — the destructive path is blocked by design. | `supabase secrets set REVENUECAT_SECRET_API_KEY=rc_sk_...` |

> **Deploy gate**: the deploy script aborts if
> `REVENUECAT_SECRET_API_KEY` is unset in the environment. This is
> a deliberate fail-closed per design §12 — a deployed function
> without the secret would be a silent 502-generator.

The function does NOT require any other env vars — `SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY` are platform-provided on every
Supabase edge function.

---

## 3. Deploy sequence

Run these commands in order. Steps 1 and 2 are idempotent — re-run
them any time without harm. Step 3 deploys the function code
(`supabase/functions/delete-account/`).

```bash
# Step 1. Apply the SQL migration (PR1 — should already be applied;
#         re-running is a no-op because the migration uses
#         `create or replace function`).
supabase db push --project-ref lfbyifbccfjposuzgccl

# Step 2. Set the new secret (one-time per environment — Supabase
#         stores it encrypted at rest). Skip if already set; the
#         command is idempotent on the server side.
supabase secrets set REVENUECAT_SECRET_API_KEY=rc_sk_xxx \
  --project-ref lfbyifbccfjposuzgccl

# Step 3. Deploy the function. The `--no-verify-jwt` CLI flag
#         overrides config.toml for the deploy call; the runtime
#         setting remains `verify_jwt = true` (gateway validates the
#         JWT before the handler runs — see config.toml).
npx supabase functions deploy delete-account \
  --project-ref lfbyifbccfjposuzgccl \
  --no-verify-jwt
```

> **CI wiring**: steps 1 and 3 should be wired into a GitHub Actions
> workflow (or the equivalent). Step 2 is an operator-only action —
> the secret MUST NOT live in any CI variable store; it lives in
> `supabase secrets` only.

---

## 4. Smoke test

After deploying, verify the function with a real JWT:

```bash
# 1. Get a fresh access_token for a test user (replace with a real
#    user id from the project's dashboard; the user must be a real
#    auth.users row, NOT the one you intend to delete in step 3).
ACCESS_TOKEN=$(curl -s "https://lfbyifbccfjposuzgccl.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"smoke-password"}' \
  | jq -r '.access_token')

# 2. POST to the function. A no-op envelope (`{ ok: true,
#    already_deleted: true }`) on a fresh user is expected ONLY if
#    the user has no household with members and a non-Pro RC
#    subscription; otherwise expect `{ ok: true }` followed by an
#    audit row written.
curl -i -X POST \
  "https://lfbyifbccfjposuzgccl.supabase.co/functions/v1/delete-account" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected outputs:

- `200 { ok: true }` — destructive path succeeded.
- `400 { error: 'household_owner_with_members' }` — caller is a
  household owner with active members; disband the household first.
- `502 { error: 'revenuecat_revoke_failed' }` — secret missing OR
  RevenueCat rejected the revoke (network error / 5xx). Check the
  function logs in the Supabase dashboard.

> **Manual verification**: after the smoke test, confirm in the
> Supabase dashboard that the user no longer has an `auth.users`
> row, no rows in `public.profiles`, no `storage.objects` in the
> `receipts` bucket under their folder, and no `webhook_events`
> with `event_type = 'ACCOUNT_DELETION'` (see risk note below).

---

## 5. Audit signal — known limitation

REQ-ACCTDEL-13 calls for an audit row in `webhook_events` with
`event_type = 'ACCOUNT_DELETION'`. The PR1 cascade chain wipes
`webhook_events` via the `profiles.user_id` FK — by the time the
handler tries to insert the audit row, the FK target is gone.

The handler currently inserts and catches the FK violation as a
non-fatal operator warning (so the destructive path does not leave
the caller with a no-data + no-response state). The audit row will
NOT persist until a follow-up migration drops the FK constraint:

```sql
-- Suggested follow-up: mobile/supabase/migrations/0037_drop_webhook_events_user_id_fk.sql
alter table public.webhook_events
  drop constraint webhook_events_user_id_fkey;
```

Apply that migration in a separate PR (out of scope for PR2).
Until then, audit deletion events via the Supabase function logs
(`[delete-account]` prefix) or the `auth.audit_log_entries` table.

---

## 6. Rollback

Per design §13 step 4. Drop in reverse dependency order; the SQL
migration is the ONLY artifact that cannot be naively dropped.

| Step | Action | Command |
|---|---|---|
| 1 | Disable the function (keeps the migration in place — manual `auth.admin.deleteUser` via the dashboard continues to work, but the RPC stays unreachable). | `npx supabase functions delete delete-account --project-ref lfbyifbccfjposuzgccl` |
| 2 | Remove the secret. | `npx supabase secrets unset REVENUECAT_SECRET_API_KEY --project-ref lfbyifbccfjposuzgccl` |
| 3 | Remove the `[functions.delete-account]` block from `config.toml` so the next deploy does not re-register the function. | `git revert` the WU-2.2 commit on `delete-account-pr2-edge`. |
| 4 | (Only if a hard zero is required) Drop the migration. | `drop function if exists public.delete_user_account(uuid);` |

> **DO NOT drop the migration without review** — the Storage sweep
> is the ONLY thing that purges receipt photos on a hard delete
> (Storage has no `ON DELETE CASCADE` from `auth.users`). Dropping
> the migration without first decommissioning any admin-driven
> deletes will leave Storage orphans.

---

## 7. Source layout

```
supabase/functions/
├── _shared/
│   ├── service-client.ts        # service-role Supabase factory (PR2 WU-2.1 refactor)
│   └── with-timeout.ts          # AbortController timeout helper (PR2 WU-2.3)
└── delete-account/
    ├── README.md                # this file
    ├── index.ts                 # main handler (PR2 WU-2.5)
    └── lib/
        ├── revenuecat.ts        # DELETE /v1/subscribers/{id} wrapper (PR2 WU-2.3)
        └── responses.ts         # error envelope types + constants (PR2 WU-2.4)
```

---

## 8. What / Why / Where / Learned

**What**: Production runbook for the `delete-account` edge function
— prerequisites, deploy sequence, smoke test, rollback plan, and a
callout for the audit-row FK limitation discovered during apply.

**Why**: The deploy sequence has a non-obvious pre-requisite
(`REVENUECAT_SECRET_API_KEY` MUST be set BEFORE deploy — without
it, every call returns 502). Documenting it inline in a README
makes the on-call engineer's deploy path unambiguous.

**Where**: `mobile/supabase/functions/delete-account/README.md`,
deploy target project-ref `lfbyifbccfjposuzgccl`.

**Learned**: (a) `--no-verify-jwt` CLI flag is a deploy-time override;
`config.toml verify_jwt = true` is the runtime setting — they are
independent and the runtime wins. (b) The audit-row-after-FK-target-gone
conflict is a real schema tension that the design §14 Decision 1
did not catch (the cascade chain wipes the FK target before the
insert fires). A follow-up migration to drop the FK is required
for REQ-ACCTDEL-13 to fully work.
