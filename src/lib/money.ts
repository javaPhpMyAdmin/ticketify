/**
 * Money-integrity helpers shared across features.
 *
 * Dependency-free by design: both the free analytics (`features/home`) and
 * the Pro charts (`features/charts`) bind single-series figures to the
 * viewer unit, and neither feature may pull the other's module graph just
 * for this filter.
 */

/**
 * Single-series binding (decision 9 / pass-3 §3): keep only the rows that
 * belong to the VIEWER's unit. A row with no recorded unit falls back to the
 * viewer (REQ-8 s4 — a legacy/untagged row and the viewer's own currency are
 * equivalent); cache rows always carry a unit (PK), so for them the
 * comparison is exact.
 *
 * Single-series surfaces — the spend trend, the weekly/daily bars, the store
 * bars, the day-detail sheet, the donut and the top category — render exactly
 * ONE figure: they consume this filtered list and NEVER split into per-currency
 * series nor hide when the month is mixed. Grouped surfaces keep the full list.
 *
 * Client-Side Read Contract s4: accepted under-report, never re-denominated —
 * on a switch month only the viewer-unit rows count, and spend recorded in
 * another unit before/after the switch is NOT re-denominated, so a
 * single-series figure mildly under-reports the month. Re-denominating would
 * fabricate a rate.
 */
export function bindViewerRows<T extends { currency?: string | null }>(
  rows: T[],
  viewer: string,
): T[] {
  return rows.filter((row) => (row.currency ?? viewer) === viewer);
}
