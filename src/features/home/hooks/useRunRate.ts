import { useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import {
  currentMonthKey,
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import {
  aggregateRunRate,
  type RunRateResult,
} from '@/features/home/lib/runRate';
import { todayLocalISO } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import {
  readMonthlyCacheRows,
  triggerMonthlyRecalc,
} from '@/lib/supabase/feature-access';
import { toQueryData } from '@/lib/supabase/query-adapters';

/**
 * The `YYYY-MM` keys the run-rate reads in one batch: the current month plus
 * the 4 preceding completed months (fixed 5-month window, one indexed read —
 * NFR-1). The trailing keys reuse `previousMonthKey`, whose December-safe
 * string math gives the rollover for free (useHomeFeed.ts).
 */
function trailingMonthKeys(monthKey: string): string[] {
  const keys = [monthKey];
  let cursor = monthKey;
  for (let i = 0; i < 4; i += 1) {
    cursor = previousMonthKey(cursor);
    keys.push(cursor);
  }
  return keys;
}

/**
 * Run-rate hook for the current month (spec `monthly-run-rate`, design
 * AD-3/AD-4/AD-6). Reads the personal `monthly_user_totals` cache rows for
 * the current + 4 previous months in a single batch query, triggers the
 * existing auto-recalc on a current-month cache miss (REQ-6, verbatim
 * `useMonthlyCache` pattern), and derives the card data through the pure
 * `aggregateRunRate`.
 *
 * Returns `{ data: null }` while the card must stay hidden (REQ-5): past
 * month selected (REQ-5a — no reads fire), loading, cache-miss pending,
 * a read failure with no data to show (REQ-6 — never fabricate numbers; a
 * failed background refetch keeps the last-good figures), or any visibility
 * gate inside `aggregateRunRate`.
 *
 * NOTE on the REQ-5a gate: the design sketches an early return before the
 * query, but navigating Home to a past month would then unmount the
 * `useQuery` between renders and violate React's hook-order rules. The gate
 * is applied via `enabled` instead — externally identical (no queries fire
 * for past months, data stays null) and hooks-order safe, matching the
 * `enabled`-gated pattern every other feature hook uses.
 */
export function useRunRate(monthKey: string): { data: RunRateResult | null } {
  const { userId } = useSessionUser();
  const isCurrent = monthKey === currentMonthKey();

  // AD-4: the key lives under the shared `monthlyCachePrefix` so the
  // existing cache-row invalidation (receipt writes) refetches run-rate
  // too. `userId ?? ''` keeps the key a plain string before the session
  // hydrates (mirrors `useMonthlyCache`); `enabled` below still guarantees
  // the read never fires without an id.
  const batchKeys = useMemo(() => trailingMonthKeys(monthKey), [monthKey]);

  const query = useQuery({
    queryKey: [
      ...queryKeys.monthlyCachePrefix(userId ?? ''),
      'run-rate',
      monthKey,
    ],
    enabled: isCurrent && !!userId,
    queryFn: () =>
      readMonthlyCacheRows(userId!, batchKeys).then(toQueryData),
  });

  // Cache-miss (REQ-6): recalc via RPC when the batch resolved WITHOUT the
  // current-month row and no recalc is in flight; the success refetch picks
  // up the freshly upserted row (`recalculate_monthly_totals` always
  // upserts, migration 0015).
  const triggerMutation = useMutation({
    mutationFn: () =>
      triggerMonthlyRecalc(userId!, monthKey).then(toQueryData),
    onSuccess: () => {
      void query.refetch();
    },
  });

  // Auto-trigger recalc when the batch resolved without the current-month
  // row and no recalc is in flight. `query.data !== undefined` keeps the
  // effect inert while the query is disabled (past month / no user).
  //
  // HONEST DEPENDENCY NOTE — this is NOT a strict one-shot:
  // `query.data` is an array identity that changes on EVERY refetch, so if
  // a refetch resolves while the current-month row is STILL missing, the
  // effect re-fires. That loop is bounded in practice: the RPC upserts the
  // row unconditionally, so a miss → recalc → refetch cycle resolves the
  // row and the `some(...)` check goes green — a second fire would require
  // the RPC to succeed while leaving the row absent (server-side anomaly,
  // not reachable through the normal write path).
  // StrictMode dev double-invoke (React 19) can fire the mutation twice on
  // the same committed render; accepted — the RPC is idempotent and this
  // is dev-only, the harness pins recalc-once under the production path.
  useEffect(() => {
    if (
      isCurrent &&
      !!userId &&
      query.data !== undefined &&
      !query.data.some((row) => row.year_month === monthKey) &&
      !query.isLoading &&
      !triggerMutation.isPending
    ) {
      triggerMutation.mutate();
    }
  }, [isCurrent, userId, monthKey, query.data, query.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // NFR-2: the day token re-derives on the local-day flip so a month
  // boundary mid-session never serves yesterday's math. Computed OUTSIDE
  // the memo so the dependency is the stable string value, not a function
  // call.
  const today = todayLocalISO();
  const result = useMemo(
    () => aggregateRunRate(query.data ?? [], today),
    [query.data, today],
  );

  // REQ-6 error contract (last-good decision, R3 review): a failed read
  // must never produce figures, but a failed BACKGROUND refetch must not
  // blank the card either — it keeps the last-good rows, the same policy
  // the budget card uses (index.tsx). React Query v5 sets `status: 'error'`
  // (→ `isError`) on a failed refetch while KEEPING `data`, so the check is
  // `isError && !hasData` (i.e. `isLoadingError`): error without data hides
  // (initial load failure — never fabricate), error with data keeps the
  // verified figures on screen.
  const hasData = query.data !== undefined;
  const hideOnReadError = query.isError && !hasData;
  return { data: hideOnReadError ? null : result };
}