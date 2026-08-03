import { useCallback, useState } from 'react';

import { parseTicket, uploadToStorage } from '../api';
import { useAuthMode } from '@/features/auth';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { tempId } from '@/lib/format';

export interface UseScanTicketArgs {
  userId: string | null;
}

export interface UseScanTicketResult {
  isLoading: boolean;
  error: string | null;
  /** Id the screen can navigate to once the draft is in the store. */
  draftId: string | null;
  scan: (imageUri: string) => Promise<void>;
  reset: () => void;
}

/**
 * Orchestrates the scan flow:
 *   1. Upload the image to Supabase Storage.
 *   2. Call the `parse-ticket` edge function.
 *   3. Seed the `useReceiptsStore` with the parsed draft.
 *
 * Returns a `draftId` callers can use to navigate to `/ticket/review/[id]`.
 */
export function useScanTicket({ userId }: UseScanTicketArgs): UseScanTicketResult {
  const { userId: sessionUserId } = useAuthMode();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  const startDraft = useReceiptsStore((s) => s.startDraft);
  const setDraftStore = useReceiptsStore((s) => s.setDraftStore);
  const setDraftDate = useReceiptsStore((s) => s.setDraftDate);
  const setDraftTotal = useReceiptsStore((s) => s.setDraftTotal);
  const setDraftItems = useReceiptsStore((s) => s.setDraftItems);

  const scan = useCallback(
    async (imageUri: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // Step 1: upload (stubbed for now) — scoped to the signed-in user's
        // storage namespace when a session exists, 'anon' in demo mode.
        const { url } = await uploadToStorage(
          userId ?? sessionUserId ?? 'anon',
          imageUri,
        );
        // Step 2: parse.
        const parsed = await parseTicket(url);
        // Step 3: seed the store.
        const id = tempId();
        startDraft(url);
        setDraftStore(parsed.store);
        setDraftDate(parsed.date);
        setDraftTotal(parsed.total);
        setDraftItems(parsed.items);
        setDraftId(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown scan error';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, sessionUserId, startDraft, setDraftStore, setDraftDate, setDraftTotal, setDraftItems],
  );

  const reset = useCallback(() => {
    setError(null);
    setDraftId(null);
  }, []);

  return { isLoading, error, draftId, scan, reset };
}
