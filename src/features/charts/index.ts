/**
 * Pro charts feature barrel (pro-subscription spec — REQ-CHART-1..6).
 *
 *   import { InsightHeroCard, StoreBars, aggregateDailySpend } from '@/features/charts';
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
  aggregateMonthlyDelta,
  aggregateWeeklySpend,
  aggregateDailyAverage,
  aggregateDailySpend,
  aggregateDayItems,
  aggregateDayTotal,
  aggregateYearlySpend,
  availableYearsFromCache,
  yearlyPointsFromCache,
  getMondayOfWeek,
  getTopCategory,
  pickMaxSpendIndex,
  buildVisibleDailySeries,
  buildDailyInsight,
  weekdayInitialsForMonth,
  WEEKDAY_NAMES,
} from './aggregate';
export type {
  SpendTrendPoint,
  StoreSpend,
  HomeCategory,
  MonthlyDelta,
  WeeklySpendPoint,
  DayItemGroup,
  DailyInsight,
  DailySpendPoint,
  YearlySpendPoint,
  VisibleDailySeries,
} from './aggregate';

export { categoryDetailHref } from './categoryHref';

export { CapsuleBarChart } from './components/CapsuleBarChart';
export type {
  CapsuleBarChartItem,
  CapsuleBarChartProps,
} from './components/CapsuleBarChart';

export { DayDetailModal } from './components/DayDetailModal';
export type { DayDetailModalProps } from './components/DayDetailModal';

export { InsightHeroCard } from './components/InsightHeroCard';
export type { InsightHeroCardProps } from './components/InsightHeroCard';

export { CategoryDonut, CHART_PALETTE } from './components/CategoryDonut';
export type {
  CategoryDonutProps,
  CategorySlice,
} from './components/CategoryDonut';

export { StoreBars } from './components/StoreBars';
export type { StoreBarsProps, StoreBar } from './components/StoreBars';

export { ChartLegend } from './components/ChartLegend';
export type { ChartLegendItem } from './components/ChartLegend';

export { ChartTooltip } from './components/ChartTooltip';
export { useChartTooltip } from './hooks/useChartTooltip';
export type { TooltipState, UseChartTooltipResult } from './hooks/useChartTooltip';
