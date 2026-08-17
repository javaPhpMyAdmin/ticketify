# Verify Report: trends-insights-v3

**Change**: trends-insights-v3 — Weekly Label, Hero Insight, Category Drill-down
**Version**: spec v1 (openspec/changes/trends-insights-v3/specs/pro-trends-insights/spec.md)
**Mode**: Standard (strict_tdd: false — openspec/config.yaml)
**Commits verified**: 27c40f6 (baseline, pre-existing, NOT re-reviewed) .. 97f4f99 (b402465, 1bd0337, eabc54f, d6fec8a, 5201ba5, 97f4f99)
**Device**: WO8XZLY999UWT8H6 (Xiaomi 2412DPC0AG, 1220x2712, com.ticketify.app), release APK built + installed from source

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 9 (1.1–4.1, all marked [x] in tasks.md) |
| Tasks complete | 9 |
| Tasks incomplete | 0 |

## Build & Tests Execution

**Build (release APK)**: ✅ Passed — `./gradlew assembleRelease` → BUILD SUCCESSFUL (1m 12s); `adb install -r` Success

**Tests**: ✅ 84 passed / 0 failed / 0 skipped — `pnpm test:charts`
```text
[tests] all 84 tests passed
  (includes buildDailyInsight: real Aug fixture day 3 → Lunes $20,289.51 ≈15x; first-max tie;
   single-spend day → days-in-month (28/29 leap); round+clamp Math.max(1,·); malformed keys → null;
   all-zero → null; empty → null — and categoryDetailHref: current → bare route, other → ?month)
```

**Typecheck**: ✅ Passed — `pnpm tsc --noEmit` → exit 0 (clean)

**Grep guards**: ✅ `hero-debug` in src/ → 0 hits; `gifted-charts` in src/ → 0 hits (also removed from package.json + lockfile)

**Coverage**: ➖ Not available (no coverage tooling configured; coverage_threshold 0)

## Spec Compliance Matrix (10 scenarios)

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Weekly Services-Exclusion Caption | Caption present with unchanged values | Source: `{period === 'week' ? <Text style={styles.weeklyCaption}>Por día · sin servicios</Text> : null}` after chartHeader, before `<CapsuleBarChart>` (charts.tsx:381-383); labelSm/textSecondary. Device: caption rendered under "Por día" weekly card; weekly bars unchanged ($560/$526/$382/$782/$812 — services-excluded) | ✅ COMPLIANT |
| Weekly Services-Exclusion Caption | Detail surfaces keep exclusion semantics | aggregate.ts diff is additive-only (+78, 0 removed lines — no aggregation function touched); device: "Promedio diario" card shows $372.62 (services-EXCLUDED ≈ $373 documented base, unchanged) | ✅ COMPLIANT |
| Hero Daily Insight Line | Insight renders from spend data | Unit: `real august fixture: day 3 → Lunes, $20,289.51, ≈15x` PASSED. Device: hero shows `Tu día más caro fue el Lunes 3 ($20,289.51 · 15x tu promedio)` — exact match | ✅ COMPLIANT |
| Hero Daily Insight Line | Zero average floors the multiple | Unit: `round + clamp: rounds to nearest integer, never emits 0 or negative (Math.max(1, ·))` PASSED; source `Math.max(1, Math.round(max/avg))` | ✅ COMPLIANT |
| Hero Daily Insight Line | No-spend month hides the line | Unit: `all-zero month → null (insight hidden)` PASSED; source `{insight ? <Text …/> : null}` (InsightHeroCard.tsx:225-234) | ✅ COMPLIANT |
| Hero Daily Insight Line | Month change recomputes | Device: Aug → Mar changed insight to `Tu día más caro fue el Lunes 9 ($958.34 · 31x tu promedio)` (single spend day → 31x = days in March) | ✅ COMPLIANT |
| Category Row Drill-down | Tap navigates for a past month | Unit: `categoryDetailHref: other month → route scoped with ?month=YYYY-MM` PASSED (pure fn, shared with History tab). On-device past-month tap NOT executed — device disconnected (see WARNING-1) | ⚠️ COMPLIANT (unit) — device check blocked |
| Category Row Drill-down | Tap navigates for the current month | Unit: `current month → bare route, no month param` PASSED. Device: Lácteos row tap → category detail screen, header "Lácteos", TOTAL DEL MES $1,003.77 (exact match with row amount), real transactions rendered (Leche ultra extra c $282.00, Leche conaprole fresca comun $180.80, Queso cheddar conaprole $155.00, …) — slug↔store alignment PROVEN | ✅ COMPLIANT |
| Category Row Drill-down | Row without onPress stays inert | Source: conditional render `onPress ? themed Pressable (role="button", a11y label) : plain View` (CategoryBudgetRow.tsx:82-93); only consumer charts.tsx passes onPress | ✅ COMPLIANT |
| No Aggregation, Schema, or Semantics Changes | Charts match prior behavior | aggregate.ts diff additive-only (0 removed lines); all pre-existing chart tests green within 84/84; device weekly bar values unchanged | ✅ COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant (8 with runtime/device evidence, 2 with passing unit test + source)

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| buildDailyInsight exists in aggregate.ts, structured DailyInsight, null on all-zero/empty/malformed monthKey | ✅ Implemented | aggregate.ts:600-628; strict `^\d{4}-\d{2}$` guard + integer/range guard + pickMaxSpendIndex −1 → null |
| WEEKDAY_NAMES single-source in aggregate.ts; WEEKDAY_SHORT derived from it | ✅ Implemented | aggregate.ts:558-566 (Sunday-first full names); InsightHeroCard.tsx:36 `WEEKDAY_NAMES.map(n => n.slice(0,3))`; charts.tsx dayLabel imports WEEKDAY_NAMES from barrel (local copy deleted) |
| CategoryBudgetRow optional onPress → themed Pressable (role="button", a11y label) vs plain View | ✅ Implemented | CategoryBudgetRow.tsx:82-93; accessibilityLabel `${name}: ${formatCurrency(amount, currency)}`; byte-identical View branch |
| charts.tsx: week-only "sin servicios" caption (period === 'week'); drill-down via categoryDetailHref(slug, monthKey, currentMonthKey()) | ✅ Implemented | charts.tsx:381-383 (caption), 453-461 (onPress wiring); categoryHref.ts:10-18 pure fn, template-literal return type passes expo-router typed routes without casts |
| InsightHeroCard insight line from buildDailyInsight, hidden when null, formatCurrency, adjustsFontSizeToFit | ✅ Implemented | InsightHeroCard.tsx:123-126 (useMemo), 225-234 (Text: numberOfLines={1}, adjustsFontSizeToFit, minimumFontScale={0.8}, bodyMd/heroText/opacity 0.7); template uses formatCurrency(insight.amount, currency) |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| buildDailyInsight in aggregate.ts (not new module) | ✅ Yes | + harness compiles it for free |
| Structured `DailyInsight \| null` (currency dropped from signature) | ✅ Yes | formatting stays in the card |
| Average derives from dailyData (sum ÷ length) | ✅ Yes | pure fn of card props |
| WEEKDAY_NAMES moved to aggregate.ts, content-identical | ✅ Yes | dayLabel byte-equal ("Lunes 11") |
| Caption standalone Text below chartHeader, week-only | ✅ Yes | labelSm/textSecondary |
| Conditional Pressable/View on CategoryBudgetRow | ✅ Yes | mirrors CategoryBudgetCard pattern |
| Insight Text between header and chart | ✅ Yes | no layout surgery |
| Review-fix: categoryDetailHref extracted to module, shared with history.tsx | ✅ Yes (deviation, additive) | replaces inline ternary from design; byte-identical behavior, single source for both consumers; history.tsx:363-369 precedent |
| Review-fix: strict YYYY-MM guard in buildDailyInsight | ✅ Yes (deviation, additive) | required so mandated malformed-key tests are honest; no app-visible change (getMonthKey always zero-pads) |

