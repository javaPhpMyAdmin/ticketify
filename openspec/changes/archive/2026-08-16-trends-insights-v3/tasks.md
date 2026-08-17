# Tasks: Trends Insights v3 — Weekly Label, Hero Insight, Category Drill-down

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~210–250 (6 files, +6 tests) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pure insight math + harness tests | PR 1 | aggregate.ts, barrel, test-charts.mjs |
| 2 | InsightHeroCard insight slot | PR 1 | depends on unit 1 |
| 3 | CategoryBudgetRow optional onPress | PR 1 | independent of units 1–2 |
| 4 | charts.tsx caption + drill-down wiring | PR 1 | depends on units 1 + 3 |
| 5 | Final typecheck + test gate | PR 1 | verification only |

## Phase 1: Foundation — Pure Insight Math (dependency root)

- [x] 1.1 In `src/features/charts/aggregate.ts`: export `WEEKDAY_NAMES` (full Spanish, Sunday-first, content-identical to charts.tsx:111-119), `DailyInsight` interface (`day`, `weekday`, `amount`, `multiple`), and pure `buildDailyInsight(dailyData, monthKey): DailyInsight | null` — max via `pickMaxSpendIndex`, avg = sum(dailyData) ÷ length, `multiple = Math.max(1, Math.round(max ÷ avg))`, weekday via `new Date(year, month - 1, day).getDay()`; returns null when no day has spend (all-zero ⇒ index -1); never emits 0/NaN.
- [x] 1.2 In `src/features/charts/index.ts`: re-export `WEEKDAY_NAMES`, `buildDailyInsight`, and type `DailyInsight`.
- [x] 1.3 In `scripts/test-charts.mjs`: destructure `buildDailyInsight` from the compiled module; add 6 tests (Aug fixture day 3 → 'Lunes', $20,289.51, ≈15x; first-max tie; single spend day → N = days-in-month; round-to-1 floor, never 0/negative; all-zero → null; empty → null). `pnpm test:charts` green: 73 → 79.

## Phase 2: Core — Component Slots (parallel)

- [x] 2.1 `src/features/charts/components/InsightHeroCard.tsx`: `useMemo` `buildDailyInsight(dailyData, monthKey)`; render standalone Text between the header View and the chart/empty state — `Tu día más caro fue el {weekday} {day} ({formatCurrency(amount, currency)} · {N}x tu promedio)` — styled bodyMd / heroText / opacity 0.7, `numberOfLines={1}` + `adjustsFontSizeToFit minimumFontScale={0.8}`; hidden when null (all-zero month); recomputes on `monthKey`/`dailyData` change, re-formats on `currency` change. Typecheck clean.
- [x] 2.2 `src/features/analytics/components/CategoryBudgetRow.tsx`: add optional `onPress?: () => void`; when set, wrap the row in a themed Pressable (accessibilityRole="button", accessibilityLabel `${name}: ${formatCurrency(amount, currency)}`, pressed dim), else keep the plain View (byte-identical output; only consumer is charts.tsx). Typecheck clean.

## Phase 3: Integration — charts.tsx Wiring

- [x] 3.1 `src/app/pro/charts.tsx`: caption Text `Por día · sin servicios` after the `chartHeader` View, before `<CapsuleBarChart>`, only when `period === 'week'` (labelSm, textSecondary); month/year views untouched.
- [x] 3.2 Same file: pass `onPress` to `CategoryBudgetRow` — `router.push('/categories/{slug}')` when `monthKey === currentMonthKey()`, else `router.push('/categories/{slug}?month={monthKey}')` using `t.category_slug` (History precedent history.tsx:363-369).
- [x] 3.3 Same file: import `WEEKDAY_NAMES` from `@/features/charts` barrel; delete the local copy (lines 111-119); `dayLabel` output stays byte-equal ("Lunes 11"). Typecheck clean.

## Phase 4: Verification — Final Gate

- [x] 4.1 `pnpm tsc --noEmit` clean; `pnpm test:charts` 79/79 green; `git diff --stat` ≤ ~250 changed lines — single PR, well under the 400/800-line review budgets.

## Risks

- ACCEPTED tradeoff (design.md): insight multiple uses the services-INCLUDED average (≈ $1,329) vs. the "Promedio diario" card's EXCLUDED base (≈ $373) — do not unify, do not claim parity.
- WARNING: RPC `category_slug` ↔ store `item.category` alignment — device-verify one category row drill-down during apply.
- INFO: pre-existing `console.log('[hero-debug]')` at charts.tsx:207-213 is unrelated — leave untouched.
