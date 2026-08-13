# Tasks: UX Charts v2 — Home Categories & Analytics Redesign

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,050–1,250 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 home → PR 3 analytics components → PR 4 analytics screen + verify |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Stable colors, aggregators, donut fallback | PR 1 | `categories.ts`, `colors.ts`, `aggregate.ts`, `CategoryDonut.tsx` |
| 2 | Home colored cards + segmented bar | PR 2 | `CategoryBudgetCard`, `SegmentedBudgetBar`, `index.tsx` |
| 3 | Analytics chart components | PR 3 | `WeeklyBarChart`, `InsightHeroCard` |
| 4 | Analytics banners/summary/rows + screen wiring | PR 4 | `InsightBanner`, `MetricSummaryCard`, `CategoryBudgetRow`, `analytics.tsx` |
| 5 | Verification | PR 4 | `test-charts.mjs`, `pnpm typecheck`, `pnpm test` |

## Phase 1: Foundation

- [x] 1.1 Add `background`/`foreground` to `ExpenseCategory` and every entry in `src/features/home/categories.ts`; export `getCategoryColor(key)` with fallback to `otros`.
- [x] 1.2 Add `heroBackground`, `heroText`, `heroLine` to `src/theme/colors.ts`.
- [x] 1.3 Update `src/features/charts/components/CategoryDonut.tsx` to derive slice color from `getCategoryColor(id).background`, falling back to `CHART_PALETTE[index]` for unknown/null keys.
- [x] 1.4 Add `aggregateWeeklySpend`, `aggregateDailyAverage`, `getTopCategory`, and `WeeklySpendPoint` to `src/features/charts/aggregate.ts`.
- [x] 1.5 Export new items from `src/features/charts/index.ts` and `src/features/analytics/index.ts`.
- [x] 1.6 Extend `scripts/test-charts.mjs` with weekly zero-fill, max-day, daily-average, and top-category cases.

## Phase 2: Home UI

- [x] 2.1 Create `src/features/home/components/CategoryBudgetCard.tsx`: colored card with icon, name, amount, percent; uses `getCategoryColor`.
- [x] 2.2 Create `src/features/home/components/SegmentedBudgetBar.tsx`: proportional colored segments, descending order, full-width single-category fallback.
- [x] 2.3 Redesign the categories section in `src/app/(tabs)/index.tsx` as a vertical stack of `CategoryBudgetCard` plus `SegmentedBudgetBar`; remove horizontal strip styles.

## Phase 3: Analytics Components

- [x] 3.1 Create `src/features/charts/components/WeeklyBarChart.tsx`: 7 capsule bars, gray default, red max day, day-initial + amount labels, disabled all-zero state.
- [x] 3.2 Create `src/features/charts/components/InsightHeroCard.tsx`: dark hero, "Gastado este mes", month total, white victory-native line, hidden delta chip.
- [x] 3.3 Create `src/features/analytics/components/InsightBanner.tsx`: red banner with icon and Spanish copy, hidden when no previous-month base.
- [x] 3.4 Create `src/features/analytics/components/MetricSummaryCard.tsx`: reusable "Top category" and "Daily avg" cards.
- [x] 3.5 Create `src/features/analytics/components/CategoryBudgetRow.tsx`: colored row with percent, amount, and optional limit.

## Phase 4: Analytics Screen

- [x] 4.1 Replace `MonthlyOverviewCard`/`CategoryBreakdownList` in `src/app/(tabs)/analytics.tsx` with hero, banner, weekly chart, summary cards, and category rows.
- [x] 4.2 Clean up dead imports and styles left after the layout swap.

## Phase 5: Verification

- [x] 5.1 Run `pnpm typecheck`; fix TS regressions.
- [x] 5.2 Run `pnpm test`; fix failing tests.
- [x] 5.3 Verify `/pro/charts` donut still renders and colors fallback for unknown keys.
