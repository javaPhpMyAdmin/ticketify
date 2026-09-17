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

## 5. Monitoring + smoke test (production reference)

The §4 smoke test is the on-call minimum; this section is the
production-grade reference for the on-call engineer who needs to
verify a deletion actually completed end-to-end (RPC + Storage
sweep + RC alias revoke + audit signal) without false negatives.

### 5.1 Audit-signal query — `webhook_events`

The edge function inserts a row into `public.webhook_events` AFTER
the RPC returns `'ok'`:

```sql
select event_id, user_id, event_ts
  from public.webhook_events
 where event_type = 'ACCOUNT_DELETION'
 order by event_ts desc
 limit 50;
```

> **Known limitation** (see §6): until migration
> `0037_drop_webhook_events_user_id_fk` lands, the insert raises an
> FK violation (the cascade wipes the FK target before the insert
> fires) and the handler swallows it as a `console.error`. The query
> above returns rows from POST-FK-drop environments only; in the
> current schema, audit deletion events via the Supabase function
> logs (`[delete-account]` prefix) or `auth.audit_log_entries`.

### 5.2 Smoke test with annotated error codes

Each error path is reachable through the function's stable envelope.
Run the curl from §4 against the four documented failure modes to
prove the wrapper + handler map the wire to the right code:

```bash
# Pre-conditions per scenario — drive the function to a known state
# before each POST so the result is reproducible.

# (1) Happy path: signed-in user with no household, no Pro sub.
#     Expected: 200 { ok: true } — destructive path succeeded.
#     Verify: auth.users row gone, storage.objects under {uid}/ gone.
curl -i -X POST \
  "https://lfbyifbccfjposuzgccl.supabase.co/functions/v1/delete-account" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
# → 200 {"ok":true}

# (2) Idempotent re-delete: a user who already completed scenario (1)
#     a few seconds ago. The RPC's first check is
#     `if not exists (select 1 from auth.users …) return 'already_deleted';`
#     so the function returns the idempotency marker without touching
#     any downstream state.
#     Expected: 200 { ok: true, already_deleted: true }.
curl -i -X POST …  # same call as scenario (1) on a deleted user
# → 200 {"ok":true,"already_deleted":true}

# (3) Household-owner pre-flight (REQ-HOUSE-DEL-1): sign in as a user
#     who is the created_by of a household with at least one OTHER
#     member (i.e. household_members row with user_id <> caller).
#     Expected: 409 { ok: false, error: 'household_owner_with_members',
#                       message: 'Tenés que disolver el hogar antes
#                       de eliminar tu cuenta.' }
#     Verify: auth.users row PRESERVED, destructive path skipped.
#     Caller UX: redirect to /settings/household after the toast.

# (4) RevenueCat revoke failed: revoke the env var OR point the
#     function at an unreachable RC API (network policy block).
#     Expected: 502 { ok: false, error: 'revenuecat_revoke_failed',
#                       message: 'No se pudo revocar la suscripción
#                       de RevenueCat.' }
#     Verify: auth.users row PRESERVED (the destructive path is
#     fail-closed — the alias MUST be gone before auth.users goes).

# (5) Internal RPC failure: simulate by stubbing the RPC with an
#     unexpected exception. Expected: 500 { ok: false, error: 'internal' }.

# (6) Unauthenticated: POST without Authorization header (or with a
#     bearer the gateway rejects). Expected: 401 { ok: false,
#     error: 'unauthenticated' }.
curl -i -X POST \
  "https://lfbyifbccfjposuzgccl.supabase.co/functions/v1/delete-account" \
  -H "Content-Type: application/json" -d '{}'
# → 401 {"ok":false,"error":"unauthenticated"}
```

Every error envelope maps 1:1 to the `DeleteAccountErrorCode` union
in `src/lib/supabase/feature-access.ts` so the client screen applies
the correct localized copy and routing (household block → /settings/
household; revoke/internal → retry dialog).

### 5.3 RevenueCat alias verification (server-side revoke)

The server-side alias revoke is the AUTHORITATIVE bridge wipe — the
local SDK clear in step (a) of `useSessionStore.deleteAccount` is
purely cosmetic for the NEXT device user. Verify the alias is gone
directly against the RevenueCat REST API:

```bash
# After a successful deletion, the subscriber lookup must return 404.
# Replace $USER_ID with the deleted user's auth.uid() (or, easier,
# the email-equivalent app_user_id if the project used email-as-id).
curl -i \
  -H "Authorization: Bearer $REVENUECAT_SECRET_API_KEY" \
  "https://api.revenuecat.com/v1/subscribers/$USER_ID"
# → 404 Not Found   ← alias is gone
# → 200 with subscriber JSON   ← alias still alive (BUG — re-run delete)

# Dashboard cross-check (manual): RevenueCat → Customers → search
# by app_user_id or email → the deleted row shows `Last Seen: <deletion time>`
# but no active entitlements. The alias stays in the dashboard
# (RevenueCat retains a tombstone for refund/analytics purposes) but
# has no `active_entitlements`.
```

> **Why this matters**: a leaked alias means the next subscriber with
> the same `app_user_id` could inherit the deleted user's Pro
> entitlement. The revoke step is fail-closed (502 short-circuits the
> destructive path); the verification above proves the leak is closed.

### 5.4 Storage sweep verification

The Storage sweep runs inside the RPC transaction (the `protect_delete`
trigger requires the `storage.allow_delete_query` GUC set LOCAL).
After a successful deletion:

```sql
-- No rows for the deleted user's folder in the receipts bucket.
select name
  from storage.objects
 where bucket_id = 'receipts'
   and (storage.foldername(name))[1] = '<deleted-user-uuid>';
-- Expected: 0 rows.
```

A non-empty result is a GDPR leak — the receipt photos survive the
auth.users cascade (Storage has no `ON DELETE CASCADE` from
`auth.users`). Escalate to a manual `storage.objects` delete via the
Supabase dashboard's Storage explorer.

---

## 6. Audit signal — known limitation

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

## 7. Rollback

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

## 8. Source layout

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

## 9. What / Why / Where / Learned

**What**: Production runbook for the `delete-account` edge function
— prerequisites, deploy sequence, smoke test (basic + per-error-
code), monitoring (audit query, RC alias check, Storage sweep),
rollback plan, and a callout for the audit-row FK limitation.

**Why**: The deploy sequence has a non-obvious pre-requisite
(`REVENUECAT_SECRET_API_KEY` MUST be set BEFORE deploy — without
it, every call returns 502). Documenting it inline in a README
makes the on-call engineer's deploy path unambiguous, and the §5
monitoring + smoke test annotations prove the destructive path
actually completed (RPC + Storage + RC + audit) without false
negatives.

**Where**: `mobile/supabase/functions/delete-account/README.md`,
deploy target project-ref `lfbyifbccfjposuzgccl`.

**Learned**: (a) `--no-verify-jwt` CLI flag is a deploy-time override;
`config.toml verify_jwt = true` is the runtime setting — they are
independent and the runtime wins. (b) The audit-row-after-FK-target-gone
conflict is a real schema tension that the design §14 Decision 1
did not catch (the cascade chain wipes the FK target before the
insert fires). A follow-up migration to drop the FK is required
for REQ-ACCTDEL-13 to fully work. (c) Storage has no `ON DELETE
CASCADE` from `auth.users` — the RPC's `delete from storage.objects`
is the ONLY thing that purges receipt photos, which is why a
Storage sweep verification is part of the production smoke flow.
