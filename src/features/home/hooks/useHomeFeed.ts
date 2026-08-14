import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { IconName } from '@/components';
import { useSessionUser } from '@/features/auth';
import { formatYearMonth } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { toQueryData, toQueryErrorMessage } from '@/lib/supabase/query-adapters';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import type { HomeFeedReceiptRow } from '@/types';
import { readPurchaseList, searchPurchaseItems } from '../api';
import { getExpenseCategory } from '../categories';

/**
 * One entry in the home screen's "Recent Receipts" card. Rows are
 * pressable and open the receipt detail (`/receipts/:id`), which shows
 * the ticket photo when `imageUrl` is set.
 */
export interface ReceiptSummary {
  id: string;
  name: string;
  date: string; // ISO
  amount: number;
  /** Ticket photo URL (null when the receipt has no stored photo). */
  imageUrl: string | null;
}

/**
 * One spending-category card in the home screen's horizontal strip.
 * The registry in `features/home/categories.ts` owns the label/icon.
 */
export interface HomeCategory {
  key: string;
  name: string;
  amount: number;
  icon: IconName;
}

export interface HomeFeed {
  categories: HomeCategory[];
  receipts: ReceiptSummary[];
  wantsSnacksTotal: number;
}

/**
 * `useHomeFeed` result: the feed data plus the query flags the screens
 * need to render skeletons (loading) and honest error states instead of
 * a blank section or a false "no data" message.
 */
export interface HomeFeedResult extends HomeFeed {
  /** True while the initial feed read is in flight (no data yet). */
  isLoading: boolean;
  /** User-safe message when the authenticated read fails. */
  error: string | null;
  /**
   * True once a feed read succeeded, even if a background refetch later
   * fails (TanStack keeps the data and sets `error`). Screens render
   * error states only when `error && !hasData` — a stale error must not
   * hide retained data.
   */
  hasData: boolean;
}

/** Neutral empty feed — no fabricated content renders inside a session. */
const EMPTY_FEED: HomeFeed = { categories: [], receipts: [], wantsSnacksTotal: 0 };

/**
 * One aggregated item inside a category's detail ("cuánto gasté en cada
 * cosa este mes"). Names are normalized (lowercase + trimmed) so the same
 * product from different receipts collapses into one row.
 */
export interface CategoryItemSummary {
  name: string;
  amount: number;
}

/**
 * Minimal receipt shape the pure month aggregators consume. The receipts
 * store's rows satisfy it structurally; declaring the subset here keeps the
 * aggregation functions decoupled from the store (and testable in
 * isolation).
 */
export interface ReceiptSpendRecord {
  id?: string;
  store_name?: string;
  purchase_date: string;
  /**
   * Line total of the receipt. Optional on the minimal record shape: the
   * store list rows always carry it, but declaring it
   * optional keeps the aggregators (monthly overview, etc.) defensive.
   */
  total?: number;
  category_totals?: Record<string, number>;
  items?: {
    /**
     * The underlying `purchase_items.id`. Optional — only present on
     * rows hydrated from the real Supabase read (the receipts store
     * passes it through); minimal fixtures and test doubles omit it.
     * Consumers that need to target a single row server-side (e.g. the
     * item rename hook) treat its absence as "can't write".
     */
    id?: string;
    name: string;
    amount: number;
    /**
     * Quantity and unit price are optional, matching the price-alert
     * source rows: present only when the item participates in price
     * alerts, where the unit price is the comparable figure across months.
     */
    quantity?: number;
    unit_price?: number;
    category: string;
    /**
     * Impulse flag: present only on rows persisted after the parse-flow
     * started emitting it (older receipts from before the flag existed have
     * `undefined`, which the impulse aggregator treats as "not impulse").
     * The Home "Antojos / Snacks" callout and breakdown modal rely on it
     * to distinguish want from need at the line-item level.
     */
    is_impulse?: boolean;
  }[];
}

/**
 * Lowercase + trim + collapse whitespace so item names merge across
 * receipts, drop a trailing " xN" quantity ("Pizzas congeladas x2" →
 * "pizzas congeladas") and strip package sizes/weights ("Arroz 1kg" →
 * "arroz", "Gaseosa 1.5L" → "gaseosa") so the same product bought in
 * different presentations still lands on one row. Diacritics are folded
 * by DECOMPOSING first (NFD → strip combining marks → NFC recompose):
 * stripping directly on NFC input is a no-op because precomposed accents
 * ("ú" in "menú") are single codepoints that the combining-mark range
 * never matches. Grouping AND matching are accent-insensitive ("menú" and
 * "menu" collapse into one row, and the query "menu" matches "menú del
 * día"). Best-effort: normalized-name matching today; Phase 5 will match
 * products properly (category_id + product group from the parse + catalog
 * keywords).
 */
