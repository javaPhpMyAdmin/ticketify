/**
 * Tickets feature — Supabase Storage + the `parse-ticket` edge function +
 * purchase persistence.
 *
 * `parseTicket` reads the local receipt image, sends it base64-encoded to the
 * `parse-ticket` edge function, and maps the parsed payload into the client
 * `ParsedReceipt` shape. `saveReceipt` persists the confirmed draft into
 * `purchases` / `purchase_items` (data-access spec scope amendment
 * 2026-08-07). `uploadToStorage` stays a stub until Phase 5 wires Storage
 * upload (image_url keeps the local uri until then).
 */
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';

import { tempId } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { CardType, PaymentMethod, ReceiptDraft, ReviewItem } from '@/types';

export interface UploadResult {
  /** Public URL where the receipt image is served from. */
  url: string;
}

/**
 * Uploads the local image to the `receipts` bucket and returns a
 * public URL the rest of the flow can attach to the draft.
 */
export async function uploadToStorage(
  _userId: string,
  _imageUri: string,
): Promise<UploadResult> {
  // TODO(Phase 5): upload to the `receipts` bucket (path: userId/tempId.jpg).
  return { url: _imageUri };
}

export interface ParsedReceipt {
  store: string;
  date: string;
  total: number;
  payment_method: PaymentMethod;
  /** Card network detected on the receipt; null when unknown/absent. */
  card_brand: string | null;
  /** Card kind detected on the receipt; null when unknown/absent. */
  card_type: CardType | null;
  items: ReviewItem[];
}

// ---------------------------------------------------------------------------
// Edge function wire shapes (snake_case, mirrors supabase/functions/parse-ticket)
// ---------------------------------------------------------------------------

interface EdgeParsedItem {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  suggested_category_slug: string | null;
}

interface EdgeParsedReceipt {
  store_name: string;
  purchase_date: string;
  total: number;
  payment_method: string;
  card_brand: string | null;
  card_type: string | null;
  items: EdgeParsedItem[];
}

/** Error envelope the edge function replies with on failures. */
interface EdgeErrorBody {
  error?: string;
  code?: string;
  limit?: number;
  used?: number;
}

// ---------------------------------------------------------------------------
// User-facing copy (app copy style is neutral Spanish)
// ---------------------------------------------------------------------------

const READ_IMAGE_MESSAGE = 'No se pudo leer la imagen del recibo';
const CONNECTION_MESSAGE =
  'No se pudo conectar con el servicio de escaneo. Inténtalo de nuevo.';
const UNAVAILABLE_MESSAGE =
  'El escaneo no está disponible en este momento. Inténtalo de nuevo.';
const GENERIC_PARSE_MESSAGE = 'No se pudo procesar el recibo. Inténtalo de nuevo.';
const IMAGE_TOO_LARGE_MESSAGE =
  'La imagen es demasiado grande para procesarla. Usa una foto más liviana.';
const TIMEOUT_MESSAGE =
  'El servicio de escaneo tardó demasiado. Inténtalo de nuevo.';

/**
 * Mirrors the edge function's MAX_BASE64_CHARS (9MB of base64 ≈ 6.75MB of
 * binary): oversized images are rejected client-side before they are even
 * encoded and sent.
 */
const MAX_IMAGE_BYTES = Math.floor((9 * 1024 * 1024 * 3) / 4);

/** Abort the invoke after this long; Gemini flash is usually single-digit seconds. */
const INVOKE_TIMEOUT_MS = 30_000;

const PAYMENT_METHODS: ReadonlySet<string> = new Set([
  'cash',
  'card',
  'apple_pay',
  'google_pay',
  'transfer',
  'other',
]);

/**
 * Error carrying a user-ready Spanish message that must NOT be masked by the
 * generic read-image copy (e.g. the too-large image message).
 */
class ClientError extends Error {}

function messageFromEdgeError(body: Partial<EdgeErrorBody>): string {
  switch (body.code) {
    case 'quota_exceeded':
      return `Alcanzaste el límite mensual de escaneos (${body.used ?? '?'}/${body.limit ?? '?'}).`;
    case 'unauthenticated':
      return 'Tu sesión expiró. Inicia sesión nuevamente.';
    case 'bad_request':
      return 'La imagen del recibo no es válida. Toma otra foto e inténtalo de nuevo.';
    case 'parse_failed':
      return 'No se pudo leer el recibo en la imagen. Toma una foto más clara e inténtalo de nuevo.';
    case 'internal':
      return 'Ocurrió un problema al procesar el recibo. Inténtalo de nuevo.';
    default:
      return GENERIC_PARSE_MESSAGE;
  }
}

