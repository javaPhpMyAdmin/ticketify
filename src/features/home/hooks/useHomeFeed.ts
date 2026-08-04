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

/**
 * Home screen feed. Purchase-list reads are out of scope for this change, so
 * the feed reports the neutral empty state — no fabricated content can render
 * inside an authenticated session.
 */
export function useHomeFeed(): HomeFeed {
  return { categories: [], receipts: [], wantsSnacksTotal: 0 };
}
