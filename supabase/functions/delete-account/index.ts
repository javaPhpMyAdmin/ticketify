// supabase/functions/delete-account/index.ts
//
// User-account deletion edge function (REQ-ACCTDEL-1..7, REQ-ACCTDEL-13,
// design §4). Mirrors `revenuecat-webhook` for the platform-level
// conventions (service-role client, idempotent envelope, constant
// error-code set) but authenticates with the user's own JWT — the
// Supabase gateway already validated it before this handler runs
// (`verify_jwt = true` in config.toml, REQ-ACCTDEL-7).
//
// Flow (design §2):
//   1. Method gate — only POST is valid; everything else is 405.
//   2. Auth — read user from the gateway-validated JWT
//      (`svc.auth.getUser(bearer)`). Missing/invalid → 401
//      { error: 'unauthenticated' }.
//   3. RC REST revoke (FAIL-CLOSED): the alias MUST be gone before
//      auth.users is deleted (REQ-ACCTDEL-7). revokeSubscriber
//      returns ok=true on 2xx and on 404 (idempotent); every other
//      failure maps to { error: 'revenuecat_revoke_failed' }. We
//      short-circuit to a 502 envelope on any failure.
//   4. RPC — invoke `public.delete_user_account(p_user_id)` via the
//      service-role client. Idempotent: returns 'ok' or
//      'already_deleted'. The household-owner pre-flight raises
//      'owner_must_disband_first' with SQLSTATE P0001; we match
//      BOTH the SQLSTATE (durable contract) AND the literal message
//      text (belt-and-suspenders) and map to
//      `household_owner_with_members` (400).
//   5. Audit signal (REQ-ACCTDEL-13) — on a fresh 'ok' return,
//      insert a `webhook_events` row with event_type='ACCOUNT_DELETION'
//      so the operator dashboard can audit deletion events. Migration
//      0037 dropped the `webhook_events.user_id` FK so the audit row
//      survives the cascade (the FK target is gone by this point).
//      On a failed insert we log + continue: the destructive path
//      already succeeded and we owe the user a 200 envelope even if
//      the audit row did not persist.
//   6. Success envelope — 200 { ok: true, already_deleted: ... }.
//
// Env (platform-provided + operator-set):
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (platform)
//   - REVENUECAT_SECRET_API_KEY                (operator — required
//     BEFORE deploy, see README.md)

import { serviceClient } from '../_shared/service-client.ts';
import { revokeSubscriber } from './lib/revenuecat.ts';
import {
  ERROR_HOUSEHOLD_OWNER_WITH_MEMBERS,
  ERROR_INTERNAL,
  ERROR_REVENUECAT_REVOKE_FAILED,
  ERROR_UNAUTHENTICATED,
  HOUSEHOLD_OWNER_MESSAGE,
  HOUSEHOLD_OWNER_SQLSTATE,
  type DeleteAccountResponse,
} from './lib/responses.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT_DELETION_EVENT_TYPE = 'ACCOUNT_DELETION';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // ----- 1. Method gate --------------------------------------------------
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // ----- 2. Auth — read user from the gateway-validated JWT -------------
  // `verify_jwt = true` in config.toml means the gateway already
  // validated the bearer token and put the user into auth.uid(). We
  // re-fetch via the service-role client so we can map a missing /
  // invalid token to a stable 401 envelope without leaking any
  // implementation detail.
  const svc = serviceClient();
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;
  const { data: userData, error: getUserErr } = await svc.auth.getUser(
    bearerToken,
  );

  if (getUserErr || !userData?.user) {
    console.error(
      '[delete-account] getUser failed:',
      getUserErr?.message ?? 'no user',
    );
    return jsonResponse(401, {
      ok: false,
      error: ERROR_UNAUTHENTICATED,
    } satisfies DeleteAccountResponse);
  }
  const appUserId = userData.user.id;

  // ----- 3. Body — not required, but consume it so the connection drops.
  // The function takes no body parameters (auth.uid() IS the user to
  // delete). We tolerate malformed bodies silently — there is no
  // meaningful body to validate.
  try {
    await req.text();
  } catch {
    // body is best-effort; ignore read errors
  }

  // ----- 4. RevenueCat alias revoke (FAIL-CLOSED) -----------------------
  const rc = await revokeSubscriber(appUserId);
  if (!rc.ok) {
    console.error(
      '[delete-account] revenuecat revoke failed:',
      rc.statusCode ?? 'no_status',
      rc.error,
    );
    return jsonResponse(502, {
      ok: false,
      error: ERROR_REVENUECAT_REVOKE_FAILED,
      message: 'No se pudo revocar la suscripción de RevenueCat.',
    } satisfies DeleteAccountResponse);
  }

  // ----- 5. RPC — the destructive primitive (PR1 migration 0036) -------
  const { data, error } = await svc.rpc('delete_user_account', {
    p_user_id: appUserId,
  });

  if (error) {
    // Match on the SQLSTATE first (durable across i18n) and on the
    // literal message text (belt-and-suspenders — guards against a
    // future migration accidentally dropping the `errcode = 'P0001'`
    // clause and leaving only the message text as the contract).
    const matchesSqlstate = error.code === HOUSEHOLD_OWNER_SQLSTATE;
    const matchesMessage =
      typeof error.message === 'string' &&
      error.message.includes(HOUSEHOLD_OWNER_MESSAGE);
    if (matchesSqlstate || matchesMessage) {
      return jsonResponse(400, {
        ok: false,
        error: ERROR_HOUSEHOLD_OWNER_WITH_MEMBERS,
        message:
          'Tenés que disolver el hogar antes de eliminar tu cuenta.',
      } satisfies DeleteAccountResponse);
    }

    console.error(
      '[delete-account] rpc failed:',
      error.code ?? 'unknown_code',
      error.message,
    );
    return jsonResponse(500, {
      ok: false,
      error: ERROR_INTERNAL,
    } satisfies DeleteAccountResponse);
  }

  const alreadyDeleted = data === 'already_deleted';

  // ----- 6. Audit signal (REQ-ACCTDEL-13) --------------------------------
  // Insert AFTER the destructive path so the row corresponds to a
  // confirmed deletion (design §14 Decision 1). Migration 0037 dropped
  // the `webhook_events.user_id → profiles.id` FK so the audit row
  // survives the cascade (the FK target is gone by this point).
  if (!alreadyDeleted) {
    const auditEventId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const { error: auditErr } = await svc.from('webhook_events').insert({
      user_id: appUserId,
      event_id: auditEventId,
      event_ts: nowIso,
      event_type: ACCOUNT_DELETION_EVENT_TYPE,
      // applied_at has `default now()`; pass it explicitly so the
      // audit row's `event_ts` and `applied_at` are identical
      // (no clock-skew window between "event happened" and
      // "audit row written").
      applied_at: nowIso,
    });
    if (auditErr) {
      // The destructive path already succeeded. Log but do NOT fail
      // here — the user has no data and we owe them a 200 envelope.
      console.error(
        '[delete-account] audit row insert failed (destructive path already succeeded):',
        auditErr.code ?? 'unknown_code',
        auditErr.message,
      );
    }
  }

  // ----- 7. Success envelope --------------------------------------------
  return jsonResponse(200, {
    ok: true,
    already_deleted: alreadyDeleted,
  } satisfies DeleteAccountResponse);
});
