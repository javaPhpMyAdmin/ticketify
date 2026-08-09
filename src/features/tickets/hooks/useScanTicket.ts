import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { parseTicket } from '../api';
import { useSessionUser } from '@/features/auth';
import { tempId } from '@/lib/format';
import { useReceiptsStore } from '@/stores/use-receipts-store';

export interface UseScanTicketResult {
  isLoading: boolean;
  error: string | null;
  /** Id the screen can navigate to once the draft is in the store. */
  draftId: string | null;
  scan: (imageUri: string) => Promise<void>;
  reset: () => void;
}

/**
 * Orchestrates the scan flow as a mutation (server-state-caching spec, D4):
 *   1. Upload the image to Supabase Storage.
 *   2. Call the `parse-ticket` edge function.
 *   3. Seed the `useReceiptsStore` with the parsed draft.
 *
 * Parsing writes nothing server-side, so a successful scan invalidates no
 * queries. A failed mutation leaves the store untouched — `error` carries
 * the message and `draftId` stays null, so the review screen shows a retry
 * state instead of a half-empty form.
 *
 * The upload scope is derived internally from the current session — callers
 * never pass a user id (post-review cleanup).
 */
export function useScanTicket(): UseScanTicketResult {
  const { userId } = useSessionUser();
  const [draftId, setDraftId] = useState<string | null>(null);

  const startDraft = useReceiptsStore((s) => s.startDraft);
  const setDraftStore = useReceiptsStore((s) => s.setDraftStore);
  const setDraftDate = useReceiptsStore((s) => s.setDraftDate);
  const setDraftTotal = useReceiptsStore((s) => s.setDraftTotal);
  const setDraftPayment = useReceiptsStore((s) => s.setDraftPayment);
  const setDraftItems = useReceiptsStore((s) => s.setDraftItems);
  const updateDraft = useReceiptsStore((s) => s.updateDraft);

  const mutation = useMutation({
    mutationFn: async (imageUri: string) => {
      // Parse only: the photo upload happens on CONFIRM inside `saveReceipt`
      // (product decision 2026-08-09) so a cancelled scan never leaves an
      // orphaned object in the `receipts` bucket. `parseTicket` reads the
      // LOCAL image (base64) — it never touches Storage.
      const parsed = await parseTicket(imageUri);
      return { url: imageUri, parsed };
    },
    onSuccess: ({ url, parsed }) => {
      // Step 2: seed the store, then expose the draft id for navigation.
      // The draft keeps the LOCAL uri for preview; `saveReceipt` uploads it.
      startDraft(url);
      setDraftStore(parsed.store);
      setDraftDate(parsed.date);
      setDraftTotal(parsed.total);
      setDraftPayment(parsed.payment_method);
      // Card brand/type are read-only extras on the draft — seed them only
      // when the parse pipeline detected them (null values are harmless).
      updateDraft({
        card_brand: parsed.card_brand,
        card_type: parsed.card_type,
      });
      setDraftItems(parsed.items);
      setDraftId(tempId());
    },
  });

  const scan = async (imageUri: string) => {
    await mutation.mutateAsync(imageUri);
  };

  const reset = () => {
    mutation.reset();
    setDraftId(null);
  };

  const error = mutation.error
    ? mutation.error instanceof Error
      ? mutation.error.message
      : 'Unknown scan error'
    : null;

  return {
    isLoading: mutation.isPending,
    error,
    draftId,
    scan,
    reset,
  };
}
