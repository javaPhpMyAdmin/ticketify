// supabase/functions/parse-ticket/index.ts
//
// v2: real Gemini parsing + atomic quota RPC (verify_jwt = true).
//
// Edge function that:
//   1. Authenticates the caller via the Authorization bearer JWT.
//   2. Validates the monthly scan quota in `public.scan_usage`.
//   3. Sends the receipt image to Google Gemini (default `gemini-3.1-flash-lite`,
//      override with the GEMINI_MODEL env var) and parses the structured
//      response into our domain shape.
//   4. Returns the parsed receipt to the mobile client.
//
// The client sends the image base64-encoded (mime image/jpeg) in
// `image_base64`; the function never touches Storage — upload and
// persistence land in Phase 5.
//
// NOTE: the default was `gemini-2.5-flash` until Google retired it for new
// API keys (404 "no longer available to new users"). Moved to
// `gemini-3.1-flash-lite`: the 3.x reasoning models (e.g.
// `gemini-3-flash-preview`) take ~47s on a receipt photo, blowing past the
// 30s client/function timeouts; flash-lite parses the same image in ~4s.

import { createClient } from '@supabase/supabase-js';
import {
  isRecord,
  ParseError,
  parseListJson,
  parseReceiptJson,
  type ParsedItem,
  type ParsedReceipt,
} from './lib/parse.ts';

// ---------------------------------------------------------------------------
// Types — kept local to the function so it can deploy without TS project
// references. The shape matches `ReceiptDraft` + `ReviewItem` in the app.
// ---------------------------------------------------------------------------

interface ParseRequest {
  image_base64?: string;
  /** MIME type of the image (image/jpeg, image/png, …). Defaults to image/jpeg. */
  mime_type?: string;
}

interface ErrorResponse {
  error: string;
  code:
    | 'unauthenticated'
    | 'quota_exceeded'
    | 'bad_request'
    | 'parse_failed'
    | 'internal';
  /** Quota metadata, only present on quota_exceeded responses. */
  limit?: number;
  used?: number;
  /** Year-month key (YYYY-MM, UTC) the quota decision belongs to. */
  month?: string;
  /**
   * True only on the post-parse race envelope (WARNING-4): the pre-check
   * passed, the parse succeeded, but a concurrent request consumed the
   * last free slot. The parsed receipt is DISCARDED. Free-only by
   * construction — Pro users never hit this (the RPC is tier-aware).
   */
  raceLost?: boolean;
}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite';

/**
 * User-facing message for unexpected server errors. Safe to send to the
 * client — unlike the raw error detail, which is logged instead (see the
 * 500 path in the handler).
 */
const INTERNAL_ERROR_MESSAGE = 'Se produjo un error al procesar el recibo.';

/** Hard cap on a single Gemini call; a hanging upstream must not hold the worker. */
const GEMINI_TIMEOUT_MS = 30_000;

/** Client scoped to the calling user (respects RLS). */
function userClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

/** Service-role client that bypasses RLS — only used for quota bookkeeping. */
function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

/**
 * Reject payloads above ~9MB of base64 text (~6.75MB decoded). Gemini's
 * inline-data limit is well above this, so the cap is a defensive guard
 * against oversized/abusive requests, not an API constraint. The client
 * mirrors it as MAX_IMAGE_BYTES (src/features/tickets/api.ts) so oversized
 * images are rejected before they are even encoded.
 */
const MAX_BASE64_CHARS = 9 * 1024 * 1024;

/**
 * Cheap structural validation for a base64 string: non-empty, only base64
 * alphabet characters (plus padding) and no length mod 4 == 1 (an impossible
 * length for real base64, which catches stray text/JSON sent by mistake).
 * Lenient by design — padding may be absent and whitespace is allowed, but a
 * whitespace-only payload is rejected (it would otherwise trim to '' and pass).
 */
function isValidBase64(value: string): boolean {
  const trimmed = value.replace(/\s/g, '');
  return (
    trimmed.length > 0 &&
    trimmed.length % 4 !== 1 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)
  );
}

