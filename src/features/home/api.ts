/**
 * Home feed data access — real Supabase reads (data-access spec, Phase 5).
 *
 * Every read funnels through the feature-access seam (ADR-7): a failed read
 * resolves to a discriminated status the hooks map to the neutral empty
 * feed / a user-safe message, never a crash.
 *
 * Scope: authenticated-only and user-scoped via RLS (`purchases_select_own`,
 * `purchase_items_select_own`). The purchase list is a single batched
 * request (nested `stores` + `purchase_items` + `categories` selects) so the
 * Home feed, History, Analytics, and the drill-downs all hydrate from one
 * round trip. `status = 'confirmed'` is filtered server-side so drafts never
 * surface in the feed.
 *
 * `scanned_at` is not a column: `purchases.created_at` IS the capture stamp,
 * so the row mapping surfaces it as `scanned_at`, the field
 * `compareReceiptsByScan` orders by. `category_totals`
 * and `wants_snacks_total` are derived client-side from the line items
 * (slug + impulse flag), keeping the grouping logic in the pure helpers the
 * reads share.
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { READ_ERROR_MESSAGE } from '@/lib/supabase/feature-access';
import type { FeatureReadResult } from '@/lib/supabase/feature-access';
import type {
  HomeFeedItemRow,
  HomeFeedReceiptRow,
  PaymentMethod,
} from '@/types';

import { buildFeedRow } from './feed-row';

/** Raw PostgREST shape of one `purchases` row with its nested relations. */
interface RawPurchaseRow {
  id: string;
  store_id: string | null;
  purchase_date: string;
  created_at: string | null;
  total: number;
  payment_method: string;
  image_url: string | null;
  status: string;
  stores: { name: string } | { name: string }[] | null;
  purchase_items: RawItemRow[] | null;
}

/** Raw PostgREST shape of one `purchase_items` row with its category. */
interface RawItemRow {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_impulse: boolean;
  sort_order: number;
  categories: { slug: string } | { slug: string }[] | null;
}

/**
 * PostgREST returns a to-one relation either as a single object or a
 * one-element array (when the nested select is ambiguous). Normalizes both
 * to the object (or null).
 */
function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Maps a raw `purchases` row into the shared feed-row shape: items ordered
 * by `sort_order`, then the shared builder derives `category_totals` by slug
 * and `wants_snacks_total` over impulse items. Unknown store/category fall
 * back to the neutral values.
 */
function mapPurchaseRow(row: RawPurchaseRow): HomeFeedReceiptRow {
  const items: HomeFeedItemRow[] = (row.purchase_items ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      // Carry the `purchase_items.id` so the rename hook on the post-scan
      // detail screen can target exactly this row server-side without a
      // name-based lookup. RLS still scopes the UPDATE to the owning user.
      id: item.id,
      name: item.name,
      amount: item.total_price,
      quantity: item.quantity,
      unit_price: item.unit_price,
      category: firstOrSelf(item.categories)?.slug ?? 'otros',
      is_impulse: item.is_impulse,
    }));

  return buildFeedRow(
    {
      id: row.id,
      store_name: firstOrSelf(row.stores)?.name ?? 'Desconocido',
      purchase_date: row.purchase_date,
      scanned_at: row.created_at,
      total: row.total,
      image_url: row.image_url,
      status: row.status as HomeFeedReceiptRow['status'],
      payment_method: row.payment_method as PaymentMethod,
    },
    items,
  );
}

/**
 * The signed-in user's confirmed purchases (all months, newest capture
 * first). The Home feed and the History/Analytics screens derive from this
 * one list; the query keys scope the cache per user.
 */
export async function readPurchaseList(
  userId: string,
): Promise<FeatureReadResult<HomeFeedReceiptRow[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('purchases')
    .select(
      `id, store_id, purchase_date, created_at, total, payment_method, image_url, status,
       stores ( name ),
       purchase_items ( id, name, quantity, unit_price, total_price, is_impulse, sort_order, categories ( slug ) )`,
    )
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[read] purchase list failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const rows = (data as unknown[] | null) ?? [];
  return {
    status: 'ok',
    data: rows.map((row) => mapPurchaseRow(row as RawPurchaseRow)),
  };
}

