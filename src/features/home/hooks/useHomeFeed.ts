import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { IconName } from '@/components';
import { useSessionUser } from '@/features/auth';
import { readMonthlyPurchasesTotal } from '@/lib/supabase/feature-access';
import { formatYearMonth } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { toQueryData, toQueryErrorMessage } from '@/lib/supabase/query-adapters';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import type { HomeFeedReceiptRow } from '@/types';
import { readPurchaseListByMonth, readPurchaseMonthKeys, searchPurchaseItems } from '../api';
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
  /** Total household spend for the current month (null when no household). */
  householdTotal: number | null;
}

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
 * Resolves the month-navigation boundaries from the list of months with
 * receipts plus the currently selected month.
 *
 * `monthKeys` is newest-first. If the CURRENT month is absent (it has no
 * receipts yet), it is synthesized at the FRONT of the effective list, so
 * the current (possibly empty) month is ALWAYS reachable via the "newer"
 * chevron — the bug this fixes: without it a user could navigate older but
 * never return to the current month once it had no receipts.
 *
 * Returns the effective month list, the selected month's index in it, the
 * navigation booleans, and the explicit next/previous target keys (mallets
 * for `goNewer`/`goOlder`). When the selected month is the current month
 * (or is newer than everything in the list), `canGoNewer` is false.
 *
 * Pure and deterministic — no clock beyond `currentMonthKey`, no side
 * effects — so it is directly unit-testable.
 */
export function resolveMonthNavigation(
  monthKeys: string[],
  monthKey: string,
): {
  months: string[];
  currentIndex: number;
  canGoNewer: boolean;
  canGoOlder: boolean;
  newerKey: string | null;
  olderKey: string | null;
} {
  const current = currentMonthKey();
  const keys = monthKeys ?? [];
  const months = keys.includes(current) ? keys : [current, ...keys];
  // The selected month is normally found (the initial selection is the
  // current month, which is always synthesized when absent). Fall back to
  // the newest position only for an unexpected out-of-list month, so the
  // selector degrades to "older-only" instead of breaking.
  const rawIndex = months.indexOf(monthKey);
  const currentIndex = rawIndex === -1 ? 0 : rawIndex;
  return {
    months,
    currentIndex,
    canGoNewer: currentIndex > 0,
    canGoOlder: currentIndex < months.length - 1,
    newerKey: currentIndex > 0 ? months[currentIndex - 1] : null,
    olderKey:
      currentIndex < months.length - 1 ? months[currentIndex + 1] : null,
  };
}

/**
 * Hook wrapper over `resolveMonthNavigation` for the shared month-selector
 * chevrons across Home / Analytics / History / Charts. `onNavigate` is
 * invoked with the target month when a chevron is pressed (screens use it
 * to also reset local UI state, e.g. a search query).
 */