/**
 * Maps a supabase-js invoke failure to a readable user message. HTTP errors
 * carry the edge function's `{ error, code, limit?, used? }` body; network
 * and relay failures fall back to generic copy.
 */
async function describeInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as Partial<EdgeErrorBody>;
      return messageFromEdgeError(body);
    } catch {
      return GENERIC_PARSE_MESSAGE;
    }
  }
  if (error instanceof FunctionsFetchError) {
    // The SDK aborts timed-out invokes with an AbortError — surface a
    // dedicated message instead of the generic connection copy.
    if (error.context?.name === 'AbortError') {
      return TIMEOUT_MESSAGE;
    }
    return CONNECTION_MESSAGE;
  }
  return GENERIC_PARSE_MESSAGE;
}

/** Raw base64 (no `data:` prefix) plus the file's MIME type. */
interface LocalImage {
  base64: string;
  mimeType: string;
}

/**
 * Reads a local image URI (file:// or content://) into raw base64 and its
 * MIME type. `expo-file-system` is imported lazily so this module stays
 * loadable in plain-node test harnesses (its entry is TypeScript and
 * native-bound); Metro resolves it on first parse.
 *
 * Rejects missing/empty files and images above MAX_IMAGE_BYTES before any
 * base64 encoding happens.
 */
async function readLocalImage(imageUri: string): Promise<LocalImage> {
  try {
    const { File } = await import('expo-file-system');
    const file = new File(imageUri);
    if (!file.exists || file.size === 0) {
      throw new Error('image file is missing or empty');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new ClientError(IMAGE_TOO_LARGE_MESSAGE);
    }
    const base64 = await file.base64();
    if (!base64) {
      throw new Error('image file produced no data');
    }
    return { base64, mimeType: file.type || 'image/jpeg' };
  } catch (err) {
    if (err instanceof ClientError) {
      throw err;
    }
    throw new Error(READ_IMAGE_MESSAGE);
  }
}

/**
 * Card brand: trimmed, casing preserved as detected. Blank/absent values
 * degrade to null so the review screen renders nothing extra.
 */
function normalizeCardBrand(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Card type: compared lowercase and normalized to 'debit' | 'credit'.
 * Unknown/absent values degrade to null — the review screen renders nothing
 * for a receipt that shows no card or an unreadable kind.
 */
function normalizeCardType(value: unknown): CardType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'debit' || normalized === 'credit' ? normalized : null;
}

/** Maps the validated edge payload into the client `ParsedReceipt` shape. */
function toClientReceipt(data: unknown): ParsedReceipt {
  const edge = data as EdgeParsedReceipt | null;
  if (
    typeof edge !== 'object' ||
    edge === null ||
    typeof edge.store_name !== 'string' ||
    !Array.isArray(edge.items) ||
    // Defense in depth after the edge's 422 on empty items: a receipt with
    // zero line items must never reach the review screen as a confirmation.
    edge.items.length === 0
  ) {
    // The edge function validates its own payload; this guards the wire anyway.
    throw new Error(GENERIC_PARSE_MESSAGE);
  }
  return {
    store: edge.store_name,
    date: edge.purchase_date,
    total: edge.total,
    // Guard the wire: the edge function already normalizes unknown values to
    // 'other', this keeps the same semantics if the payload ever drifts.
    payment_method:
      typeof edge.payment_method === 'string' &&
      PAYMENT_METHODS.has(edge.payment_method)
        ? (edge.payment_method as PaymentMethod)
        : 'other',
    // The edge function already normalizes these to null; this keeps old
    // payloads without the fields (or with junk values) on the same semantics.
    card_brand: normalizeCardBrand(edge.card_brand),
    card_type: normalizeCardType(edge.card_type),
    items: edge.items.map((item) => ({
      temp_id: tempId(),
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      category_id: null,
      is_impulse: false,
      // The app uses the slug as the category id and renders it directly.
      ai_suggested_category_id: item.suggested_category_slug ?? null,
    })),
  };
}

/**
 * Calls the `parse-ticket` edge function. Returns a structured
 * draft the user can review before committing to the DB.
 *
 * Throws a readable Error on any failure (image read, network, edge
 * function error codes), which the scan hook surfaces to the review screen.
 */
export async function parseTicket(imageUri: string): Promise<ParsedReceipt> {
  const { base64, mimeType } = await readLocalImage(imageUri);

  if (!isSupabaseConfigured) {
    throw new Error(UNAVAILABLE_MESSAGE);
  }

  const { data, error } = await supabase.functions.invoke('parse-ticket', {
    body: { image_base64: base64, mime_type: mimeType },
    timeout: INVOKE_TIMEOUT_MS,
  });

  if (error) {
    throw new Error(await describeInvokeError(error));
  }

  return toClientReceipt(data);
}

