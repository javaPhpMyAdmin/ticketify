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
import type { HomeFeedItemRow, HomeFeedReceiptRow } from '@/types';

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
 * by `sort_order`, `category_totals` summed by slug, `wants_snacks_total`
 * summed over impulse items, and `scanned_at` from `created_at`. Unknown
 * store/category fall back to the neutral values.
 */
function mapPurchaseRow(row: RawPurchaseRow): HomeFeedReceiptRow {
  const items: HomeFeedItemRow[] = (row.purchase_items ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      name: item.name,
      amount: item.total_price,
      quantity: item.quantity,
      unit_price: item.unit_price,
      category: firstOrSelf(item.categories)?.slug ?? 'otros',
      is_impulse: item.is_impulse,
    }));

  const categoryTotals: Record<string, number> = {};
  for (const item of items) {
    categoryTotals[item.category] =
      (categoryTotals[item.category] ?? 0) + item.amount;
  }

  return {
    id: row.id,
    store_name: firstOrSelf(row.stores)?.name ?? 'Desconocido',
    purchase_date: row.purchase_date,
    scanned_at: row.created_at,
    total: row.total,
    image_url: row.image_url,
    status: row.status as HomeFeedReceiptRow['status'],
    wants_snacks_total: items
      .filter((item) => item.is_impulse)
      .reduce((sum, item) => sum + item.amount, 0),
    category_totals: categoryTotals,
    items,
  };
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

/** `YYYY-MM` one month after `monthKey` (string math, no Date parsing). */
function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
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
      name: row.name,
      amount: row.total_price,
      quantity: row.quantity,
      unit_price: row.unit_price,
      category,
      is_impulse: row.is_impulse,
    },
  ];
  return {
    id: row.id,
    store_name: purchase
      ? (firstOrSelf(purchase.stores)?.name ?? 'Desconocido')
      : 'Desconocido',
    purchase_date: purchase?.purchase_date ?? '',
    scanned_at: purchase?.created_at ?? null,
    total: purchase?.total ?? row.total_price,
    image_url: purchase?.image_url ?? null,
    status: (purchase?.status as HomeFeedReceiptRow['status']) ?? 'confirmed',
    wants_snacks_total: row.is_impulse ? row.total_price : 0,
    category_totals: { [category]: row.total_price },
    items,
  };
}

/**
 * Item search (approved option B): accent-insensitive, indexed ilike on
 * `purchase_items.name_search` (migration 0006) with the accent-stripped
 * query, user-scoped through RLS plus an explicit `purchases.user_id`
 * filter, and month-bounded by the purchase date. Returns matched items as
 * single-receipt rows; the caller aggregates them with the same pure month
 * aggregators the reads use, so results group identically.
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
    .ilike('name_search', `%${normalizedQuery}%`)
    .gte('purchases.purchase_date', `${monthKey}-01`)
    .lt('purchases.purchase_date', nextMonthKey(monthKey))
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
