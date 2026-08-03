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

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatRelativeDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';
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