export function normalizeItemName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\sx\d+$/g, '')
    .replace(/\s+\d+(?:\.\d+)?\s*(?:kg|g|gr|l|lt|ml|cc|un|u|pack|docenas?)\b/g, '');
}

/**
 * Month bucket (`YYYY-MM`) a receipt lands in, derived by slicing the ISO
 * date — no Date parsing, so no timezone shifting at month boundaries.
 */
export function getMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The current month bucket (`YYYY-MM`) in local calendar time, matching the
 * local-date keys `todayLocalISO` produces (a UTC slice would drift a day
 * on late-evening timestamps in UTC-x zones).
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Previous month bucket (`YYYY-MM`) for a given month key. String math only
 * (no Date parsing), mirroring `getMonthKey`: December rolls to January of
 * the previous year.
 */
export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/**
 * Spanish display label for a `YYYY-MM` bucket, e.g. `2026-08` →
 * `Agosto 2026` (es-AR, full month name, capitalized for headings).
 * Malformed input is returned unchanged by the underlying formatter.
 */
export function monthKeyToLabel(monthKey: string): string {
  return formatYearMonth(monthKey, { full: true, capitalize: true });
}

/**
 * Month buckets that actually have receipts, newest first. The History tab
 * navigates within this list, so empty months never show up as steps.
 */
