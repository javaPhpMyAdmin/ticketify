export { readPurchaseList, readPurchaseListByMonth, searchPurchaseItems } from './api';
export { buildFeedRow, reviewItemsToFeedItems } from './feed-row';
export type { FeedRowMeta } from './feed-row';
export { useHomeFeed, useMonthReceipts } from './hooks/useHomeFeed';
export type { HomeFeed } from './hooks/useHomeFeed';
export { mapPurchaseRowsToHomeFeed } from './hooks/useHomeFeed';
export { useCategoryDetail } from './hooks/useHomeFeed';
export { useItemSearch, useItemDetail, useStoreDetail } from './hooks/useHomeFeed';
export type {
  CategoryItemSummary,
  ReceiptSpendRecord,
  ItemPurchaseSummary,
} from './hooks/useHomeFeed';
export {
  getMonthKey,
  currentMonthKey,
  monthKeyToLabel,
  getAvailableMonthKeys,
  normalizeItemName,
  aggregateCategoriesByMonth,
  aggregateCategoryItemCounts,
  aggregateItemsByCategory,
  aggregateItemsByMonth,
} from './hooks/useHomeFeed';
export { useScanQuota } from './hooks/useScanQuota';
export type { ScanQuotaResult } from './hooks/useScanQuota';
export { ScanQuotaCard } from './components/ScanQuotaCard';
export { CategoryBudgetCard } from './components/CategoryBudgetCard';
export type { CategoryBudgetCardProps } from './components/CategoryBudgetCard';
export { SegmentedBudgetBar } from './components/SegmentedBudgetBar';
export type {
  SegmentedBudgetBarProps,
  SegmentedBudgetBarSegment,
} from './components/SegmentedBudgetBar';
export { CategoryBudgetCardSkeleton } from './components/CategoryBudgetCardSkeleton';
