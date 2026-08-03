import { useAuthMode } from '@/features/auth';
import {
  homeCategories,
  recentReceipts,
  wantsSnacksTotal,
  type HomeCategory,
  type ReceiptSummary,
} from '@/lib/fixtures/demo';

export interface HomeFeed {
  categories: HomeCategory[];
  receipts: ReceiptSummary[];
  wantsSnacksTotal: number;
}

/**
 * Home screen feed (ADR-4, demo-mode spec). Demo mode → fixtures; authenticated
 * mode → empty arrays, because purchase-list reads are explicitly out of scope
 * for this change (design "File Changes": "kept in demo; purchase-list reads
 * out of scope"). The empty state guarantees demo fixtures never render inside
 * an authenticated session.
 */
export function useHomeFeed(): HomeFeed {
  const { mode } = useAuthMode();
  if (mode === 'demo') {
    return {
      categories: homeCategories,
      receipts: recentReceipts,
      wantsSnacksTotal,
    };
  }
  return { categories: [], receipts: [], wantsSnacksTotal: 0 };
}