/**
 * User-safe copy when the purchase write fails (real mode). Raw backend
 * text never reaches the user (same posture as the auth and read paths).
 */
const SAVE_ERROR_MESSAGE = 'No se pudo guardar el recibo. Inténtalo de nuevo.';

/**
 * Resolves a store row for `name`: reuses an existing global or user-owned
 * store (case-insensitive match through RLS, `limit(1)` guards the
 * maybeSingle against duplicates), or creates the store as the user's own
 * row (`stores_insert_own`). Returns null when the lookup/insert fails so
 * the caller surfaces the user-safe message.
 */
async function resolveStoreId(userId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  const { data: existing } = await supabase
    .from('stores')
    .select('id')
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: inserted, error } = await supabase
    .from('stores')
    .insert({ user_id: userId, name: trimmed })
    .select('id')
    .single();
  if (error || !inserted) return null;
  return (inserted as { id: string }).id;
}

/**
 * Fetches the category slug → id map once per save so each line item can
 * resolve its chosen slug (user pick preferred over the AI suggestion) to a
 * real uuid FK. Categories are seeded by migration and rarely change, so
 * this is one small read.
 */
async function fetchCategoryIdsBySlug(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug')
    .limit(200);
  if (error) return {};
  const map: Record<string, string> = {};
  const rows = (data as Array<{ id: string; slug: string }> | null) ?? [];
  for (const row of rows) {
    map[row.slug] = row.id;
  }
  return map;
}

/**
 * Persists the confirmed draft to the DB. Returns the new
 * purchase id on success. Throws a user-safe Error on failure (the review
 * screen keeps the draft and lets the user retry).
 *
 * Real mode: writes the
 * `purchases` row plus its `purchase_items`, sequential inserts under RLS
 * (`purchases_insert_own`, `purchase_items_insert_own` scope both to the
 * session user). A failed item write rolls back the purchase row
 * (best-effort) so a partial save never renders in the feed. Storage
 * upload stays out of scope: `image_url` keeps the local draft uri until
 * `uploadToStorage` lands. The reads the new receipt feeds (home feed,
 * budget, scan usage, analytics totals) are cached, so they are invalidated
 * after the write (server-state-caching spec).
 */
export async function saveReceipt(
  userId: string,
  draft: ReceiptDraft,
): Promise<{ id: string }> {
  const storeId = await resolveStoreId(userId, draft.store_name);
  if (!storeId) throw new Error(SAVE_ERROR_MESSAGE);

  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      user_id: userId,
      store_id: storeId,
      purchase_date: draft.purchase_date,
      total: draft.total,
      payment_method: draft.payment_method,
      image_url: draft.image_url || null,
      status: 'confirmed',
    })
    .select('id')
    .single();
  if (purchaseError || !purchase) throw new Error(SAVE_ERROR_MESSAGE);
  const purchaseId = (purchase as { id: string }).id;

  const categoryIds = await fetchCategoryIdsBySlug();
  const itemRows = draft.items.map((item, index) => ({
    purchase_id: purchaseId,
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    // The review screen stores the category as a slug (user pick preferred
    // over the AI suggestion); the DB column is a uuid FK, so resolve here.
    category_id:
      categoryIds[item.category_id ?? ''] ??
      categoryIds[item.ai_suggested_category_id ?? ''] ??
      null,
    is_impulse: item.is_impulse,
    sort_order: index,
  }));

  const { error: itemsError } = await supabase
    .from('purchase_items')
    .insert(itemRows);
  if (itemsError) {
    // Best-effort compensating delete: without it a confirmed purchase with
    // no line items would render in the feed with empty drill-downs.
    const { error: rollbackError } = await supabase
      .from('purchases')
      .delete()
      .eq('id', purchaseId);
    if (rollbackError) {
      console.warn(
        '[save] rollback failed:',
        rollbackError.code,
        rollbackError.message,
      );
    }
    throw new Error(SAVE_ERROR_MESSAGE);
  }

  // The reads the new receipt feeds are cached per user: invalidate them so
  // the next focus refetches (server-state-caching spec, D5).
  void queryClient.invalidateQueries({ queryKey: queryKeys.homeFeed(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.budget(userId) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.scanUsage(userId, utcYearMonth()),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.monthlyTotals(userId, utcYearMonth()),
  });
  return { id: purchaseId };
}
