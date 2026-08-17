# Proposal: Annual Trend Chart

## Intent

Users currently see monthly spending only for a rolling 6-month window or yearly totals in the segmented control. There is no way to browse a single year's month-by-month breakdown — the exact view needed to understand seasonal patterns and year-over-year differences. This change adds a dedicated "Tendencia anual" card with 12 months of data for a selectable year, placed below the existing chart card.

## Scope

### In Scope
- New "Tendencia anual" card section below the summary row in `ChartsBody`
- Year selector (chevron left/right + year label, same pattern as month selector)
- 12-month `CapsuleBarChart` with horizontal scroll to fit 12 bars
- Highlight of the current month's bar (or no highlight if the year is not the current year)
- Year derived from `list` (receipts store): range = earliest receipt year → current year
- Uses `aggregateSpendTrend(records, months)` with a 12-month YYYY-MM array for the selected year
- Zero-filled months (months with no receipts show $0)

### Out of Scope
- Drill-down from an annual bar to a specific month's details
- Comparison overlays (e.g. overlay last year vs this year)
- Horizontal scroll position persistence across re-renders
- Any schema, DB/RPC, or RLS changes

## Capabilities

### New Capabilities
- `annual-trend-chart`: 12-month bar chart with year selector in the Pro trends screen, showing monthly totals for a selected year with horizontal scroll

### Modified Capabilities
None — existing requirements are unchanged; this adds a new section to the layout without altering any spec-level behavior.

## Approach

1. **Year state**: Add `selectedYear` state in `ChartsBody` (default: current year). Derive `availableYears` from `list` — sorted array of unique years from receipt timestamps.
2. **Year selector**: Render chevron left/right + year label below the existing segmented control or inside a new `<Card>` with the same visual pattern as the month selector.
3. **Monthly data**: Compute `aggregateSpendTrend(list, monthsOfYear)` where `monthsOfYear` = 12 YYYY-MM keys for `selectedYear` (Jan–Dec). Highlight index = current month if `selectedYear === currentYear`, else `null`.
4. **Horizontal scroll**: Wrap `CapsuleBarChart` in a `ScrollView horizontal` with `showsHorizontalScrollIndicator={false}`. Each bar gets a fixed minimum width (~36dp) so 12 bars overflow and scroll naturally.
5. **Position**: Place the annual card after the summary row and before the "Por categoría" section.
6. **Zero data**: When the selected year has no receipts at all, show a subtle empty state ("Sin gastos este año") inside the card rather than 12 zero bars.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/pro/charts.tsx` | Modified | Add year state, year selector, annual card section, horizontal scroll |
| `src/features/charts/` | Unchanged | `aggregateSpendTrend` already supports arbitrary month arrays |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 12 bars overflow card on narrow screens | High | Horizontal ScrollView with fixed bar width; already a known pattern in the codebase |
| Empty year (no receipts) looks broken | Medium | Show "Sin gastos este año" empty state instead of 12 zero bars |
| Year selector next to month selector confuses hierarchy | Low | Place year selector inside its own card section, visually separated from the month selector |

## Rollback Plan

Delete the annual card section, year state, and `selectedYear`/`availableYears` logic from `ChartsBody`. The existing segmented control chart and all other sections remain untouched. No DB or store changes to revert.

## Dependencies

- `aggregateSpendTrend` (existing, in `@/features/charts`)
- `CapsuleBarChart` (existing component)
- `useReceiptsStore.list` (existing store)

## Success Criteria

- [ ] "Tendencia anual" card renders with 12 bars for the selected year
- [ ] Year selector navigates between available years using chevrons
- [ ] Current month bar is highlighted when viewing the current year
- [ ] Bars scroll horizontally when 12 bars overflow the card width
- [ ] Empty year shows "Sin gastos este año" instead of 12 zero bars
- [ ] Existing chart card, summary row, categories, and store sections are unchanged
- [ ] `pnpm typecheck` passes with no errors
