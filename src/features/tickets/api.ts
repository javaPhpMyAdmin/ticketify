/**
 * Tickets feature — Supabase Storage + the `parse-ticket` edge function +
 * purchase persistence.
 *
 * `parseTicket` reads the local receipt image, sends it base64-encoded to the
 * `parse-ticket` edge function, and maps the parsed payload into the client
 * `ParsedReceipt` shape. `saveReceipt` persists the confirmed draft into
 * `purchases` / `purchase_items` (data-access spec scope amendment
 * 2026-08-07). `updateReceipt` edits an existing purchase (items replaced;
 * a failed write RESTORES the pre-edit row + items — it never deletes a
 * receipt the user already had) and `deleteReceipt` removes one (row first,
 * fail-closed on a 0-row RLS miss, then the storage photo best-effort).
 * `uploadToStorage` uploads the local
 * image to the private `receipts` bucket (path `userId/tempId.jpg`) and
 * returns the OBJECT PATH; reads resolve a signed URL at render time (see
 * receipt-photo.ts). The upload runs on CONFIRM, inside `saveReceipt`, so a
 * cancelled scan never leaves an orphaned object in the bucket.
 */
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';

import { tempId, todayLocalISO } from '@/lib/format';
import { queryClient } from '@/lib/query-client';
import { queryKeys, utcYearMonth } from '@/lib/query-keys';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { resolveReceiptPhotoPath } from '@/lib/supabase/receipt-photo';
import type {
  CardType,
  Category,
  PaymentMethod,
  PurchaseStatus,
  ReceiptDraft,
  ReviewItem,
} from '@/types';

export interface UploadResult {
  /** Object path in the private `receipts` bucket, e.g. `userId/tempId.jpg`. */
  path: string;
}

/**
 * Uploads the local image to the `receipts` bucket under the signed-in
 * user's storage namespace (`userId/tempId.jpg` — the per-owner RLS policy
 * scopes on `storage.foldername(name)[1] = auth.uid()`) and returns the
 * object path. The bucket is private, so this is a path, NOT a renderable
 * URL: readers must resolve a signed URL (receipt-photo.ts).
 *
 * The image is read via `readLocalImage` (the same base64 seam the parse
 * uses) and decoded to bytes for the upload — no `fetch(file://)` that some
 * Expo runtimes reject.
 */
export async function uploadToStorage(
  userId: string,
  imageUri: string,
): Promise<UploadResult> {
  if (!isSupabaseConfigured) throw new Error(SAVE_ERROR_MESSAGE);
  const { base64, mimeType } = await readLocalImage(imageUri);
  const path = `${userId}/${tempId()}.jpg`;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage
    .from('receipts')
    .upload(path, bytes, { contentType: mimeType });
  if (error) {
    console.warn('[upload] storage failed:', error.statusCode ?? error.message);
    throw new Error(SAVE_ERROR_MESSAGE);
  }
  return { path };
}

/**
 * Best-effort removal of an object uploaded moments ago by `saveReceipt`.
 * Called on the failure paths so a retried confirm does not leave orphaned
 * objects in the bucket. Never throws: a failed cleanup must not mask the
 * original save error — the orphan is the cheaper failure to accept.
 */
async function removeUploadedObject(path: string | null): Promise<void> {
  if (!path) return;
  try {
    const { error } = await supabase.storage.from('receipts').remove([path]);
    if (error) {
      console.warn('[photo] cleanup failed:', path, error.statusCode ?? error.message);
    }
  } catch (err) {
    console.warn('[photo] cleanup threw:', path, String(err));
  }
}

/**
 * Defense-in-depth ownership guard before ANY `storage.remove`: only object
 * paths shaped `userId/<object>` (uuid folder — the per-owner RLS storage
 * namespace) may be deleted, the first folder segment must equal the session
 * user, and `..` traversal is rejected outright. A path failing this check
 * is never passed to the storage API — the receipt row is still deleted, the
 * object is simply left for a future GC pass.
 */
