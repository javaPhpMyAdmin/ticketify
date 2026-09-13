/**
 * Pure date-picker calendar logic — no React, no RN, no Supabase.
 *
 * Node-loadable so the harness (`scripts/test-date-picker.mjs`) compiles and
 * imports these functions directly to verify the calendar contract without a
 * device. Operates on plain ISO date strings (YYYY-MM-DD) matching the
 * `purchases.purchase_date` format the RPC stores (`p_purchase_date`); no
 * time component exists for manual entries (REQ-004).
 *
 * PR 2 (`app-i18n`): `formatDateES` was a one-line wrapper around the
 * canonical `formatDate('es-AR', iso, { todayISO })` in
 * `src/lib/format.ts`. PR 3 deletes the wrapper: every call site reads
 * `formatDate('es-AR', iso, { todayISO })` directly. The "Elegir fecha"
 * placeholder for empty / malformed inputs is a UI affordance that lives
 * in the screen (`src/app/ticket/manual.tsx`) where it belongs.
 *
 * PR 3 (`app-i18n`): month and weekday names now read from the locale-
 * aware `date` namespace via `i18next.t()` (single source of truth per
 * AD-12). The static `MONTHS_*_ES_AR` / `WEEKDAY_*` arrays are GONE —
 * any other reader (calendar component, manual-form harness) reads
 * through `i18next.t('date.monthFull.<n>')`. `fullMonthES` stays as a
 * thin wrapper so the existing test harness (`scripts/test-manual-screen.mjs`)
 * keeps a stable surface; new code should prefer the typed
 * `fullMonthForLocale` helper in `src/lib/format.ts`.
 */

import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Calendar math (local calendar time)
// ---------------------------------------------------------------------------

/** Days of each month indexed by month (0-based). February varies by leap. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export type MaybeDate = { year: number; month: number; day: number } | null;

/** Pads to ISO-safe 2 digits, e.g. 5 -> '05'. */
export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Builds the full ISO string for a local calendar date. Null input (an
 * incomplete/empty selection) yields null — the picker blocks submit until
 * a full date is chosen.
 */
export function isoFromParts(parts: {
  year: number | null;
  month: number | null;
  day: number | null;
}): string | null {
  if (parts.year == null || parts.month == null || parts.day == null) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Parses an ISO date (YYYY-MM-DD) into parts, or null if malformed/incomplete. */
export function partsFromISO(iso: string | null | undefined): MaybeDate {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month - 1)) return null;
  return { year, month, day };
}

/**
 * The calendar grid for a month: each entry is a numeric day or null for the
 * leading/trailing blanks that align the weekday columns.
 *
 * `mondayFirst` aligns weeks starting Monday (es-AR convention —
 * `L M M J V S D`), which is the header `weekdayLabels` renders.
 */
export function monthGrid(year: number, month: number, mondayFirst: boolean) {
  const first = new Date(year, month, 1).getDay(); // 0 = Sunday
  const lead = mondayFirst ? (first + 6) % 7 : first;
  const total = daysInMonth(year, month);
  const blanks: (number | null)[] = Array.from({ length: lead }, () => null);
  const days: (number | null)[] = Array.from({ length: total }, (_, i) => i + 1);
  return blanks.concat(days);
}

/**
 * 0-based month seed for the picker's internal state, derived from an ISO
 * date. `partsFromISO` returns a 1-based month (September = 9); the
 * component state is 0-based (matches `monthGrid` / `Date#getMonth`), so
 * this subtracts 1 — the single source of that conversion.
 *
 * Fallback chain: parse `iso` → parse `fallbackISO` (the caller passes
 * today) → `new Date().getMonth()` as the last resort. Because
 * `partsFromISO` validates month ∈ 1..12, the `- 1` is always safe.
 */
export function seedMonthFromISO(
  iso: string | null | undefined,
  fallbackISO: string | null | undefined,
): number {
  const parts = partsFromISO(iso) ?? partsFromISO(fallbackISO);
  if (parts) return parts.month - 1;
  return new Date().getMonth();
}

// ---------------------------------------------------------------------------
// Range guards (REQ-004: future dates blocked)
// ---------------------------------------------------------------------------

/** True when `value` is in the future relative to `today` (calendar date, local). */
export function isFutureISO(value: string, todayISO: string): boolean {
  return value > todayISO; // ISO strings compare lexicographically = chronologically
}

/**
 * True when a (year, month, day) selection is itself in the future. A null
 * target (blank day) is never "future" — it just isn't complete.
 */
export function isFutureSelection(
  parts: { year: number | null; month: number | null; day: number | null },
  todayISO: string,
): boolean {
  const iso = isoFromParts(parts);
  if (iso === null) return false;
  return isFutureISO(iso, todayISO);
}

// ---------------------------------------------------------------------------
// es-AR display formatting
// ---------------------------------------------------------------------------

/**
 * Weekday header labels. Reads the locale-aware `date` namespace via
 * `i18next.t()` — the single source of truth (per AD-12) shared with
 * the calendar grid and any future widget. Falls back to the empty
 * string per index when i18next is not yet initialized (mirrors the
 * `formatDate` fallback contract for early-render pre-i18n states).
 *
 * `mondayFirst` picks the `weekdayMonFirst` (es-AR convention) or
 * `weekdaySunFirst` cluster — the header matches the grid alignment.
 */
export function weekdayLabels(mondayFirst: boolean): string[] {
  if (!i18next.isInitialized) return ['', '', '', '', '', '', ''];
  const key = mondayFirst ? 'date:weekdayMonFirst' : 'date:weekdaySunFirst';
  const labels: Record<string, string> = i18next.t(key, { returnObjects: true }) as Record<string, string>;
  // Index keys are JSON-stringified ints ("0".."6"). Map into a dense
  // string[] so the calendar header renders in order.
  return [0, 1, 2, 3, 4, 5, 6].map((i) => labels[String(i)] ?? '');
}

/**
 * Long es-AR date for the trigger/header, e.g. `07 set 2026` — or a friendlier
 * `Hoy` / `Ayer` when the value rounds to the near present.
 *
 * PR 3: REMOVED. The PR 2 wrapper around `formatDate('es-AR', ...)` is
 * gone — call sites now read `formatDate('es-AR', iso, { todayISO })`
 * directly from `@/lib/format`. The "Elegir fecha" UI affordance for an
 * empty / malformed input lives in `src/app/ticket/manual.tsx` where it
 * belongs.
 */

/**
 * Full month name used in the picker header, e.g. `septiembre`.
 *
 * PR 3 (`app-i18n`): reads from the locale-aware `date` namespace via
 * `i18next.t()` — same source the calendar grid header uses. Kept here
 * as a thin wrapper because the test harness
 * (`scripts/test-manual-screen.mjs`) imports it; new code should prefer
 * the typed `fullMonthForLocale` in `src/lib/format.ts`.
 *
 * `month` is 0-based (matching `Date#getMonth()`); the underlying
 * `date.monthFull.<n>` keys use JSON-stringified ints, so the lookup
 * resolves the right leaf.
 */
export function fullMonthES(month: number): string {
  if (!i18next.isInitialized) return '';
  return i18next.t(`date:monthFull.${month}` as 'date:monthFull.0');
}