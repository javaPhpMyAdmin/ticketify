import { create } from 'zustand';

import { MOCK_RECEIPTS, USE_MOCK_DATA } from '@/lib/mock-data';
import type { PaymentMethod, PurchaseStatus, ReceiptDraft, ReviewItem } from '@/types';
import { tempId, todayLocalISO } from '@/lib/format';

export type ScanState = 'idle' | 'capturing' | 'parsing' | 'reviewing' | 'saving' | 'error';

interface ReceiptsState {
  /**
   * Receipts backing Home's feed and the History/drill-down screens. Mock
   * only for now: seeded from `MOCK_RECEIPTS` and appended to by the mock
   * save path — nothing hydrates it from Supabase until Phase 5 wires the
   * real `purchases` / `purchase_items` reads.
   */
  list: Array<{
    id: string;
    store_name: string;
    purchase_date: string;
    /** When the receipt was scanned/captured (ISO). Orders "Recibos recientes". */
    scanned_at: string;
    total: number;
    image_url: string | null;
    status: PurchaseStatus;
    /** Impulse-items total for the receipt, if the source provides it. */
    wants_snacks_total?: number;
    /**
     * Per-category totals (category key -> amount) so the Home feed can
     * break spending down by item type. Mock-only for now; Phase 5 persists
     * `category_id` per item server-side and derives this from the items.
     */
    category_totals?: Record<string, number>;
    /**
     * Line items of the receipt (name + amount + category key). Mock-only
     * for now; drives the per-category detail screen. Phase 5 persists
     * items server-side with a real `category_id`.
     */
    items?: { name: string; amount: number; category: string }[];
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
  // Local calendar date (mirrors saveReceipt/mockParsedReceipt): the parse
  // result overwrites this seed, and it must never drift to UTC's date.
  purchase_date: todayLocalISO(),
  total: 0,
  payment_method: 'card',
  image_url: imageUrl,
  items: [],
});

export const useReceiptsStore = create<ReceiptsState>((set) => ({
  // Offline dev seeds the feed with sample receipts so the Home tab fills
  // the screen (no empty band under the floating FAB); prod starts empty —
  // real hydration lands in Phase 5 (History/drill-downs are mock-only
  // until then).
  list: USE_MOCK_DATA ? MOCK_RECEIPTS : [],
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
