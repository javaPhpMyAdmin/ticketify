/**
 * Pure view-mode-scoped headline decision for the analytics overview card.
 *
 * In household view the "TOTAL GASTADO" headline must be the HOUSEHOLD total
 * (sum of the `monthly_category_totals` RPC rows), not the caller's personal
 * receipt sum — a personal figure sitting above the household category list
 * would contradict it. The change-% badge stays personal-scoped (it reads the
 * personal `monthly_user_totals` cache), so it is dropped in household mode.
 *
 * When household data has NOT resolved (still loading) or errored, the
 * headline must never state a false "$0.00" — that would assert no household
 * spend when we simply don't know yet. In that case this returns
 * `headlineTotal: null`, which the caller renders as a neutral placeholder
 * (the body already shows the loading/error state).
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
  /** Whether the household RPC has resolved (false while loading/errored). */
  hasHouseholdData: boolean;
}

export interface OverviewHeadline {
  /** Number to render as "TOTAL GASTADO"; null = show a placeholder. */
  headlineTotal: number | null;
  /** Change-% badge value; null = omit the badge entirely. */
  headlineChangePct: number | null;
}

export function buildOverviewHeadline(
  viewMode: OverviewViewMode,
  {
    householdMonthTotal,
    overviewTotal,
    personalChangePct,
    hasHouseholdData,
  }: OverviewHeadlineInput,
): OverviewHeadline {
  if (viewMode !== 'household') {
    // Personal view: the caller's own receipts + personal change badge.
    return { headlineTotal: overviewTotal, headlineChangePct: personalChangePct };
  }

  if (!hasHouseholdData) {
    // Loading or error: never state a false "$0.00" — render a placeholder
    // instead (the body already shows the loading/error state).
    return { headlineTotal: null, headlineChangePct: null };
  }

  // Household data resolved: the headline is the real household total. The
  // finite guard defensively turns a NaN aggregate into a numeric 0 so the
  // headline never prints "NaN" (an empty-but-resolved household is 0).
  const safeTotal = Number.isFinite(householdMonthTotal) ? householdMonthTotal : 0;
  return { headlineTotal: safeTotal, headlineChangePct: null };
}