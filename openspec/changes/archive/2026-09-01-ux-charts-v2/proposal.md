# Proposal: UX Charts v2 — Home Categories & Analytics Redesign

## Intent

The current home category strip and analytics screen look plain: flat white cards, no category identity, single-color progress bars, and charts that don't surface trends at a glance. The references in `capturas/` show a higher-density, color-coded design that makes budget health and spending patterns immediately scannable. This redesign refreshes the UI layer only, keeping existing data hooks intact.

## Scope

### In Scope
- Home "Categorías de gastos" section: recolor/re-layout category cards to match the Budget reference.
- Analytics tab (`src/app/(tabs)/analytics.tsx`): redesign to match the Insights reference — dark hero card with white line chart + delta chip, red insight banner, "This week" rounded vertical bar chart, and "Top category" / "Daily avg" summary cards.
- New/chart components: `WeeklyBarChart`, `InsightHeroCard`, `InsightBanner`, `CategoryBudgetRow`, `SummaryPill`.
- Stable category color system mapped to `ExpenseCategoryKey`.
- New pure aggregators: weekly spend by day and daily average for the selected month.

### Out of Scope
- RevenueCat / Pro entitlement logic or paywall behavior.
- Backend changes, DB migrations, RPC/edge functions.
- Export feature.
- Full dark theme support beyond the hero card.
- Changes to data hooks (`useHomeFeed`, `useMonthlyTotals`, `useBudget`); only their return shape is consumed.

## Capabilities

### New Capabilities
- `analytics-tab-layout`: Insights-style redesign of the free analytics tab.
- `home-category-list`: colored category cards on the home screen.
- `category-color-system`: stable color mapping per expense category.
- `weekly-bar-chart`: custom rounded vertical bars for week/day spend.
- `insight-hero-card`: dark hero card with line chart and delta chip.
- `category-budget-row`: colored category list item with status label and budget metadata.

### Modified Capabilities
- None (no existing main specs to modify).

## Approach

1. Assign stable colors in `src/features/home/categories.ts` so categories keep the same color across home, analytics, and charts.
2. Reuse `victory-native` for the hero line chart; build the weekly bar chart as a custom component to get rounded capsule bars and per-bar labels.
3. Add presentational components under `src/features/charts/components/` and `src/features/analytics/components/`; keep them dumb and testable.
4. Keep business-logic hooks unchanged; add small pure aggregators in `src/features/charts/aggregate.ts` for weekly/day-of-week data.
5. Update `analytics.tsx` layout and the home `CategoryCard` usage; optionally reuse new components in `/pro/charts` without changing its route guard.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/(tabs)/index.tsx` | Modified | Home category list layout/styling. |
| `src/app/(tabs)/analytics.tsx` | Modified | Insights-style screen layout. |
| `src/features/home/categories.ts` | Modified | Add stable color per category. |
| `src/features/charts/components/` | New | `WeeklyBarChart`, `InsightHeroCard`, etc. |
| `src/features/analytics/components/` | Modified | New summary cards, insight banner. |
| `src/features/charts/aggregate.ts` | New | Week/day aggregators. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Category color clashes with existing index-based `CHART_PALETTE` | Med | Replace palette usage with stable category colors; test donut/store charts still differentiate. |
| Accessibility contrast on colored category cards | Med | Use a contrast-checked palette; keep text within WCAG AA. |
| Weekly aggregation assumes receipt-level dates | Low | Derive from existing `purchase_date` fields; add empty-state for partial weeks. |
| Large diff across home + analytics + chart components | High | Split into stacked PRs (home first, then analytics). |

## Rollback Plan

Revert the component and screen commits. The data hooks and stores remain unchanged, so rolling back only restores the previous UI layer.

## Dependencies

- Existing `victory-native` (41.26.0).
- Existing date/currency helpers.

## Success Criteria

- [ ] Home category list visually matches Budget reference category cards.
- [ ] Analytics tab visually matches Insights reference hero, banner, weekly chart, and summary cards.
- [ ] `pnpm typecheck` passes.
- [ ] No backend/RPC changes required.
- [ ] Existing Pro entitlement gating on `/pro/charts` remains intact.

## Proposal Question Round

Before finalizing specs, I'd like to confirm:

1. Should the home category list become a vertical budget-style list, or stay horizontal and only adopt colored cards?
2. Does "analytics screen" mean the free Analytics tab, the Pro `/pro/charts` screen, or both?
3. The reference shows per-category budget limits (e.g., "$380 of $380") — does Ticketify already store per-category limits, or should we derive them proportionally from the overall budget?
4. Should category colors be fixed per key, or user-customizable later?
5. The red insight banner mentions "vs last month" — should this replace the existing price-alert banners or sit above them?
