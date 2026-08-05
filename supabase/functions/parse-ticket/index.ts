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
  normalizeCardBrand,
  normalizeCardType,
} from './lib/card.ts';

// ---------------------------------------------------------------------------
// Types — kept local to the function so it can deploy without TS project
// references. The shape matches `ReceiptDraft` + `ReviewItem` in the app.
// ---------------------------------------------------------------------------

interface ParseRequest {
  image_base64?: string;
  /** MIME type of the image (image/jpeg, image/png, …). Defaults to image/jpeg. */
  mime_type?: string;
}

interface ParsedItem {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  suggested_category_slug: string | null;
}

interface ParsedReceipt {
  store_name: string;
  purchase_date: string; // YYYY-MM-DD
  total: number;
  payment_method: 'cash' | 'card' | 'apple_pay' | 'google_pay' | 'transfer' | 'other';
  /** Card network printed on the receipt (Visa, OCA, …), null when unknown. */
  card_brand: string | null;
  /** Card kind printed on the receipt, null when unknown. */
  card_type: 'debit' | 'credit' | null;
  items: ParsedItem[];
}

interface ErrorResponse {
  error: string;
  code: 'unauthenticated' | 'quota_exceeded' | 'bad_request' | 'parse_failed' | 'internal';
  /** Quota metadata, only present on quota_exceeded responses. */
  limit?: number;
  used?: number;
}

/**
 * Thrown when Gemini's output cannot be trusted as a `ParsedReceipt`
 * (missing/invalid JSON or a structurally invalid payload). The handler maps
 * it to `parse_failed` with status 422.
 */
class ParseError extends Error {}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

const PAYMENT_METHODS = new Set([
  'cash',
  'card',
  'apple_pay',
  'google_pay',
  'transfer',
  'other',
]);

