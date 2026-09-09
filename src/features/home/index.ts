export { readPurchaseList, readPurchaseListByMonth, readPurchaseMonthKeys, searchPurchaseItems } from './api';
export { buildFeedRow, reviewItemsToFeedItems } from './feed-row';
export type { FeedRowMeta } from './feed-row';
export { useHouseholdMonthTotal, useMonthReceipts, useAvailableMonthKeys } from './hooks/useHomeFeed';
export type { HomeFeed } from './hooks/useHomeFeed';
export { mapPurchaseRowsToHomeFeed } from './hooks/useHomeFeed';
export { useCategoryDetail } from './hooks/useHomeFeed';
export { useItemSearch, useItemDetail, useStoreDetail } from './hooks/useHomeFeed';
export { useMonthNavigation, resolveMonthNavigation } from './hooks/useHomeFeed';
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
  aggregateHouseholdCategoryItems,
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
export { RunRateCard } from './components/RunRateCard';
export type { RunRateCardProps } from './components/RunRateCard';
export { useRunRate } from './hooks/useRunRate';
export { aggregateRunRate } from './lib/runRate';
export type { RunRateResult } from './lib/runRate';
