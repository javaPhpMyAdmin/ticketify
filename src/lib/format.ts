/**
 * Lightweight, locale-aware formatters. We intentionally avoid
 * `Intl.NumberFormat` for the currency formatter on Hermes because
 * support is inconsistent across versions — a hand-rolled prefix is
 * cheaper and predictable.
 *
 * PR 2 (`app-i18n`): introduces the canonical `formatDate(locale, iso,
 * opts?)` / `formatRelativeDay(locale, iso, todayISO)` API and the
 * LATAM/INTL currency grouping rules. The old `formatCurrency` keeps
 * its behavior intact here (PR 2 work-unit 2.1) — WU-2.2 then rewrites
 * it to use the new hybrid policy where the **currency code is the
 * authority of format** (AD-6).
 */

/** Locales the catalog ships — matches `SUPPORTED_LOCALE_TAGS` in
 *  `src/i18n/config.ts`. Kept here as a small, dependency-free alias
 *  so the formatters don't have to pull i18next into a module that
 *  otherwise has zero imports. */
export type FormatDateLocale = 'en' | 'es-AR' | 'pt-BR';

/** Optional knobs for `formatDate` / `formatRelativeDay`. The
 *  `todayISO` argument is what makes "Hoy" / "Today" / "Hoje" work:
 *  without it the helper falls back to "Yesterday" relative to the
 *  built-in calendar date. */
export interface FormatDateOpts {
  /** Today's date in `YYYY-MM-DD`. Defaults to `todayLocalISO()`. */
  todayISO?: string;
}

// ---------------------------------------------------------------------------
// Currency policy (AD-6) — currency code is the authority of format
// ---------------------------------------------------------------------------

/**
 * LATAM currencies: thousands `.`, decimals `,` (es-AR / pt-BR / es-MX /
 * es-CL / es-CO / es-PE convention). The full ISO 4217 set the app
 * surfaces — anything missing falls back to the INTL grouping.
 */
export const LATAM_CURRENCIES: ReadonlySet<string> = new Set([
  'ARS', // Peso argentino
  'BRL', // Real brasileño
  'CLP', // Peso chileno
  'COP', // Peso colombiano
  'MXN', // Peso mexicano
  'PEN', // Sol peruano
  'UYU', // Peso uruguayo
]);

/**
 * INTL currencies: thousands `,`, decimals `.` (USD / EUR / GBP / JPY /
 * etc.). Anything outside both sets also lands here (the spec rule:
 * unknown code → INTL default).
 */
export const INTL_CURRENCIES: ReadonlySet<string> = new Set([
  'AUD',
  'CAD',
  'EUR',
  'GBP',
  'JPY',
  'USD',
]);

/**
 * Symbol lookup keyed by ISO 4217 code. Unknown codes fall back to the
 * code itself as the symbol (e.g. `XYZ 1,234.56` — same convention the
 * old `formatCurrency` used, kept for backward compatibility with the
 * existing call sites).
 */
export const CURRENCY_SYMBOL: Record<string, string> = {
  ARS: '$',
  AUD: 'A$',
  BRL: 'R$',
  CAD: 'CA$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  MXN: '$',
  UYU: '$U',
  USD: 'US$',
};

// ---------------------------------------------------------------------------
// Month / weekday arrays (es-AR source of truth)
// ---------------------------------------------------------------------------

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
 * English short month names (PR 2 adds the en / pt-BR companion arrays
 * alongside the existing es-AR ones — PR 3 rewrites the
 * `formatDateES`-using call sites to delegate here).
 */
export const MONTHS_SHORT_EN = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** English full month names. */
export const MONTHS_FULL_EN = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Portuguese (pt-BR) short month names. */
export const MONTHS_SHORT_PT_BR = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** Portuguese (pt-BR) full month names. */
export const MONTHS_FULL_PT_BR = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Localized full-month lookup keyed by locale. */
const MONTHS_FULL_BY_LOCALE: Record<FormatDateLocale, readonly string[]> = {
  en: MONTHS_FULL_EN,
  'es-AR': MONTHS_FULL_ES,
  'pt-BR': MONTHS_FULL_PT_BR,
};

