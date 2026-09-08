import { previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import type { MonthlyTotalsCacheRow } from '@/types';

/**
 * Minimum number of days with a non-zero daily total required to render a
 * run-rate (REQ-5b). Days 1-2 of a month produce a degenerate % and
 * projection, so the card stays hidden until the third spend day.
 */
const MIN_SPEND_DAYS = 3;

export interface RunRateResult {
  /** Raw sum of the current-month daily totals on or before `referenceDate`. */
  mtd: number;
  /**
   * Raw baseline the delta is computed against — either the previous
   * month's same-calendar-day window or the prorated historical mean.
   * Always > 0 when a result is produced (a zero/negative baseline has no
   * meaningful percentage and nullifies the result).
   */
  baseline: number;
  /**
   * Signed percent vs. the baseline, rounded to 1 decimal via
   * `Math.round(x*1000)/10` (AD-5). `-0` is normalized to `0` (AD-7) so
   * the card never renders "−0%".
   */
  deltaPct: number;
  /** Raw `mtd / dayOfMonth × daysInMonth`; formatted at display time. */
  projection: number;
  /** Which baseline produced the delta: MoM window or historical mean. */
  source: 'mom' | 'fallback';
}

/**
 * Pure month-to-date run-rate aggregation over the personal
 * `monthly_user_totals` cache rows (spec `monthly-run-rate`, design AD-1..AD-7).
 *
 * Answers "am I on track this month?": MTD spend, a signed % vs. the
 * previous month's same-calendar-day window (falling back to a prorated
 * mean of the up to 3 preceding completed months when that window is
 * unavailable), and a linear end-of-month projection.
 *
 * Deterministic: no clock. `referenceDate` is the explicit device-local
 * `YYYY-MM-DD` (produced by `todayLocalISO`, format.ts) — tests fix
 * fixtures without depending on "today".
 *
 * Returns `null` when any visibility gate fails — the caller MUST render
 * nothing in that case (REQ-5): current-month row missing, fewer than
 * `MIN_SPEND_DAYS` spend days, no MoM window AND no preceding rows, or a
 * baseline that adds up to zero (no division by zero, no fabricated delta).
 */
export function aggregateRunRate(
  rows: MonthlyTotalsCacheRow[],
  referenceDate: string,
): RunRateResult | null {
  const currentKey = referenceDate.slice(0, 7);
  const dayOfMonth = Number(referenceDate.slice(8, 10));

  // Gate 1 (REQ-6): nothing renders until the current-month row exists.
  const current = rows.find((row) => row.year_month === currentKey);
  if (!current) return null;

  // Gates 2-3 (REQ-5b, REQ-1): spend days = current-month daily totals on
  // or before `referenceDate` with a non-zero value. ISO `YYYY-MM-DD` keys
  // compare lexicographically, which equals chronological order: future
  // days are clamped by `key <= referenceDate` and stray foreign-month keys
  // are dropped by the prefix check. MTD is the sum of exactly those
  // entries; an empty `daily_totals` would yield MTD 0, but the < 3 gate
  // already hides it.
  const spendEntries = Object.entries(current.daily_totals).filter(
    ([dayKey, value]) =>
      dayKey.startsWith(currentKey) && dayKey <= referenceDate && value > 0,
  );
  if (spendEntries.length < MIN_SPEND_DAYS) return null;
  const mtd = spendEntries.reduce((sum, [, value]) => sum + value, 0);

  // Gate 4 (REQ-2): primary baseline = previous month's daily totals for
  // days 1..N (N = today's day-of-month). `previousMonthKey` is
  // December-safe string math (useHomeFeed.ts), so January compares against
  // December of the prior year. Day-vs-day comparison means February vs.
  // 31-day months never borrow days from the previous month's tail. A
  // missing previous row or an empty window (no spend days 1..N) makes the
  // baseline unavailable and drops to the fallback (REQ-2 scenario 2).
  const previousKey = previousMonthKey(currentKey);
  const previousRow = rows.find((row) => row.year_month === previousKey);
  const momWindow = previousRow
    ? Object.entries(previousRow.daily_totals)
        .filter(
          ([dayKey, value]) =>
            dayKey.startsWith(previousKey) &&
            Number(dayKey.slice(8, 10)) <= dayOfMonth,
        )
        .reduce((sum, [, value]) => sum + value, 0)
    : 0;
  // The result contract requires baseline > 0, so a negative window (not
  // producible by real spend data) also falls through to the fallback path
  // instead of producing a meaningless signed delta.
  if (previousRow && momWindow > 0) {
    // Gate 6 (AD-5/AD-7): rounded to 1 decimal, -0 normalized; projection
    // via the current month's own day count.
    let deltaPct = Math.round(((mtd - momWindow) / momWindow) * 1000) / 10;
    if (deltaPct === 0) deltaPct = 0;
    const daysInMonth = new Date(
      Number(currentKey.slice(0, 4)),
      Number(currentKey.slice(5, 7)),
      0,
    ).getDate();
    return {
      mtd,
      baseline: momWindow,
      deltaPct,
      projection: (mtd / dayOfMonth) * daysInMonth,
      source: 'mom',
    };
  }

  // Gate 5 (REQ-3, AD-1): fallback baseline = mean of the up to 3 most
  // recent completed-month rows (`year_month < currentKey`), prorated by
  // the fraction of the current month elapsed: mean × dayOfMonth /
  // daysInMonth. Zero-total months count as real data (a genuinely empty
  // month pulls the mean down). `daysInMonth` derives from the current
  // month via the 1-based month index with day 0 — `new Date(2026, 9, 0)`
  // is 30 (Sep), `new Date(2026, 2, 0)` is 28 (Feb), and December rolls to
  // `new Date(2026, 12, 0)` = 31.
  const prior = rows
    .filter((row) => row.year_month < currentKey)
    .sort((a, b) => (a.year_month < b.year_month ? 1 : -1))
    .slice(0, 3);
  if (prior.length === 0) return null;
  const mean = prior.reduce((sum, row) => sum + row.total, 0) / prior.length;
  const daysInMonth = new Date(
    Number(currentKey.slice(0, 4)),
    Number(currentKey.slice(5, 7)),
    0,
  ).getDate();
  const baseline = (mean * dayOfMonth) / daysInMonth;
  // A zero/negative baseline makes the delta undefined — hide (no div-by-zero).
  if (baseline <= 0) return null;

  let deltaPct = Math.round(((mtd - baseline) / baseline) * 1000) / 10;
  if (deltaPct === 0) deltaPct = 0;

  return {
    mtd,
    baseline,
    deltaPct,
    projection: (mtd / dayOfMonth) * daysInMonth,
    source: 'fallback',
  };
}