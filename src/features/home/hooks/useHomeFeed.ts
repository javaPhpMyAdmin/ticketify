import { useQuery } from '@tanstack/react-query';

import type { IconName } from '@/components';
import { useSessionUser } from '@/features/auth';
import { formatYearMonth } from '@/lib/format';
import { USE_MOCK_DATA } from '@/lib/mock-data';
import { queryKeys } from '@/lib/query-keys';
import { useReceiptsStore } from '@/stores/use-receipts-store';
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
  category_totals?: Record<string, number>;
  items?: { name: string; amount: number; category: string }[];
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
 * día"). Best-effort: the mock matches by normalized name; Phase 5
 * matches products properly (category_id + product group from the parse
 * + catalog keywords).
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
 * local-date keys `daysAgoISO` produces in the mock fixtures (a UTC slice
 * would drift a day on late-evening timestamps in UTC-x zones).
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
 */
export function aggregateItemsByMonth(
  list: ReceiptSpendRecord[],
  monthKey: string,
): CategoryItemSummary[] {
  const totalsByItem = new Map<string, number>();
  for (const receipt of list) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    for (const item of receipt.items ?? []) {
      const key = normalizeItemName(item.name);
      totalsByItem.set(key, (totalsByItem.get(key) ?? 0) + item.amount);
    }
  }
  return [...totalsByItem.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Per-category drill-down (mock): reads the receipts store reactively and
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
 */
export interface ItemPurchaseSummary {
  receiptId: string;
  storeName: string;
  date: string; // ISO
  amount: number;
}

/**
 * Item search (mock): every normalized item in the month, cross-category,
 * sorted by amount desc — "en qué se me fue la plata", product by product.
 * `query` filters by normalized substring (e.g. "menú" matches "menú del
 * día"); an empty query returns the full month item list. Works for any
 * month via `monthKey` (defaults to the current month).
 */
export function useItemSearch(query: string, monthKey = currentMonthKey()) {
  const list = useReceiptsStore((s) => s.list);
  const items = aggregateItemsByMonth(list, monthKey);
  const normalizedQuery = normalizeItemName(query);
  if (!normalizedQuery) return items;
  return items.filter((item) => item.name.includes(normalizedQuery));
}

/**
 * Item drill-down (mock): the individual purchases behind one normalized
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
      });
    }
  }
  return { total, purchases };
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
  a: { scanned_at?: string; purchase_date: string },
  b: { scanned_at?: string; purchase_date: string },
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
 * Mock feed derived from the receipts store (EXPO_PUBLIC_MOCK_DATA=1),
 * scoped to the current month: recent receipts map 1:1 to the saved list
 * (current month only), category cards aggregate the per-item totals
 * across those receipts through the expense-category registry (so the
 * strip answers "en qué se me va el dinero" by item type, not by store),
 * and the snacks total sums the persisted impulse totals on them (0 when
 * none). Reads the store imperatively via `getState()` so it can run
 * inside the queryFn without a React subscription, and so a save that
 * appended to the list is picked up on refetch.
 */
function buildMockHomeFeed(): HomeFeed {
  const { list } = useReceiptsStore.getState();
  const monthKey = currentMonthKey();

  // The Home feed is scoped to the current month: past receipts drop off
  // the recent list, the category strip, and the impulse total. Older
  // months live in the History tab. "Recibos recientes" orders by
  // `scanned_at` (when the ticket was captured), not by purchase date, so
  // scanning an older ticket surfaces it at the top; ties break by purchase
  // date (newer first) for a stable list.
  const receipts: ReceiptSummary[] = list
    .filter((item) => getMonthKey(item.purchase_date) === monthKey)
    .sort(compareReceiptsByScan)
    .map((item) => ({
      id: item.id,
      name: item.store_name,
      date: item.purchase_date,
      amount: item.total,
      imageUrl: item.image_url ?? null,
    }));

  const categories = aggregateCategoriesByMonth(list, monthKey);

  const wantsSnacksTotal = list
    .filter((item) => getMonthKey(item.purchase_date) === monthKey)
    .reduce((sum, item) => sum + (item.wants_snacks_total ?? 0), 0);

  return { categories, receipts, wantsSnacksTotal };
}

/**
 * Home screen feed through TanStack Query (server-state-caching spec, D7).
 * The feed is scoped to the current month: categories, recent receipts,
 * and the impulse total only cover receipts whose purchase month matches
 * `currentMonthKey()` — past months live in the History tab. Purchase-list
 * reads are out of scope for this change, so the queryFn resolves the
 * neutral empty state; Phase 5 swaps only the queryFn. In offline dev
 * (EXPO_PUBLIC_MOCK_DATA=1) the feed is derived from the receipts store
 * instead. The query is disabled until a signed-in user exists, so no read
 * ever runs without a session.
 */
export function useHomeFeed(): HomeFeed {
  const { userId } = useSessionUser();

  const feedQuery = useQuery({
    queryKey: queryKeys.homeFeed(userId!),
    enabled: !!userId,
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return buildMockHomeFeed();
      }
      return EMPTY_FEED;
    },
  });

  // The production queryFn is a Phase 5 placeholder that currently resolves
  // the neutral empty state; if it ever rejects (a broken read), don't let
  // the swallow be silent — log it so the failure is visible in dev.
  if (__DEV__ && feedQuery.isError) {
    console.error('[HomeFeed] feed query failed:', feedQuery.error);
  }

  return feedQuery.data ?? EMPTY_FEED;
}
