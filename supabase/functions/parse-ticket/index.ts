// supabase/functions/parse-ticket/index.ts
//
// v3: real Gemini parsing + hourly parse rate-limit (verify_jwt = true).
// The monthly scan quota is consumed at SAVE time (consume_scan_on_save,
// 0021), NOT here — parse never burns a slot. This function only:
//   1. Authenticates the caller via the Authorization bearer JWT.
//   2. Takes one hourly parse permit (parse_try_take, 0022) to bound
//      Gemini invocations.
//   3. Pre-checks (non-authoritative) the monthly quota to avoid burning a
//      Gemini call when the user is clearly out of free slots.
//   4. Sends the receipt image to Google Gemini (default `gemini-3.1-flash-lite`,
//      override with the GEMINI_MODEL env var) and parses the structured
//      response into our domain shape.
//   5. Returns the parsed receipt to the mobile client.
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
  currentDateYmd,
  isRecord,
  ParseError,
  parseListJson,
  parseReceiptJson,
  ProviderOverloadedError,
  withProviderRetry,
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
    | 'rate_limited'
    | 'bad_request'
    | 'parse_failed'
    | 'provider_overloaded'
    | 'internal';
  /** Quota metadata, only present on quota_exceeded responses. */
  limit?: number;
  used?: number;
  /** Year-month key (YYYY-MM, UTC) the quota decision belongs to. */
  month?: string;
  /** Rate-limit metadata, only present on rate_limited responses. */
  attempts?: number;
  cap?: number;
  /** Seconds the client should wait before retrying a rate-limited parse. */
  retryAfterSeconds?: number;
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

/**
 * Hard cap on a single Gemini call; a hanging upstream must not hold the worker.
 * Raised from 30s to 60s: the 3.x reasoning models take ~47s COLD on a receipt
 * photo, and the old 30s abort cut off the first (cold) call — surfacing a
 * false "Servicio no disponible" when a retry (now warm) succeeded instantly.
 * 60s gives the cold first call room to finish; the client invoke timeout is
 * raised to match (65s, see src/features/tickets/api.ts).
 */
const GEMINI_TIMEOUT_MS = 60_000;

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
- purchase_date: the receipt date formatted as YYYY-MM-DD. The current year is CURRENT_YEAR. When the receipt does not show a year, use CURRENT_YEAR. When the printed year looks wrong (e.g. 2023), use CURRENT_YEAR instead.
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
          { text: PROMPT.replace('CURRENT_YEAR', String(new Date().getUTCFullYear())) },
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
    if (res.status === 503 || res.status === 429) {
      // Provider saturation (model "high demand" / rate limiting) is
      // transient, not a user or image problem — mark it so the handler
      // answers with the provider_overloaded envelope.
      throw new ProviderOverloadedError(
        `Gemini request failed (HTTP ${res.status}): ${detail}`,
      );
    }
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
    if (res.status === 503 || res.status === 429) {
      // Same provider-saturation classification as receipt mode: transient
      // overload, not a user/photo problem.
      throw new ProviderOverloadedError(
        `Gemini list-mode request failed (HTTP ${res.status}): ${detail}`,
      );
    }
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

// ---------------------------------------------------------------------------
// Parse rate limit (0022) — per-user hourly cap to bound Gemini invocations.
// The monthly quota is NOT checked here beyond the pre-check below; the real
// consumption happens at SAVE time via `consume_scan_on_save` (0021).
// ---------------------------------------------------------------------------

/** Max parse permit takes per user per UTC hour (mirrors the SQL cap 30). */
const PARSE_RATE_LIMIT = 30;

/**
 * Take one hourly parse permit for the user.
 *
 * Delegates to `parse_try_take` (migration 0022): the SQL atomically bumps
 * the user's attempts for the current UTC hour and reports (allowed,
 * attempts, cap). Fail-OPEN: if the RPC errors (e.g. not deployed yet) we
 * log and allow the parse — a rate-limit outage must never block scanning.
 */
