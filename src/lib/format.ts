/**
 * Lightweight, locale-aware formatters. We intentionally avoid
 * `Intl.NumberFormat` for the currency formatter on Hermes because
 * support is inconsistent across versions — a hand-rolled prefix is
 * cheaper and predictable.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  ARS: '$',
  GBP: '£',
  BRL: 'R$',
  MXN: 'MX$',
  UYU: '$',
};

export function formatCurrency(
  value: number,
  currency: string = 'UYU',
): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const fixed = Math.abs(value).toFixed(2);
  // Add thousands separator to the integer part only.
  const [intPart, decPart] = fixed.split('.');
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${symbol}${withSeparators}.${decPart}`;
}

/**
 * Currency without the decimal fraction — "$812.24" renders as "$812".
 * Used by the capsule chart amounts and the day-detail total, where the
 * cents add noise to an already long label (UYU has no cents in practice).
 */
export function formatCurrencyWhole(
  value: number,
  currency: string = 'UYU',
): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const rounded = Math.abs(value).toFixed(0);
  const withSeparators = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${symbol}${withSeparators}`;
}

/** Spanish short month names (lowercase, the standard for `es`). */
export const MONTHS_SHORT_ES = [
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

/** Spanish full month names (lowercase, the standard for `es`). */
export const MONTHS_FULL_ES = [
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

/**
 * Parses a date string in LOCAL calendar time. `new Date('YYYY-MM-DD')`
 * parses as UTC midnight, which shifts a day backward in UTC-x zones —
 * under TZ=America/Montevideo (UTC-3) '2026-08-01' would render "31 jul"
 * and today "5 ago". Date-only strings are split and built as a local
 * date; anything with a time component falls back to normal ISO parsing.
 */
function parseLocalDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(iso);
}

/** Formats an ISO date as `d MMM` in Spanish — day-first, e.g. `12 ago`. */
export function formatShortDate(iso: string): string {
  const date = parseLocalDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getDate()} ${
    MONTHS_SHORT_ES[date.getMonth()].charAt(0).toUpperCase() +
    MONTHS_SHORT_ES[date.getMonth()].slice(1)
  }. `;
}

/**
 * Formats a `YYYY-MM` year-month (as produced by `utcYearMonth`) for display,
 * e.g. `2026-08` → `ago 2026` (short, default) or `agosto 2026` (full).
 * `capitalize` uppercases the first letter for heading positions (e.g.
 * `Agosto 2026`). Malformed input is returned unchanged.
 */
export function formatYearMonth(
  yearMonth: string,
  options: { full?: boolean; capitalize?: boolean } = {},
): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return yearMonth;
  }
  const names = options.full ? MONTHS_FULL_ES : MONTHS_SHORT_ES;
  const label = `${names[month - 1]} ${year}`;
  return options.capitalize
    ? label.charAt(0).toUpperCase() + label.slice(1)
    : label;
}

/**
 * Renders a 0-100 percent share as a compact Spanish label, keeping a
 * significant digit for tiny slices so a small category never reads as a
 * misleading "0%": "0%" (zero), "<0.1%" (sub-tenth), "0.2%" (exact one
 * decimal below 1%), "12%" (integer otherwise). Callers append the
 * " del gasto" phrase where it belongs (budget cards/rows); the analytics
 * breakdown renders the token as-is.
 */
export function formatPercentLabel(value: number): string {
  if (value <= 0) return '0%';
  if (value < 0.1) return '<0.1%';
  if (value < 1) return `${value.toFixed(1)}%`;
  return `${value.toFixed(0)}%`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hour12 = date.getHours() % 12 || 12;
  const meridiem = date.getHours() < 12 ? 'a. m.' : 'p. m.';
  return `${String(hour12).padStart(2, '0')}:${minutes} ${meridiem}`;
}

export function formatRelativeDay(iso: string, now: Date = new Date()): string {
  const date = parseLocalDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return 'Hoy';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Ayer';
  return formatShortDate(iso);
}

/**
 * `YYYY-MM-DD` for today in local calendar time. A UTC slice
 * (`new Date().toISOString().slice(0, 10)`) drifts a day for late-evening
 * timestamps in UTC-x zones (in UTC-3, from ~21:00 a "today" stamp lands on
 * the NEXT day), which would push a saved receipt into the next month and
 * out of Home's current-month view. Today's own date in local calendar time.
 */
export function todayLocalISO(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Display label for a 4-digit year string. Returns as-is — keeps format
 * logic centralized in case future i18n needs prefixing or ordinal form.
 */
export function yearLabel(year: string): string {
  return year;
}

/**
 * Rough UUID generator. We use this for local-only ids (e.g. the
 * `temp_id` on `ReviewItem` rows). Don't use for anything that
 * will hit the database.
 */
export function tempId(): string {
  // crypto.getRandomValues is available on Hermes >= 0.71 and on web.
  const random = (length: number) =>
    Array.from({ length }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  return `${random(8)}-${random(4)}-${random(4)}-${random(4)}-${random(12)}`;
}