export function getAvailableMonthKeys(list: ReceiptSpendRecord[]): string[] {
  const keys = new Set(list.map((receipt) => getMonthKey(receipt.purchase_date)));
  return [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * Pure aggregation: per-category totals for one month, mapped through the
 * expense-category registry (label + icon) and sorted by amount desc.
 * Drives the Home strip (current month) and the History tab (any month).
 */
export function aggregateCategoriesByMonth(
  list: ReceiptSpendRecord[],
  monthKey: string,
): HomeCategory[] {
  const totalsByCategory = new Map<string, number>();
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const [key, amount] of Object.entries(receipt.category_totals ?? {})) {
      totalsByCategory.set(key, (totalsByCategory.get(key) ?? 0) + amount);
    }
  }
  return [...totalsByCategory.entries()]
    .map(([key, amount]) => {
      const def = getExpenseCategory(key);
      return { key, name: def.label, amount, icon: def.icon };
    })
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Pure aggregation: how many items were bought per category in one month —
 * "cuántos artículos compré en cada categoría". Counts one per item ROW,
 * NOT per quantity, mirroring the `monthly_category_totals` RPC's
 * `count(*)` over `purchase_items` so the History cards agree with the
 * analytics block. Categories with no items are absent from the result.
 */
export function aggregateCategoryItemCounts(
  list: ReceiptSpendRecord[],
  monthKey: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const item of receipt.items ?? []) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Pure aggregation: line items tagged `categoryKey` within one month,
 * grouped by normalized name and sorted by amount desc — "cuánto gasté en
 * cada cosa". `total` for the category is the sum of the returned rows.
 */
export function aggregateItemsByCategory(
  list: ReceiptSpendRecord[],
  categoryKey: string,
  monthKey: string,
): CategoryItemSummary[] {
  const totalsByItem = new Map<string, number>();
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const item of receipt.items ?? []) {
      if (item.category !== categoryKey) continue;
      const key = normalizeItemName(item.name);
      totalsByItem.set(key, (totalsByItem.get(key) ?? 0) + item.amount);
    }
  }
  return [...totalsByItem.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Pure aggregation: every line item within one month, grouped by normalized
 * name across ALL categories and stores — "cuánto gasté en menú del día este
 * mes", wherever it was bought. This is the item-level lens (identity) that
 * complements the category lens (label): the same product from a bakery, a
 * buffet, or a supermarket collapses into one row with one monthly total.
 *
 * `excludeCategories` drops whole categories before grouping (default: none,
 * so History's item search keeps seeing every item). The analytics "Top
 * Artículos" passes `['servicios']` — utility bills (Luz/Teléfono/Agua) are
 * items on their receipts but are not consumption, and they would otherwise
 * own every top-N rank.
 */
export function aggregateItemsByMonth(
  list: ReceiptSpendRecord[],
  monthKey: string,
  excludeCategories: string[] = [],
): CategoryItemSummary[] {
  const excluded = new Set(excludeCategories);
  const totalsByItem = new Map<string, number>();
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const item of receipt.items ?? []) {
      if (excluded.has(item.category)) continue;
      const key = normalizeItemName(item.name);
      totalsByItem.set(key, (totalsByItem.get(key) ?? 0) + item.amount);
    }
  }
  return [...totalsByItem.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Pure aggregation: impulse (`is_impulse === true`) line items within one
 * month, grouped by normalized name and sorted by amount desc. Drives the
 * Home "Antojos / Snacks" breakdown modal — "en qué se me fue la plata en
 * impulsos este mes". Items without `is_impulse` (older receipts that did
 * not persist the flag) are excluded: the modal's contract is "things the
 * user marked as impulse", not "things the user might have marked".
 */
export function aggregateImpulseItemsByMonth(
  list: ReceiptSpendRecord[],
  monthKey: string,
): CategoryItemSummary[] {
  const totalsByItem = new Map<string, number>();
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const item of receipt.items ?? []) {
      if (!item.is_impulse) continue;
      const key = normalizeItemName(item.name);
      totalsByItem.set(key, (totalsByItem.get(key) ?? 0) + item.amount);
    }
  }
  return [...totalsByItem.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Per-category drill-down: reads the receipts store reactively and
 * aggregates every line item tagged with `categoryKey` within `monthKey`
 * (defaults to the current month), grouped by normalized name, sorted by
 * amount desc. `total` is the sum of those items — the category's monthly
 * spend for the selected month.
 */
export function useCategoryDetail(categoryKey: string, monthKey = currentMonthKey()) {
  const list = useReceiptsStore((s) => s.list);
  const category = getExpenseCategory(categoryKey);
  const items = aggregateItemsByCategory(list, categoryKey, monthKey);
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return { category, total, items };
}

/**
 * One individual purchase of a searched item (identity lens): the receipt
 * it came from, the store, the ticket date, and what that item alone cost.
 *
 * `purchaseItemId` carries the underlying `purchase_items.id` so the
 * post-scan rename hook can target exactly this row server-side without
 * a name-based lookup (the name is what the URL is keyed on, so a
 * server-side lookup would be ambiguous when two items share a name).
 */
export interface ItemPurchaseSummary {
  receiptId: string;
  storeName: string;
  date: string; // ISO
  amount: number;
  purchaseItemId?: string;
}

/**
 * Item search: every normalized item in the month, cross-category, sorted
 * by amount desc — "en qué se me fue la plata", product by product.
 * `query` filters by normalized substring (e.g. "menú" matches "menú del
 * día"); an empty query returns the full month item list. Works for any
 * month via `monthKey` (defaults to the current month).
 *
 * Runs an indexed, accent-insensitive ilike on `purchase_items.name_search`
 * (option B, approved), user-scoped via RLS, month-bounded by the purchase
 * date; matched items come back as single-receipt rows and re-aggregate
 * through the same pure month aggregators. Empty queries never hit the
 * network (the History screen renders the category list in that case).
 *
 * The result exposes the query flags alongside the data so the History
 * screen can distinguish loading (skeletons), error (error state) and a
 * genuine empty result ("Sin resultados") — a failed search must never
 * render as "no results".
 */
export interface ItemSearchResult {
  results: CategoryItemSummary[];
  /** True while the search read is in flight (no data yet). */
  isLoading: boolean;
  /** User-safe message when the authenticated search fails. */
  error: string | null;
  /**
   * True once a search read succeeded, even if a background refetch
   * later fails (TanStack keeps the data and sets `error`). The History
   * screen renders the error state only when `error && !hasData`.
   */
  hasData: boolean;
}

export function useItemSearch(
  query: string,
  monthKey = currentMonthKey(),
): ItemSearchResult {
  const { userId } = useSessionUser();
  const normalizedQuery = normalizeItemName(query);

  const searchQuery = useQuery<CategoryItemSummary[]>({
    queryKey: queryKeys.itemSearch(userId!, monthKey, normalizedQuery),
    enabled: !!userId && normalizedQuery.length > 0,
    queryFn: async () => {
      const result = await searchPurchaseItems(
        userId!,
        monthKey,
        normalizedQuery,
      );
      const rows = toQueryData(result);
      return aggregateItemsByMonth(rows, monthKey).filter((item) =>
        item.name.includes(normalizedQuery),
      );
    },
  });

  return {
    results: searchQuery.data ?? [],
    isLoading: searchQuery.isLoading,
    error: searchQuery.error ? toQueryErrorMessage(searchQuery.error) : null,
    hasData: searchQuery.data !== undefined,
  };
}

/**
 * Item drill-down: the individual purchases behind one normalized
 * item in one month, with the month total — the answer to "cuánto gasté en
 * menú del día este mes", wherever it was bought. `total` is the sum of the
 * returned purchases.
 */
export function useItemDetail(itemName: string, monthKey = currentMonthKey()) {
  const list = useReceiptsStore((s) => s.list);
  const purchases: ItemPurchaseSummary[] = [];
  let total = 0;
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const item of receipt.items ?? []) {
      if (normalizeItemName(item.name) !== itemName) continue;
      total += item.amount;
      purchases.push({
        receiptId: receipt.id ?? '',
        storeName: receipt.store_name ?? '',
        date: receipt.purchase_date,
        amount: item.amount,
        purchaseItemId: item.id,
      });
    }
  }
  return { total, purchases };
}