/** Default page size for paginated purchase reads. */
export const PURCHASE_PAGE_SIZE = 10;

/**
 * Paginated purchase read — fetches a single page of confirmed purchases,
 * newest capture first. Used by the infinite-query home feed to load
 * receipts 10 at a time. Returns a full page means there may be more;
 * a short page means this is the last one.
 */
export async function readPurchasePage(
  userId: string,
  page: number,
  pageSize: number = PURCHASE_PAGE_SIZE,
): Promise<FeatureReadResult<HomeFeedReceiptRow[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error } = await supabase
    .from('purchases')
    .select(
      `id, store_id, purchase_date, created_at, total, payment_method, image_url, status,
       stores ( name ),
       purchase_items ( id, name, quantity, unit_price, total_price, is_impulse, sort_order, categories ( slug ) )`,
    )
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) {
    console.warn('[read] purchase page failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const rows = (data as unknown[] | null) ?? [];
  return {
    status: 'ok',
    data: rows.map((row) => mapPurchaseRow(row as RawPurchaseRow)),
  };
}

/** `YYYY-MM` one month after `monthKey` (string math, no Date parsing). */
function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Fetch ALL confirmed receipts for a specific month (no pagination).
 * Used by the charts screen so detail views (day tap, category drill-down)
 * have the full receipt set regardless of how much of the home feed
 * has been scrolled.
 */
export async function readPurchaseListByMonth(
  userId: string,
  yearMonth: string,
): Promise<FeatureReadResult<HomeFeedReceiptRow[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const startDate = `${yearMonth}-01`;
  const endDate = `${nextMonthKey(yearMonth)}-01`;
  const { data, error } = await supabase
    .from('purchases')
    .select(
      `id, store_id, purchase_date, created_at, total, payment_method, image_url, status,
       stores ( name ),
       purchase_items ( id, name, quantity, unit_price, total_price, is_impulse, sort_order, categories ( slug ) )`,
    )
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .gte('purchase_date', startDate)
    .lt('purchase_date', endDate)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[read] purchase list by month failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const rows = (data as unknown[] | null) ?? [];
  return {
    status: 'ok',
    data: rows.map((row) => mapPurchaseRow(row as RawPurchaseRow)),
  };
}

/** Raw PostgREST shape of one `purchase_items` row with its purchase. */
interface RawSearchItemRow {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_impulse: boolean;
  sort_order: number;
  categories: { slug: string } | { slug: string }[] | null;
  /** The owning purchase (PostgREST returns the to-one relation as a single
   *  object or a one-element array depending on the select). */
  purchases: RawPurchaseRow | RawPurchaseRow[] | null;
}

/**
 * Maps a matched item into a single-receipt row so the caller can re-use
 * the pure month aggregators (one item per row). The purchase is always
 * present (the query filters on it); the fallbacks are defensive.
 */
function mapSearchItemRow(row: RawSearchItemRow): HomeFeedReceiptRow {
  const purchase = firstOrSelf(row.purchases);
  const category = firstOrSelf(row.categories)?.slug ?? 'otros';
  const items: HomeFeedItemRow[] = [
    {
      // The search query already selects `purchase_items.id`; carry it
      // through so the rename hook can target this exact row.
      id: row.id,
      name: row.name,
      amount: row.total_price,
      quantity: row.quantity,
      unit_price: row.unit_price,
      category,
      is_impulse: row.is_impulse,
    },
  ];
  return buildFeedRow(
    {
      id: row.id,
      store_name: purchase
        ? (firstOrSelf(purchase.stores)?.name ?? 'Desconocido')
        : 'Desconocido',
      purchase_date: purchase?.purchase_date ?? '',
      scanned_at: purchase?.created_at ?? null,
      total: purchase?.total ?? row.total_price,
      image_url: purchase?.image_url ?? null,
      status:
        (purchase?.status as HomeFeedReceiptRow['status']) ?? 'confirmed',
      // The nested purchases select includes `payment_method`; the fallback
      // covers a defensive null purchase (the query filters on it, so the
      // method is normally always present).
      payment_method: purchase?.payment_method as PaymentMethod | undefined,
    },
    items,
  );
}

/**
 * Escapes LIKE/ILIKE wildcards so user-typed `%`, `_` and `\` are matched
 * literally instead of acting as pattern metacharacters. Order matters:
 * backslash is escaped FIRST — the backslashes this function itself inserts
 * for `%`/`_` must not be re-escaped by a later pass — then `%` → `\%`,
 * then `_` → `\_`. Postgres's default LIKE escape character is `\`, so the
 * caller can safely interpolate the result inside its own `%…%` prefix and
 * suffix wildcards.
 */
function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Item search (approved option B): accent-insensitive, indexed ilike on
 * `purchase_items.name_search` (migration 0006) with the accent-stripped
 * query, user-scoped through RLS plus an explicit `purchases.user_id`
 * filter, and month-bounded by the purchase date. Returns matched items as
 * single-receipt rows; the caller aggregates them with the same pure month
 * aggregators the reads use, so results group identically.
 *
 * LIKE wildcards the user typed (`%`, `_`, `\`) are escaped first via
 * `escapeLikePattern`, so they match literally — `50%` finds names
 * containing "50%", never every name containing "50". Only the surrounding
 * `%…%` remains a wildcard (prefix/suffix matching is the intent).
 *
 * The trigram GIN index on `name_search` keeps the leading-wildcard ilike
 * indexed as the catalog grows — the reason this search is server-side
 * rather than an in-memory filter.
 */
export async function searchPurchaseItems(
  userId: string,
  monthKey: string,
  normalizedQuery: string,
): Promise<FeatureReadResult<HomeFeedReceiptRow[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('purchase_items')
    .select(
      `id, name, quantity, unit_price, total_price, is_impulse, sort_order,
       categories ( slug ),
       purchases ( id, purchase_date, created_at, total, payment_method, image_url, status, stores ( name ) )`,
    )
    .eq('purchases.user_id', userId)
    // User-typed wildcards are escaped so `%`, `_` and `\` match literally;
    // only the `%…%` around the query keeps prefix/suffix matching.
    .ilike('name_search', `%${escapeLikePattern(normalizedQuery)}%`)
    .gte('purchases.purchase_date', `${monthKey}-01`)
    // `purchase_date` is a real `date` column: Postgres must be able to
    // parse the bound, so the exclusive upper bound is the FIRST day of the
    // next month (`2026-09-01`), never the bare `YYYY-MM` prefix — a bare
    // prefix raised `22007 invalid input syntax for type date: "2026-09"`.
    .lt('purchases.purchase_date', `${nextMonthKey(monthKey)}-01`)
    // Deterministic pagination: without an explicit order PostgREST's row
    // order is unspecified, so equal-amount results could flip between
    // requests. `purchases(purchase_date)` sorts the parent rows by the
    // to-one purchase's date (bare `purchase_date` is not a column of
    // `purchase_items`), then `name` breaks ties, then `purchases(id)`
    // orders purchases sharing a date+name, and finally `id` — the
    // `purchase_items` PK — orders the items inside one purchase, so the
    // sort is fully total (no two rows can share all four keys) and the
    // `.limit(200)` cutoff can never flip between requests.
    .order('purchases(purchase_date)', { ascending: true })
    .order('name')
    .order('purchases(id)')
    .order('id')
    .limit(200);
  if (error) {
    console.warn('[read] item search failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const rows = (data as unknown[] | null) ?? [];
  return {
    status: 'ok',
    data: rows.map((row) => mapSearchItemRow(row as RawSearchItemRow)),
  };
}
