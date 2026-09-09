# Monthly Run-Rate Specification

## Purpose

Home shows how much was spent, not the spending pace. This capability adds a run-rate card for the current month: month-to-date (MTD) spend with a signed percent vs. the previous month's same-calendar-day window, plus an end-of-month projection («al ritmo actual, ¿cuánto vas a gastar?»). It is personal-only, 100% client-side over the existing `monthly_user_totals` cache, and never fabricates numbers: when data, baseline, or reads fail, the card is hidden.

## Requirements

### REQ-1: Month-to-date aggregation

The system SHALL compute MTD spend as the sum of `daily_totals` entries for days on or before the current local date (`todayLocalISO()`). The reference "today" MUST use the device-local calendar, never UTC. Entries dated after today SHALL be clamped (excluded).

**Given/When/Then**:

1. Given a current-month cache row with `daily_totals` for days 1..12 and today is the 8th, When MTD is computed, Then it equals the sum of days 1..8 only.
2. Given a `daily_totals` entry dated after today, When MTD is computed, Then that entry is excluded.
3. Given a cache row with empty `daily_totals`, When MTD is computed, Then MTD is 0 (a valid value for an empty month, not an error).

### REQ-2: Same-calendar-days MoM baseline

The system SHALL compute the primary baseline as the sum of the previous month's `daily_totals` for days 1..N, where N is today's day-of-month. February vs. 31-day months SHALL compare day-vs-day; the projection denominator SHALL always be the current month's day count.

**Given/When/Then**:

1. Given today is 2026-09-08 and both September and August have cache rows, When the baseline is computed, Then it equals the sum of Aug 1..8 daily totals.
2. Given the previous month's row is missing or has no spend in days 1..N, When the baseline is computed, Then the MoM baseline is unavailable and REQ-3 applies.

### REQ-3: Historical-average fallback baseline

When the MoM baseline is unavailable, the system SHALL fall back to the mean of the up to 3 most recent cache rows preceding the current month (minimum 1 available), scaled by the fraction of the current month elapsed (`dayOfMonth ÷ daysInCurrentMonth`). When no preceding rows exist, the baseline SHALL be unavailable and the card SHALL be hidden.

**Given/When/Then**:

1. Given rows exist for May, June, July but none for August, When the fallback is computed for Sep 8, Then the baseline is `(May+Jun+Jul) ÷ 3 × 8/30`.
2. Given only one preceding month row exists, When the fallback is computed, Then that single month's total is used.
3. Given no completed-month cache rows exist, When the fallback would be computed, Then no baseline is produced and the card is hidden.

### REQ-4: End-of-month projection

The system SHALL project the month close as `MTD ÷ dayOfMonth × daysInCurrentMonth`, rounded to whole UYU via `formatCurrencyWhole`. The projection SHALL always be presented as an estimate (leading "~", "al ritmo actual" framing), never as a guarantee.

**Given/When/Then**:

1. Given MTD $3.000 on Sep 8 (30-day month), When the projection is computed, Then it is $11.250.
2. Given the projection produces a fractional value, When formatted, Then it is rounded to a whole UYU figure.

### REQ-5: Visibility gate

The card SHALL render only when ALL hold: (a) the selected month key equals `currentMonthKey()`; (b) the current month has at least 3 days with a non-zero daily total; (c) a baseline exists (REQ-2 or REQ-3); (d) all reads succeeded. Otherwise the card SHALL be hidden, and the hidden state MUST NOT render an empty placeholder.

**Given/When/Then**:

1. Given the current month selected, 5 spend days and a baseline available, When Home renders, Then the card is visible.
2. Given a previous month selected, When Home renders, Then the card is hidden.
3. Given the current month has only 1-2 spend days, When Home renders, Then the card is hidden (degenerate % / projection avoided).
4. Given ≥3 spend days but no baseline, When Home renders, Then the card is hidden.

### REQ-6: Data source, cache-miss and read failure

The system SHALL read run-rate figures exclusively from the signed-in user's personal `monthly_user_totals` rows via the existing cache read path (`readMonthlyCacheRows`); household data SHALL NOT be aggregated. On cache-miss of the current month, the existing auto-recalc path SHALL populate the row and the card SHALL NOT render computed figures until it resolves. On an initial read error (no data yet) the card SHALL be hidden; on a background refetch failure with already-verified data, the card SHALL keep rendering the last-good figures (last-good policy, consistent with the budget card). The system MUST NOT fabricate, substitute, or estimate numbers when reads fail.

**Given/When/Then**:

1. Given the current-month row is missing, When the hook reads, Then recalculation is triggered and no computed figures render until the row resolves.
2. Given a baseline read fails (network/DB error) and no verified data exists yet, When the card would render, Then the card is hidden; given data was already verified, a later refetch failure keeps the last-good figures visible.
3. Given a household exists, When run-rate is computed, Then only the personal cache rows contribute.

### REQ-7: Card content and interaction

The card SHALL display both figures: (a) MTD spend with a signed percent delta vs. the baseline («$X este mes, Y% vs mes anterior»), and (b) the projected close («~$Z»). Percentages SHALL be rounded to 1 decimal (`Math.round(x*1000)/10`); currency SHALL use the whole-UYU notation consistent with Home/analytics. The card SHALL be pressable and SHALL navigate to the Analytics tab on tap. Copy SHALL be in rioplatense Spanish, warm and informal, consistent with existing Home insight copy (exact wording is product-defined).

**Given/When/Then**:

1. Given MTD $3.000 and baseline $2.500, When the card renders, Then the delta shows +20% and the estimate shows ~$11.250.
2. Given MTD below baseline, When the card renders, Then the percent delta is negative.
3. Given the user taps the card, When the tap registers, Then the app navigates to the Analytics tab.

### REQ-8: Card placement

The card SHALL render on Home between the month selector and the `MonthlyBudgetCard`, reusing the existing card/banner visual patterns (no new visual language).

**Given/When/Then**:

1. Given the card is visible, When the Home list header renders, Then the card appears below the month selector and above the budget card.
2. Given the card is hidden, When Home renders, Then the remaining elements keep their current order and spacing.

## Non-Functional Requirements

### NFR-1: Performance

The capability SHALL add no new backend calls beyond the existing cache reads; the historical fallback SHALL reuse the batch cache read. All computation SHALL be synchronous pure functions over already-fetched rows.

### NFR-2: Timezone and date correctness

All day boundaries SHALL derive from the device-local calendar (`todayLocalISO()`); UTC-derived month keys SHALL NOT drive run-rate math. Future-dated entries MUST be clamped.

### NFR-3: Accessibility

The card SHALL expose a single accessibility action with a label summarizing the run-rate. The hidden state MUST NOT leave focusable empty regions.

### NFR-4: Notation consistency

Currency SHALL match Home/analytics notation (UYU, whole units, no decimal cents). The estimate SHALL always carry the "~" marker so it cannot read as a guarantee. Percent deltas SHALL always be signed.

## Acceptance Gates

1. `pnpm typecheck` passes.
2. Mid-month hand-check: MTD, % vs. same-days last month, and ~projection match values hand-computed from the cache rows.
3. Hidden-state checks: day 1-2, empty month, previous-month view, no baseline, read failure — card absent in all five.
4. Feb-vs-31d check: baseline is day-vs-day; projection denominator is the current month's day count.
5. Cache-miss check: missing current-month row triggers auto-recalc; card renders only after the row resolves.
6. Tap check: tapping the card navigates to Analytics.