/**
 * Per-store drill-down: the receipts the user scanned at the named
 * store in the requested month, plus the store's monthly total.
 * Sibling to `useItemDetail` — same shape, different axis.
 *
 * `purchases` are aggregated at the RECEIPT level (one row per
 * ticket) rather than the item level. The store detail screen's tap
 * target is "open the ticket photo for that receipt" (`/receipts/[id]`),
 * so the natural grain is one row per ticket, with that ticket's
 * subtotal-for-this-store as the row amount. A user who bought three
 * items at Coto across one ticket sees one row, not three. Without
 * item-name data on the `ItemPurchaseSummary` shape, the per-item grain
 * would render as `(date, amount)` blobs with no semantic meaning; the
 * per-receipt grain reads as "tickets I scanned at this store".
 *
 * The store name is compared in normalized form (trim + lowercase) so
 * "Coto", "COTO" and " coto " all collapse onto one row, matching
 * `aggregateStoresByMonth`'s normalization. The receipt's `store_name`
 * is used directly (no separate `store_id` field today) — once a
 * parser-backed `store_id` exists, this filter should switch from name
 * to id.
 *
 * `total` is the per-store monthly total (the same number the bar
 * chart shows for this store in this month). Receipts that landed in
 * OTHER stores in the same month are not counted here even if some of
 * their items share a category with this store.
 */
export function useStoreDetail(storeName: string, monthKey?: string) {
  const list = useReceiptsStore((s) => s.list);
  const month = monthKey ?? currentMonthKey();
  const normalizedTarget = storeName.trim().toLowerCase();
  type ReceiptPurchase = {
    receiptId: string;
    storeName: string;
    date: string;
    amount: number;
    purchaseItemId?: string;
  };
  const purchasesByReceipt = new Map<string, ReceiptPurchase>();
  let total = 0;
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== month) continue;
    if ((receipt.store_name ?? '').trim().toLowerCase() !== normalizedTarget) {
      continue;
    }
    const receiptId = receipt.id ?? '';
    let receiptSubtotal = 0;
    for (const item of receipt.items ?? []) {
      receiptSubtotal += item.amount;
    }
    // Always derive the row amount from the items, not `receipt.total`
    // — `receipt.total` covers the entire ticket (which can include
    // items at OTHER stores if a single ticket bagged purchases from
    // multiple merchants, an edge case the parser doesn't yet surface
    // but the aggregator should be defensive against). The subtotal
    // computed from `receipt.items` is the source of truth for this
    // store's contribution.
    total += receiptSubtotal;
    if (receiptId) {
      const existing = purchasesByReceipt.get(receiptId);
      if (existing) {
        existing.amount += receiptSubtotal;
      } else {
        purchasesByReceipt.set(receiptId, {
          receiptId,
          storeName: receipt.store_name ?? '',
          date: receipt.purchase_date,
          amount: receiptSubtotal,
        });
      }
    }
  }
  // Newest first — most recent trip to the store surfaces at the top.
  const purchases = [...purchasesByReceipt.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  // Cast to the public shape — the screen consumes `ItemPurchaseSummary`
  // for the common fields (receiptId, storeName, date, amount). The
  // optional `purchaseItemId` is absent by design (item-level grain
  // doesn't apply here).
  return {
    total,
    purchases: purchases as unknown as ItemPurchaseSummary[],
  };
}