function isOwnedReceiptPath(userId: string, path: string): boolean {
  if (path.includes('..')) return false;
  if (!/^[0-9a-f-]{36}\/.+$/.test(path)) return false;
  return path.startsWith(`${userId}/`);
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

/**
 * Maps the edge payload into the client `ParsedReceipt` shape, tolerating
 * missing or empty receipt metadata so list-mode drafts (empty store, today's
 * date) still render on the review screen for editing.
 */
function toClientReceipt(data: unknown): ParsedReceipt {
  const edge = data as EdgeParsedReceipt | null;
  if (
    typeof edge !== 'object' ||
    edge === null ||
    !Array.isArray(edge.items) ||
    // Defense in depth after the edge's 422 on empty items: a receipt with
    // zero line items must never reach the review screen as a confirmation.
    edge.items.length === 0
  ) {
    // The edge function validates its own payload; this guards the wire anyway.
    throw new Error(GENERIC_PARSE_MESSAGE);
  }
  return {
    store: typeof edge.store_name === 'string' ? edge.store_name.trim() : '',
    date: validDateOrToday(edge.purchase_date),
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
 * Accepts a YYYY-MM-DD string only when it is a real calendar date. Any other
 * value (missing, malformed, or invalid like 2026-02-30) defaults to today's
 * local date so the review screen always has a renderable date.
 */
function validDateOrToday(value: unknown): string {
  if (typeof value !== 'string') return todayLocalISO();
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return todayLocalISO();
  const [y, m, d] = trimmed.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return todayLocalISO();
  }
  return trimmed;
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

/** User-safe copy when the purchase read for editing fails (same posture). */
const LOAD_ERROR_MESSAGE = 'No se pudo cargar el recibo. Inténtalo de nuevo.';

/** User-safe copy when the purchase delete fails (same posture). */
const DELETE_ERROR_MESSAGE = 'No se pudo eliminar el recibo. Inténtalo de nuevo.';

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
 * this is one small read. The fetch is ordered by slug so the 200-row cap
 * truncates deterministically — 'otros' (sort_order 99, last in the seed)
 * can never be excluded by arbitrary physical row order.
 */
async function fetchCategoryIdsBySlug(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug')
    .order('slug')
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
 * (best-effort) so a partial save never renders in the feed.
 *
 * The ticket photo upload runs HERE, on confirm (product decision
 * 2026-08-09): when the draft still carries a LOCAL image uri (the scan
 * preview), it is uploaded to the private `receipts` bucket first and the
 * OBJECT PATH is persisted as `image_url`; readers resolve a signed URL at
 * render time (receipt-photo.ts). Already-remote values (seed/demo picsum
 * URLs, or a storage path on a re-save) pass through unchanged. Uploading
 * on confirm means a cancelled scan never leaves an orphaned object.
 *
 * The reads the new receipt feeds (home feed,
 * budget, scan usage, analytics totals) are cached, so they are invalidated
 * after the write (server-state-caching spec).
 */
export async function saveReceipt(
  userId: string,
  draft: ReceiptDraft,
): Promise<{ id: string }> {
  const storeId = await resolveStoreId(userId, draft.store_name);
  if (!storeId) throw new Error(SAVE_ERROR_MESSAGE);

  // The draft carries the LOCAL photo uri during capture/review. Upload it
  // on confirm so `image_url` persists a storage path (private bucket →
  // signed URL on read). Only device-local schemes (file:/content:/ph:) are
  // uploaded — http(s) seed rows AND already-persisted storage paths
  // (no scheme) pass through unchanged (a path must never be re-uploaded).
  // The path is tracked so a failed save best-effort removes the object it
  // just uploaded (no orphaned object on a retried confirm).
  let imageUrl: string | null = draft.image_url || null;
  let uploadedPath: string | null = null;
  if (imageUrl && /^(file|content|ph):/i.test(imageUrl)) {
    const uploaded = await uploadToStorage(userId, imageUrl);
    uploadedPath = uploaded.path;
    imageUrl = uploaded.path;
  }

  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      user_id: userId,
      store_id: storeId,
      purchase_date: draft.purchase_date,
      total: draft.total,
      payment_method: draft.payment_method,
      image_url: imageUrl,
      status: 'confirmed',
    })
    .select('id')
    .single();
  if (purchaseError || !purchase) {
    await removeUploadedObject(uploadedPath);
    throw new Error(SAVE_ERROR_MESSAGE);
  }
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
    // An unresolved slug (no user pick AND no AI suggestion) falls back to
    // the 'otros' category so NULLs never persist — the backfill in
    // 0009_fix_null_category_items.sql only fixes rows already in the DB.
    // The trailing `?? null` guards the pathological case where 'otros' is
    // missing from the map (fetchCategoryIdsBySlug caps at 200 rows, ordered
    // by slug so the cap can never skip 'otros'); the RPC's LEFT
    // JOIN/COALESCE buckets those NULLs under 'otros' read-side.
    category_id:
      categoryIds[item.category_id ?? ''] ??
      categoryIds[item.ai_suggested_category_id ?? ''] ??
      categoryIds['otros'] ??
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
    // The upload already happened before the insert: clean the object up so
    // a retried confirm does not pile up orphans in the bucket.
    await removeUploadedObject(uploadedPath);
    throw new Error(SAVE_ERROR_MESSAGE);
  }

  // A new receipt changes every cached feed read (server-state-caching spec,
  // D5); scan usage is invalidated here too — only a SAVE consumes a scan.
  void queryClient.invalidateQueries({
    queryKey: queryKeys.scanUsage(userId, utcYearMonth()),
  });
  invalidateReceiptFeeds(userId);
  return { id: purchaseId };
}

/**
 * Invalidates the cached receipt feeds after a write (server-state-caching
 * spec, D5) — the shared seam `saveReceipt`, `updateReceipt` and
 * `deleteReceipt` all use:
 * - monthlyTotals readers build the key on the LOCAL month (analytics
 *   selector) while a pinned UTC month here would miss the cached entry they
 *   hold at the UTC/local month boundary. Invalidate by the user prefix
 *   instead: the factory appends the month unconditionally, so the prefix
 *   matches EVERY month variant of the key and nothing else.
 * - The Home budget spent reads the `monthly_purchases_total` RPC under its
 *   OWN key (single-total shape, separate from the category rows): a write
 *   changes the month total, so that key must be invalidated too or the
 *   budget card keeps showing the pre-write spent.
 * - Item search reads the same rows: a write can rename or remove items
 *   (and a save adds new ones), so EVERY month/query variant of the
 *   itemSearch keys must refetch — invalidated by the user prefix.
 * scanUsage is deliberately NOT invalidated here: only a SAVE consumes a
 * scan — updates and deletes do not.
 */
function invalidateReceiptFeeds(userId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.homeFeed(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.budget(userId) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.monthlyTotalsPrefix(userId),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.monthlyPurchasesTotalPrefix(userId),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.itemSearchPrefix(userId),
  });
}

