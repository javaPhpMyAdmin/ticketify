/**
 * Pure view-mode-scoped headline decision for the analytics overview card.
 *
 * In household view the "TOTAL GASTADO" headline must be the HOUSEHOLD total
 * (sum of the `monthly_category_totals` RPC rows), not the caller's personal
 * receipt sum — a personal figure sitting above the household category list
 * would contradict it. The change-% badge stays personal-scoped (it reads the
 * personal `monthly_user_totals` cache), so it is dropped in household mode.
 *
 * Deterministic: takes primitives only, so the node harness can pin it
 * without a component tree.
 */

export type OverviewViewMode = 'personal' | 'household';

export interface OverviewHeadlineInput {
  /** Sum of the household category totals (household RPC mode). */
  householdMonthTotal: number;
  /** Sum of the caller's own receipts for the month (personal mode). */
  overviewTotal: number;
  /** Personal month-over-month change % (personal cache); null = no badge. */
  personalChangePct: number | null;
}

export interface OverviewHeadline {
  /** Number to render as "TOTAL GASTADO". */
  headlineTotal: number;
  /** Change-% badge value; null = omit the badge entirely. */
  headlineChangePct: number | null;
}

export function buildOverviewHeadline(
  viewMode: OverviewViewMode,
  {
    householdMonthTotal,
    overviewTotal,
    personalChangePct,
  }: OverviewHeadlineInput,
): OverviewHeadline {
  if (viewMode !== 'household') {
    // Personal view: the caller's own receipts + personal change badge.
    return { headlineTotal: overviewTotal, headlineChangePct: personalChangePct };
  }
  // Household view: the headline is the real household total; the personal
  // change badge is dropped (it would mix scopes).
  return { headlineTotal: householdMonthTotal, headlineChangePct: null };
}