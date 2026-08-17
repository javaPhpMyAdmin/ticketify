# Pro Trends Insights Specification

## Purpose

Insight layer for the Pro "Tus tendencias" screen (`src/app/pro/charts.tsx`): a documentational caption on the weekly "Por día" card clarifying that its bars exclude `servicios`, a single template-based textual insight line on the hero card, and pressable category rows that navigate to the existing `/categories/[key]` screen. Purely presentational: no aggregation math, schema, RLS, query, or LLM changes.

## Requirements

### Requirement: Weekly Services-Exclusion Caption

The weekly "Por día" card MUST show the caption "Por día · sin servicios" beneath its card title. The caption MUST be documentational only: weekly bar values MUST remain computed with the existing services-excluding aggregation and MUST NOT change. The day-detail sheet and the "Promedio diario" card MUST keep their current services-excluded behavior.

#### Scenario: Caption present with unchanged values

- GIVEN the Pro trends screen renders a month with weekly data
- WHEN the weekly "Por día" card renders
- THEN the caption "Por día · sin servicios" appears under the card title
- AND each bar amount equals the previous services-excluded total

#### Scenario: Detail surfaces keep exclusion semantics

- GIVEN a weekly day whose services-excluded total is lower than its raw total
- WHEN the user opens the day-detail sheet
- THEN the sheet and the "Promedio diario" card still use the services-excluded base, unchanged

### Requirement: Hero Daily Insight Line

The hero card MUST render a single-line textual insight "Tu día más caro fue el {weekday} {day} ({amount} · {N}x tu promedio)" from the hero's daily data (services INCLUDED, same base as the hero bars). {weekday} MUST be the Spanish weekday name and {day} the day number of the highest-spend day; {amount} MUST be formatted with the existing locale-aware `formatCurrency` using the current currency; {N} MUST be max-day amount ÷ monthly daily average, rounded to the nearest integer and floored at 1, or hidden when the average is 0. The insight MUST recompute from the card's `dailyData`, `currency`, and `monthKey` props and MUST be hidden entirely when no day has spend (no maximum day).

Known limitation (accepted product tradeoff): {N} divides by the services-INCLUDED average (Aug 2026 ≈ $1,329), which differs from the "Promedio diario" card's services-EXCLUDED average (≈ $373). The bases MUST NOT be unified.

#### Scenario: Insight renders from spend data

- GIVEN a month with spend on at least one day
- WHEN the hero card renders
- THEN the insight shows "Tu día más caro fue el {weekday} {day} ({formatted amount} · {N}x tu promedio)"
- AND {N} equals max ÷ services-included average, floored at 1

#### Scenario: Zero average floors the multiple

- GIVEN a max-day amount whose division yields a multiple below 1
- WHEN the insight computes {N}
- THEN {N} renders as 1, never 0 or negative

#### Scenario: No-spend month hides the line

- GIVEN a month whose daily totals are all zero
- WHEN the hero card renders
- THEN the insight line is not rendered

#### Scenario: Month change recomputes the insight

- GIVEN the user changes the selected month
- WHEN the hero re-renders with the new `dailyData` and `monthKey`
- THEN the insight reflects the new month's max day, amount, and multiple
- AND a no-spend new month hides the line

### Requirement: Category Row Drill-down

Category rows in the "por categoría" section MUST be pressable and MUST navigate to the existing `/categories/[key]` screen via `router.push`, reusing the existing screen and query (no new queries, no RLS changes). For the current month the route MUST omit the month param; for any other month the route MUST include `?month={monthKey}`. `CategoryBudgetRow` MUST accept an optional `onPress`; without it the row MUST remain a non-interactive View.

#### Scenario: Tap navigates for a past month

- GIVEN the selected month is not the current month
- WHEN the user taps a category row
- THEN the app routes to `/categories/{key}?month={monthKey}`

#### Scenario: Tap navigates for the current month

- GIVEN the selected month is the current month
- WHEN the user taps a category row
- THEN the app routes to `/categories/{key}` with no month param

#### Scenario: Row without onPress stays inert

- GIVEN a `CategoryBudgetRow` rendered without `onPress` by another consumer
- WHEN the user taps it
- THEN nothing happens

### Requirement: No Aggregation, Schema, or Semantics Changes

This change MUST NOT alter aggregation math, services-exclusion semantics, weekly/daily chart values, the day-detail sheet, the daily-average card, schema, DB/RPC/RLS, or existing queries. The insight MUST NOT use an LLM. A new daily-average chip and the latent `getMondayOfWeek` UTC drift fix are explicitly out of scope.

#### Scenario: Charts match prior behavior

- GIVEN the change is applied
- WHEN the Pro trends screen renders
- THEN weekly and daily chart values are identical to pre-change output