/**
 * The full purchase row the edit flow works on: the store name is
 * flattened from the `stores` join and each item carries its category
 * object (slug/name/icon) so the UI can render without another lookup.
 */
export interface PurchaseWithItems {
  id: string;
  store_id: string | null;
  store_name: string | null;
  purchase_date: string;
  total: number;
  payment_method: PaymentMethod;
  image_url: string | null;
  status: PurchaseStatus;
  items: PurchaseItemDetail[];
}

/** One item row inside `PurchaseWithItems`. */
export interface PurchaseItemDetail {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  category_id: string | null;
  category: Category | null;
  is_impulse: boolean;
  /** Original line order — preserved through the edit round trip. */
  sort_order: number;
}

/**
 * PostgREST returns a to-one relation (single FK embed) either as a single
 * object or a one-element array depending on the select — normalizes both to
 * the object (or null). Same helper the home read path uses
 * (`features/home/api.ts`).
 */
function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Loads the full purchase row + its items (with store and category names)
 * for the edit flow, scoped to the session user (defense in depth — RLS
 * already scopes). Object paths resolve to signed urls at render time —
 * the review screen reuses the same `resolveReceiptPhotoPath` /
 * `getSignedReceiptPhotoUrl` pair the detail read uses, so the photo keeps
 * working when the edit form is open. Items come back ordered by
 * `sort_order` so the seeded draft preserves the original line order.
 */
