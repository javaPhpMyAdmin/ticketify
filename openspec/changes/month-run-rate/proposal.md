# Proposal: Current-Month Run-Rate Card

## Intent

Home shows what was spent, not the spending pace. Full-month totals and completed-month MoM deltas exist (`computeMonthOverview`, `aggregateMonthlyDelta`), but nothing answers "am I on track mid-month?". This adds a Home card: "Vas $X este mes (Y% vs mes anterior)" + "Al ritmo actual cerras en ~$Z", tap → Analytics.

## Confirmed product assumptions (user-approved)

- Baseline: same-calendar-days MoM primary; fallback ≤3 available historical months pro-rated to day N; none → hidden.
- Projection: `MTD ÷ dayOfMonth × daysInMonth`, whole UYU.
- Current month only; personal-only; read failure → hidden (never fabricate numbers).

## Scope

### In Scope
- `aggregateRunRate(cacheRows, referenceDate)` — pure fn: MTD from `daily_totals` (clamped ≤ today, local tz), MoM delta, historical-avg fallback, projection.
- `useRunRate(monthKey)` — consumes `useMonthlyCache` + `readMonthlyCacheRows`; null when month ≠ current, data < 3 spend days, no baseline, or read failure.
- `RunRateCard` (features/home/components/) + barrel export; mounted in Home `ListHeaderComponent` below the month selector and above `MonthlyBudgetCard`.
- Tap → `router.push('/analytics')`.

### Out of Scope
- Household run-rate; any SQL/RPC/migration (zero backend change); analytics/charts changes; card settings/toggles.

## Capabilities

### New Capabilities
- `monthly-run-rate`: MTD aggregation from `daily_totals`, MoM baseline + historical-avg fallback, projection math, gating (current month, min data, no baseline → hidden), personal-only, tap-to-analytics.

### Modified Capabilities
- None — `monthly-totals-cache`/`data-access` requirements unchanged; run-rate adds only a consumer of existing reads.

## Approach

Client-side pure logic, no SQL. `aggregateRunRate` sums `daily_totals` days ≤ today for current + prev-month same-day window; missing/empty prev → average last ≤3 available cache rows pro-rated to day N; none → hide. Projection `MTD ÷ day × daysInMonth`; `formatCurrencyWhole` (UYU), `Math.round(x*1000)/10` for %. Local "today" via `todayLocalISO()` — NOT UTC `utcYearMonth()`. Follow Home/Analytics patterns (`Card`, `InsightBanner`/`PriceAlertBanner`). Feb-vs-31d: day-vs-day compare; denominator = current month length.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/home/lib/runRate.ts` | New | pure aggregator |
| `src/features/home/hooks/useRunRate.ts` | New | cache-consumer hook |
| `src/features/home/components/RunRateCard.tsx` | New | card UI + tap |
| `src/features/home/index.ts` | Modified | barrel exports |
| `src/app/(tabs)/index.tsx` | Modified | mount card in list header |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Day 1-2 degenerate % / projection | Med | hide until ≥3 spend days |
| UTC/local day cut-off drift | Low | `todayLocalISO()`; clamp future days |
| Misleading baseline (new user, noisy month) | Med | 3-month fallback; hide when no baseline |
| Copy reads as a guarantee | Low | "~" + "al ritmo actual" framing |

## Rollback Plan

Revert the PR: unmount card, delete `runRate.ts`/`useRunRate.ts`/`RunRateCard.tsx`, restore barrel. Pure client code — no migration, no data risk. `pnpm typecheck` gates.

## Dependencies

- `monthly_user_totals` + `daily_totals` (migration 0015), `readMonthlyCacheRows` (:791), `useMonthlyCache` — all existing.

## Success Criteria

- [ ] `pnpm typecheck` passes.
- [ ] Mid-month: MTD, % vs same-days last month, and ~projection match hand-computed values from cache rows.
- [ ] Day 1-2, empty month, read failure, past-month view: card hidden.
- [ ] Tap navigates to Analytics.

## Proposal question round

Resolved (user-approved 2026-09-08): (1) placement — below month selector, above `MonthlyBudgetCard`; (2) min-data threshold — 3 spend days; (3) historical fallback — "≤3 available months" (min 1). See spec (`specs/monthly-run-rate/spec.md`) as authoritative source for the frozen scope.