const PROMPT = `You are a receipt parser. Extract the purchase data from the receipt image and respond with ONLY strict JSON (no markdown fences, no commentary) matching exactly this schema:

{
  "store_name": string,
  "purchase_date": string,
  "total": number,
  "payment_method": "cash" | "card" | "apple_pay" | "google_pay" | "transfer" | "other",
  "card_brand": string | null,
  "card_type": "debit" | "credit" | null,
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "suggested_category_slug": string | null
    }
  ]
}

Rules:
- store_name: the merchant name printed on the receipt.
- purchase_date: the receipt date formatted as YYYY-MM-DD.
- total: the FINAL amount the customer actually pays — the "amount to pay" / "total a pagar" / "total a abonar" figure, which is the last money total printed on the receipt. Receipts often show a discount AFTER the items: a payment-method discount (debit/card), a legal discount ("descuento de ley", "descuento por débito", "bonificación", "descuento promocional", "cupón"), or any negative adjustment, followed by a final total to pay that is LOWER than the pre-discount total. The total must ALWAYS be that FINAL amount after the discount (what the card/account is actually charged), in ANY country or language, NEVER the subtotal printed before the discount. When in doubt, prefer the LOWEST money total printed at the end of the receipt. The discount line itself is not an item and must not be added to the total.
- payment_method: one of cash, card, apple_pay, google_pay, transfer, other.
- card_brand: the card network printed on the receipt, e.g. Visa, Mastercard, Maestro, OCA, American Express, Diners, etc. null when the receipt shows no card (e.g. cash or transfer) or the brand cannot be determined. Never guess or infer a brand from unrelated text.
- card_type: "debit" or "credit" when the receipt states the card kind. A payment-method discount (e.g. "descuento por débito", "debit discount", "ley 19.210", "Ley de Inclusión Financiera") is direct evidence of a debit payment — set card_type to "debit" even when the card kind is not spelled out. null when there is no evidence. Never guess or infer the card kind from unrelated text.
- items: one entry per line item, skipping taxes, subtotals, discounts and total-only lines. quantity is how many units, unit_price is the price of one unit, total_price is the line total.
- Multi-unit lines: receipts show the same product multiple times in different ways — a leading count column ("CANT 2"), a "2 x 47.00" notation, or two identical consecutive lines. When that happens, emit ONE item with quantity = the unit count, unit_price = the price of one unit, and total_price = the line total (quantity × unit_price). NEVER collapse a multi-unit line into quantity=1 with unit_price=total_price: a line "2 x 47.00" must become {"name": "...", "quantity": 2, "unit_price": 47, "total_price": 94}, never quantity=1 / unit_price=94.
- suggested_category_slug: exactly one of bebidas, frutas-verduras, refrescos, panaderia, carnes, lacteos, limpieza, snacks, alimentos, higiene, farmacia, servicios, otros, or null when you are not confident.
- All money values must be plain numbers without currency symbols or thousands separators.`;

/**
 * Relaxed fallback prompt for images that are not strict receipts: shopping
 * lists, handwritten notes, screenshots of phone memos, etc. Only items with
 * prices are required — store, date and payment metadata are filled in by the
 * review screen with safe defaults.
 */
const LIST_PROMPT = `You are a shopping-list parser. The image may be a handwritten list, a phone-note screenshot, or any informal list of products with prices. Extract the items and respond with ONLY strict JSON (no markdown fences, no commentary) matching exactly this schema:

{
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "suggested_category_slug": string | null
    }
  ]
}

Rules:
- Emit one entry per line item. Skip headings, totals, taxes, and lines without a price.
- quantity is how many units. Default to 1 when the image shows no explicit count.
- unit_price is the price of one unit; total_price is the line total (quantity × unit_price).
- If a line only shows a total (e.g. "Leche 45"), set quantity to 1, unit_price to 45, and total_price to 45.
- Multi-unit lines like "2 x 47.00" become {"quantity": 2, "unit_price": 47, "total_price": 94}.
- suggested_category_slug: exactly one of bebidas, frutas-verduras, refrescos, panaderia, carnes, lacteos, limpieza, snacks, alimentos, higiene, farmacia, servicios, otros, or null when you are not confident.
- All money values must be plain numbers without currency symbols or thousands separators.`;

