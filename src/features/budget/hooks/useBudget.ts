import { useQuery } from '@tanstack/react-query';

import {
  fetchMonthlyBudget,
  type MonthlyBudget,
} from '../api';
import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { bindViewerRows } from '@/lib/money';
import { queryKeys } from '@/lib/query-keys';
import { readMonthlyPurchasesTotal } from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';

/**
 * Returns the user's monthly budget plus the amount spent so far (data-access
 * spec) through TanStack Query (server-state-caching spec). Both reads are
 * authenticated-only and disabled until a signed-in user exists. The budget
 * comes from the profile row's `monthly_budget`.
 *
 * Spent-failure contract: the "spent" amount is a SECOND read
 * (`spentQuery`) — the `monthly_purchases_total` RPC, the SUM of
 * `purchases.total` (what the user was actually charged, AFTER
 * payment-method discounts like "Desc. de ley 19210"). When `error` is
 * non-null, `spent === 0` is a FAILURE FALLBACK, never real spend: the
 * progress UI cannot render null, so the 0 exists only as a stand-in while
 * the spent read loads or fails. No number is ever fabricated — a progress
 * bar showing 0% with `error` set means "unknown", not "spent nothing".
 *
 * Cache contract: `spentQuery` uses its OWN key
 * (`queryKeys.monthlyPurchasesTotal`), separate from the analytics
 * `monthlyTotals` rows key — the cache must never mix the category-rows
 * shape with the single-total shape under one key.
 */
/**
 * One currency's recorded total for a month, each denomination kept on its
 * own line — `unitTotals` below is NEVER folded into a single number.
 */
export interface BudgetUnitTotal {
  currency: string;
  total: number;
}

export interface BudgetSnapshot {
  budget: MonthlyBudget;
  spent: number;
  /**
   * 0..1, or `null` when no honest percentage exists — specifically when the
   * viewer currency has no receipts but other units do (issue #214). The
   * single source of truth for the card: it must never recompute a ratio.
   */
  percent: number | null;
  /**
   * The month's per-unit totals (one entry per recorded currency), never
   * summed across units, sorted highest-first for determinism. Empty when the
   * month has no receipts at all.
   */
  unitTotals: BudgetUnitTotal[];
  /**
   * True when the viewer currency has NO receipts this month but OTHER units
   * do. In that state the card must show the real totals under their own
   * symbols and render NO percentage or progress bar — a confident `0 / 0%`
   * under the viewer symbol is the false claim issue #214 is about.
   */
  currencyMismatch: boolean;
  /** User-safe message when the authenticated read fails or the profile is missing. */
  error: string | null;
  /** True while either read is in flight with no data yet (initial fetch). */
  isLoading: boolean;
  /**
   * True once the budget read succeeded (a real limit exists), even if a
   * background refetch later fails. Screens render the budget error state
   * only when `error && !hasData` — a "Límite: $0" card must never stand
   * in for a failed budget read.
   */
  hasData: boolean;
  /** True while a background refetch is in flight (data is stale but valid). */
  isRefetching: boolean;
}

/** Neutral fallback while an authenticated read loads or fails — never fabricated. */
const NEUTRAL_BUDGET: MonthlyBudget = { amount: 0, currency: 'USD' };

/**
 * The selected month the `spent` read is scoped to. Defaults to the local
 * current month (the same value the analytics screen passes to
 * `useMonthlyTotals`), so both surfaces agree on which month is "now". The
 * budget LIMIT stays global (one `monthly_budget` profile value); only
 * `spent` is per-month.
 */
export function useBudget(monthKey: string = currentMonthKey()): BudgetSnapshot {
  const { userId } = useSessionUser();

  const budgetQuery = useQuery({
    queryKey: queryKeys.budget(userId!),
    enabled: !!userId,
    queryFn: () => fetchMonthlyBudget(userId!).then(toQueryData),
  });

  // Resolve the budget (and its unit) BEFORE the spent query: `spent` binds to
  // the VIEWER-currency group only — a budget is expressed in one unit, so a
  // mixed-currency month must never be summed into it (R1). Falls back to the
  // neutral unit while the budget read loads.
  const budget = budgetQuery.data ?? NEUTRAL_BUDGET;

  const spentQuery = useQuery({
    queryKey: queryKeys.monthlyPurchasesTotal(userId!, monthKey),
    enabled: !!userId,
    queryFn: () =>
      readMonthlyPurchasesTotal(monthKey).then(toQueryData),
  });

  // The raw per-unit rows (one per recorded currency). The old `select`
  // collapsed them to the viewer total with `?? 0`, throwing away the fact
  // that OTHER units had receipts — the false zero behind issue #214. Keep
  // the rows and derive the snapshot below instead.
  const rows = spentQuery.data ?? [];

  // Viewer-currency rows only (R1: never sum across units). A legacy unit-less
  // row binds to the viewer unit — the shared `bindViewerRows` rule.
  const viewerRows = bindViewerRows(rows, budget.currency);
  const viewerRow = viewerRows[0];
  const spent = viewerRow?.total ?? 0;

  // Every OTHER unit's recorded total, accumulated defensively per currency
  // (the grouped RPC returns one row per unit, but a naive "last wins" would
  // silently drop a duplicate). Unit-less rows are viewer rows, so they never
  // land here.
  const foreignTotals = new Map<string, number>();
  for (const row of rows) {
    const unit = row.currency ?? budget.currency;
    if (unit === budget.currency) continue;
    foreignTotals.set(unit, (foreignTotals.get(unit) ?? 0) + row.total);
  }

  // The mismatch: the viewer currency has no receipts, but at least one other
  // unit does. Only THEN is a percentage dishonest — a genuine zero month
  // (no rows at all) keeps `0%`.
  const currencyMismatch = viewerRows.length === 0 && foreignTotals.size > 0;

  const unitTotals: BudgetUnitTotal[] = [
    ...(viewerRow
      ? [{ currency: budget.currency, total: viewerRow.total }]
      : []),
    ...[...foreignTotals.entries()].map(([currency, total]) => ({
      currency,
      total,
    })),
  ].sort((a, b) => b.total - a.total);

  const percent = currencyMismatch
    ? null
    : budget.amount > 0
      ? Math.min(1, spent / budget.amount)
      : 0;

  return {
    budget,
    spent,
    percent,
    unitTotals,
    currencyMismatch,
    error: budgetQuery.error
      ? toQueryErrorMessage(budgetQuery.error)
      : spentQuery.error
        ? toQueryErrorMessage(spentQuery.error)
        : null,
    isLoading: budgetQuery.isLoading || spentQuery.isLoading,
    hasData: budgetQuery.data !== undefined,
    isRefetching: budgetQuery.isRefetching || spentQuery.isRefetching,
  };
}
