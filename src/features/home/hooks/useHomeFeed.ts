import { useQuery } from '@tanstack/react-query';

import { useSessionUser } from '@/features/auth';
import { queryKeys } from '@/lib/query-keys';

/**
 * One entry in the home screen's "Recent Receipts" card.
 */
export interface ReceiptSummary {
  id: string;
  name: string;
  date: string; // ISO
  amount: number;
}

/**
 * One spending-category card in the home screen's horizontal strip.
 */
export interface HomeCategory {
  name: string;
  amount: number;
  icon: 'sparkles';
}

export interface HomeFeed {
  categories: HomeCategory[];
  receipts: ReceiptSummary[];
  wantsSnacksTotal: number;
}

/** Neutral empty feed — no fabricated content renders inside a session. */
const EMPTY_FEED: HomeFeed = { categories: [], receipts: [], wantsSnacksTotal: 0 };

/**
 * Home screen feed through TanStack Query (server-state-caching spec, D7).
 * Purchase-list reads are out of scope for this change, so the queryFn
 * resolves the neutral empty state; Phase 5 swaps only the queryFn. The
 * query is disabled until a signed-in user exists, so no read ever runs
 * without a session.
 */
export function useHomeFeed(): HomeFeed {
  const { userId } = useSessionUser();

  const feedQuery = useQuery({
    queryKey: queryKeys.homeFeed(userId!),
    enabled: !!userId,
    queryFn: async () => EMPTY_FEED,
  });

  return feedQuery.data ?? EMPTY_FEED;
}
