/**
 * Pro charts feature barrel (pro-subscription spec — REQ-CHART-1..6).
 *
 *   import { TrendChart, CategoryDonut, StoreBars, aggregateSpendTrend } from '@/features/charts';
 *
 * The aggregations are pure and re-exported alongside the visual
 * components so a single import covers both the math and the chart.
 * `aggregateCategoriesByMonth` is re-exported from the home feed hook
 * (single source of truth between the donut and the analytics strip).
 */
export {
  aggregateSpendTrend,
  aggregateStoresByMonth,
  aggregateCategoriesByMonth,
} from './aggregate';
export type {
  SpendTrendPoint,
  StoreSpend,
  HomeCategory,
} from './aggregate';

export { TrendChart } from './components/TrendChart';
export type { TrendChartProps, TrendPoint } from './components/TrendChart';

export { CategoryDonut, CHART_PALETTE } from './components/CategoryDonut';
export type {
  CategoryDonutProps,
  CategorySlice,
} from './components/CategoryDonut';

export { StoreBars } from './components/StoreBars';
export type { StoreBarsProps, StoreBar } from './components/StoreBars';
