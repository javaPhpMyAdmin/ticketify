# Tasks: Annual Trend Chart

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 70–90 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Foundation — Format Helper

- [x] 1.1 Add `yearLabel(year: string): string` to `src/lib/format.ts` — returns the 4-digit year string as-is (keeps format logic centralized per design)

## Phase 2: Core Implementation — Charts Body

- [x] 2.1 Add `selectedYear` state (default: current year) and `availableYears` memo to `ChartsBody` in `src/app/pro/charts.tsx` — derive from `list` via `purchase_date.slice(0,4)` deduplicated+sorted
- [x] 2.2 Add `monthsOfYear` memo (12 YYYY-MM keys for selected year), `annualTrend` memo via `aggregateSpendTrend(list, monthsOfYear)`, and `hasAnnualData` check
- [x] 2.3 Add `currentMonthIdx` and `highlightIdx` computation — highlight only when `selectedYear === currentYear`
- [x] 2.4 Add year selector navigation helpers: `canGoPrevYear`, `canGoNextYear`, `goPrevYear`, `goNextYear`
- [x] 2.5 Render year selector row (Card with chevron left + year label + chevron right) — match existing `monthSelector` styling pattern; insert after summary row, before "Por categoría"

## Phase 3: Chart Rendering & Empty State

- [x] 3.1 Render conditional content inside the annual card: if `hasAnnualData`, show `ScrollView horizontal` wrapping `CapsuleBarChart` with `annualItems` mapping; else show "Sin gastos este año" text
- [x] 3.2 Map `annualTrend` to `CapsuleBarChartItem[]` — label from `shortMonthLabel`, value from `total`, highlight from `highlightIdx`; set container `minWidth: 12 * 44` for scroll overflow
- [x] 3.3 Wire `onPressItem` callback for bar tap drill-down — navigate with `?month={YYYY-MM}` for past months, omit param for current month (follow existing navigation pattern)

## Phase 4: Verification

- [x] 4.1 Run `pnpm typecheck` — verify no type errors
- [ ] 4.2 Manual verify: mount Pro trends → annual card shows 12 bars → year selector navigates → current month highlighted → empty year shows text → horizontal scroll works