/** Category slugs the app renders directly as review chips. */
const CATEGORY_SLUGS = new Set([
  'frutas-verduras',
  'refrescos',
  'panaderia',
  'carnes',
  'lacteos',
  'limpieza',
  'snacks',
  'otros',
]);

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
- total: the final amount paid, as a plain number (no currency symbol).
- payment_method: one of cash, card, apple_pay, google_pay, transfer, other.
- card_brand: the card network printed on the receipt, e.g. Visa, Mastercard, Maestro, OCA, American Express, Diners, etc. null when the receipt shows no card (e.g. cash or transfer) or the brand cannot be determined. Never guess or infer a brand from unrelated text.
- card_type: "debit" or "credit" when the receipt states the card kind. null when it does not state it or the receipt shows no card. Never guess or infer the card kind from unrelated text.
- items: one entry per line item, skipping taxes, subtotals, discounts and total-only lines. quantity is how many units, unit_price is the price of one unit, total_price is the line total.
- suggested_category_slug: exactly one of frutas-verduras, refrescos, panaderia, carnes, lacteos, limpieza, snacks, otros, or null when you are not confident.
- All money values must be plain numbers without currency symbols or thousands separators.`;

async function callGemini(imageBase64: string, mimeType: string): Promise<ParsedReceipt> {
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
        : `Gemini request failed: ${err instanceof Error ? err.message : 'network error'}`,
    );
  }

  if (!res.ok) {
    const detail = await geminiErrorDetail(res);
    console.error('[parse-ticket]', `Gemini request failed (HTTP ${res.status})`, detail);
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
    if (isRecord(part) && typeof part.text === 'string' && part.text.trim() !== '') {
      return part.text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response validation — never trust the model
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ParseError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ParseError(`${field} must be a finite number`);
  }
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Unknown payment methods degrade to 'other' instead of failing the scan. */
function normalizePaymentMethod(value: unknown): ParsedReceipt['payment_method'] {
  return typeof value === 'string' && PAYMENT_METHODS.has(value)
    ? (value as ParsedReceipt['payment_method'])
    : 'other';
}

/** Unknown category slugs degrade to null (the review chip shows SIN CATEGORÍA). */
function normalizeCategorySlug(value: unknown): string | null {
  return typeof value === 'string' && CATEGORY_SLUGS.has(value) ? value : null;
}

function parseReceiptJson(raw: unknown): ParsedReceipt {
  if (!isRecord(raw)) {
    throw new ParseError('Parsed receipt is not an object');
  }

  const store_name = requireNonEmptyString(raw.store_name, 'store_name');
  const purchase_date = requireNonEmptyString(raw.purchase_date, 'purchase_date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchase_date)) {
    throw new ParseError('purchase_date must be YYYY-MM-DD');
  }
  // The regex alone accepts calendar-invalid dates like 2026-13-45 or
  // 2026-02-30 — verify the components round-trip through a UTC date.
  const [y, m, d] = purchase_date.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(y, m - 1, d));
  if (
    parsedDate.getUTCFullYear() !== y ||
    parsedDate.getUTCMonth() !== m - 1 ||
    parsedDate.getUTCDate() !== d
  ) {
    throw new ParseError('purchase_date is not a valid calendar date');
  }
  const total = round2(requireFiniteNumber(raw.total, 'total'));
  const payment_method = normalizePaymentMethod(raw.payment_method);
  const card_brand = normalizeCardBrand(raw.card_brand);
  const card_type = normalizeCardType(raw.card_type);

  if (!Array.isArray(raw.items)) {
    throw new ParseError('items must be an array');
  }
  const items = raw.items.map((entry, index) => parseItem(entry, index));

  // A receipt with zero line items is unparseable — the review screen would
  // otherwise confirm an empty purchase.
  if (items.length === 0) {
    throw new ParseError('items must not be empty');
  }

  return { store_name, purchase_date, total, payment_method, card_brand, card_type, items };
}

function parseItem(entry: unknown, index: number): ParsedItem {
  if (!isRecord(entry)) {
    throw new ParseError(`items[${index}] is not an object`);
  }
  const name = requireNonEmptyString(entry.name, `items[${index}].name`);
  // Clamp quantity to a positive integer (floor, min 1).
  const quantity = Math.max(
    1,
    Math.floor(requireFiniteNumber(entry.quantity, `items[${index}].quantity`)),
  );
  const unit_price = round2(requireFiniteNumber(entry.unit_price, `items[${index}].unit_price`));
  const total_price = round2(
    requireFiniteNumber(entry.total_price, `items[${index}].total_price`),
  );
  const suggested_category_slug = normalizeCategorySlug(entry.suggested_category_slug);

  return { name, quantity, unit_price, total_price, suggested_category_slug };
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Monthly scan allowance for free-tier users (mirrors scan_usage.scans_limit). */
const SCANS_LIMIT = 10;

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
  const { data: userData, error: userErr } = await userClient_.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError(401, 'unauthenticated', userErr?.message ?? 'Invalid token');
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
    return jsonError(400, 'bad_request', 'image_base64 exceeds the maximum allowed size');
  }
  const mimeType =
    typeof body.mime_type === 'string' && /^image\//.test(body.mime_type)
      ? body.mime_type
      : 'image/jpeg';

  let quota: Awaited<ReturnType<typeof consumeScanQuota>>;
  try {
    quota = await consumeScanQuota(userId);
  } catch (err) {
    // The RPC can fail when the function is not deployed yet (missing
    // try_consume_scan), on permission denials, or on SQL errors. Those are
    // server-side problems: answer with the internal envelope instead of
    // letting Deno.serve surface a bare platform 500. The quota_exceeded
    // path below is a normal response, not an error.
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
        error: 'Monthly scan quota exceeded',
        code: 'quota_exceeded',
        limit: quota.limit,
        used: quota.used,
      } satisfies ErrorResponse),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const parsed = await callGemini(body.image_base64, mimeType);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Gemini/validation failures are a client-fixable 422; anything else is
    // a server-side internal error. Auth/validation/quota paths above stay
    // on their existing 401/400/429 statuses.
    if (err instanceof ParseError) {
      console.error('[parse-ticket]', 'parse failed:', err.message);
      return jsonError(422, 'parse_failed', err.message);
    }
    // Never leak server-side detail (Gemini HTTP text, RPC errors) to the
    // client — log it for operators and answer with a generic message.
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('[parse-ticket]', 'internal error:', detail);
    return jsonError(500, 'internal', INTERNAL_ERROR_MESSAGE);
  }
});

function jsonError(status: number, code: ErrorResponse['code'], error: string) {
  const body: ErrorResponse = { error, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
