// supabase/functions/parse-ticket/index.ts
//
// Edge function that:
//   1. Authenticates the caller via the Authorization bearer JWT.
//   2. Validates the monthly scan quota in `public.scan_usage`.
//   3. Sends the receipt image to Google Gemini 1.5 Flash and parses the
//      structured response into our domain shape.
//   4. Returns the parsed receipt to the mobile client.
//
// The actual Gemini call is currently STUBBED with a deterministic mock
// so the rest of the system (RLS, quotas, payload shape) can be exercised
// end-to-end before we wire in the real model.

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types — kept local to the function so it can deploy without TS project
// references. The shape matches `ReceiptDraft` + `ReviewItem` in the app.
// ---------------------------------------------------------------------------

interface ParseRequest {
  image_url?: string;
  image_base64?: string;
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
  items: ParsedItem[];
}

interface ErrorResponse {
  error: string;
  code: 'unauthenticated' | 'quota_exceeded' | 'bad_request' | 'parse_failed' | 'internal';
  /** Quota metadata, only present on quota_exceeded responses. */
  limit?: number;
  used?: number;
}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-1.5-flash';

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
// Gemini call (stubbed)
// ---------------------------------------------------------------------------

async function callGemini(_imageUrl: string): Promise<ParsedReceipt> {
  // Real implementation:
  //
  //   const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  //   const body = {
  //     contents: [{
  //       parts: [
  //         { text: 'Extract the receipt into strict JSON matching this schema: ...' },
  //         { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
  //       ],
  //     }],
  //     generationConfig: { response_mime_type: 'application/json' },
  //   };
  //   const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  //   ...
  //
  // For now, return a deterministic Whole Foods receipt that matches the
  // Stitch review_receipt.png reference.

  return {
    store_name: 'Whole Foods Market',
    purchase_date: new Date().toISOString().slice(0, 10),
    total: 9.69,
    payment_method: 'card',
    items: [
      {
        name: 'Avocado, Hass',
        quantity: 2,
        unit_price: 1.5,
        total_price: 3.0,
        suggested_category_slug: 'frutas-verduras',
      },
      {
        name: 'Coca-Cola 2.25L',
        quantity: 1,
        unit_price: 4.49,
        total_price: 4.49,
        suggested_category_slug: 'refrescos',
      },
      {
        name: 'Whole Wheat Bread',
        quantity: 1,
        unit_price: 2.2,
        total_price: 2.2,
        suggested_category_slug: 'panaderia',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function consumeScanQuota(userId: string): Promise<{ ok: true } | { ok: false; limit: number; used: number }> {
  const svc = serviceClient();
  const ym = currentYearMonth();

  // Ensure a row exists for the current month.
  await svc.from('scan_usage').upsert(
    { user_id: userId, year_month: ym, scans_used: 0, scans_limit: 10 },
    { onConflict: 'user_id', ignoreDuplicates: true },
  );

  const { data, error } = await svc
    .from('scan_usage')
    .select('scans_used, scans_limit')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new Error(`scan_usage lookup failed: ${error?.message ?? 'no row'}`);
  }

  if (data.scans_used >= data.scans_limit) {
    return { ok: false, limit: data.scans_limit, used: data.scans_used };
  }

  const { error: incError } = await svc
    .from('scan_usage')
    .update({ scans_used: data.scans_used + 1 })
    .eq('user_id', userId);

  if (incError) {
    throw new Error(`scan_usage increment failed: ${incError.message}`);
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
  if (!body.image_url && !body.image_base64) {
    return jsonError(400, 'bad_request', 'Provide image_url or image_base64');
  }

  const quota = await consumeScanQuota(userId);
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
    const imageRef = body.image_url ?? 'inline-base64';
    const parsed = await callGemini(imageRef);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return jsonError(500, 'internal', message);
  }
});

function jsonError(status: number, code: ErrorResponse['code'], error: string) {
  const body: ErrorResponse = { error, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