async function callGemini(
  imageBase64: string,
  mimeType: string,
): Promise<ParsedReceipt> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { response_mime_type: 'application/json' },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Abort after GEMINI_TIMEOUT_MS so a hanging upstream cannot hold the
      // edge worker open indefinitely (Deno supports AbortSignal.timeout).
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout aborts with an AbortError — map it to a readable
    // message instead of surfacing the raw "signal timed out" text.
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      '[parse-ticket]',
      isTimeout ? 'Gemini request timed out' : 'Gemini request failed',
      err instanceof Error ? err.message : err,
    );
    throw new Error(
      isTimeout
        ? 'Gemini request timed out'
        : `Gemini request failed: ${
            err instanceof Error ? err.message : 'network error'
          }`,
    );
  }

  if (!res.ok) {
    const detail = await geminiErrorDetail(res);
    console.error(
      '[parse-ticket]',
      `Gemini request failed (HTTP ${res.status})`,
      detail,
    );
    throw new Error(`Gemini request failed (HTTP ${res.status}): ${detail}`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ParseError('Gemini response was not valid JSON');
  }

  const text = extractResponseText(payload);
  if (text === null) {
    throw new ParseError('Gemini response contained no text candidate');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ParseError('Gemini returned malformed JSON');
  }

  return parseReceiptJson(raw);
}

/**
 * Second-pass Gemini call for informal lists. Reuses the same model, timeout,
 * and response-extraction logic as receipt mode but sends LIST_PROMPT and
 * validates only the items array.
 */
async function callGeminiListMode(
  imageBase64: string,
  mimeType: string,
): Promise<{ items: ParsedItem[]; total: number }> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    contents: [
      {
        parts: [
          { text: LIST_PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { response_mime_type: 'application/json' },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      '[parse-ticket]',
      isTimeout ? 'Gemini list-mode request timed out' : 'Gemini list-mode request failed',
      err instanceof Error ? err.message : err,
    );
    throw new Error(
      isTimeout
        ? 'Gemini list-mode request timed out'
        : `Gemini list-mode request failed: ${
            err instanceof Error ? err.message : 'network error'
          }`,
    );
  }

  if (!res.ok) {
    const detail = await geminiErrorDetail(res);
    console.error(
      '[parse-ticket]',
      `Gemini list-mode request failed (HTTP ${res.status})`,
      detail,
    );
    throw new Error(
      `Gemini list-mode request failed (HTTP ${res.status}): ${detail}`,
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ParseError('Gemini list-mode response was not valid JSON');
  }

  const text = extractResponseText(payload);
  if (text === null) {
    throw new ParseError('Gemini list-mode response contained no text candidate');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ParseError('Gemini list-mode returned malformed JSON');
  }

  return parseListJson(raw);
}

/** Best-effort human-readable detail from a Gemini error response. */
async function geminiErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    const message = body?.error?.message;
    return message ? message.slice(0, 300) : 'no error detail';
  } catch {
    return 'no error detail';
  }
}

