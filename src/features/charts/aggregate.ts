/**
 * Pure aggregations for the Pro charts (pro-subscription spec — REQ-CHART-1..6).
 *
 * These functions consume the same `ReceiptSpendRecord[]` shape the free
 * analytics use (`features/home/hooks/useHomeFeed`), so the Pro charts and
 * the analytics tab read the SAME receipts and only the visualization
 * layer differs. No React, no I/O, no skia — they are deterministic and
 * trivially testable (M8.1 will exercise zero-fill, sort determinism, and
 * donut parity against `aggregateCategoriesByMonth`).
 *
 * `aggregateCategoriesByMonth` is RE-EXPORTED from `useHomeFeed` rather
 * than duplicated, so the donut chart and the free analytics share a
 * single source of truth — the donut cannot drift away from the category
 * strip just because someone tweaked the math here.
 */
import {
  aggregateCategoriesByMonth,
  getMonthKey,
  previousMonthKey,
  type HomeCategory,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';

export interface SpendTrendPoint {
  /** `YYYY-MM` month bucket, in the same order as the input `months` array. */
  month: string;
  /** Sum of `receipt.total` for receipts landing in this month (0 when none). */
  total: number;
}

/**
 * Per-month spend, zero-filled across the requested `months` window. Months
 * with no receipts render as `{ month, total: 0 }` (NOT omitted) so the
 * trend chart keeps a continuous x-axis — a gap would lie about "we had
 * no spending" when the truth is "no data was recorded". The output
 * preserves the input order (`months` is the source of truth for ordering,
 * not the receipts themselves).
 *
 * Deterministic: same input always yields the same output; the months loop
 * never depends on insertion order of the receipts.
 */
export function aggregateSpendTrend(
  records: ReceiptSpendRecord[],
  months: string[],
): SpendTrendPoint[] {
  const totalsByMonth = new Map<string, number>();
  for (const receipt of records) {
    const key = getMonthKey(receipt.purchase_date);
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + (receipt.total ?? 0));
  }
  return months.map((month) => ({
    month,
    total: totalsByMonth.get(month) ?? 0,
  }));
}

export interface StoreSpend {
  /** Stable identifier — falls back to the store name when no id is set. */
  storeId: string;
  /** Display name, e.g. "Mercado del Puerto". */
  storeName: string;
  /** Sum of receipt totals for this store within the requested month. */
  total: number;
}

/**
 * Per-store totals for a single month, sorted by total descending and
 * tie-broken by storeName ascending. The record shape exposes only
 * `store_name` (no `store_id`), so we use the name as both the id and
 * the display label — that keeps two receipts from different branches of
 * the same chain merged (the parser would set a separate `store_id` later
 * if we ever add one). A normalized comparison (`trim` + lowercase)
 * prevents "Mercado X" and "mercado x" from splitting into two rows.
 */
export function aggregateStoresByMonth(
  records: ReceiptSpendRecord[],
  month: string,
): StoreSpend[] {
  const totalsByStore = new Map<string, { storeName: string; total: number }>();
  for (const receipt of records) {
    if (getMonthKey(receipt.purchase_date) !== month) continue;
    const rawName = receipt.store_name ?? '';
    const displayName = rawName.trim() || 'Sin tienda';
    const key = displayName.toLowerCase();
    const entry = totalsByStore.get(key) ?? { storeName: displayName, total: 0 };
    entry.total += receipt.total ?? 0;
    // First-seen casing wins so the legend reads the original brand
    // spelling rather than whatever casing happens to be last in `records`.
    if (entry.storeName !== displayName && entry.storeName.toLowerCase() !== key) {
      entry.storeName = displayName;
    }
    totalsByStore.set(key, entry);
  }
  return [...totalsByStore.entries()]
    .map(([storeId, { storeName, total }]) => ({ storeId, storeName, total }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.storeName.localeCompare(b.storeName);
    });
}

/**
 * Re-export of the free analytics category aggregator. The donut chart
 * consumes its output shape (`HomeCategory`); routing it through this
 * barrel keeps the chart feature's import surface stable and prevents
 * drift between the donut and the analytics category strip.
 */
