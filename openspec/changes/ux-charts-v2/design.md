# Design: UX Charts v2 — Home Categories & Analytics Redesign

## Technical Approach

Refresh the home and analytics UI layers without touching data hooks. Add stable category colors to `categories.ts`, build presentational chart and analytics components, and wire them into `src/app/(tabs)/index.tsx` and `src/app/(tabs)/analytics.tsx`. Existing hooks (`useHomeFeed`, `useMonthlyTotals`, `useBudget`) and the receipts store feed the new UI; new pure aggregators live in `src/features/charts/aggregate.ts`.

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|---|---|---|---|
| Category colors | A) Index-based `CHART_PALETTE`; B) Stable key-mapped colors | A) unstable across screens; B) requires donut migration | B — add `background`/`foreground` to `ExpenseCategory`; donut falls back to `CHART_PALETTE` for unknown/null keys |
| Home category layout | Horizontal strip vs. vertical list | Strip needs less space; list matches the Budget reference and supports full-width color | Vertical full-width colored cards (Budget reference) |
| Per-category budget | Derive from total budget vs. hide until backend exists | Derived limits are misleading; hiding matches the spec wording "when a budget exists" | Hide limit metadata when no per-category budget exists |
| Weekly bars | `victory-native` Bar vs. custom View bars | Victory bars are hard to style as rounded capsules with per-bar labels | Custom `WeeklyBarChart` using React Native Views |
| Hero dark theme | Reuse `inverseSurface` vs. add semantic hero tokens | Tokens are cleaner; `inverseSurface` already exists | Add `heroBackground`, `heroText`, `heroLine` tokens derived from `inverseSurface` |

## Data Flow

```
Home:
  useHomeFeed.categories ──► CategoryCard ──► /categories/{key}
                                   │
Analytics:                         │
  useReceiptsStore.list ──► aggregateCategoriesByMonth ──► CategoryBudgetRow + SegmentedBudgetBar
  useReceiptsStore.list ──► aggregateWeeklySpend ────────► WeeklyBarChart
  useMonthlyTotals ───────► InsightHeroCard (white line + delta chip)
  useBudget ──────────────► (no per-category limit today)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/features/home/categories.ts` | Modify | Add `background`, `foreground` to `ExpenseCategory`; export `getCategoryColor` |
| `src/app/(tabs)/index.tsx` | Modify | Render vertical colored `CategoryCard` stack instead of horizontal strip |
| `src/app/(tabs)/analytics.tsx` | Modify | Insights layout: hero, banner, weekly chart, summary cards, budget rows |
| `src/features/charts/components/CategoryDonut.tsx` | Modify | Derive slice color from category key; keep `CHART_PALETTE` fallback |
| `src/features/charts/aggregate.ts` | Modify | Add `aggregateWeeklySpend`, `aggregateDailyAverage`, `getTopCategory` |
| `src/features/charts/components/WeeklyBarChart.tsx` | Create | 7-day capsule bar chart with day initial and amount labels |
| `src/features/charts/components/InsightHeroCard.tsx` | Create | Dark hero card with "Gastado este mes", white line chart, delta chip |
| `src/features/analytics/components/InsightBanner.tsx` | Create | Red insight banner, hidden when no previous-month base exists |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Create | Colored row with category status, percent, and optional limit |
| `src/features/analytics/components/SegmentedBudgetBar.tsx` | Create | Proportional colored segments sized by percent of total spend |
| `src/features/analytics/components/MetricSummaryCard.tsx` | Create | "Top category" and "Daily avg" summary cards |
| `src/features/charts/index.ts` | Modify | Export new aggregators and `InsightHeroCard` |
| `src/features/analytics/index.ts` | Modify | Export new analytics components |
| `src/theme/colors.ts` | Modify | Add `heroBackground`, `heroText`, `heroLine` semantic tokens |

## Interfaces / Contracts

```ts
// src/features/home/categories.ts
export interface ExpenseCategory {
  key: ExpenseCategoryKey;
  label: string;
  icon: IconName;
  background: string;
  foreground: string;
}

export function getCategoryColor(key: string): { background: string; foreground: string };

// src/features/charts/aggregate.ts
export interface WeeklySpendPoint {
  day: string;      // full day label, e.g. "Mon"
  initial: string;  // single-letter label, e.g. "M"
  amount: number;
}

export function aggregateWeeklySpend(
  records: ReceiptSpendRecord[],
  weekStart?: string, // ISO date; defaults to start of current week
): WeeklySpendPoint[];

export function aggregateDailyAverage(
  records: ReceiptSpendRecord[],
  monthKey: string,
): number;

export function getTopCategory(
  records: ReceiptSpendRecord[],
  monthKey: string,
): HomeCategory | null;
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | New pure aggregators | Extend `scripts/test-charts.mjs` with zero-fill, max-day highlight, daily average, and top-category cases |
| Type | All new/modified TSX/TS files | `pnpm typecheck` |
| Visual | Donut/store chart regression | Manual check on `/pro/charts` after color migration; `StoreBars` is unaffected because it uses `CHART_PALETTE[0]` |

## Migration / Rollout

Split implementation into stacked PRs to protect review focus:

1. Color tokens and `categories.ts` color map.
2. Home vertical colored category cards.
3. Analytics presentational components and screen layout.
4. Donut color migration with `CHART_PALETTE` fallback.

Rollback: revert the relevant PR. Data hooks and stores remain unchanged, so rollback only restores the previous UI layer.

## Open Questions

None. Per-category budget limits were investigated: only an overall monthly budget exists via `useBudget`, so `CategoryBudgetRow` hides the limit line per the spec.