async function takeParsePermit(
  userId: string,
): Promise<{ allowed: boolean; attempts: number; cap: number }> {
  const svc = serviceClient();
  try {
    const { data, error } = await svc.rpc('parse_try_take', {
      p_user_id: userId,
    });
    if (error) {
      throw new Error(`parse_try_take failed: ${error.message}`);
    }
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (row) {
      return {
        allowed: row.allowed !== false,
        attempts: row.attempts ?? 0,
        cap: row.cap ?? PARSE_RATE_LIMIT,
      };
    }
    // No row (unexpected): fail open rather than false-rate-limit.
    return { allowed: true, attempts: 0, cap: PARSE_RATE_LIMIT };
  } catch (err) {
    console.error(
      '[parse-ticket]',
      'rate-limit RPC failed (fail-open):',
      err instanceof Error ? err.message : err,
    );
    return { allowed: true, attempts: 0, cap: PARSE_RATE_LIMIT };
  }
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

  // Monthly-quota pre-check FIRST (numeric-only, non-atomic UX optimization,
  // design D2 / CRITICAL-1): skip the Gemini call when the user is clearly
  // out of free quota. NULL scans_limit is the Pro marker (set by
  // set_profile_tier on grant, see migration 0011 §3) — the pre-check MUST
  // skip the comparison entirely for Pro rows. JS coerces `null >= 0` to
  // `true` in numeric comparison, so a fresh Pro row (scans_limit=null,
  // scans_used=0) would otherwise evaluate as `0 >= 15 → true` (false 429).
  // This pre-check is a pure UX optimization (REQ-QUOTA-4): it is NOT
  // authoritative — the real cap is enforced at SAVE time by the client's
  // `consume_scan_on_save` RPC (0021), which returns ok=false (never raises)
  // when the free cap is reached.
  //
  // Ordering note: the quota pre-check runs BEFORE `takeParsePermit` so a
  // user who is out of monthly quota NEVER burns an hourly parse permit —
  // the 429 short-circuits before any permit is taken.
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

  // Rate-limit (0022): take one hourly parse permit per user AFTER the
  // monthly-quota pre-check. This bounds Gemini invocations independently of
  // the monthly quota (which is consumed at SAVE time, not parse time).
  const limit = await takeParsePermit(userId);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        code: 'rate_limited',
        attempts: limit.attempts,
        cap: limit.cap,
        retryAfterSeconds: 3600,
      } satisfies ErrorResponse),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let parsed: ParsedReceipt;
  try {
    // Bounded retry for transient Gemini saturation (HTTP 503 / provider 429):
    // a cold or overloaded first call is retried a couple times inside the
    // edge with a small backoff so a spurious provider blip does not surface
    // as "Servicio no disponible". Auth/validation/LLM-content errors are NOT
    // retried — only ProviderOverloadedError, and the call is idempotent
    // (edge ↔ Gemini only, no side-effects), so a retry is always safe.
    parsed = await withProviderRetry(() => callGemini(body.image_base64, mimeType));
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
        const list = await withProviderRetry(() =>
          callGeminiListMode(body.image_base64, mimeType),
        );
        parsed = listToReceipt(list);
      } catch (listErr) {
        if (listErr instanceof ProviderOverloadedError) {
          // List mode hit provider saturation (Gemini 503 / 429): the image
          // is fine, the provider is overloaded — same envelope as receipt
          // mode. Returning parse_failed here would falsely blame the photo.
          return jsonError(503, 'provider_overloaded', listErr.message);
        }
        const listDetail =
          listErr instanceof Error ? listErr.message : 'unknown list error';
        console.error('[parse-ticket]', 'list mode failed:', listDetail);
        console.error('[parse-ticket]', 'parse failed:', err.message);
        return jsonError(422, 'parse_failed', err.message);
      }
    } else if (err instanceof ProviderOverloadedError) {
      // Provider saturation (Gemini HTTP 503 / provider 429 "high demand")
      // is transient, not a user or image problem: answer with a dedicated
      // envelope so the client can ask the user to retry in a moment. The
      // full detail was already logged at the throw site.
      return jsonError(503, 'provider_overloaded', err.message);
    } else {
      // Never leak server-side detail (Gemini HTTP text, RPC errors) to the
      // client — log it for operators and answer with a generic message.
      const detail = err instanceof Error ? err.message : 'unknown error';
      console.error('[parse-ticket]', 'internal error:', detail);
      return jsonError(500, 'internal', INTERNAL_ERROR_MESSAGE);
    }
  }

  // Successful parse → 200. The monthly quota is NOT consumed here: parse
  // does not burn a scan slot. Consumption happens at SAVE time via the
  // client's `consume_scan_on_save` RPC (0021) when the user confirms the
  // draft (a parsed-but-discarded receipt cost nothing).
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