export function useMonthNavigation(
  monthKeys: string[],
  monthKey: string,
  onNavigate: (nextKey: string) => void,
): {
  months: string[];
  currentIndex: number;
  canGoNewer: boolean;
  canGoOlder: boolean;
  goNewer: () => void;
  goOlder: () => void;
} {
  const { months, currentIndex, canGoNewer, canGoOlder, newerKey, olderKey } =
    useMemo(
      () => resolveMonthNavigation(monthKeys, monthKey),
      [monthKeys, monthKey],
    );
  const goNewer = useCallback(() => {
    if (newerKey) onNavigate(newerKey);
  }, [newerKey, onNavigate]);
  const goOlder = useCallback(() => {
    if (olderKey) onNavigate(olderKey);
  }, [olderKey, onNavigate]);
  return { months, currentIndex, canGoNewer, canGoOlder, goNewer, goOlder };
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
 * Shared month-scoped receipts query. Reads the FULL month via
 * `readPurchaseListByMonth` (not paginated) so month-scoped aggregations
 * (analytics top items, category detail, item detail, store detail) are
 * accurate regardless of the infinite-scroll depth in the receipts store.
 *
 * Returns `{ data, isLoading, hasData }`: `data` is the full-month list
 * once the query resolves (TanStack wins), falling back to the receipts
 * store's paginated list while loading so the UI never flashes empty.
 *
 * IMPORTANT: this hook NEVER writes to `useReceiptsStore`. The full-month
 * data lives only in the TanStack query cache (REQ-10 store integrity).
 */
export function useMonthReceipts(monthKey = currentMonthKey()) {
  const list = useReceiptsStore((s) => s.list); // fallback only
  const { userId } = useSessionUser();
  const query = useQuery({
    queryKey: queryKeys.monthReceipts(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readPurchaseListByMonth(userId!, monthKey).then(toQueryData),
  });
  return {
    data: query.data ?? list,
    isLoading: query.isLoading,
    hasData: query.data !== undefined,
  };
}

/**
 * First-class source of all months with receipts for the user, independent
 * of the selected-month query and the infinite-scroll store. Drives the
 * month selector in Home, Analytics, and History so navigation is never
 * broken when the current month has no receipts.
 *
 * On error the hook fails gracefully (empty array → older-nav disabled),
 * never throwing. Screens keep rendering the current month.
 */
export function useAvailableMonthKeys(
  userId?: string | null,
  enabled = true,
): string[] {
  const query = useQuery<string[]>({
    queryKey: queryKeys.monthKeys(userId!),
    enabled: !!userId && enabled,
    queryFn: () => readPurchaseMonthKeys(userId!).then(toQueryData),
    staleTime: 5 * 60 * 1000,
  });
  // Fail gracefully: query error → empty array (older-nav disabled)
  return query.data ?? [];
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
  const { userId } = useSessionUser();

  // Fetch full month receipts for accurate category breakdown.
  const monthQuery = useQuery({
    queryKey: queryKeys.monthReceipts(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readPurchaseListByMonth(userId!, monthKey).then(toQueryData),
  });
  const monthList = monthQuery.data ?? list;

  const category = getExpenseCategory(categoryKey);
  const items = aggregateItemsByCategory(monthList, categoryKey, monthKey);
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
  const { userId } = useSessionUser();
  const monthQuery = useQuery({
    queryKey: queryKeys.monthReceipts(userId!, monthKey),
    enabled: !!userId,
    queryFn: () => readPurchaseListByMonth(userId!, monthKey).then(toQueryData),
  });
  const monthList = monthQuery.data ?? list;
  const purchases: ItemPurchaseSummary[] = [];
  let total = 0;
  for (const receipt of monthList) {
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
 */
export function useStoreDetail(storeName: string, monthKey?: string) {
  const list = useReceiptsStore((s) => s.list);
  const { userId } = useSessionUser();
  const month = monthKey ?? currentMonthKey();
  const monthQuery = useQuery({
    queryKey: queryKeys.monthReceipts(userId!, month),
    enabled: !!userId,
    queryFn: () => readPurchaseListByMonth(userId!, month).then(toQueryData),
  });
  const monthList = monthQuery.data ?? list;
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
  for (const receipt of monthList) {
    if (getMonthKey(receipt.purchase_date) !== month) continue;
    if ((receipt.store_name ?? '').trim().toLowerCase() !== normalizedTarget) {
      continue;
    }
    const receiptId = receipt.id ?? '';
    let receiptSubtotal = 0;
    for (const item of receipt.items ?? []) {
      receiptSubtotal += item.amount;
    }
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
  const purchases = [...purchasesByReceipt.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  return {
    total,
    purchases: purchases as unknown as ItemPurchaseSummary[],
  };
}

/**
 * Orders "Recibos recientes" by `scanned_at` (when the ticket was
 * captured), newest first, falling back to `purchase_date` when the scan
 * stamp is missing; ties break by purchase date (newer first).
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
export function mapPurchaseRowsToHomeFeed(
  rows: HomeFeedReceiptRow[],
  householdTotal?: number | null,
  monthKey: string = currentMonthKey(),
): HomeFeed {

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

  return { categories, receipts, wantsSnacksTotal, householdTotal: householdTotal ?? null };
}

/**
 * Household total for a selected month. The only part the Home screen needs
 * from the old `useHomeFeed` for the household card. A server-side RPC
 * scoped to `monthKey`, so Home browsing ANY month (current or past) gets
 * the correct total without firing the redundant month-agnostic
 * infinite-scroll feed or writing the receipts store.
 *
 * `isLoading` reflects the household-total read (what the household card
 * needs). The snacks total is derived from the full-month rows
 * (`mapPurchaseRowsToHomeFeed`) so the separate impulse RPC is no longer
 * fetched here (it was a no-op consumer in Home).
 */
export function useHouseholdMonthTotal(
  monthKey: string = currentMonthKey(),
): { householdTotal: number | null; isLoading: boolean } {
  const { userId } = useSessionUser();
  const householdId = useHouseholdStore((s) => s.household?.id);

  // ── Household total (selected month, when household is active) ────────
  const householdTotalQuery = useQuery<{ total: number }[]>({
    queryKey: householdId
      ? queryKeys.householdMonthlyPurchasesTotal(householdId, monthKey)
      : ['household-purchases-total', 'disabled'],
    enabled: !!userId && !!householdId,
    queryFn: async () => {
      const result = await readMonthlyPurchasesTotal(monthKey, householdId!);
      return toQueryData(result);
    },
  });
  const householdTotal =
    householdId && householdTotalQuery.data
      ? (householdTotalQuery.data[0]?.total ?? 0)
      : null;

  return {
    householdTotal,
    isLoading: householdTotalQuery.isLoading,
  };
}
