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
 * Transaction history feed. The purchase-list read is out of scope for this
 * change, so the feed reports the neutral empty state — no fabricated
 * transactions can appear in an authenticated session.
 */
export function useHistoryEntries(): HistoryEntry[] {
  return [];
}
