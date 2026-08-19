// supabase/functions/revenuecat-webhook/index.ts
//
// Tier-sync webhook for RevenueCat (M2 of the pro-subscription change).
//
// The handler receives POSTs from RevenueCat, validates them with a
// shared secret compared in constant time, deduplicates by event_id,
// checks ordering against the ledger, and applies tier transitions
// through the `set_profile_tier` SECURITY DEFINER RPC from migration
// 0011. Every branch returns either 401, 400, 200, or 500 — never a
// partial side effect on a 200.
//
// Flow (REQ-SYNC-1..7, design D6, WARNING-1/2/3):
//   1. Read raw body + Authorization header. Reject 401 if missing.
//   2. Constant-time secret compare (verifySecret). False → 401, no DB.
//   3. Parse JSON. Malformed → 400.
//   4. SANDBOX event in production mode → 200 no-op (REQ-SYNC-7).
//   5. Unknown event type → 200 no-op (REQ-SYNC-2/7).
//   6. app_user_id not uuid → 200 no-op BEFORE any DB touch (WARNING-2).
//   7. Build service-role Supabase client.
//   8. Ledger INSERT … ON CONFLICT DO NOTHING; no row → 200 no-op
//      (REQ-SYNC-6 dedupe). Real DB error → 500.
//   9. Ordering check: any newer row for the same user → delete the row
//      we just inserted, then 200 no-op (WARNING-1).
//  10. set_profile_tier RPC:
//      - P0002 (profile not found) → 200 no-op (WARNING-2,
//        REVOKE of never-signed-in user is normal).
//      - Other RPC error → 500. NOTE: the ledger row from step 8
//        stays. Future retries collide on the PK and stay 200 no-op,
//        so the tier change is lost until the next event delivery
//        reconciles — acceptable per design D6.
//  11. Success → 200 { received: true }.
//
// Environment variables (set at deploy time, NEVER in `.env` files):
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (platform-provided)
//   - REVENUECAT_WEBHOOK_SECRET  (shared with RevenueCat)
//   - REVENUECAT_ENVIRONMENT     ('production' to filter sandbox events;
//                                 unset defaults to production; 'sandbox'
//                                 disables the filter for dev/staging)
//
// The function route is declared `verify_jwt = false` in
// `supabase/config.toml`: RevenueCat does NOT send a Supabase user JWT,
// it authenticates via its own shared secret (REQ-SYNC-4).

import { createClient } from '@supabase/supabase-js';
import {
  isProductionEnvironment,
  mapTier,
  mapTrialStatus,
  TRIAL_EVENT_TYPES,
  type Tier,
} from './lib/event-types.ts';
import { isUuid } from './lib/uuid.ts';
import { verifySecret } from './lib/verify.ts';

// ---------------------------------------------------------------------------
// Types — kept local so the function deploys without TS project references.
// The shape matches RevenueCat's webhook v2 payload. We intentionally keep
// the type permissive (everything is `unknown`-cast at the boundary) and
// validate field-by-field inside the handler so a malformed payload fails
// fast with 400 / 200 no-op instead of crashing on a property access.
// ---------------------------------------------------------------------------

interface RevenueCatEvent {
  id?: unknown;
  type?: unknown;
  environment?: unknown;
  /** RevenueCat webhook v2 uses `event_timestamp_ms` (epoch ms). */
  event_timestamp_ms?: unknown;
  app_user_id?: unknown;
}

