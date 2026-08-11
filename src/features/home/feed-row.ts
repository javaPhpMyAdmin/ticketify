/**
 * Shared pure feed-row builder — the single source of the derived
 * aggregates (`category_totals`, `wants_snacks_total`) that the home
 * reads (`features/home/api`) and the edit-review flow
 * (`app/ticket/review/[id]`) both compute over line items.
 *
 * Each caller keeps its own light mapping into the shared item shape
 * (`HomeFeedItemRow`): the home read resolves the category slug from the
 * joined `categories` relation, the review flow resolves the user's
 * category pick over the AI suggestion. The aggregation that follows is
 * identical by construction, so the Home feed and the edited row can
 * never drift apart.
 */
import type {
  HomeFeedItemRow,
  HomeFeedReceiptRow,
  ReviewItem,
} from '@/types';

/** The row fields the callers supply; the aggregates are derived here. */
export interface FeedRowMeta {
  id: string;
  store_name: string;
  purchase_date: string;
  scanned_at: string | null;
  total: number;
  image_url: string | null;
  status: HomeFeedReceiptRow['status'];
}

/**
 * Resolves the display category slug for one review line item: the user's
 * pick wins over the AI suggestion, and unknown categories fall back to
 * the neutral `otros` (mirrors the home read's slug fallback).
 */
export function reviewItemCategorySlug(
  item: Pick<ReviewItem, 'category_id' | 'ai_suggested_category_id'>,
): string {
  return item.category_id ?? item.ai_suggested_category_id ?? 'otros';
}

/**
 * Maps review line items (`ReviewItem`) into the shared feed-row item
 * shape (`HomeFeedItemRow`), resolving the category slug via
 * `reviewItemCategorySlug`.
 */
export function reviewItemsToFeedItems(items: ReviewItem[]): HomeFeedItemRow[] {
  return items.map((item) => ({
    name: item.name,
    amount: item.total_price,
    quantity: item.quantity,
    unit_price: item.unit_price,
    category: reviewItemCategorySlug(item),
    is_impulse: item.is_impulse,
  }));
}

/**
 * Builds the full feed row from the caller-supplied meta and the
 * normalized item list, deriving `category_totals` (summed by category
 * slug, in item order) and `wants_snacks_total` (summed over impulse
 * items). Shared by the home reads and the edit review flow so both
 * surfaces aggregate identically.
 */
export function buildFeedRow(
  meta: FeedRowMeta,
  items: HomeFeedItemRow[],
): HomeFeedReceiptRow {
  const categoryTotals: Record<string, number> = {};
  for (const item of items) {
    categoryTotals[item.category] =
      (categoryTotals[item.category] ?? 0) + item.amount;
  }

  return {
    id: meta.id,
    store_name: meta.store_name,
    purchase_date: meta.purchase_date,
    scanned_at: meta.scanned_at,
    total: meta.total,
    image_url: meta.image_url,
    status: meta.status,
    wants_snacks_total: items
      .filter((item) => item.is_impulse)
      .reduce((sum, item) => sum + item.amount, 0),
    category_totals: categoryTotals,
    items,
  };
}
