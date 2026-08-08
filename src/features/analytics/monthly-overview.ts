import {
  getMonthKey,
  previousMonthKey,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';

export interface MonthOverview {
  /** Total gastado en el mes consultado. */
  currentTotal: number;
  /** Total gastado el mes anterior. */
  previousTotal: number;
  /** Cambio % con signo; null cuando no hay base para comparar. */
  changePct: number | null;
}

/**
 * Pure month-over-month comparison (data-access spec). Sums each receipt's
 * `total` into its month bucket and compares the target month against the
 * previous one. `changePct` is null when the previous month has no spend —
 * the caller renders no badge instead of a division-by-zero artifact.
 * Deterministic: the month is an explicit `YYYY-MM`, so tests can fix
 * fixtures without depending on "today".
 */
export function computeMonthOverview(
  records: ReceiptSpendRecord[],
  monthKey: string,
): MonthOverview {
  const previousKey = previousMonthKey(monthKey);
  const sumMonth = (key: string) =>
    records
      .filter((r) => getMonthKey(r.purchase_date) === key)
      .reduce((acc, r) => acc + (r.total ?? 0), 0);

  const currentTotal = sumMonth(monthKey);
  const previousTotal = sumMonth(previousKey);
  const changePct =
    previousTotal > 0
      ? Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10
      : null;

  return { currentTotal, previousTotal, changePct };
}
