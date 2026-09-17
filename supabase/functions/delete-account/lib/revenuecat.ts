// supabase/functions/delete-account/lib/revenuecat.ts
//
// RevenueCat REST helper: alias revocation. Called BEFORE the
// SECURITY DEFINER `delete_user_account` RPC so the alias is gone
// from RevenueCat's side before auth.users is hard-deleted (matches
// the spec promise in REQ-ACCTDEL-7: "the alias is gone BEFORE
// auth.users goes").
//
// The RevenueCat REST endpoint:
//   DELETE https://api.revenuecat.com/v1/subscribers/{app_user_id}
//   Authorization: Bearer <REVENUECAT_SECRET_API_KEY>
//
// Response codes:
//   - 2xx (incl. 200/202/204)        → ok (alias revoked)
//   - 404                            → ok (alias already gone — idempotent;
//     a re-deleted or never-subscribed user lands here)
//   - non-2xx (non-404)              → ok=false, statusCode + error='revenuecat_revoke_failed'
//   - timeout / network / parse      → ok=false, error='revenuecat_revoke_failed'
//
// The caller (index.ts) maps `ok=false` to a 502 envelope
// (fail-closed per spec: the destructive path is blocked until the
// alias is confirmed gone).
//
// Env vars:
//   - REVENUECAT_SECRET_API_KEY  (operator sets via `supabase secrets set`)

import { withTimeout, TimeoutError } from '../../_shared/with-timeout.ts';

const RC_BASE = 'https://api.revenuecat.com/v1';
const TIMEOUT_MS = 5_000;

const KEY = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';

/** Stable error code returned to the client envelope on every failure. */
export const RC_REVOKE_FAILED = 'revenuecat_revoke_failed';

export interface RevokeSubscriberResult {
  ok: boolean;
  statusCode?: number;
  error?: typeof RC_REVOKE_FAILED;
}

/**
 * Delete a RevenueCat subscriber alias. Idempotent: a 404 (alias
 * already gone, e.g. the user never subscribed, or was deleted via
 * the dashboard) is treated as success so the destructive path
 * downstream can proceed.
 *
 * Never throws — every error path returns `{ ok: false, ... }` so
 * the caller's control flow stays linear (no try/catch noise in the
 * main handler).
 */
export async function revokeSubscriber(
  appUserId: string,
): Promise<RevokeSubscriberResult> {
  // Pre-flight: missing secret is a deploy bug, not a runtime
  // condition. Surface it loudly so the operator knows to set the
  // secret BEFORE re-deploying.
  if (KEY === '') {
    console.error(
      '[delete-account] REVENUECAT_SECRET_API_KEY is unset — cannot revoke. ' +
        'Set it via `supabase secrets set REVENUECAT_SECRET_API_KEY=...` ' +
        'and redeploy.',
    );
    return { ok: false, error: RC_REVOKE_FAILED };
  }

  if (appUserId === '') {
    // Defensive — the caller should never pass an empty id (we read
    // it from auth.uid() which is always a uuid), but a malformed
    // caller should still fail closed.
    return { ok: false, error: RC_REVOKE_FAILED };
  }

  const url = `${RC_BASE}/subscribers/${encodeURIComponent(appUserId)}`;

  let res: Response;
  try {
    res = await withTimeout(
      fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${KEY}` },
      }),
      { ms: TIMEOUT_MS, label: 'revenuecat.revokeSubscriber' },
    );
  } catch (err) {
    // TimeoutError, network error, DNS failure, TLS handshake — all
    // map to the same stable code. Log with the original cause for
    // the operator dashboard.
    if (err instanceof TimeoutError) {
      console.error(
        `[delete-account] revenuecat revoke timed out after ${err.ms}ms:`,
        err.message,
      );
    } else {
      console.error('[delete-account] revenuecat revoke network error:', err);
    }
    return { ok: false, error: RC_REVOKE_FAILED };
  }

  if (res.ok) {
    return { ok: true, statusCode: res.status };
  }
  if (res.status === 404) {
    // Alias already gone — treat as success. This makes the
    // destructive path idempotent across retries, dashboard-side
    // deletes, and users who never subscribed.
    return { ok: true, statusCode: 404 };
  }

  // Non-2xx, non-404. Read the body for the operator log; do NOT
  // surface it to the client (it may carry the user id echoed back).
  let body = '';
  try {
    body = await res.text();
  } catch {
    // body is best-effort
  }
  console.error(
    `[delete-account] revenuecat revoke failed: ${res.status} ${body}`,
  );
  return { ok: false, statusCode: res.status, error: RC_REVOKE_FAILED };
}