export { aggregateCategoriesByMonth };
export type { HomeCategory };

/**
 * Month-over-month spend delta — the "vs. last month" pill on the Pro
 * charts screen. Pure derivation, no React.
 *
 * `previous` is `null` when the previous month has NO receipts at all
 * (not zero — "we have no data for last month" is meaningfully different
 * from "you spent $0 last month", and the UI surfaces that distinction
 * by skipping the delta pill). `current` is always a number (0 is a real
 * "nothing this month" answer). `deltaPct` is `null` when `previous` is
 * null; otherwise `((current - previous) / previous) * 100`.
 *
 * `isImprovement` reflects the user's mental model of "good vs. bad"
 * spend: less spend than last month is good, more is bad. The UI uses
 * it to pick green/red coloring, not to make a value judgement. Receipts
 * with no `total` are treated as 0 (defensive — `ReceiptSpendRecord.total`
 * is optional in the minimal record shape).
 */
export interface MonthlyDelta {
  current: number;
  /** Null when the previous month has no receipts; zero is a valid amount. */
  previous: number | null;
  /** Percentage change vs. the previous month; null when `previous` is null. */
  deltaPct: number | null;
  /** True when `deltaPct < 0` (less spent than the previous month). */
  isImprovement: boolean;
}

export function aggregateMonthlyDelta(
  records: ReceiptSpendRecord[],
  monthKey: string,
): MonthlyDelta {
  let current = 0;
  let previous: number | null = null;
  let previousSeen = false;
  const prevKey = previousMonthKey(monthKey);
  for (const receipt of records) {
    const total = receipt.total ?? 0;
    const key = getMonthKey(receipt.purchase_date);
    if (key === monthKey) {
      current += total;
    } else if (key === prevKey) {
      previous = (previous ?? 0) + total;
      previousSeen = true;
    }
  }
  if (!previousSeen) previous = null;
  const deltaPct =
    previous === null || previous === 0
      ? null
      : ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    deltaPct,
    isImprovement: deltaPct !== null && deltaPct < 0,
  };
}

/**
 * Spanish weekday labels used by the weekly bar chart. The initial is a
 * single letter per day. Deliberate choice: Miércoles uses `M` (matching
 * Martes) per explicit product request — the duplicate is accepted for
 * readability over the traditional disambiguating `X`.
 */
const WEEKDAY_LABELS: readonly { day: string; initial: string }[] = [
  { day: 'Lun', initial: 'L' },
  { day: 'Mar', initial: 'M' },
  { day: 'Mié', initial: 'M' },
  { day: 'Jue', initial: 'J' },
  { day: 'Vie', initial: 'V' },
  { day: 'Sáb', initial: 'S' },
  { day: 'Dom', initial: 'D' },
];

/**
 * ISO date (`YYYY-MM-DD`) for the Monday of the week that contains
 * `isoDate`. Also exported so the day-detail sheet can compute the exact
 * week window the weekly aggregator uses by default.
 */
