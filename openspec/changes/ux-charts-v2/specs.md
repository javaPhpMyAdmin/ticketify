# Spec: UX Charts v2 — Home Categories & Analytics Redesign

## Capabilities

- `analytics-tab-layout`: Insights-style redesign of the free analytics tab.
- `home-category-list`: Colored category cards on the home screen.
- `category-color-system`: Stable color mapping per expense category.
- `weekly-bar-chart`: Custom rounded vertical bars for week/day spend.
- `insight-hero-card`: Dark hero card with line chart and delta chip.
- `category-budget-row`: Colored category list item with status label and budget metadata.

## Functional Requirements

### Home Category List (`home-category-list`)

The system MUST render "Categorías de gastos" as colored cards. Each card MUST use the stable `ExpenseCategoryKey` color and show the category icon, localized name, and current-month spend. Tap navigates to `/categories/{key}`.

### Analytics Tab Layout (`analytics-tab-layout`)

The system MUST redesign `src/app/(tabs)/analytics.tsx` to match the Insights reference: dark hero, insight banner, weekly bar chart, and summary cards. The layout MUST adapt to iOS and Android safe areas.

### Category Color System (`category-color-system`)

The system MUST assign each `ExpenseCategoryKey` a stable background and foreground color, reused across cards, analytics rows, and chart segments.

### Weekly Bar Chart (`weekly-bar-chart`)

The system MUST render a 7-day spend bar chart with capsule bars in gray and the maximum day in red. Each bar MUST show the day initial and amount. Data MUST be derived from existing receipts via pure aggregation; all-zero values MUST render a disabled/empty state.

### Insight Hero Card (`insight-hero-card`)

The system MUST render a dark hero card showing "Gastado este mes", the selected month total, a white `victory-native` line chart, and a previous-month delta chip hidden when no previous-month data exists.

### Category Budget Row (`category-budget-row`)

The system MUST render a horizontal segmented budget bar sized by category percent of total spend, colored by stable category colors, ordered descending. Spend and limit MUST show when a budget exists; otherwise the limit MUST be hidden.

### Insight Banner (`insight-banner`)

The system MUST render an insight banner below the hero with an icon and Spanish text, hidden when no previous-month base exists.

### Summary Cards (`analytics-tab-layout`)

The system MUST render "Top category" and "Daily avg" cards under the weekly chart, showing the top category and daily average.

## Non-Functional Requirements

- Reuse existing data hooks/stores; no new backend calls or RPCs.
- User-facing text MUST be neutral Spanish; code comments MUST be English.
- UI MUST work on iOS and Android in light mode only.
- New components MUST be presentational and pass `pnpm typecheck`.

## Edge Cases / Error States

| Case | Behavior |
|---|---|
| Empty categories | Show existing empty state copy. |
| Single category | Render one full-width colored card / 100% segment. |
| All-zero weekly values | Render minimal gray $0 bars with no selection. |
| Missing budget | Hide limit; show spend and percent only. |
| Missing previous month | Hide delta chip and banner. |
| Failed `useMonthlyTotals` | Show existing error/empty state instead of charts. |

## Acceptance Scenarios

### Scenario: Home category strip uses stable colors

- GIVEN the user is on the home screen with receipts this month
- WHEN the section renders
- THEN each card background matches its `ExpenseCategoryKey` color and tapping navigates to `/categories/{key}`

### Scenario: Analytics hero shows month trend

- GIVEN the user is on the Analytics tab with selected-month receipts
- WHEN the hero renders
- THEN it shows "Gastado este mes", a white line chart, and a previous-month delta chip

### Scenario: Weekly chart highlights max spend day

- GIVEN the weekly bar chart has 7 daily totals
- WHEN it renders
- THEN the highest-spend day is red, the rest are gray, and each bar shows day initial + amount

### Scenario: Category budget bar reflects proportions

- GIVEN the analytics tab has two or more categories
- WHEN the segmented bar renders
- THEN each segment width matches the category's percent of total spend and uses its stable color
