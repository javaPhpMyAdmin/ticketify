import { create } from 'zustand';

import type { PaymentMethod, PurchaseStatus, ReceiptDraft, ReviewItem } from '@/types';
import { tempId } from '@/lib/format';

export type ScanState = 'idle' | 'capturing' | 'parsing' | 'reviewing' | 'saving' | 'error';

interface ReceiptsState {
  /** Server-backed purchases, hydrated from Supabase on app start. */
  list: Array<{
    id: string;
    store_name: string;
    purchase_date: string;
    total: number;
    image_url: string | null;
    status: PurchaseStatus;
  }>;
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
  purchase_date: new Date().toISOString().slice(0, 10),
  total: 0,
  payment_method: 'card',
  image_url: imageUrl,
  items: [],
});

export const useReceiptsStore = create<ReceiptsState>((set) => ({
  list: [],
  draft: null,
  scanState: 'idle',
  scanError: null,

  setScanState: (scanState) => set({ scanState }),
  setScanError: (scanError) => set({ scanError, scanState: scanError ? 'error' : 'idle' }),

  startDraft: (imageUrl) =>
    set({
      draft: emptyDraft(imageUrl),
      scanState: 'reviewing',
      scanError: null,
    }),

  updateDraft: (patch) =>
    set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : state)),

  upsertItem: (item) =>
    set((state) => {
      if (!state.draft) return state;
      const idx = state.draft.items.findIndex((i) => i.temp_id === item.temp_id);
      const items = idx >= 0
        ? state.draft.items.map((i, k) => (k === idx ? item : i))
        : [...state.draft.items, item];
      return { draft: { ...state.draft, items } };
    }),

  removeItem: (tempId) =>
    set((state) =>
      state.draft
        ? { draft: { ...state.draft, items: state.draft.items.filter((i) => i.temp_id !== tempId) } }
        : state,
    ),

  setDraftItems: (items) =>
    set((state) => (state.draft ? { draft: { ...state.draft, items } } : state)),

  setDraftStore: (store_name) =>
    set((state) => (state.draft ? { draft: { ...state.draft, store_name } } : state)),

  setDraftDate: (purchase_date) =>
    set((state) => (state.draft ? { draft: { ...state.draft, purchase_date } } : state)),

  setDraftPayment: (payment_method) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, payment_method } } : state,
    ),

  setDraftTotal: (total) =>
    set((state) => (state.draft ? { draft: { ...state.draft, total } } : state)),

  clearDraft: () => set({ draft: null, scanState: 'idle', scanError: null }),

  setList: (list) => set({ list }),
}));

export { tempId };