export function getMondayOfWeek(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

/**
 * Receipt total minus the amounts of any excluded categories (e.g. utility
 * bills, "servicios"), clamped at 0. With an empty exclusion set this is the
 * receipt total itself, so charts that do not exclude keep their exact
 * current output. `category_totals` may omit a slug or a whole receipt —
 * missing entries contribute 0.
 *
 * The clamp matters because `receipt.total` is the FINAL discounted amount
 * while `category_totals` are PRE-discount line sums: a receipt-level
 * discount or a multi-merchant ticket can push the excluded items' share
 * above the total, and a negative "effective total" would render a negative
 * bar (a lie about how much was spent). `Math.max(0, …)` makes those edges
 * render as zero instead.
 */
function effectiveReceiptTotal(
  receipt: ReceiptSpendRecord,
  excluded: ReadonlySet<string>,
): number {
  let excludedAmount = 0;
  for (const slug of excluded) {
    excludedAmount += receipt.category_totals?.[slug] ?? 0;
  }
  return Math.max(0, (receipt.total ?? 0) - excludedAmount);
}

export interface WeeklySpendPoint {
  /** Full weekday label, e.g. "Lun". */
  day: string;
  /** Single-letter weekday initial, e.g. "L". */
  initial: string;
  /** Sum of receipt totals for that day. */
  amount: number;
}

/**
 * Seven-day spend totals starting on `weekStart` (ISO date, defaults to
 * the Monday of the current week). Zero-fills days with no receipts so the
 * weekly bar chart always renders seven bars.
 *
 * The sum uses `receipt.total` (the receipt-level total), matching the
 * granularity shown on the chart. Days are ordered Monday → Sunday to
 * align with the "This week" label in the analytics reference.
 *
 * `excludeCategories` removes those categories' amounts from each receipt
 * before summing (see `effectiveReceiptTotal`) — used to keep utility
 * bills ("servicios") out of the daily bars.
 */
export function aggregateWeeklySpend(
  records: ReceiptSpendRecord[],
  weekStart?: string,
  excludeCategories: string[] = [],
): WeeklySpendPoint[] {
  const start = weekStart ?? getMondayOfWeek(new Date().toISOString().slice(0, 10));
  const excluded = new Set(excludeCategories);
  const totalsByDay = new Map<string, number>();
  for (const receipt of records) {
    const date = receipt.purchase_date.slice(0, 10);
    totalsByDay.set(
      date,
      (totalsByDay.get(date) ?? 0) + effectiveReceiptTotal(receipt, excluded),
    );
  }

  return WEEKDAY_LABELS.map((label, index) => {
    const date = new Date(`${start}T00:00:00`);
    date.setDate(date.getDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      day: label.day,
      initial: label.initial,
      amount: totalsByDay.get(iso) ?? 0,
    };
  });
}

export interface YearlySpendPoint {
  /** Calendar year, e.g. "2026". */
  year: string;
  /** Sum of `receipt.total` for receipts landing in this year (0 when none). */
  total: number;
}

/**
 * Per-calendar-year spend, zero-filled across the last three years (the
 * current year and the two previous ones), ordered oldest → newest.
 * Years with no receipts render as `{ year, total: 0 }` (NOT omitted) so
 * the "Por año" chart keeps a continuous x-axis — a gap would lie about
 * "we had no spending" when the truth is "no data was recorded".
 *
 * The year is derived by slicing the ISO date (`purchase_date.slice(0, 4)`)
 * — no Date parsing, so no timezone shifting at year boundaries. Receipts
 * with no `total` are treated as 0 (defensive, matching the other
 * aggregators).
 */
export function aggregateYearlySpend(
  records: ReceiptSpendRecord[],
): YearlySpendPoint[] {
  const totalsByYear = new Map<string, number>();
  for (const receipt of records) {
    const year = receipt.purchase_date.slice(0, 4);
    totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + (receipt.total ?? 0));
  }
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear].map(String);
  return years.map((year) => ({ year, total: totalsByYear.get(year) ?? 0 }));
}

/**
 * Average spend per calendar day for a given month. Computed as the month
 * total divided by the number of days in that month — "daily average" in
 * the summary cards means "if I spent the same amount every day of the
 * month, this would be the value".
 *
 * `excludeCategories` removes those categories' amounts from each receipt
 * before summing (see `effectiveReceiptTotal`) — used to keep utility
 * bills ("servicios") out of the daily average.
 */
export function aggregateDailyAverage(
  records: ReceiptSpendRecord[],
  monthKey: string,
  excludeCategories: string[] = [],
): number {
  const excluded = new Set(excludeCategories);
  let total = 0;
  for (const receipt of records) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    total += effectiveReceiptTotal(receipt, excluded);
  }
  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return daysInMonth > 0 ? total / daysInMonth : 0;
}

export type DailySpendPoint = {
  /** Day of the month (1..days-in-month). */
  day: number;
  /** Sum of `receipt.total` for receipts landing on that day (0 when none). */
  total: number;
};

