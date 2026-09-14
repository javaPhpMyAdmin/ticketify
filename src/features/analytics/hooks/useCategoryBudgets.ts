import { useEffect, useRef } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { useCategoryCatalog } from '@/features/categories/hooks/useCategoryCatalog';
import { currentMonthKey, previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import { queryKeys } from '@/lib/query-keys';
import {
  ROLLOVER_MARKER_SLUG,
  markCategoryBudgetRolloverApplied,
  readCategoryBudgets,
  upsertCategoryBudgets,
} from '@/lib/supabase/feature-access';
import {
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import type { CategoryBudget } from '@/types';

/**
 * Hook wrapping per-category budget read + write via React Query.
 *
 * `budgets` — the user's budget limits for the month (possibly empty).
 * `isLoading` — true while the initial read is in flight.
 * `error` — user-safe error string, or null.
 * `save(budgets)` — upserts the given budget amounts for the current month
 *   and invalidates the query so the UI stays fresh.
 *
 * Rollover (AD-1/AD-2/AD-7): when the resolved current-month budget read is
 * empty and the month is the local current month, copies the previous month's
 * limits once and durably records the copy (migration 0030: the
 * `rollover_applied` flag plus the `__rollover__` sentinel row). The record
 * is written even when there is nothing to copy, so the copy never re-runs on
 * remount or restart — including after the user clears every budget
 * (delete-on-zero does not touch the sentinel).
 *
 * `rolloverEnabled` (default true) lets callers opt out — the household
 * context passes `false` because household limits are aggregated server-side
 * and must not be re-copied per member (AD-6).
 *
 * PR 7 (category-management): validKeys are the DYNAMIC merged catalog (13
 * canonical ∪ own custom rows) — custom budgets roll over exactly like
 * canonical ones, a deleted custom slug is dropped, the `__rollover__`
 * sentinel is excluded explicitly, and the rollover fails closed (never runs,
 * never writes the marker) while the catalog is unknown (loading or failed)
 * so an empty key set can never silently drop previous budgets.
 */
export function useCategoryBudgets(
  yearMonth = currentMonthKey(),
  rolloverEnabled = true,
) {
  const { userId } = useSessionUser();
  const queryClient = useQueryClient();
  // PR 7 (category-management): the rollover key set is the DYNAMIC catalog —
  // the merged 13 canonical ∪ the caller's own custom rows (D3: the picker,
  // budgets settings, rollover validKeys and all display surfaces consume the
  // same catalog). `useCategoryCatalog` is the single shared cache, so the
  // settings screen's own catalog hook and this one resolve the same data.
  const { catalog, isLoading: catalogLoading } = useCategoryCatalog();

  const budgetsQuery = useQuery({
    queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
    enabled: !!userId,
    queryFn: () =>
      readCategoryBudgets(userId!, yearMonth).then(toQueryData),
  });

  const saveMutation = useMutation({
    mutationFn: (budgets: Array<{ category_slug: string; amount: number }>) =>
      upsertCategoryBudgets(budgets, yearMonth, userId!).then(toQueryData),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
      });
      // Also invalidate monthly totals since the RPC now returns budget_limit
      queryClient.invalidateQueries({
        queryKey: queryKeys.monthlyTotals(userId!, yearMonth),
      });
    },
  });

  const budgets: CategoryBudget[] = budgetsQuery.data ?? [];

  // --- Rollover (AD-1, AD-2) ---
  // Guards: disabled → skip; not-current month → skip; rows exist or the
  // rollover already ran this month (copies/sentinel carry rollover_applied)
  // → skip; loading → skip; ref guard → skip. One-shot per mount+month via
  // rolloverDoneRef, plus the durable marker so restart is safe too.
  const rolloverDoneRef = useRef<string | null>(null);
  const lastRolloverAttemptRef = useRef<number | null>(null);

  // PR 7 (category-management): stable gate signal for the fail-closed catalog
  // check — `catalog` is `{}` before the first successful load AND after a
  // failed load (`useCategoryCatalog` resolves data ?? {}), so the count is
  // the only observable that distinguishes "loaded" from "unknown".
  const catalogKeyCount = Object.keys(catalog).length;

  const rolloverMutation = useMutation({
    mutationFn: async (): Promise<{ copied: number } | null> => {
      const prevKey = previousMonthKey(yearMonth);
      const prevResult = await readCategoryBudgets(userId!, prevKey);
      if (prevResult.status !== 'ok') return null;

      const prevBudgets = prevResult.data ?? [];
      // PR 7 (category-management): validKeys = the merged dynamic catalog
      // (13 canonical ∪ own custom rows). Custom categories roll over exactly
      // like canonical ones (same slug key, same amount, same month handling);
      // a DELETED custom category disappears from the catalog and its budget
      // is dropped (spec: "Category removed from the catalog is not copied").
      const validKeys = new Set(Object.keys(catalog));

      // Filter: slug must exist in the dynamic catalog AND amount > 0 (AD-7),
      // and the rollover sentinel is excluded EXPLICITLY — never a copy
      // candidate even if a corrupted row carried amount > 0 (the amount
      // filter alone must not be what keeps it out). This hook is NOT the
      // only gate: `markCategoryBudgetRolloverApplied` applies the same
      // sentinel exclusion on the write path (feature-access.ts:346-348);
      // both must agree or a rogue sentinel row could copy.
      const copies = prevBudgets
        .filter(
          (b) =>
            b.category_slug !== ROLLOVER_MARKER_SLUG &&
            validKeys.has(b.category_slug) &&
            b.amount > 0,
        )
        .map((b) => ({ category_slug: b.category_slug, amount: b.amount }));

      lastRolloverAttemptRef.current = copies.length;

      // Persist the copies (rollover_applied = true) + the __rollover__
      // sentinel — durable "ran for this month", even with zero copies.
      const result = await markCategoryBudgetRolloverApplied(
        copies,
        yearMonth,
        userId!,
      );
      if (result.status !== 'ok') return null;
      return { copied: copies.length };
    },
    onSuccess: (result) => {
      // No-op result (prev read error / write error) → nothing was copied →
      // skip invalidation: refetching would only re-enter the same gate.
      if (result === null) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.categoryBudgets(userId!, yearMonth),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.monthlyTotals(userId!, yearMonth),
      });
    },
    onError: () => {
      // Unexpected throw (not a FeatureReadResult error): log the attempt so
      // repeated failures are diagnosable without user-visible noise.
      console.warn(
        `[rollover] copy for ${yearMonth} failed after reading ${
          lastRolloverAttemptRef.current ?? 'unknown'
        } previous budgets`,
      );
    },
  });

  useEffect(() => {
    if (!userId) return;
    if (!rolloverEnabled) return;
    if (yearMonth !== currentMonthKey()) return;
    if (budgets.length > 0) return;
    if (budgets.some((b) => b.rollover_applied === true)) return;
    if (budgetsQuery.data === undefined) return;
    // PR 7 (category-management): fail-closed catalog gate. Rollover only runs
    // once the dynamic catalog actually LOADED (0 sentinel keys = still
    // loading OR failed/empty). With an unknown catalog the key set is
    // UNKNOWN — copying now could silently drop every previous budget (empty
    // validKeys), and writing the sentinel would permanently suppress a retry
    // next open. No catalog → no rollover.
    if (catalogLoading) return;
    if (catalogKeyCount === 0) return;
    if (rolloverMutation.isPending) return;
    if (rolloverDoneRef.current === yearMonth) return;

    rolloverDoneRef.current = yearMonth;
    rolloverMutation.mutate();
  }, [
    userId,
    yearMonth,
    budgets,
    budgetsQuery.data,
    catalogLoading,
    catalogKeyCount,
    rolloverMutation.isPending,
    rolloverEnabled,
  ]);

  return {
    budgets,
    isLoading: budgetsQuery.isLoading,
    error: budgetsQuery.error
      ? toQueryErrorMessage(budgetsQuery.error)
      : null,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
