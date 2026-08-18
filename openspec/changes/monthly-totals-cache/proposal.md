# Proposal: Monthly Totals Cache

## Intent

After infinite scroll paginated receipt loading (10/page), analytics, charts, and history screens show **incorrect totals** because they read from `useReceiptsStore` — a zustand store containing only the paginated subset. The home screen uses the RPC `monthly_purchases_total` (correct: $43,134) but charts show $15,492 (first page only). This is a data-correctness bug affecting every Pro analytics screen.

## Scope

### In Scope

- Materialized `monthly_user_totals` table (PK: `user_id` + `year_month`)
- Columns: `total`, `category_totals` (jsonb), `store_totals` (jsonb), `daily_totals` (jsonb), `items_count`, `updated_at`
- Postgres trigger on `purchases` INSERT/UPDATE/DELETE that calls an RPC to recalculate the relevant month
- Household support: `p_household_id` parameter aggregates across household members
- Client reads from cache table instead of computing from partial store or re-running RPCs per mount
- Migration following `NNNN_name.sql` pattern

### Out of Scope

- Changing receipt save flow or image upload
- Modifying existing RPC signatures (`monthly_purchases_total`, `monthly_category_totals`)
- Real-time cache updates for other tables (only `purchases` triggers recalculation)
- Backfill strategy for historical months (can be a follow-up)

## Capabilities

### New Capabilities

- `monthly-totals-cache`: Materialized monthly totals table with trigger-based updates, server-side recalculation RPC, and client-side cache reads replacing store-based aggregation

### Modified Capabilities

- None — this replaces the computation approach; spec-level behavior (what analytics shows) is unchanged

## Approach

1. **Schema**: Create `monthly_user_totals` table with composite PK `(user_id, year_month)` and jsonb aggregate columns
2. **Trigger RPC**: Create `recalculate_monthly_totals(p_user_id, p_year_month, p_household_id?)` that aggregates from `purchases` + `purchase_items` and upserts into the cache
3. **Trigger**: PostgreSQL trigger on `purchases` fires after INSERT/UPDATE/DELETE, extracts `user_id` and `year_month` from the affected row, calls the RPC
4. **Client**: Replace store-based aggregation calls (`aggregateSpendTrend`, `aggregateDailySpend`, etc.) with reads from `monthly_user_totals` via a simple Supabase query or lightweight hook
5. **RLS**: User-scoped read policy using `auth.uid()`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | New migration for table + trigger + RPC |
| `src/features/analytics/` | Modified | Replace store-based aggregation with cache reads |
| `src/features/home/hooks/` | Minor | `useMonthlyOverview` may simplify (already RPC-based, can read cache instead) |
| `useReceiptsStore` consumers | Modified | Charts/history stop depending on paginated store for totals |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Trigger fires on every purchase write, adding latency to save flow | Low | RPC is a single upsert — sub-50ms on typical data. Benchmark with realistic row counts. |
| Stale cache if trigger fails silently | Low | `updated_at` column enables staleness detection. Add a safety re-query fallback on client. |
| Household aggregation doubles trigger work | Low | Trigger already extracts `household_id` from the row; single RPC handles both scopes |

## Rollback Plan

1. Drop the trigger and RPC: `DROP TRIGGER ... ON purchases; DROP FUNCTION recalculate_monthly_totals;`
2. Drop the table: `DROP TABLE monthly_user_totals;`
3. Revert client changes to re-use existing RPCs or store aggregation
4. No data loss — `purchases` table is untouched

## Dependencies

- Existing `purchases` and `purchases_items` tables (stable schema)
- Existing `auth.uid()` RLS pattern

## Success Criteria

- [ ] Home screen total matches analytics/charts total for the same month
- [ ] Charts render correct values after adding a new receipt (cache updates within seconds)
- [ ] Household mode shows aggregated totals across members
- [ ] No measurable regression in purchase save latency
- [ ] `pnpm typecheck` passes with no new errors