## Issues Found

**CRITICAL**: None

**WARNING**:
1. On-device past-month drill-down (`?month=` scoping) not executed — device WO8XZLY999UWT8H6 disconnected mid-verification (flaky USB; multiple adb restarts, eventual total drop; not recoverable via software). Mitigation: covered by passing unit test for categoryDetailHref + the same pure fn drives the pre-existing History tab, so the two can't drift. Re-verify on next device session if desired.
2. September no-spend UI state not observable on device — the right month arrow is `disabled` when the selected month is the newest with receipts (`canGoNewer = currentIndex > 0`; month-selector code untouched by this change, verified via git diff). September has no receipts, so it is not in `getAvailableMonthKeys` and cannot be reached by the arrows. No-spend hide behavior is covered by the passing unit test + conditional render source. Not a defect.

**SUGGESTION**: None

## Verdict

**PASS WITH WARNINGS** — 9/9 tasks complete; 84/84 tests green; tsc clean; release APK builds and installs; device-verified: insight line (exact text), week-only caption, current-month category drill-down with RPC `category_slug` ↔ store `item.category` alignment PROVEN (Lácteos → detail screen with matching total $1,003.77 and real transactions), month-change insight recompute (Aug → Mar). Warnings are device-coverage gaps (hardware disconnect + unreachable empty month), not implementation defects.

## Device-Verified Texts (actual)

- Insight (Aug 2026): `Tu día más caro fue el Lunes 3 ($20,289.51 · 15x tu promedio)`
- Insight (Mar 2026, recompute): `Tu día más caro fue el Lunes 9 ($958.34 · 31x tu promedio)`
- Weekly caption: `Por día · sin servicios`
- Category screen after tapping Lácteos row: header `Lácteos`, `TOTAL DEL MES` `$1,003.77`, transactions `Leche ultra extra c $282.00`, `Leche conaprole fresca comun $180.80`, `Queso cheddar conaprole $155.00`, `Leche fresca entera $135.57`, `Leche conaprole fresca comun 1 $90.40`, `Leche entera $80.00`, `Leche entera l vida $80.00`
