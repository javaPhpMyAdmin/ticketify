import { ZERO_DECIMAL_CURRENCIES } from './format';

/** Trimmed input must be digits and separators only (design: reject anything
 * not `^[0-9.,]+$`). `$45`, `12abc`, `1e3` are all rejected → null. */
const MONEY_SHAPE = /^[0-9.,]+$/;

/**
 * Parse a human-entered money string with a fixed, locale-independent rule
 * (REQ-7, decision 10 — symmetric rule). The result never varies with the UI
 * locale, the region, or `currencyCode`: `currencyCode` is used ONLY to apply
 * zero-decimal rounding for codes in `ZERO_DECIMAL_CURRENCIES`.
 *
 * Rule:
 * - Both `.` and `,` appear → the RIGHTMOST separator is the decimal
 *   separator; every other separator is grouping ("last separator wins").
 * - Exactly one separator type appears: the last separator of that type is a
 *   thousands separator EXACTLY when three digits follow it, otherwise it is
 *   a decimal separator. Symmetric for `.` and `,`.
 *     - `1.234` → three digits follow `.` → grouping → `1234`
 *     - `1,234` → three digits follow `,` → grouping → `1234`
 *     →  two digits follow `.` → decimal → `45.99`
 *     → one digit follows `.`  → decimal → `47.5`
 * - Empty, no-digit, or any char outside `[0-9.,]` → `null`.
 *
 * Accepted trade-off: `45.999` parses as grouping (three digits after the dot)
 * → `45999`. Recorded in the spec, deliberately not guarded.
 */
export function parseMoney(
  input: string,
  currencyCode: string,
): number | null {
  if (input == null) return null;
  const s = input.trim();
  if (s.length === 0) return null;
  if (!MONEY_SHAPE.test(s)) return null;
  if (!/\d/.test(s)) return null;

  const normalized = normalizeSeparators(s);

  const value = parseFloat(normalized);
  if (!Number.isFinite(value)) return null;

  const upperCode = currencyCode ? currencyCode.toUpperCase() : '';
  return ZERO_DECIMAL_CURRENCIES.has(upperCode) ? Math.round(value) : value;
}

/**
 * Collapse the separator-ambiguous string to a plain JS number literal. Only
 * digits survive, plus (at most) one `.` produced by the decimal separator.
 */
function normalizeSeparators(s: string): string {
  const hasDot = s.indexOf('.') >= 0;
  const hasComma = s.indexOf(',') >= 0;

  if (hasDot && hasComma) {
    // Rightmost separator is the decimal point; every other separator is
    // grouping and is dropped.
    const decimalIndex = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch >= '0' && ch <= '9') out += ch;
      else if (i === decimalIndex) out += '.';
    }
    return out;
  }

  if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const lastIndex = s.lastIndexOf(sep);
    const digitsAfter = s.length - 1 - lastIndex;
    // Three digits follow the separator → thousands grouping: drop every
    // separator. Otherwise the last separator is the decimal point and any
    // earlier separators are grouping.
    if (digitsAfter === 3) {
      return s.split(sep).join('');
    }
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch >= '0' && ch <= '9') out += ch;
      else if (i === lastIndex) out += '.';
    }
    return out;
  }

  return s;
}