interface WebhookResponse {
  received: boolean;
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Shared secret sent by RevenueCat in the Authorization header.
 * Compared in constant time — see `lib/verify.ts`. NEVER committed;
 * the operator sets this on the deployed function via
 * `supabase secrets set REVENUECAT_WEBHOOK_SECRET=…`.
 */
const REVENUECAT_WEBHOOK_SECRET =
  Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';

/**
 * Environment discriminator for sandbox filtering. Unset or
 * `'production'` → ignore sandbox events (safe-by-default per
 * REQ-SYNC-7). `'sandbox'` → accept all events (dev/staging).
 */
const REVENUECAT_ENVIRONMENT =
  Deno.env.get('REVENUECAT_ENVIRONMENT') ?? 'production';

/**
 * Postgres SQLSTATE for "no data found". Migration 0011 raises this
 * with `errcode = 'P0002'` from `set_profile_tier` when the profile
 * row is missing (REVOKE of never-signed-in user, WARNING-2). Matching
 * on the SQLSTATE is more reliable than message-text scraping — a
 * future i18n of the message won't break the catch.
 */
const PROFILE_NOT_FOUND_SQLSTATE = 'P0002';

// ---------------------------------------------------------------------------
// Supabase service-role client — bypasses RLS for ledger writes + RPC.
// Mirrors `parse-ticket/serviceClient()` (no Authorization header from
// the caller; we authenticate via the secret check above, not a user JWT).
// ---------------------------------------------------------------------------

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Field validation — never trust the payload
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireNonEmptyString(value: unknown, field: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (field === 'event.id' || field === 'event.type' || field === 'event.app_user_id') {
    return value.trim();
  }
  return value;
}

/**
 * Coerce `event_timestamp_ms` (epoch ms, possibly a JSON number OR a
 * numeric string) into a Postgres `timestamptz` ISO string. Returns
 * null on any unparseable value so the handler answers 200 no-op
 * (a bad timestamp MUST NOT crash the ledger insert).
 */
function coerceEventTs(value: unknown): string | null {
  let ms: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    ms = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    ms = parsed;
  } else {
    return null;
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Only POST is valid (RevenueCat webhook delivery); everything else
  // is a hard 405 so misconfigured callers fail loud, not silent 200.
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // ----- 1. Read raw body + Authorization header -----------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  // Use a single header read so the missing-vs-empty branch is
  // indistinguishable to the caller. Constant-time compare below
  // handles both the same way.
  const providedSecret = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonResponse(400, { error: 'malformed_body' });
  }

  // ----- 2. Constant-time auth (WARNING-3) -----------------------------
  // Identical 401 envelope for missing / wrong / empty / length-mismatch.
  // No DB touch on this branch.
  const secretOk = await verifySecret(providedSecret, REVENUECAT_WEBHOOK_SECRET);
  if (!secretOk) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // ----- 3. Parse JSON body --------------------------------------------
  let event: RevenueCatEvent;
  try {
    const parsed = JSON.parse(rawBody);
    if (!isRecord(parsed)) {
      return jsonResponse(400, { error: 'malformed_body' });
    }
    event = parsed as RevenueCatEvent;
  } catch {
    return jsonResponse(400, { error: 'malformed_body' });
  }

  // ----- 4. Environment filter (REQ-SYNC-7) ----------------------------
  // RevenueCat sends `event.environment` as `'SANDBOX'` or `'PRODUCTION'`
  // (uppercase in the v2 payload). We compare case-sensitively — that is
  // what the platform documents — and treat anything else as production
  // (fail-safe: ignore ambiguous environments rather than accept them).
  if (
    event.environment === 'SANDBOX' &&
    isProductionEnvironment(REVENUECAT_ENVIRONMENT)
  ) {
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }

  // ----- 5. Event-type filter (REQ-SYNC-2 / REQ-SYNC-7) -----------------
  const eventType = requireNonEmptyString(event.type, 'event.type');
  if (eventType === null) {
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }
  const mappedTier: Tier | null = mapTier(eventType);
  if (mappedTier === null) {
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }

  // ----- 6. UUID validation (WARNING-2) ---------------------------------
  // Reject BEFORE any DB touch — a malformed app_user_id is the
  // attacker's favorite probe target. 200 no-op (the malicious or
  // misconfigured payload is not RevenueCat's fault we can fix).
  const appUserId = requireNonEmptyString(event.app_user_id, 'event.app_user_id');
  if (appUserId === null || !isUuid(appUserId)) {
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }

  // Validate the rest of the fields the ledger needs. Any malformed
  // value → 200 no-op (a webhook delivery with a bad event_ts is not
  // something we can act on without corrupting the ledger).
  const eventId = requireNonEmptyString(event.id, 'event.id');
  if (eventId === null) {
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }
  const eventTs = coerceEventTs(event.event_timestamp_ms);
  if (eventTs === null) {
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }

  // ----- 7. Build service-role client ----------------------------------
  const svc = serviceClient();

  // ----- 8. Ledger insert (idempotency) --------------------------------
  // The `select('applied_at').maybeSingle()` round-trip gives us
  // "did we win the INSERT?" without an extra query: a duplicate
  // event_id collides on the PK and returns no row.
  const { data: inserted, error: insertErr } = await svc
    .from('webhook_events')
    .insert({
      user_id: appUserId,
      event_id: eventId,
      event_ts: eventTs,
      event_type: eventType,
    })
    .select('applied_at')
    .maybeSingle();

  if (insertErr) {
    console.error(
      '[revenuecat-webhook]',
      'ledger insert failed:',
      insertErr.message,
    );
    return jsonResponse(500, { error: 'internal' });
  }
  if (inserted === null) {
    // Already-seen event_id. REQ-SYNC-6 idempotency.
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }

