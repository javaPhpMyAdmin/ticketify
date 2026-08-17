# Design: Trends Insights v3 — Weekly Label, Hero Insight, Category Drill-down

## Technical Approach

Three independent presentational additions to the Pro trends screen with zero math/schema/query changes (spec: No Aggregation, Schema, or Semantics Changes). (1) A static caption under the week-view chart header documents the weekly bars' services exclusion. (2) A new pure function `buildDailyInsight` derives the hero insight from the card's existing `dailyData` + `monthKey` props; `InsightHeroCard` renders the template line. (3) `CategoryBudgetRow` gains an optional `onPress` wired to the existing `/categories/[key]` screen via the History navigation pattern. Pure math lives in `aggregate.ts` and is exercised by the existing charts harness (`scripts/test-charts.mjs`, baseline 73/73 green).

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|---|---|---|---|
| Insight fn location | New `insights.ts` module vs. `aggregate.ts` | New module needs harness compile-list + barrel plumbing; `aggregate.ts` already hosts the daily helpers and is harness-compiled for free | `aggregate.ts` |
| `buildDailyInsight` return | Formatted string vs. structured `DailyInsight \| null` | String pulls `formatCurrency` (a UI concern) into the math module and grows harness deps; structured keeps math pure, formatting stays in the card (already imports `formatCurrency`) | Structured result; `currency` dropped from the proposal's signature — spec only mandates formatting, not where |
| Average base | `aggregateDailyAverage(list, monthKey, [])` vs. derive from `dailyData` (sum ÷ length) | `dailyData` is zero-filled by `aggregateDailySpend` (servicios incl.), so sum ÷ length == total ÷ days — identical numbers, but the fn becomes a pure function of the card's own props, exactly as the spec requires | Derive from `dailyData` |
| Weekday names | Reuse `WEEKDAY_SHORT` vs. full names | Template reads "el Lunes 3"; short names read stilted; full-name array already exists in charts.tsx (duplicate) | Move `WEEKDAY_NAMES` (full, Sunday-first) into `aggregate.ts` as single source; charts.tsx `dayLabel` imports it from the barrel |
| Caption placement | Inside `chartHeader` (column restructure) vs. standalone Text below it | Column restructure risks segmented-control alignment; standalone keeps layout intact | Standalone caption Text, only when `period === 'week'` |
| Row interaction | Themed `Pressable` always (disabled) vs. conditional View/Pressable | Spec mandates a non-interactive View without `onPress` (analytics tab output stays byte-identical) | Conditional: `onPress ? Pressable (role="button", a11y label) : View` — mirrors `CategoryBudgetCard` |
| Insight rendering | Inside header row vs. between header and chart | Header is a row (kicker/month/total + chip); a full-width line below it needs no layout surgery | Standalone `Text` after the header `View`, before chart/empty state |

Multiple rule: `N = max(1, round(max ÷ avg))`. Math note (documented in code): max ≥ mean always, so round ≥ 1 — `max(1,·)` is defense-in-depth; the avg=0 edge is likewise unreachable (avg=0 ⟺ all-zero ⟹ `pickMaxSpendIndex` = -1 ⟹ null). Guards stay enforced so the fn can never emit 0/NaN.

## Data Flow

```
InsightHeroCard (props: dailyData, monthKey, currency)
  └─ buildDailyInsight(dailyData, monthKey) ──► DailyInsight {day, weekday, amount, multiple} | null
       │   (pickMaxSpendIndex + sum/length avg + WEEKDAY_NAMES[jsDay])
       └─ Text: `Tu día más caro fue el {weekday} {day} ({formatCurrency(amount,currency)} · {N}x tu promedio)`

charts.tsx
  ├─ period === 'week' ──► <Text>Por día · sin servicios</Text> (below chart header)
  └─ totals[].category_slug ──► CategoryBudgetRow.onPress ──► router.push(
         monthKey === currentMonthKey() ? `/categories/${slug}` : `/categories/${slug}?month=${monthKey}`)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/features/charts/aggregate.ts` | Modify | Export `WEEKDAY_NAMES`, `DailyInsight`, `buildDailyInsight` (~35 lines) |
| `src/features/charts/index.ts` | Modify | Re-export `buildDailyInsight`, `DailyInsight`, `WEEKDAY_NAMES` |
| `src/features/charts/components/InsightHeroCard.tsx` | Modify | `useMemo` insight + header-area Text (bodyMd, heroText, opacity 0.7, numberOfLines=1 + adjustsFontSizeToFit) |
| `src/app/pro/charts.tsx` | Modify | Week-only caption + style; CategoryBudgetRow `onPress`; import `WEEKDAY_NAMES` from barrel, delete local copy (111-119) |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Modify | Optional `onPress?: () => void`; conditional View/Pressable |
| `scripts/test-charts.mjs` | Modify | Destructure `buildDailyInsight`; ~6 new tests (73 → ~79) |

## Interfaces / Contracts

```ts
// src/features/charts/aggregate.ts
export const WEEKDAY_NAMES: readonly string[]; // ['Domingo','Lunes',…,'Sábado'], Sunday-first

export interface DailyInsight {
  day: number;      // day-of-month of the highest-spend day (first max wins)
  weekday: string;  // full Spanish name, monthKey-derived, e.g. 'Lunes'
  amount: number;   // that day's total (servicios included — hero base)
  multiple: number; // Math.max(1, Math.round(amount / (sum(dailyData) / dailyData.length)))
}

export function buildDailyInsight(
  dailyData: readonly DailySpendPoint[],
  monthKey: string,
): DailyInsight | null; // null when no day has spend (all-zero ⇒ pickMaxSpendIndex = -1)
```

```tsx
// CategoryBudgetRow.tsx — additive prop, existing consumers unaffected
onPress?: () => void;

// charts.tsx — exact History precedent (history.tsx:363-369)
onPress={() =>
  monthKey === currentMonthKey()
    ? router.push(`/categories/${t.category_slug}`)
    : router.push(`/categories/${t.category_slug}?month=${monthKey}`)
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `buildDailyInsight` | Extend `scripts/test-charts.mjs`: real Aug fixture (day 3, 'Lunes', $20,289.51, 15x); first-max tie; single spend day (N = days-in-month); round-to-1 (avg ≈ max, never 0/negative); all-zero → null; empty → null |
| Type | All modified TS | `pnpm typecheck` |
| Visual/manual | Caption only in week view; insight recomputes on month/currency change; category tap → `/categories/{key}[?month=…]` | Device check during apply — also verifies RPC `category_slug` ↔ item.category alignment (known risk) |

## Migration / Rollout

No migration. Single commit series (diff < 200 lines). Rollback: revert component commits — no aggregation/schema/data changes.

## Risks

- ACCEPTED tradeoff (spec mandate, MUST NOT be "fixed"): insight multiple divides by the services-INCLUDED average (≈ $1,329) while the "Promedio diario" card shows the EXCLUDED base (≈ $373). The insight text must not claim parity with the card.
- WARNING: RPC `category_slug` ↔ store `item.category` alignment on drill-down — same registry (`getExpenseCategory`, fallback `otros`); device-verify one row during apply.
- INFO: `WEEKDAY_NAMES` move is content-identical; `dayLabel` output ("Lunes 11") must stay byte-equal.
- INFO: latent `getMondayOfWeek` UTC drift untouched (out of scope).

## Open Questions

None. All spec decisions encoded; the accepted avg-base tradeoff and slug alignment are tracked risks, not blockers.
