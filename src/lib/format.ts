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
};

export function formatCurrency(value: number, currency: string = 'USD'): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const fixed = Math.abs(value).toFixed(2);
  // Add thousands separator to the integer part only.
  const [intPart, decPart] = fixed.split('.');
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${symbol}${withSeparators}.${decPart}`;
}

/** Spanish short month names (lowercase, the standard for `es`). */
const MONTHS_SHORT_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** Spanish full month names (lowercase, the standard for `es`). */
export const MONTHS_FULL_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Formats an ISO date as `d MMM` in Spanish — day-first, e.g. `12 ago`. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getDate()} ${MONTHS_SHORT_ES[date.getMonth()]}`;
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
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return yearMonth;
  }
  const names = options.full ? MONTHS_FULL_ES : MONTHS_SHORT_ES;
  const label = `${names[month - 1]} ${year}`;
  return options.capitalize
    ? label.charAt(0).toUpperCase() + label.slice(1)
    : label;
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
  const date = new Date(iso);
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
