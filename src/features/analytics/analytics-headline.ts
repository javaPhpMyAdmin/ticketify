/**
 * Pure view-mode-scoped headline decision for the analytics overview card.
 *
 * In household view the "TOTAL GASTADO" headline must be the HOUSEHOLD total
 * from the net-paid, confirmed-only `monthly_purchases_total` RPC — the same
 * base as the personal headline (Σ `purchases.total`, post-discount) under
 * the same query key Home's household card uses, so Personal and Household
 * reconcile to the cent. (Previously the headline summed the gross
 * `monthly_category_totals` rows, which over-counted discounts and leaked
 * non-confirmed purchases.) The change-% badge stays personal-scoped (it
 * reads the personal `monthly_user_totals` cache), so it is dropped in
 * household mode.
 *
 * Since 0044 both totals are GROUPED PER UNIT (decision 9): the headline
 * renders one labeled figure per currency — never a cross-currency sum.
 * `headlineTotals` is null ONLY while the household data has not resolved
 * (loading) or errored — the caller renders a neutral placeholder instead
 * of a false "$0.00" (the body already shows the loading/error state).
 *
 * Deterministic: takes primitives only, so the node harness can pin it
 * without a component tree.
 */

import type { CurrencyTotal } from '@/types';

export type OverviewViewMode = 'personal' | 'household';

export interface OverviewHeadlineInput {
  /**
   * Net final paid for the household month, one entry PER UNIT — Σ
   * `purchases.total` of confirmed receipts via `monthly_purchases_total`
   * (same base as personal; NOT the sum of the gross category rows).
   * Empty array means an empty-but-resolved month: the caller folds it
   * into a single `[{ currency: viewer, total: 0 }]` group so the card
   * still states a real zero instead of a placeholder.
   */
  householdTotals: CurrencyTotal[];
  /** Caller's own per-unit totals for the month (personal mode). */
  overviewTotals: CurrencyTotal[];
  /** Personal month-over-month change % (personal cache); null = no badge. */
  personalChangePct: number | null;
  /** Whether the household queries have resolved (false while loading/errored). */
  hasHouseholdData: boolean;
}

export interface OverviewHeadline {
  /**
   * Per-unit figures to render as "TOTAL GASTADO", one labeled figure per
   * currency; null = show a placeholder (household unresolved).
   */
  headlineTotals: CurrencyTotal[] | null;
  /** Change-% badge value; null = omit the badge entirely. */
  headlineChangePct: number | null;
}

export function buildOverviewHeadline(
  viewMode: OverviewViewMode,
  {
    householdTotals,
    overviewTotals,
    personalChangePct,
    hasHouseholdData,
  }: OverviewHeadlineInput,
): OverviewHeadline {
  if (viewMode !== 'household') {
    // Personal view: the caller's own per-unit totals + personal badge. The
    // caller normalizes an empty month to a single viewer-currency zero, so
    // the card always has at least one figure to render.
    return {
      headlineTotals: overviewTotals,
      headlineChangePct: personalChangePct,
    };
  }

  if (!hasHouseholdData) {
    // Loading or error: never state a false "$0.00" — render a placeholder
    // instead (the body already shows the loading/error state).
    return { headlineTotals: null, headlineChangePct: null };
  }

  // Household data resolved. The finite guard defensively turns a NaN
  // aggregate into 0 so the headline never prints "NaN" (an empty-but-
  // resolved household is a single viewer-currency zero, folded by the
  // caller). Each group keeps its own unit label.
  const safeTotals = householdTotals.map((t) => ({
    currency: t.currency,
    total: Number.isFinite(t.total) ? t.total : 0,
  }));
  return {
    headlineTotals:
      safeTotals.length > 0
        ? safeTotals.map((t) => ({ total: t.total, currency: t.currency }))
        : [{ total: 0 }],
    headlineChangePct: null,
  };
}