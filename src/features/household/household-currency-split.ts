export interface HouseholdUnitTotal {
  currency?: string | null;
  total: number;
}

export interface HouseholdCurrencySplit {
  /** Net total in the viewer's unit (0 when the month has no viewer spend). */
  viewerTotal: number;
  /** Every other recorded unit, one entry per unit, sorted by total desc. */
  foreignTotals: { currency: string; total: number }[];
}

/**
 * Split the household per-unit totals for the Home card.
 *
 * Product decision (household card): the viewer's currency is the headline
 * figure; any other recorded unit is listed as a secondary note. Amounts of
 * different currencies are NEVER summed or converted (money-integrity spec),
 * and a unit-less row binds to the viewer unit — the same rule as the shared
 * `bindViewerRows` helper.
 */
export function splitHouseholdTotals(
  totals: readonly HouseholdUnitTotal[],
  viewer: string,
): HouseholdCurrencySplit {
  // Accumulate defensively per unit: the grouped RPC returns one row per
  // unit, but a naive "last wins" would silently drop a duplicate row.
  const byUnit = new Map<string, number>();
  for (const row of totals) {
    const unit = row.currency ?? viewer;
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + row.total);
  }

  const viewerTotal = byUnit.get(viewer) ?? 0;
  byUnit.delete(viewer);

  const foreignTotals = [...byUnit.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);

  return { viewerTotal, foreignTotals };
}