/**
 * Orders "Recibos recientes" by `scanned_at` (when the ticket was
 * captured), newest first, falling back to `purchase_date` when the scan
 * stamp is missing; ties break by purchase date (newer first). A proper
 * TOTAL ORDER: equal keys return 0 and swapped arguments return opposite
 * signs (`cmp(a, b) === -cmp(b, a)`), so `.sort()` is stable and the
 * result does not depend on the input order. Comparing `undefined`
 * against a string is not anti-symmetric (both directions return the same
 * sign); the `?? purchase_date` fallback keeps both sides comparable.
 */
export function compareReceiptsByScan(
  a: { scanned_at?: string | null; purchase_date: string },
  b: { scanned_at?: string | null; purchase_date: string },
): number {
  const aScanned = a.scanned_at ?? a.purchase_date;
  const bScanned = b.scanned_at ?? b.purchase_date;
  if (aScanned !== bScanned) {
    return aScanned < bScanned ? 1 : -1;
  }
  if (a.purchase_date !== b.purchase_date) {
    return a.purchase_date < b.purchase_date ? 1 : -1;
  }
  return 0;
}

/**
 * Pure derivation: receipt rows → the Home feed, scoped to the current
 * month: recent receipts map 1:1 to the current-month rows ordered by
 * `scanned_at` (when the ticket was captured — scanning an older ticket
 * surfaces it at the top; ties break by purchase date), category cards
 * aggregate the per-item totals through the expense-category registry (so
 * the strip answers "en qué se me va el dinero" by item type, not by
 * store), and the snacks total sums the impulse totals (0 when none).
 */
export function mapPurchaseRowsToHomeFeed(rows: HomeFeedReceiptRow[]): HomeFeed {
  const monthKey = currentMonthKey();

  const receipts: ReceiptSummary[] = rows
    .filter((item) => getMonthKey(item.purchase_date) === monthKey)
    .sort(compareReceiptsByScan)
    .map((item) => ({
      id: item.id,
      name: item.store_name,
      date: item.purchase_date,
      amount: item.total,
      imageUrl: item.image_url ?? null,
    }));

  const categories = aggregateCategoriesByMonth(rows, monthKey);

  const wantsSnacksTotal = rows
    .filter((item) => getMonthKey(item.purchase_date) === monthKey)
    .reduce((sum, item) => sum + (item.wants_snacks_total ?? 0), 0);

  return { categories, receipts, wantsSnacksTotal };
}

/**
 * Home screen feed through TanStack Query (server-state-caching spec, D7).
 * The feed is scoped to the current month: categories, recent receipts,
 * and the impulse total only cover receipts whose purchase month matches
 * `currentMonthKey()` — past months live in the History tab. The query
 * source is the full purchase list (all months), read from `purchases` /
 * `purchase_items` (one batched round trip). The feed also hydrates the
 * receipts store with the full list, so the store-based History/Analytics
 * screens and drill-downs render the same rows. The query is disabled
 * until a signed-in user exists, so no read ever runs without a session.
 */
export function useHomeFeed(): HomeFeedResult {
  const { userId } = useSessionUser();

  const rowsQuery = useQuery<HomeFeedReceiptRow[]>({
    queryKey: queryKeys.homeFeed(userId!),
    enabled: !!userId,
    queryFn: async () => toQueryData(await readPurchaseList(userId!)),
  });

  // Hydrates the receipts store with the full purchase list so the
  // store-subscribing screens (History, Analytics, drill-downs, price
  // alerts) render the same rows the feed does. Keys on the DATA only —
  // the loading/error flags added below must never re-fire this effect.
  const rows = rowsQuery.data;
  useEffect(() => {
    if (rows) {
      useReceiptsStore.setState({ list: rows });
    }
  }, [rows]);

  const feed = useMemo(
    () => (rows ? mapPurchaseRowsToHomeFeed(rows) : EMPTY_FEED),
    [rows],
  );

  // A failed read must not be silent — log it so the failure is visible in
  // dev (the feed still renders the neutral empty state, never crashes).
  if (__DEV__ && rowsQuery.isError) {
    console.error('[HomeFeed] feed query failed:', rowsQuery.error);
  }

  return {
    ...feed,
    isLoading: rowsQuery.isLoading,
    error: rowsQuery.error ? toQueryErrorMessage(rowsQuery.error) : null,
    hasData: rowsQuery.data !== undefined,
  };
}
