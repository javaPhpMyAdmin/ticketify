import { useAuthMode } from '@/features/auth';
import { historyEntries } from '@/lib/fixtures/demo';
import type { HistoryEntry } from '@/lib/fixtures/demo';

/**
 * Transaction history feed (ADR-4, demo-mode spec). Demo mode → fixtures;
 * authenticated mode → empty, because the purchase-list read is out of scope
 * for this change, so no demo transaction can appear in an authenticated
 * session.
 */
export function useHistoryEntries(): HistoryEntry[] {
  const { mode } = useAuthMode();
  return mode === 'demo' ? historyEntries : [];
}