/** Localized short-month lookup keyed by locale. */
const MONTHS_SHORT_BY_LOCALE: Record<FormatDateLocale, readonly string[]> = {
  en: MONTHS_SHORT_EN,
  'es-AR': MONTHS_SHORT_ES,
  'pt-BR': MONTHS_SHORT_PT_BR,
};

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

export function formatRelativeDay(
  iso: string,
  now: Date = new Date(),
): string {
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

// ---------------------------------------------------------------------------
// PR 2 canonical API: formatDate(locale, iso, opts?)
// ---------------------------------------------------------------------------

/**
 * Long localized date for the trigger/header, e.g. `07 set 2026` (es-AR)
 * / `07 Sep 2026` (en) / `07 set 2026` (pt-BR) — or a friendlier
 * `Hoy` / `Today` / `Hoje` (and `Ayer` / `Yesterday` / `Ontem`) when the
 * value rounds to the near present.
 *
 * `opts.todayISO` defaults to `todayLocalISO()` when omitted. Pass an
 * explicit value to make the comparison deterministic (tests / previews).
 *
 * The locale argument is the ONLY knob that selects language; the
 * formatter does NOT read `i18next.language` (callers wanting the
 * active UI language can pass `i18next.language as FormatDateLocale`).
 */
export function formatDate(
  locale: FormatDateLocale,
  iso: string,
  opts: FormatDateOpts = {},
): string {
  const todayISO = opts.todayISO ?? todayLocalISO();
  const todayDate = parseLocalDate(todayISO);
  const monthsShort = MONTHS_SHORT_BY_LOCALE[locale];
  // Default for malformed input — calendar.ts historically returned
  // "Elegir fecha" here, but this canonical helper has no such affordance
  // (the picker UI is wired separately). Return the input as-is so the
  // caller can decide.
  const parsed = iso ? parseLocalDate(iso) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return iso;
  if (!todayDate || Number.isNaN(todayDate.getTime())) {
    // Same-day check needs a valid today; fall back to the short
    // `DD MMM YYYY` form.
    return `${pad2(parsed.getDate())} ${monthsShort[parsed.getMonth()]} ${parsed.getFullYear()}`;
  }
  const sameDay =
    parsed.getFullYear() === todayDate.getFullYear() &&
    parsed.getMonth() === todayDate.getMonth() &&
    parsed.getDate() === todayDate.getDate();
  if (sameDay) return RELATIVE_TODAY[locale];
  const yesterday = new Date(todayDate);
  yesterday.setDate(todayDate.getDate() - 1);
  const isYesterday =
    parsed.getFullYear() === yesterday.getFullYear() &&
    parsed.getMonth() === yesterday.getMonth() &&
    parsed.getDate() === yesterday.getDate();
  if (isYesterday) return RELATIVE_YESTERDAY[locale];
  return `${pad2(parsed.getDate())} ${monthsShort[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

/** Locale-keyed "today" label used by `formatDate` and friends. */
const RELATIVE_TODAY: Record<FormatDateLocale, string> = {
  en: 'Today',
  'es-AR': 'Hoy',
  'pt-BR': 'Hoje',
};

/** Locale-keyed "yesterday" label. */
const RELATIVE_YESTERDAY: Record<FormatDateLocale, string> = {
  en: 'Yesterday',
  'es-AR': 'Ayer',
  'pt-BR': 'Ontem',
};

/** Localized full-month name for a 1-based `month` argument. */
export function fullMonthForLocale(
  locale: FormatDateLocale,
  month: number,
): string {
  const months = MONTHS_FULL_BY_LOCALE[locale];
  return months[month - 1] ?? '';
}

/** Localized short-month name for a 1-based `month` argument. */
export function shortMonthForLocale(
  locale: FormatDateLocale,
  month: number,
): string {
  const months = MONTHS_SHORT_BY_LOCALE[locale];
  return months[month - 1] ?? '';
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

/** Pads to ISO-safe 2 digits, e.g. 5 -> '05'. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Currency — PR 2 hybrid policy (AD-6): currency code is the authority of
// format. The function reads `i18next.language` for label/symbol-form
// choices only (currently a no-op — the symbol form is keyed by currency
// code, and the grouping rules live entirely in the LATAM/INTL sets).
// ---------------------------------------------------------------------------

/**
 * Hand-rolled currency formatter (no `Intl.NumberFormat`).
 *
 * Contract:
 *
 *   1. Currency code is the authority of format. `formatCurrency(1234.56,
 *      'ARS')` is LATAM-grouped (`.` thousands + `,` decimals) regardless
 *      of the active UI locale; `formatCurrency(1234.56, 'USD')` is
 *      INTL-grouped (`,` thousands + `.` decimals). Unknown codes fall
 *      back to the INTL default and use the code itself as the symbol
 *      (e.g. `XYZ 1,234.56`).
 *   2. Symbol form is keyed by `CURRENCY_SYMBOL`. UYU renders `$U`,
 *      USD renders `US$`, ARS renders `$`, etc. (Different from the old
 *      `formatCurrency`, which collapsed UYU / ARS / USD to a single
 *      `$` — the AD-6 symbol table disambiguates them.)
 *   3. A space separates the symbol from the number for both grouping
 *      styles (`US$ 1,234.56`, `R$ 1.234,56`). The old format glued them
 *      (`$1,234.50`); the space makes the symbol stand out from the
 *      digits.
 *   4. Negative values are prefixed with `-` BEFORE the symbol
 *      (`-US$ 1,234.56`) — matches the LATAM / INTL norm. The old
 *      format did the same; this preserves the existing call-site
 *      ergonomics.
 *
 * The function intentionally reads `i18next.language` internally so a
 * future round of work (PR 3) can branch on language for things like a
 * localized currency label or a kanji "¥" suffix without changing the
 * signature. Today's implementation does not branch on the language.
 */
export function formatCurrency(value: number, currencyCode: string): string {
  const upperCode = currencyCode.toUpperCase();
  const isLATAM = LATAM_CURRENCIES.has(upperCode);
  const symbol = CURRENCY_SYMBOL[upperCode] ?? currencyCode;
  const fixed = Math.abs(value).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  // Hand-rolled grouping: thousands separator every 3 digits from the
  // right, no leading separator.
  const groupSep = isLATAM ? '.' : ',';
  const decSep = isLATAM ? ',' : '.';
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  // Drop the decimal segment when it would render all zeros (e.g. `0.00`
  // → `0`) — keeps `formatCurrency(0, 'ARS')` as `'$ 0'` rather than
  // `'$ 0,00'`. PR 2 spec table, WU-2.3 zero edge case.
  const hasNonZeroDecimal = decPart && decPart !== '00';
  const number = hasNonZeroDecimal
    ? `${withSeparators}${decSep}${decPart}`
    : withSeparators;
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol} ${number}`;
}

/**
 * Currency without the decimal fraction — "US$ 812.24" renders as
 * "US$ 812". Used by the capsule chart amounts and the day-detail
 * total, where the cents add noise to an already long label (UYU has
 * no cents in practice). Mirrors `formatCurrency`'s grouping policy
 * and symbol form.
 */
export function formatCurrencyWhole(
  value: number,
  currencyCode: string,
): string {
  const upperCode = currencyCode.toUpperCase();
  const isLATAM = LATAM_CURRENCIES.has(upperCode);
  const symbol = CURRENCY_SYMBOL[upperCode] ?? currencyCode;
  const rounded = Math.abs(value).toFixed(0);
  const groupSep = isLATAM ? '.' : ',';
  const withSeparators = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol} ${withSeparators}`;
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