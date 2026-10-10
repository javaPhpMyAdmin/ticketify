/**
 * Pure breakdown helpers for the Home "Antojos / Snacks" modal
 * (`SnacksBreakdownModal`). Grouping is self-contained; the single grand total
 * reuses the shared `bindViewerRows` predicate (`@/lib/money`) so the
 * single-series viewer-unit binding is defined in exactly one place.
 *
 * Money-integrity invariant (issue #166): amounts recorded in different units
 * are NEVER summed. The `monthly_impulse_items` RPC (0045) already subtotals
 * per (normalized name, recorded unit); these helpers group defensively per
 * (name, unit), render each unit's figure with ITS unit, and — where a single
 * grand total is shown — reduce ONLY the viewer-currency rows (a legacy
 * unit-less row folds into the viewer unit). The under-report on a month that
 * spans units is an accepted product limitation, not a defect: re-denominating
 * a foreign amount under the viewer label is forbidden.
 */
import { bindViewerRows } from '@/lib/money';

/** One row as returned by the `monthly_impulse_items` RPC. */
export interface ImpulseItem {
  name: string;
  amount: number;
  /**
   * The row's recorded unit after the 0045 coalesce. `null` is the defensive
   * fallback for pre-0045 legacy rows (0019 had no currency column at all).
   */
  currency: string | null;
}

/** A breakdown row: a normalized name aggregated within ONE resolved unit. */
export interface ImpulseItemRow {
  name: string;
  amount: number;
  /** Resolved unit — never null (a unit-less row folds into the viewer unit). */
  currency: string;
}

/** Resolve a row's effective unit: the row's own, else the viewer's. */
function effectiveUnit(row: ImpulseItem, viewer: string): string {
  return row.currency ?? viewer;
}

/**
 * Group rows per `(name, unit)`: the same product bought in two units stays
 * TWO rows, each carrying its own unit — it is never folded into one figure.
 * A row with no recorded unit folds into the viewer unit (0045 recorder
 * fallback semantics, REQ-8 s4). Sorted by amount desc, then name, so the
 * largest moments surface first and the order is deterministic.
 */
export function groupImpulseItemsByUnit(
  rows: readonly ImpulseItem[],
  viewer: string,
): ImpulseItemRow[] {
  const byKey = new Map<string, ImpulseItemRow>();
  for (const row of rows) {
    const unit = effectiveUnit(row, viewer);
    const key = `${row.name}\u0000${unit}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += row.amount;
    } else {
      byKey.set(key, { name: row.name, amount: row.amount, currency: unit });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
  );
}

/**
 * Single grand total under ONE (viewer) label: reduce ONLY the viewer-currency
 * rows via the shared `bindViewerRows` predicate (`@/lib/money`) — the same
 * `(row.currency ?? viewer) === viewer` rule the other single-series surfaces
 * use. Rows recorded in another unit are NOT re-denominated under the viewer
 * label (accepted under-report, Client-Side Read Contract s4) and a legacy
 * unit-less row counts as the viewer's. When a month spans units the total is
 * therefore intentionally smaller than the sum of the visible rows.
 */
export function viewerImpulseTotal(
  rows: readonly ImpulseItem[],
  viewer: string,
): number {
  return bindViewerRows([...rows], viewer).reduce(
    (sum, row) => sum + row.amount,
    0,
  );
}