/**
 * Per-day spend curve for a single month: one entry for EVERY day of the
 * month (1..days-in-month), zero-filled — days without receipts render as
 * `{ day, total: 0 }` (NOT omitted) so the hero line chart keeps a
 * continuous x-axis. Sums `receipt.total` per `purchase_date` day and
 * INCLUDES servicios: this is the full daily spend picture, and the hero
 * header total (which also includes them) is the sum of these days.
 * Deterministic: the month is an explicit `YYYY-MM` and the loop never
 * depends on record insertion order.
 */
export function aggregateDailySpend(
  records: ReceiptSpendRecord[],
  monthKey: string,
): DailySpendPoint[] {
  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalsByDay = new Map<number, number>();
  for (const receipt of records) {
    if (getMonthKey(receipt.purchase_date) !== monthKey) continue;
    const day = Number(receipt.purchase_date.slice(8, 10));
    totalsByDay.set(day, (totalsByDay.get(day) ?? 0) + (receipt.total ?? 0));
  }
  return Array.from({ length: daysInMonth }, (_, index) => ({
    day: index + 1,
    total: totalsByDay.get(index + 1) ?? 0,
  }));
}

export interface ClampedDailySeries {
  /** Days with totals clamped to `yCap` (oversized days pinned to the plot top). */
  points: DailySpendPoint[];
  /** Upper bound for the hero chart's y-domain; always > 0. */
  yCap: number;
  /** Days whose REAL total exceeds `yCap` (they were clamped; shown in a note). */
  overflowDays: DailySpendPoint[];
}

// Single-letter Spanish initial for each JavaScript weekday index
// (0 = Sunday .. 6 = Saturday). Matches the product decision that
// Miércoles shares `M` with Martes (see WEEKDAY_LABELS).
const WEEKDAY_INITIAL_BY_JS_DAY: readonly string[] = [
  'D', // 0 Sunday
  'L', // 1 Monday
  'M', // 2 Tuesday
  'M', // 3 Wednesday
  'J', // 4 Thursday
  'V', // 5 Friday
  'S', // 6 Saturday
];

/**
 * One weekday initial per day of `monthKey` (1..days-in-month), indexed by
 * calendar position: `result[day - 1]` is the initial under the day number
 * in the hero chart's manual x-axis (e.g. August 2026 starts on Saturday
 * → `['S', 'D', 'L', ...]`). Lets the user correlate the curve's bumps
 * with real calendar days at a glance.
 *
 * Deterministic: built from the explicit `YYYY-MM` month; a malformed key
 * returns an empty array.
 */
export function weekdayInitialsForMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const jsDay = new Date(year, month - 1, index + 1).getDay();
    return WEEKDAY_INITIAL_BY_JS_DAY[jsDay];
  });
}

/**
 * Y-axis cap for the hero daily curve. The y-domain is derived from the
 * SECOND-highest spend day (× 1.2) instead of the max, so a single outlier
 * ticket cannot flatten the rest of the month into an unreadable line at
 * the bottom. Days above the cap are clamped to the top of the plot and
 * returned in `overflowDays` so the caller can call them out — the cap
 * never hides a real spend.
 *
 * Deliberate limit: with two close high days and a long tail (e.g. 1000,
 * 999, then ~50s) the cap matches the runner-up and the tail stays
 * flattened — there is no overflow note because there is no outlier, just
 * a skewed distribution. Proving that case would need a percentile-based
 * cap, which this helper intentionally does not do.
 *
 * Deterministic: pure function of `dailyData`; same input → same output.
 */
export function buildClampedDailySeries(
  dailyData: readonly DailySpendPoint[],
): ClampedDailySeries {
  const totals = dailyData
    .map((point) => point.total)
    .filter((total) => total > 0);
  const maxTotal = totals.length > 0 ? Math.max(...totals) : 0;
  const secondMax =
    totals.length > 1 ? [...totals].sort((a, b) => b - a)[1] : maxTotal;
  const yCap = secondMax * 1.2 || 1;
  return {
    points: dailyData.map((point) => ({
      ...point,
      total: Math.min(point.total, yCap),
    })),
    yCap,
    overflowDays: dailyData.filter((point) => point.total > yCap),
  };
}

