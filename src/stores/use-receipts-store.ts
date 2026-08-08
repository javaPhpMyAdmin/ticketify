import { create } from 'zustand';

import { tempId, todayLocalISO } from '@/lib/format';
import type {
  HomeFeedReceiptRow,
  PaymentMethod,
  PurchaseStatus,
  ReceiptDraft,
  ReviewItem,
} from '@/types';

export type ScanState =
  | 'idle'
  | 'capturing'
  | 'parsing'
  | 'reviewing'
  | 'saving'
  | 'error';

interface ReceiptsState {
  /**
   * Receipts backing Home's feed and the History/drill-down screens. The
   * Home feed query hydrates it from the `purchases` / `purchase_items`
   * reads (all months), so every derived screen renders the same rows the
   * feed does.
   */
  list: HomeFeedReceiptRow[];
  /** The receipt currently being captured / parsed / reviewed. */
  draft: ReceiptDraft | null;
  scanState: ScanState;
  scanError: string | null;

  setScanState: (state: ScanState) => void;
  setScanError: (error: string | null) => void;
  startDraft: (imageUrl: string) => void;
  updateDraft: (patch: Partial<ReceiptDraft>) => void;
  upsertItem: (item: ReviewItem) => void;
  removeItem: (tempId: string) => void;
  setDraftItems: (items: ReviewItem[]) => void;
  setDraftStore: (storeName: string) => void;
  setDraftDate: (date: string) => void;
  setDraftPayment: (method: PaymentMethod) => void;
  setDraftTotal: (total: number) => void;
  clearDraft: () => void;
  setList: (list: ReceiptsState['list']) => void;
}

const emptyDraft = (imageUrl: string): ReceiptDraft => ({
  store_name: '',
  // Local calendar date (mirrors saveReceipt and the parse result): the
  // parse result overwrites this seed, and it must never drift to UTC's date.
  purchase_date: todayLocalISO(),
  total: 0,
  payment_method: 'card',
  image_url: imageUrl,
  items: [],
});

export const useReceiptsStore = create<ReceiptsState>((set) => ({
  // Starts empty; the Home feed query hydrates it from the `purchases` /
  // `purchase_items` reads once a signed-in user exists.
  list: [],
  draft: null,
  scanState: 'idle',
  scanError: null,

  setScanState: (scanState) => set({ scanState }),
  setScanError: (scanError) =>
    set({ scanError, scanState: scanError ? 'error' : 'idle' }),

  startDraft: (imageUrl) =>
    set({
      draft: emptyDraft(imageUrl),
      scanState: 'reviewing',
      scanError: null,
    }),

  updateDraft: (patch) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, ...patch } } : state,
    ),

  upsertItem: (item) =>
    set((state) => {
      if (!state.draft) return state;
      const idx = state.draft.items.findIndex(
        (i) => i.temp_id === item.temp_id,
      );
      const items =
        idx >= 0
          ? state.draft.items.map((i, k) => (k === idx ? item : i))
          : [...state.draft.items, item];
      return { draft: { ...state.draft, items } };
    }),

  removeItem: (tempId) =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              items: state.draft.items.filter((i) => i.temp_id !== tempId),
            },
          }
        : state,
    ),

  setDraftItems: (items) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, items } } : state,
    ),

  setDraftStore: (store_name) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, store_name } } : state,
    ),

  setDraftDate: (purchase_date) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, purchase_date } } : state,
    ),

  setDraftPayment: (payment_method) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, payment_method } } : state,
    ),

  setDraftTotal: (total) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, total } } : state,
    ),

  clearDraft: () => set({ draft: null, scanState: 'idle', scanError: null }),

  setList: (list) => set({ list }),
}));

export { tempId };
