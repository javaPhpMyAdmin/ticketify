# Design: Annual Trend Chart

## Technical Approach

Add a self-contained "Tendencia anual" card to `ChartsBody` — a `Card` with a year selector (reusing the existing chevron pattern) and a 12-bar `CapsuleBarChart` wrapped in horizontal `ScrollView`. All data flows from the existing `useReceiptsStore.list` through the already-exported `aggregateSpendTrend`. No new aggregators, stores, or DB changes.

The implementation is a **single-file change** to `src/app/pro/charts.tsx` plus a small utility in `src/lib/format.ts`.

## Architecture Decisions

### Decision: Single-file card vs. extracted component

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Inline in `ChartsBody` | Simpler; keeps related state co-located; ~60 lines added | **Chosen** |
| Extract `AnnualTrendCard` component | Better isolation but adds a file + prop threading for `list`, `currency`, `selectedYear` | Rejected — overkill for one card |

**Rationale**: The annual card depends on the same `list` and `currency` already in `ChartsBody` scope. Extracting a component would require passing both as props or creating a context — not worth it for a single card.

### Decision: Year derivation — all unique years vs. last 3 years

| Option | Tradeoff | Decision |
|--------|----------|----------|
| All unique years from receipts | Shows every year the user has data for | **Chosen** |
| Last 3 years (like `aggregateYearlySpend`) | Simpler but hides older data | Rejected |

**Rationale**: Users importing receipts from past years need to see them. Deriving from `list` is trivial: `[...new Set(list.map(r => r.purchase_date.slice(0, 4)))].sort()`.

### Decision: Horizontal scroll — ScrollView wrapper vs. new prop on CapsuleBarChart

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Wrap CapsuleBarChart in ScrollView at call site | No component change; bar min-width set via container | **Chosen** |
| Add `scrollable` prop to CapsuleBarChart | Encapsulates scroll but couples component to one use case | Rejected |

**Rationale**: CapsuleBarChart's `columnWrap` uses `flex: 1` which naturally fills available width. Wrapping in a horizontal ScrollView with a fixed-minimum-width container forces 12 bars to overflow. The component stays unaware of scroll — correct separation.

### Decision: Empty year state — show "Sin gastos este año" vs. zero bars

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Text empty state | Clear UX; avoids 12 invisible bars | **Chosen** |
| Zero bars with muted labels | Consistent with 6-month chart | Rejected |

**Rationale**: 12 zero-height bars on a scrollable chart look broken and waste scroll space. Spec requires this.

## Data Flow

```
useReceiptsStore.list
        │
        ▼
availableYears = deriveYears(list)     ← new memo
        │
        ▼
selectedYear (useState, default: currentYear)
        │
        ├──▶ monthsOfYear = build 12 YYYY-MM keys for selectedYear
        │
        ▼
aggregateSpendTrend(list, monthsOfYear)  ← existing function
        │
        ▼
chartItems = map to CapsuleBarChartItem[]
  - label: shortMonthLabel(monthKey)
  - value: point.total
  - highlight: index === currentMonthIndex IF selectedYear === currentYear
        │
        ▼
ScrollView horizontal > CapsuleBarChart
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/app/pro/charts.tsx` | Modify | Add `selectedYear` state, `availableYears` memo, year selector UI, annual card section with horizontal scroll, empty state, and bar tap navigation |
| `src/lib/format.ts` | Modify | Add `yearLabel(year: string): string` helper — returns the 4-digit year string formatted for display (trivial but keeps format logic centralized) |

No changes to `src/features/charts/` — `aggregateSpendTrend` and `CapsuleBarChart` work as-is.

## Interfaces / Contracts

```typescript
// New helper in src/lib/format.ts
export function yearLabel(year: string): string {
  return year; // 4-digit year displayed as-is
}

// New computed values in ChartsBody (not exported)
const currentYear = String(new Date().getFullYear());
const availableYears: string[] = useMemo(
  () => [...new Set(list.map((r) => r.purchase_date.slice(0, 4)))].sort(),
  [list],
);
const [selectedYear, setSelectedYear] = useState(currentYear);

// 12-month key array for the selected year
const monthsOfYear: string[] = useMemo(() => {
  const year = selectedYear;
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`,
  );
}, [selectedYear]);

// Annual trend data (zero-filled)
const annualTrend = useMemo(
  () => aggregateSpendTrend(list, monthsOfYear),
  [list, monthsOfYear],
);

// Has receipts for this year?
const hasAnnualData = annualTrend.some((p) => p.total > 0);

// Current month index (only when viewing current year)
const currentMonthIdx = Number(new Date().getMonth()); // 0-11
const highlightIdx = selectedYear === currentYear ? currentMonthIdx : -1;
```

**Year selector navigation:**

```typescript
const canGoPrevYear =
  availableYears.length > 0 && selectedYear > availableYears[0];
const canGoNextYear = selectedYear < currentYear;

const goPrevYear = () =>
  setSelectedYear(String(Number(selectedYear) - 1));
const goNextYear = () =>
  setSelectedYear(String(Number(selectedYear) + 1));
```

**Bar tap → monthly detail (spec requirement):**

```typescript
onPressItem={(_item, index) => {
  const monthKey = monthsOfYear[index];
  if (monthKey === currentMonthKey()) {
    // Current month — navigate without month param
    // (route pattern TBD in tasks — likely same screen's month selector)
  } else {
    // Past month — navigate with ?month={YYYY-MM}
    // Uses existing category drill-down pattern or direct route
  }
}}
```

**Bar chart items mapping:**

```typescript
const annualItems: CapsuleBarChartItem[] = annualTrend.map((point, i) => ({
  label: shortMonthLabel(point.month),
  value: point.total,
  highlight: i === highlightIdx,
}));
```

## Layout Position

Insert the annual card **after** the summary row (line ~417) and **before** "Por categoría" section (line ~418). The card contains:

1. Year selector row (chevron left + year label + chevron right) — styled like `monthSelector`
2. Conditional render: `hasAnnualData ? <ScrollView horizontal>...</ScrollView> : <Text>Sin gastos este año</Text>`
3. The ScrollView wraps a `<View style={{ minWidth: 12 * 44 }}>` containing the `CapsuleBarChart`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `availableYears` derivation, `monthsOfYear` generation, highlight logic | Inline in component — no separate unit needed; test via E2E |
| Integration | Year selector navigation, empty state display, horizontal scroll | Manual verify + screenshot comparison |
| E2E | Full flow: mount → verify 12 bars → navigate year → verify re-render | Detox or manual (per existing project patterns) |

No new test files needed — this is a UI-only addition using existing pure functions.

## Migration / Rollout

No migration required. The feature is additive — a new card section in the existing Pro charts screen. No DB, store, or schema changes.

## Open Questions

- [ ] **Monthly detail route**: The spec requires bar tap → monthly detail navigation. The codebase has no standalone monthly detail screen — drill-downs go to `/categories/[key]?month=...` or `/stores/[name]?month=...`. Need to clarify: does bar tap navigate to the existing month selector (scroll to that month) or to a new screen? **Recommendation**: Navigate to a route that shows the month's data — possibly reuse the existing month selector by calling `setMonthKey(monthKey)`.
- [ ] **Year label format**: Spec says "year label" — display as `2026` or `Año 2026`? Proposal implies plain `2026`.
