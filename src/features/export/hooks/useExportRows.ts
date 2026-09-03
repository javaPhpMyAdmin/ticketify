/**
 * `useExportRows` — the export screen's read hook (data-access spec).
 *
 * Thin wrapper over `readPurchaseList` (the shared, user-scoped purchase
 * read: status `confirmed`, newest first, items + category slugs included).
 * It reuses the `homeFeed` query key ON PURPOSE: the export and the Home
 * feed read the exact same purchase list, so they share one cache entry and
 * one invalidation target — `features/tickets/api` invalidates
 * `homeFeed(userId)` after every receipt save/edit/delete, which keeps the
 * export screen fresh with no extra wiring.
 *
 * Mirrors the sibling hooks (`useProfile`): TanStack Query with the read
 * seam adapted at the queryFn boundary (`toQueryData`), the query disabled
 * until a signed-in user exists, and the user-safe error via
 * `toQueryErrorMessage` — never a crash, never a false "no data" message.
 */
import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { readPurchaseList } from '@/features/home/api';
import { queryKeys } from '@/lib/query-keys';
import { toQueryData, toQueryErrorMessage } from '@/lib/supabase/query-adapters';
import type { HomeFeedReceiptRow } from '@/types';

export interface ExportRowsResult {
  rows: HomeFeedReceiptRow[];
  /** True while the initial read is in flight (no data yet). */
  isLoading: boolean;
  /** User-safe message when the authenticated read fails. */
  error: string | null;
  /**
   * True once a read succeeded, even if a background refetch later fails
   * (TanStack keeps the data and sets `error`).
   */
  hasData: boolean;
  /** Re-runs the read on demand (e.g. the screen's retry action). */
  refetch: () => void;
}

export function useExportRows(): ExportRowsResult {
  const { userId } = useSessionUser();

  const rowsQuery = useQuery<HomeFeedReceiptRow[]>({
    queryKey: queryKeys.homeFeed(userId!),
    enabled: !!userId,
    queryFn: async () => toQueryData(await readPurchaseList(userId!)),
  });

  return {
    rows: rowsQuery.data ?? [],
    isLoading: rowsQuery.isLoading,
    error: rowsQuery.error ? toQueryErrorMessage(rowsQuery.error) : null,
    hasData: rowsQuery.data !== undefined,
    refetch: rowsQuery.refetch,
  };
}
