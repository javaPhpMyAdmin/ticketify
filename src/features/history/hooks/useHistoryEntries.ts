import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { queryKeys } from '@/lib/query-keys';

/**
 * One transaction row in the history screen.
 */
export interface HistoryEntry {
  id: string;
  merchant: string;
  date: string; // ISO
  category: string;
  needs: number;
  wants: number;
  income: number;
}

/**
 * Transaction history feed through TanStack Query (server-state-caching
 * spec, D7). The purchase-list read is out of scope for this change, so the
 * queryFn resolves the neutral empty state; Phase 5 swaps only the queryFn.
 * The query is disabled until a signed-in user exists, so no read ever runs
 * without a session.
 */
export function useHistoryEntries(): HistoryEntry[] {
  const { userId } = useSessionUser();

  const entriesQuery = useQuery({
    queryKey: queryKeys.historyEntries(userId!),
    enabled: !!userId,
    queryFn: async () => [],
  });

  return entriesQuery.data ?? [];
}