export async function fetchPurchaseDetail(
  userId: string,
  purchaseId: string,
): Promise<PurchaseWithItems> {
  if (!isSupabaseConfigured) {
    throw new Error(LOAD_ERROR_MESSAGE);
  }

  const { data: purchase, error } = await supabase
    .from('purchases')
    .select(
      `id, store_id, total, purchase_date, payment_method, image_url, status,
       stores ( name ),
       purchase_items ( id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order, categories ( id, slug, name, kind, icon, color, sort_order ) )`,
    )
    .eq('id', purchaseId)
    .eq('user_id', userId)
    .order('sort_order', { referencedTable: 'purchase_items' })
    .maybeSingle();
  if (error || !purchase) {
    console.warn('[receipts] fetch detail:', purchaseId, error?.message ?? 'not found');
    throw new Error(LOAD_ERROR_MESSAGE);
  }
  // The client is untyped (schema lives in Supabase): shape the raw row the
  // same way the read path does, so the mapping below is type-safe. To-one
  // embeds (stores, categories) arrive as an object OR a one-element array
  // (see `firstOrSelf`).
  const row = purchase as unknown as {
    id: string;
    store_id: string | null;
    total: number;
    purchase_date: string;
    payment_method: PaymentMethod;
    image_url: string | null;
    status: PurchaseStatus;
    stores: { name: string | null } | { name: string | null }[] | null;
    purchase_items:
      | {
          id: string;
          name: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          category_id: string | null;
          is_impulse: boolean;
          sort_order: number;
          categories: Category | Category[] | null;
        }[]
      | null;
  };

  const store = firstOrSelf(row.stores);
  const items: PurchaseItemDetail[] = (row.purchase_items ?? []).map(
    (item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      category_id: item.category_id,
      is_impulse: item.is_impulse,
      category: firstOrSelf(item.categories),
      sort_order: item.sort_order,
    }),
  );

  return {
    id: row.id,
    store_id: row.store_id,
    store_name: store?.name ?? null,
    purchase_date: row.purchase_date,
    total: row.total,
    payment_method: row.payment_method,
    image_url: row.image_url,
    status: row.status,
    items,
  };
}

/**
 * Maps an existing purchase back into the review `ReceiptDraft` shape, so
 * the review screen can edit it like any other draft. Item category ids are
 * normalized to SLUGS — the review's category picker and the item rows key
 * off slugs, not uuids (parseTicket already delivers slugs, so the round
 * trip stays consistent). Items keep their `sort_order` order (the fetch
 * orders by it), so an edit round trip never reorders the lines.
 */
export function purchaseToDraft(purchase: PurchaseWithItems): ReceiptDraft {
  const items: ReviewItem[] = (purchase.items ?? []).map((item) => ({
    temp_id: tempId(),
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    category_id: item.category?.slug ?? null,
    ai_suggested_category_id: null,
    is_impulse: item.is_impulse,
  }));
  return {
    store_name: purchase.store_name ?? '',
    purchase_date: purchase.purchase_date,
    total: purchase.total,
    payment_method: purchase.payment_method,
    image_url: purchase.image_url ?? '',
    items,
  };
}

/**
 * Best-effort restore of the PRE-EDIT purchase after a failed `updateReceipt`
 * write: re-applies the original row fields (the in-place update may already
 * have applied) and, when the draft's item insert failed, re-inserts the
 * original items (the wholesale delete already removed them). Never deletes
 * the receipt — an edit failure must not destroy a purchase the user already
 * had, or retries would fail forever. Failures are logged; the caller still
 * surfaces the user-safe error (the restore is best-effort, not a guarantee).
 */
async function restorePurchase(
  userId: string,
  purchaseId: string,
  original: PurchaseWithItems,
  restoreItems: boolean,
): Promise<void> {
  const { error: rowError } = await supabase
    .from('purchases')
    .update({
      store_id: original.store_id,
      purchase_date: original.purchase_date,
      total: original.total,
      payment_method: original.payment_method,
      image_url: original.image_url,
      status: original.status,
    })
    .eq('id', purchaseId)
    .eq('user_id', userId);
  if (rowError) {
    console.warn('[receipts] restore row failed:', purchaseId, rowError.code, rowError.message);
  }
  if (!restoreItems) return;
  // The original item rows are re-inserted with their ORIGINAL values — the
  // category FK is already a uuid, no slug resolution needed — and their
  // original sort_order, so the receipt looks exactly as before the edit.
  const { error: itemsError } = await supabase
    .from('purchase_items')
    .insert(
      original.items.map((item) => ({
        purchase_id: purchaseId,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        category_id: item.category_id,
        is_impulse: item.is_impulse,
        sort_order: item.sort_order,
      })),
    );
  if (itemsError) {
    console.warn(
      '[receipts] restore items failed:',
      purchaseId,
      itemsError.code,
      itemsError.message,
    );
  }
}

