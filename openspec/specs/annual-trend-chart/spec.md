# Annual Trend Chart Specification

## Purpose

A year-selectable 12-month bar chart card ("Tendencia anual") in the Pro trends screen, showing monthly totals for a chosen year with horizontal scroll, current-month highlight, and tap-to-drill-down.

## Requirements

### Requirement: Year Selector

The system MUST render a year selector with left/right chevron buttons and a centered year label inside the card. It MUST default to the current calendar year. `availableYears` MUST be derived from receipts `list` (sorted ascending, deduplicated). Left chevron disabled at earliest year; right chevron disabled at current year.

#### Scenario: Default year on mount

- GIVEN the user opens the Pro trends screen
- WHEN the annual card renders
- THEN the selected year is the current calendar year

#### Scenario: Navigate to a previous year

- GIVEN the user views the current year
- WHEN the user taps the left chevron
- THEN the selected year decreases by one and bars recompute

#### Scenario: Right chevron disabled at current year

- GIVEN the selected year equals the current year
- WHEN the user views the right chevron
- THEN it is visually disabled and non-interactive

#### Scenario: Left chevron disabled at earliest year

- GIVEN the earliest receipt year is 2024 and selected year is 2024
- WHEN the user views the left chevron
- THEN it is visually disabled and non-interactive

### Requirement: 12-Month Bar Chart with Horizontal Scroll

The system MUST render a `CapsuleBarChart` with exactly 12 bars (Jan–Dec), wrapped in horizontal `ScrollView` (`showsHorizontalScrollIndicator={false}`). Data MUST use `aggregateSpendTrend(list, monthsOfYear)` with 12 YYYY-MM keys. Months without receipts MUST be zero-filled.

#### Scenario: Bars render for a year with data

- GIVEN the selected year has receipts in multiple months
- WHEN the chart renders
- THEN exactly 12 bars appear, proportional to spend
- AND the chart is horizontally scrollable

#### Scenario: Zero-filled months

- GIVEN the selected year has receipts only in March and July
- WHEN the chart renders
- THEN March and July show spend; remaining 10 months show zero-height bars

### Requirement: Current Month Highlight

The system MUST highlight the current month's bar ONLY when `selectedYear === currentYear`. All other years MUST show no highlight.

#### Scenario: Current year highlights current month

- GIVEN selected year is 2026 and today is August
- WHEN the chart renders
- THEN the August bar has a distinct visual highlight

#### Scenario: Past year shows no highlight

- GIVEN selected year is 2024
- WHEN the chart renders
- THEN no bar has the highlight style

### Requirement: Monthly Total Labels

Each bar MUST display its spend as a formatted currency label using `formatCurrency`. Months with no receipts MUST show the locale-equivalent of $0.

#### Scenario: Label shows formatted amount

- GIVEN March 2025 has a total of $45,230
- WHEN the chart renders
- THEN the March bar displays the formatted amount

### Requirement: Empty Year State

When the selected year has zero receipts, the system MUST NOT render 12 zero bars. It MUST display "Sin gastos este año" inside the card.

#### Scenario: Year with no data

- GIVEN the selected year has no receipts
- WHEN the chart renders
- THEN the bar chart is NOT shown and "Sin gastos este año" appears

### Requirement: Bar Tap Drill-down

Each bar MUST be pressable. Tapping navigates to the monthly detail screen using the same route pattern as weekly day-tap. The route MUST include `?month={YYYY-MM}` for past months and omit the param for the current month.

#### Scenario: Tap navigates to month detail

- GIVEN the user taps the March 2025 bar
- WHEN navigation occurs
- THEN the app routes to monthly detail with `?month=2025-03`

#### Scenario: Current month tap omits month param

- GIVEN the user taps the current month bar in the current year
- WHEN navigation occurs
- THEN the route has no month param
