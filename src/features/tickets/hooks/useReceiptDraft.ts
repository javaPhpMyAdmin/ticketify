import { useReceiptsStore } from '@/stores/use-receipts-store';
import type { PaymentMethod, ReceiptDraft, ReviewItem } from '@/types';

export interface ReceiptDraftDraft {
  /** The current draft being captured / parsed / reviewed. */
  draft: ReceiptDraft | null;
}

export interface ReceiptDraftActions {
  startDraft: (imageUrl: string) => void;
  setStore: (name: string) => void;
  setDate: (date: string) => void;
  setPayment: (method: PaymentMethod) => void;
  upsertItem: (item: ReviewItem) => void;
  removeItem: (id: string) => void;
  setItems: (items: ReviewItem[]) => void;
  setTotal: (total: number) => void;
  clear: () => void;
  setError: (error: string | null) => void;
}

/**
 * Read slice of the receipts store. Returns the current draft so
 * screens can render it without pulling in the whole store.
 */
export function useReceiptDraftDraft(): ReceiptDraftDraft {
  const draft = useReceiptsStore((s) => s.draft);
  return { draft };
}

/**
 * Write slice of the receipts store. Exposes only the setters the
 * scan / review screens need, renamed to read naturally at the
 * call site (`setStore` instead of `setDraftStore`).
 */
export function useReceiptDraftActions(): ReceiptDraftActions {
  const startDraft = useReceiptsStore((s) => s.startDraft);
  const setDraftStore = useReceiptsStore((s) => s.setDraftStore);
  const setDraftDate = useReceiptsStore((s) => s.setDraftDate);
  const setDraftPayment = useReceiptsStore((s) => s.setDraftPayment);
  const upsertItem = useReceiptsStore((s) => s.upsertItem);
  const removeItem = useReceiptsStore((s) => s.removeItem);
  const setDraftItems = useReceiptsStore((s) => s.setDraftItems);
  const setDraftTotal = useReceiptsStore((s) => s.setDraftTotal);
  const clearDraft = useReceiptsStore((s) => s.clearDraft);
  const setScanError = useReceiptsStore((s) => s.setScanError);
  return {
    startDraft,
    setStore: setDraftStore,
    setDate: setDraftDate,
    setPayment: setDraftPayment,
    upsertItem,
    removeItem,
    setItems: setDraftItems,
    setTotal: setDraftTotal,
    clear: clearDraft,
    setError: setScanError,
  };
}