/**
 * Persists the review draft over an EXISTING purchase (edit flow):
 * - the pre-edit row + items are captured FIRST (fetchPurchaseDetail, scoped
 *   to the session user) so a failed write can restore them;
 * - resolveStoreId is shared with saveReceipt — a re-typed store name
 *   creates the store row, a match reuses the existing one;
 * - the purchase row is updated in place and its items are REPLACED by
 *   the draft's (delete-all + re-insert);
 * - a failed write RESTORES the pre-edit row + items — unlike saveReceipt
 *   (whose row was created in this same call) this receipt already existed,
 *   so deleting it on failure would destroy user data on a transient error;
 * - photo handling: an existing object path is kept as-is; a local file
 *   (camera edit) is uploaded first; null clears the photo. A photo that
 *   changed is best-effort removed from storage after the edit succeeds.
 * On success the cached receipt feeds are invalidated.
 */
export async function updateReceipt(
  userId: string,
  purchaseId: string,
  draft: ReceiptDraft,
): Promise<{ id: string }> {
  if (!isSupabaseConfigured) {
    throw new Error(SAVE_ERROR_MESSAGE);
  }

  // Capture the pre-edit state before ANY write (throws LOAD_ERROR when the
  // row is missing or belongs to another user — a 0-row fetch is a miss).
  const original = await fetchPurchaseDetail(userId, purchaseId);

  const storeId = await resolveStoreId(userId, draft.store_name);
  if (!storeId) throw new Error(SAVE_ERROR_MESSAGE);

  // The seeded draft carries the already-persisted storage path (or a
  // remote url) and passes through unchanged; only a device-local uri
  // (never produced by the edit flow today) would be uploaded — the same
  // scheme gate saveReceipt uses. The uploaded object is tracked so a
  // failed save best-effort removes it (no orphan on a retried confirm).
  let imageUrl: string | null = draft.image_url || null;
  let uploadedPath: string | null = null;
  if (imageUrl && /^(file|content|ph):/i.test(imageUrl)) {
    const uploaded = await uploadToStorage(userId, imageUrl);
    uploadedPath = uploaded.path;
    imageUrl = uploaded.path;
  }

  // `.select('id')` returns the updated row: a 0-row result (an RLS miss or
  // a row deleted mid-edit) fails closed instead of silently "succeeding" —
  // same fail-closed pattern deleteReceipt uses.
  const { data: updatedRow, error: purchaseError } = (await supabase
    .from('purchases')
    .update({
      store_id: storeId,
      purchase_date: draft.purchase_date,
      total: draft.total,
      payment_method: draft.payment_method,
      image_url: imageUrl,
      status: 'confirmed',
    })
    .eq('id', purchaseId)
    .eq('user_id', userId)
    .select('id')) as unknown as {
    data: { id: string }[] | null;
    error: { message: string; code?: string } | null;
  };
  if (purchaseError || !updatedRow || updatedRow.length === 0) {
    await removeUploadedObject(uploadedPath);
    console.warn(
      '[receipts] update purchase:',
      purchaseId,
      purchaseError?.message ?? 'no row matched',
      purchaseError?.code ?? '0-rows',
    );
    throw new Error(SAVE_ERROR_MESSAGE);
  }

  // Items are replaced wholesale: delete the current rows, then insert the
  // draft's. Delete first (not upsert) so a removed line is never left
  // behind.
  const { error: deleteError } = await supabase
    .from('purchase_items')
    .delete()
    .eq('purchase_id', purchaseId);
  if (deleteError) {
    // The row update already applied but the original items are still in
    // place (the delete never ran): restore the original row fields only.
    await restorePurchase(userId, purchaseId, original, false);
    await removeUploadedObject(uploadedPath);
    console.warn('[receipts] delete items:', purchaseId, deleteError.code, deleteError.message);
    throw new Error(SAVE_ERROR_MESSAGE);
  }

  const categoryIds = await fetchCategoryIdsBySlug();
  const itemRows = draft.items.map((item, index) => ({
    purchase_id: purchaseId,
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    category_id:
      categoryIds[item.category_id ?? ''] ??
      categoryIds[item.ai_suggested_category_id ?? ''] ??
      categoryIds['otros'] ??
      null,
    is_impulse: item.is_impulse,
    sort_order: index,
  }));
  const { error: itemsError } = await supabase
    .from('purchase_items')
    .insert(itemRows);
  if (itemsError) {
    // The wholesale delete already ran AND the row update applied: restore
    // BOTH the row fields and the original items. The receipt must survive
    // an edit failure — deleting it would destroy data on a transient error
    // and make every retry fail forever.
    await restorePurchase(userId, purchaseId, original, true);
    await removeUploadedObject(uploadedPath);
    console.warn('[receipts] insert items:', purchaseId, itemsError.code, itemsError.message);
    throw new Error(SAVE_ERROR_MESSAGE);
  }

  // The photo changed (re-upload or clear): best-effort remove the previous
  // object — it is unreachable now that image_url points elsewhere. A failed
  // remove only orphans the object (future GC), it never fails the edit.
  // Only owned object paths are ever passed to storage.remove.
  if (original.image_url && original.image_url !== imageUrl) {
    const previous = resolveReceiptPhotoPath(original.image_url);
    if (previous?.kind === 'path' && isOwnedReceiptPath(userId, previous.value)) {
      await removeUploadedObject(previous.value);
    }
  }

  invalidateReceiptFeeds(userId);
  return { id: purchaseId };
}