  // ----- 9. Ordering check (WARNING-1 / REQ-SYNC-6) --------------------
  // A retried INITIAL_PURCHASE arriving after a later EXPIRATION would
  // replay the grant (free → pro after pro → free). The ledger now
  // contains BOTH rows (the new insert succeeded); we delete ours and
  // answer 200 no-op so the older event never applies.
  const { data: newer, error: newerErr } = await svc
    .from('webhook_events')
    .select('event_id')
    .eq('user_id', appUserId)
    .neq('event_id', eventId)
    .gt('event_ts', eventTs)
    .limit(1)
    .maybeSingle();

  if (newerErr) {
    console.error(
      '[revenuecat-webhook]',
      'ordering check failed:',
      newerErr.message,
    );
    // The ledger row we inserted stays. A 500 here is acceptable: the
    // next retry will see our row on the ledger (dedupe → 200 no-op)
    // and lose this delivery's tier change — the *next* event delivery
    // from RevenueCat will reconcile. We don't try to delete the row
    // because a failed ordering check is itself ambiguous (the older
    // event might be the one we wanted to apply — we just can't tell).
    return jsonResponse(500, { error: 'internal' });
  }

  if (newer !== null) {
    // Out-of-order delivery: undo the ledger insert so the same event
    // arriving in-order later can win the PK and apply. The delete
    // target is `(user_id, event_id)` — the row we just inserted.
    const { error: deleteErr } = await svc
      .from('webhook_events')
      .delete()
      .eq('user_id', appUserId)
      .eq('event_id', eventId);
    if (deleteErr) {
      // The ledger row stays even though we won't apply this event.
      // Same reconciliation story as the insert-err path: a future
      // delivery for the same event_id dedupes; a future NEWER event
      // for this user applies correctly. Not a 500 — we did decide
      // not to apply, we just couldn't clean up the audit row.
      console.error(
        '[revenuecat-webhook]',
        'out-of-order rollback failed (row stays):',
        deleteErr.message,
      );
    }
    return jsonResponse(200, { received: true } satisfies WebhookResponse);
  }

  // ----- 10. Apply tier change (set_profile_tier) ----------------------
  const { error: rpcErr } = await svc.rpc('set_profile_tier', {
    p_user_id: appUserId,
    p_tier: mappedTier,
  });

  if (rpcErr) {
    // WARNING-2: a REVOKE for a never-signed-in user raises
    // `profile not found` with SQLSTATE P0002 from migration 0011.
    // That is NOT an error from our point of view — the user simply
    // has no profile to revoke. Answer 200 no-op (the ledger row
    // from step 8 stays as the audit trail).
    if (rpcErr.code === PROFILE_NOT_FOUND_SQLSTATE) {
      return jsonResponse(200, { received: true } satisfies WebhookResponse);
    }

    // Real RPC failure. The ledger row from step 8 STAYS — the insert
    // happened, the tier change failed. Future retries of the same
    // event_id collide on the PK and stay 200 no-op (the tier change
    // is lost). Acceptable per design D6: the next event delivery
    // (a different event_id, e.g. a SUBSCRIPTION_PAUSED followed by a
    // RENEWAL) will reconcile the tier state.
    console.error(
      '[revenuecat-webhook]',
      `set_profile_tier failed (${rpcErr.code ?? 'unknown'}):`,
      rpcErr.message,
    );
    return jsonResponse(500, { error: 'internal' });
  }

  // ----- 11. Trial-specific sync (TRIAL_STARTED / TRIAL_ENDED) ----------
  // For trial events, `set_profile_tier` alone does not set the correct
  // subscription_status lifecycle value:
  //   - TRIAL_STARTED: set_profile_tier('pro') → subscription_status='active'
  //     but we need 'trial'. Call sync_subscription_status to correct it.
  //   - TRIAL_ENDED: set_profile_tier('free') already sets status='expired'
  //     (per §4 logic when current is 'trial'), but we call sync explicitly
  //     for idempotency — a duplicate delivery won't hurt.
  const trialStatus = mapTrialStatus(eventType);
  if (trialStatus !== null) {
    const { error: syncErr } = await svc.rpc('sync_subscription_status', {
      p_user_id: appUserId,
      p_status: trialStatus,
    });
    if (syncErr) {
      // Non-fatal: the tier change from step 10 already applied. The
      // trial_status sync is a refinement — a failure here means the
      // subscription_status column may lag by one event, which the next
      // delivery will reconcile.
      console.error(
        '[revenuecat-webhook]',
        `sync_subscription_status failed for ${eventType}:`,
        syncErr.message,
      );
    }
  }

  // ----- 12. Success ---------------------------------------------------
  return jsonResponse(200, { received: true } satisfies WebhookResponse);
});