/** Pulls the first non-empty text part out of a generateContent response. */
function extractResponseText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!isRecord(first)) return null;
  const content = first.content;
  if (!isRecord(content)) return null;
  const parts = content.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (
      isRecord(part) &&
      typeof part.text === 'string' &&
      part.text.trim() !== ''
    ) {
      return part.text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}`;
}

/** Today's date in UTC as YYYY-MM-DD, used as the default purchase_date. */
function currentDateYmd(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Builds a full ParsedReceipt from a successful list-mode parse by applying
 * safe defaults for the receipt metadata the list prompt intentionally does
 * not ask for.
 */
function listToReceipt(list: { items: ParsedItem[]; total: number }): ParsedReceipt {
  return {
    store_name: '',
    purchase_date: currentDateYmd(),
    total: list.total,
    payment_method: 'other',
    card_brand: null,
    card_type: null,
    items: list.items,
  };
}

/**
 * Monthly scan allowance for free-tier users. Mirrors the SQL
 * `coalesce(su.scans_limit, 15)` defensive guard in `try_consume_scan`
 * (migration 0011 §2). The DB row value is authoritative — this constant
 * only backs rows that report no limit, a drift the RPC's coalesce also
 * guards against (REQ-QUOTA-1, REQ-QUOTA-5).
 */
const SCANS_LIMIT = 15;

/**
 * Atomically consumes one monthly scan slot.
 *
 * Delegates to the `try_consume_scan` RPC (migration 0003): the SQL function
 * ensures the (user_id, year_month) row exists and runs a single guarded
 * `UPDATE … SET scans_used = scans_used + 1 WHERE scans_used < scans_limit`.
 * The row lock serializes concurrent scans, so the limit can never be
 * oversold by parallel requests — the old read-modify-write here could.
 */
async function consumeScanQuota(
  userId: string,
): Promise<{ ok: true } | { ok: false; limit: number; used: number }> {
  const svc = serviceClient();

  const { data, error } = await svc.rpc('try_consume_scan', {
    p_user_id: userId,
    p_year_month: currentYearMonth(),
  });

  if (error) {
    throw new Error(`try_consume_scan failed: ${error.message}`);
  }

  const row =
    Array.isArray(data) && data.length > 0
      ? (data[0] as { ok?: boolean; scans_used?: number; scans_limit?: number })
      : null;

  if (!row || row.ok !== true) {
    return {
      ok: false,
      limit: row?.scans_limit ?? SCANS_LIMIT,
      used: row?.scans_used ?? 0,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) {
    return jsonError(401, 'unauthenticated', 'Missing bearer token');
  }

  const userClient_ = userClient(jwt);
  const { data: userData, error: userErr } = await userClient_.auth.getUser(
    jwt,
  );
  if (userErr || !userData?.user) {
    return jsonError(
      401,
      'unauthenticated',
      userErr?.message ?? 'Invalid token',
    );
  }
  const userId = userData.user.id;

  let body: ParseRequest;
  try {
    body = (await req.json()) as ParseRequest;
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  if (typeof body.image_base64 !== 'string' || body.image_base64.length === 0) {
    return jsonError(400, 'bad_request', 'Provide image_base64');
  }
  if (!isValidBase64(body.image_base64)) {
    return jsonError(400, 'bad_request', 'image_base64 is not valid base64');
  }
  if (body.image_base64.length > MAX_BASE64_CHARS) {
    return jsonError(
      400,
      'bad_request',
      'image_base64 exceeds the maximum allowed size',
    );
  }
  const mimeType =
    typeof body.mime_type === 'string' && /^image\//.test(body.mime_type)
      ? body.mime_type
      : 'image/jpeg';

  // Pre-check (numeric-only, non-atomic UX optimization, design D2 / CRITICAL-1):
  // skip the Gemini call when the user is clearly out of free quota. NULL
  // scans_limit is the Pro marker (set by set_profile_tier on grant, see
  // migration 0011 §3) — the pre-check MUST skip the comparison entirely
  // and let the tier-aware RPC accept the scan. JS coerces `null >= 0` to
  // `true` in numeric comparison, so a fresh Pro row (scans_limit=null,
  // scans_used=0) would otherwise evaluate as `0 >= 15 → true` (false 429).
  // The RPC (try_consume_scan) is the tier-aware authority; this pre-check
  // is only here to avoid burning a Gemini call when the answer is
  // obvious (REQ-QUOTA-4).
  const currentMonth = currentYearMonth();
  const svc = serviceClient();
  let preUsage: { scans_limit: number | null; scans_used: number } | null = null;
  try {
    const { data } = await svc
      .from('scan_usage')
      .select('scans_limit, scans_used')
      .eq('user_id', userId)
      .eq('year_month', currentMonth)
      .maybeSingle();
    preUsage = data;
  } catch {
    // Pre-check read failure → proceed (availability over optimization;
    // the RPC remains the contract).
  }
  if (
    preUsage &&
    preUsage.scans_limit != null &&
    preUsage.scans_used >= preUsage.scans_limit
  ) {
    return new Response(
      JSON.stringify({
        error: 'quota_exceeded_pre',
        code: 'quota_exceeded',
        limit: preUsage.scans_limit,
        used: preUsage.scans_used,
        month: currentMonth,
      } satisfies ErrorResponse),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let parsed: ParsedReceipt;
  try {
    parsed = await callGemini(body.image_base64, mimeType);
  } catch (err) {
    // Gemini/validation failures are a client-fixable 422; anything else is
    // a server-side internal error. Auth/validation/pre-check paths above
    // stay on their existing 401/400/429 statuses. A parse failure MUST NOT
    // burn a quota slot (REQ-QUOTA-4): there is no consume call before this
    // point, so falling through here leaves scans_used untouched.
    if (err instanceof ParseError) {
      // Receipt mode failed to parse — try a relaxed list-mode pass before
      // giving up (REQ-LIST-1). A second ParseError means the image is not
      // readable as a list either; return the original receipt-mode message
      // so the user gets a consistent failure explanation.
      try {
        const list = await callGeminiListMode(body.image_base64, mimeType);
        parsed = listToReceipt(list);
      } catch (listErr) {
        const listDetail =
          listErr instanceof Error ? listErr.message : 'unknown list error';
        console.error('[parse-ticket]', 'list mode failed:', listDetail);
        console.error('[parse-ticket]', 'parse failed:', err.message);
        return jsonError(422, 'parse_failed', err.message);
      }
    } else {
      // Never leak server-side detail (Gemini HTTP text, RPC errors) to the
      // client — log it for operators and answer with a generic message.
      const detail = err instanceof Error ? err.message : 'unknown error';
      console.error('[parse-ticket]', 'internal error:', detail);
      return jsonError(500, 'internal', INTERNAL_ERROR_MESSAGE);
    }
  }

  // Consume AFTER successful parse (REQ-QUOTA-4). The RPC is tier-aware
  // (CRITICAL-1/2): Pro always wins via the `v_tier = 'pro'` branch,
  // free is gated by `scans_used < coalesce(scans_limit, 15)`. A race
  // loser (ok=false here after the pre-check passed) gets a distinct
  // envelope so the client can render the post-parse "consumed by
  // concurrent use" message (WARNING-4). The parsed receipt is
  // DISCARDED in this branch — the free slot was lost to a concurrent
  // request, there is nothing to return (design.md:64).
  let quota: Awaited<ReturnType<typeof consumeScanQuota>>;
  try {
    quota = await consumeScanQuota(userId);
  } catch (err) {
    // The RPC can fail when the function is not deployed yet (missing
    // try_consume_scan), on permission denials, or on SQL errors. Those are
    // server-side problems: answer with the internal envelope instead of
    // letting Deno.serve surface a bare platform 500. The quota_exceeded
    // path below is a normal response, not an error. The parsed receipt
    // is discarded here as well — we cannot guarantee the slot was
    // consumed, so handing the receipt back to a client whose quota
    // state is unknown would be a lie.
    console.error(
      '[parse-ticket]',
      'quota RPC failed:',
      err instanceof Error ? err.message : err,
    );
    return jsonError(500, 'internal', INTERNAL_ERROR_MESSAGE);
  }
  if (!quota.ok) {
    return new Response(
      JSON.stringify({
        error: 'quota_exceeded_race',
        code: 'quota_exceeded',
        limit: quota.limit,
        used: quota.used,
        raceLost: true,
        month: currentMonth,
      } satisfies ErrorResponse),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

function jsonError(status: number, code: ErrorResponse['code'], error: string) {
  const body: ErrorResponse = { error, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
