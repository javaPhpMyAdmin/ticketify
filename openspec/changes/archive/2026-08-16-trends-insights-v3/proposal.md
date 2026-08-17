# Proposal: Trends Insights v3 — Weekly Label, Hero Insight, Category Drill-down

## Intent

The Pro "Tus tendencias" screen (`src/app/pro/charts.tsx`) shows two daily charts with opposite inclusion rules: the hero daily bars INCLUDE `servicios` (charts.tsx:203-206 → `aggregateDailySpend`, aggregate.ts:348-364) while the weekly "Por día" bars EXCLUDE them (charts.tsx:255 → `aggregateWeeklySpend(list, weekStartISO, ['servicios'])`, aggregate.ts:245-271). Same-looking numbers, different semantics — root cause verified with real data (Aug 13, 2026: day total $5,862.00 incl. vs $782 excl.). This change stops the contradiction with a label, adds one template insight line to the hero, and wires category rows to the existing drill-down screen. No aggregation math changes.

## Scope

### In Scope
1. **Weekly services label (documentational only)**: caption under the weekly card title (charts.tsx:367) — "Por día · sin servicios". No math change.
2. **Hero textual insight (single line, template, no LLM)**: "Tu día más caro fue el {weekday} {day} ({amount} · {N}x tu promedio)". Built from the EXISTING daily data (servicios INCLUDED — same base as hero bars, charts.tsx:203-206). Multiple = max/avg, rounded to nearest integer, floored at 1, hidden when avg is 0; whole line hidden when no spend (pickMaxSpendIndex = -1).
3. **Category drill-down wiring**: `CategoryBudgetRow` gets optional `onPress` (currently a plain View, CategoryBudgetRow.tsx:44-45) → `router.push` to the existing `/categories/[key]` screen, following the History precedent (history.tsx:363-369): omit `?month=` for the current month, else `?month=${monthKey}`. Route params verified: `useLocalSearchParams<{key, month?}>` (categories/[key].tsx:22-27), store-derived `useCategoryDetail` (useHomeFeed.ts:332-339). `t.category_slug` already maps via `getExpenseCategory` (charts.tsx:448).

### Out of Scope
- No new daily-average chip/line (Promedio diario card exists, charts.tsx:414-419).
- No TZ fix for the latent `getMondayOfWeek` UTC drift (aggregate.ts:190-196, 261-264) — future change.
- No changes to aggregation math or exclusion semantics — day-detail sheet (charts.tsx:230-241) and daily-avg card keep the services-excluded base.
- No schema/DB/RPC/RLS changes, no new screens or queries.

## Capabilities

### New Capabilities
- `pro-trends-insights`: Pro trends insight layer — weekly exclusion caption, hero textual insight line, category-row drill-down navigation.

### Modified Capabilities
- None (no existing main spec covers the Pro trends screen).

## Approach

1. Static caption Text under the weekly card title.
2. New pure fn `buildDailyInsight(dailyData, monthKey, currency)` in `aggregate.ts` reusing `pickMaxSpendIndex` (aggregate.ts:539-550) + `aggregateDailyAverage` (no exclusions) + weekday names; ~5-8 tests in `scripts/test-charts.mjs`; one Text slot in `InsightHeroCard`.
3. Optional `onPress` prop on `CategoryBudgetRow` (wrap row in Pressable); pass `router.push` in charts.tsx:447-460 per the History pattern.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/pro/charts.tsx` | Modified | Weekly caption (~367), insight wiring, category row onPress (447-460) |
| `src/features/charts/components/InsightHeroCard.tsx` | Modified | Insight line slot |
| `src/features/charts/aggregate.ts` | Modified | `buildDailyInsight` pure fn |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Modified | Optional `onPress` prop |
| `scripts/test-charts.mjs` | Modified | `buildDailyInsight` tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Insight "tu promedio" (incl. ≈ $1,329) differs from "Promedio diario" card (excl. ≈ $373) — ACCEPTED product tradeoff (user chose hero base) | Certain | Documented here; insight must not claim parity with the card |
| RPC `category_slug` vs `item.category` key alignment on drill-down | Med | Same registry (`getExpenseCategory`); device-verify one row |
| Latent `getMondayOfWeek` UTC+x drift | Low (latent, UTC-3 target) | Out of scope; logged for future change |

## Rollback Plan

Revert the component commits. No aggregation, schema, or data changes — rollback restores the previous UI only.

## Dependencies

- Existing expo-router typed routes, existing aggregators, victory-native. No new deps.

## Success Criteria

- [ ] Weekly card shows the services-exclusion caption; chart numbers unchanged.
- [ ] Hero insight renders correct max day/amount/multiple (Aug 2026 fixture: day 3, $20,289.51, ≈15x).
- [ ] Category rows navigate to existing `/categories/[key]` with correct month scoping.
- [ ] `pnpm typecheck` clean; `pnpm test:charts` 73+ green; diff < 200 lines (800-line review budget).
