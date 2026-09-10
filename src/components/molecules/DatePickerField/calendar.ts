/**
 * Pure date-picker calendar logic — no React, no RN, no Supabase.
 *
 * Node-loadable so the harness (`scripts/test-date-picker.mjs`) compiles and
 * imports these functions directly to verify the calendar contract without a
 * device. Operates on plain ISO date strings (YYYY-MM-DD) matching the
 * `purchases.purchase_date` format the RPC stores (`p_purchase_date`); no
 * time component exists for manual entries (REQ-004).
 *
 * PR 2 (`app-i18n`): `formatDateES` is now a one-line wrapper that delegates
 * to the canonical `formatDate('es-AR', iso, { todayISO })` in
 * `src/lib/format.ts`. The signature `(iso, todayISO)` is preserved so every
 * existing call site keeps working unchanged — the public API here is still
 * the ES-AR-pinned helper the DatePickerField trigger uses.
 *
 * PR 2 WU-2.8b: the month/weekday arrays and `formatDateES`/`fullMonthES`
 * are kept as module-level data (test harness still asserts the calendar
 * grid layout) but the DatePickerField component reads the localized
 * month/weekday names via `i18next.t()` at render time. Future PR can
 * delete these constants — they're kept for backwards compatibility with
 * the test harness and the calendar grid header.
 */

import i18next from 'i18next';

import { formatDate } from '@/lib/format';

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

const MONTHS_FULL_ES_AR = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const MONTHS_ABBR_ES_AR = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

const WEEKDAY_SUNDAY_FIRST = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const WEEKDAY_MONDAY_FIRST = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Weekday header labels. `mondayFirst` mirrors the grid alignment. */
export function weekdayLabels(mondayFirst: boolean): string[] {
  return mondayFirst ? WEEKDAY_MONDAY_FIRST : WEEKDAY_SUNDAY_FIRST;
}

/**
 * Long es-AR date for the trigger/header, e.g. `07 set 2026` — or a friendlier
 * `Hoy` / `Ayer` when the value rounds to the near present.
 *
 * PR 2 wrapper pass: delegates to the canonical `formatDate(locale, iso,
 * opts)` helper. The signature `(iso, todayISO)` is preserved on purpose so
 * the one existing call site (`src/app/ticket/manual.tsx:220`) keeps
 * working without churn — WU-2.1 is a wrapper pass, not a signature change.
 * The empty / invalid-input fallback ("Elegir fecha") stays local because
 * the canonical helper has no UI affordance for "no date picked yet" and
 * a malformed input (e.g. 'garbage') historically collapsed to the same
 * placeholder — the manual-receipt harness asserts on that contract.
 */
export function formatDateES(iso: string | null, todayISO: string): string {
  if (!iso) return 'Elegir fecha';
  const parsed = partsFromISO(iso);
  if (!parsed) return 'Elegir fecha';
  return formatDate('es-AR', iso, { todayISO });
}

/** Full month name used in the picker header, e.g. `septiembre`. */
export function fullMonthES(month: number): string {
  return MONTHS_FULL_ES_AR[month] ?? '';
}