/**
 * Deletes a purchase. The ROW goes first, fail-closed: `.select('id,
 * image_url')` returns the deleted rows, so a 0-row result (RLS miss, wrong
 * user, already gone) surfaces the delete error instead of silently
 * "succeeding" — and the response still carries the photo path for the
 * cleanup below. The storage photo (object path) is then removed
 * best-effort — storage deletes do not cascade from the row, and a leftover
 * object is unreachable once the row is gone; a failed remove is logged but
 * does not block the delete. Only owned object paths are ever passed to
 * storage.remove. On success the cached receipt feeds are invalidated.
 */
export async function deleteReceipt(
  userId: string,
  purchaseId: string,
): Promise<void> {
  if (!isSupabaseConfigured) return;

  // The client is untyped (schema lives in Supabase): shape the awaited
  // delete-with-select response so the fail-closed 0-row check and the
  // photo cleanup below are type-safe (same pattern saveReceipt uses).
  const { data: deleted, error: deleteError } = (await supabase
    .from('purchases')
    .delete()
    .eq('id', purchaseId)
    .eq('user_id', userId)
    .select('id, image_url')) as unknown as {
    data: Array<{ id: string; image_url: string | null }> | null;
    error: { message: string; code?: string } | null;
  };
  if (deleteError || !deleted || deleted.length === 0) {
    console.warn(
      '[receipts] delete row:',
      purchaseId,
      deleteError?.message ?? 'no row matched',
      deleteError?.code ?? '0-rows',
    );
    throw new Error(DELETE_ERROR_MESSAGE);
  }

  // Best-effort photo removal AFTER the row: a failed remove leaves an
  // orphaned object (future GC) but never resurrects the row, and never
  // fails the delete.
  const imageUrl = deleted[0].image_url;
  const classified = imageUrl ? resolveReceiptPhotoPath(imageUrl) : null;
  // Only owned object paths live in the bucket: remote http(s) urls
  // (demo/seed rows) and foreign/untraversable paths are never passed to
  // `remove`.
  if (
    classified?.kind === 'path' &&
    isOwnedReceiptPath(userId, classified.value)
  ) {
    // storage-js re-throws non-StorageError exceptions from handleOperation:
    // a network failure REJECTS instead of returning {error}. The removal
    // must NEVER fail the delete — the row is already gone, a retry would
    // hit the fail-closed 0-row check above, and the invalidation below
    // would be skipped (the store + feed caches would keep the ghost
    // receipt). The try/catch-wrapped helper absorbs both the error and the
    // rejection path.
    await removeUploadedObject(classified.value);
  }

  invalidateReceiptFeeds(userId);
}