export interface DayItemGroup {
  /** Display name of the product (first-seen casing wins). */
  name: string;
  /** Total quantity bought that day across merged rows. */
  quantity: number;
  /** Total amount spent on the product that day. */
  amount: number;
}

/**
 * Line items bought on a single day, merged by trimmed-lowercased name and
 * sorted by amount descending. Powers the day-detail sheet behind the
 * weekly bar chart ("qué compré el lunes"). Only receipts whose
 * `purchase_date` matches `isoDate` contribute; categories listed in
 * `excludeCategories` (e.g. "servicios") never appear.
 *
 * Merging is deliberately lighter than `normalizeItemName` (no accent
 * folding, no unit stripping): the sheet shows raw product names, and the
 * grouping only needs to collapse exact-name duplicates bought the same
 * day. First-seen casing wins for the displayed name.
 */
export function aggregateDayItems(
  records: ReceiptSpendRecord[],
  isoDate: string,
  excludeCategories: string[] = [],
): DayItemGroup[] {
  const excluded = new Set(excludeCategories);
  const byKey = new Map<string, DayItemGroup>();
  for (const receipt of records) {
    if (receipt.purchase_date.slice(0, 10) !== isoDate) continue;
    for (const item of receipt.items ?? []) {
      if (excluded.has(item.category)) continue;
      const key = item.name.trim().toLowerCase();
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += item.quantity ?? 0;
        existing.amount += item.amount;
      } else {
        // First-seen casing wins.
        byKey.set(key, {
          name: item.name,
          quantity: item.quantity ?? 0,
          amount: item.amount,
        });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
  );
}

/**
 * Effective spend for a single day (ISO date): the sum of
 * `effectiveReceiptTotal` across that day's receipts. This is EXACTLY the
 * number the weekly bar chart shows for the same day, so the day-detail
 * sheet can pin the same headline total the bar displayed — even when
 * post-items discounts make `receipt.total` disagree with the item list
 * (the bar and the items live at different grains on purpose). Only
 * receipts whose `purchase_date` matches `isoDate` contribute;
 * categories listed in `excludeCategories` (e.g. "servicios") are removed
 * per receipt, with each receipt clamped at 0.
 */
export function aggregateDayTotal(
  records: ReceiptSpendRecord[],
  isoDate: string,
  excludeCategories: string[] = [],
): number {
  const excluded = new Set(excludeCategories);
  let total = 0;
  for (const receipt of records) {
    if (receipt.purchase_date.slice(0, 10) !== isoDate) continue;
    total += effectiveReceiptTotal(receipt, excluded);
  }
  return total;
}

/**
 * Top spending category for a month, or `null` when the month has no
 * categorized spending. Returns the same `HomeCategory` shape produced by
 * `aggregateCategoriesByMonth` so callers can reuse label/icon/color
 * helpers.
 */
export function getTopCategory(
  records: ReceiptSpendRecord[],
  monthKey: string,
): HomeCategory | null {
  const categories = aggregateCategoriesByMonth(records, monthKey);
  return categories[0] ?? null;
}

/**
 * Index of the highest-spend bucket in a chart series, or `-1` when every
 * value is $0. First maximum wins on ties. Pure and testable — the weekly
 * bar chart uses it to decide which bar gets the rose highlight (the day
 * with the most spend, not today), so the highlight rule can be proven
 * instead of living inline in the component.
 */
export function pickMaxSpendIndex(amounts: readonly number[]): number {
  if (amounts.length === 0) return -1;
  let max = -1;
  let maxIndex = -1;
  for (let i = 0; i < amounts.length; i += 1) {
    if (amounts[i] > max) {
      max = amounts[i];
      maxIndex = i;
    }
  }
  return max > 0 ? maxIndex : -1;
}
