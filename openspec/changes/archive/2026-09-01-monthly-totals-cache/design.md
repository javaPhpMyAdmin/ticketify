# Design: Monthly Totals Cache

## Technical Approach

Replace store-based aggregation (which reads from the paginated `useReceiptsStore` — only 10–20 receipts) with a server-side materialized `monthly_user_totals` table. A Postgres trigger on `purchases` fires on INSERT/UPDATE/DELETE, calling an RPC that aggregates from `purchases` + `purchase_items` and upserts the cache row. Client reads from the cache for all month-scoped analytics. Household mode continues using existing RPCs (no household cache — avoids cross-user invalidation complexity).

**Data flow:**

```
purchases INSERT/UPDATE/DELETE
  → trigger fires (extracts user_id + year_month)
    → recalculate_monthly_totals(user_id, year_month)
      → aggregates purchases + purchase_items
      → upserts monthly_user_totals row

Client (charts, analytics)
  → useMonthlyCache(yearMonth)
    → reads monthly_user_totals row (fast, single row)
    → if cache miss → calls recalculate_monthly_totals → waits
    → returns { total, category_totals, store_totals, daily_totals, items_count }
```

## Architecture Decisions

| Decision | Option A | Option B | Decision | Rationale |
|----------|----------|----------|----------|-----------|
| Household caching | Cache household totals too (complex invalidation) | Household mode uses RPCs directly | **B** | Trigger doesn't know household context; household is secondary use case; avoids multi-user cache invalidation |
| Cache granularity | Per-receipt cache | Per-month aggregate | **Per-month** | Charts need month-level aggregates; per-receipt cache would just duplicate `purchases` |
| `daily_totals` format | `{day: number: total}` | `{YYYY-MM-DD: total}` | **ISO date keys** | Matches the `purchase_date` column directly; no conversion needed |
| `store_totals` format | `{store_id: {total, count}}` | `{store_name: {total, count}}` | **store_name** | Charts render by store name; `store_id` is nullable; matches existing `aggregateStoresByMonth` shape |
| Weekly/yearly charts | Migrate now | Defer to follow-up | **Defer** | Weekly spans months; yearly needs multi-year; both need per-receipt data; separate concern from the core bug |

## Migration: `0015_monthly_totals_cache.sql`

### §1. Table

```sql
create table public.monthly_user_totals (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  year_month       text not null,  -- 'YYYY-MM'
  total            numeric(12,2) not null default 0,
  category_totals  jsonb not null default '{}',
  store_totals     jsonb not null default '{}',
  daily_totals     jsonb not null default '{}',
  items_count      integer not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (user_id, year_month)
);

comment on table public.monthly_user_totals is
  'Materialized monthly spend totals. Trigger-maintained on purchases write.';
```

### §2. RLS

```sql
alter table public.monthly_user_totals enable row level security;

create policy "monthly_user_totals_select_own"
  on public.monthly_user_totals for select to authenticated
  using (auth.uid() = user_id);
```

### §3. Recalculate RPC

```sql
create or replace function public.recalculate_monthly_totals(
  p_user_id uuid,
  p_year_month text,
  p_household_id uuid default null
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_total numeric;
  v_category jsonb;
  v_stores jsonb;
  v_daily jsonb;
  v_items_count integer;
begin
  -- Aggregate from purchases + purchase_items
  with target_users as (
    select p_user_id as uid where p_household_id is null
    union
    select hm.user_id as uid
    from public.household_members hm
    where hm.household_id = p_household_id
      and public.is_household_member(auth.uid(), p_household_id)
  ),
  month_purchases as (
    select p.id, p.total as purchase_total, p.purchase_date
    from public.purchases p
    join target_users tu on tu.uid = p.user_id
    where p.status = 'confirmed'
      and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  ),
  cat_agg as (
    select coalesce(c.slug, 'otros') as slug,
           coalesce(c.name, 'Otros') as name,
           sum(pi.total_price)::numeric(12,2) as total,
           count(*)::int as count
    from public.purchase_items pi
    join month_purchases mp on mp.id = pi.purchase_id
    left join public.categories c on c.id = pi.category_id
    group by c.slug, c.name
  ),
  store_agg as (
    select coalesce(s.name, 'Sin tienda') as store_name,
           sum(mp.purchase_total)::numeric(12,2) as total,
           count(*)::int as count
    from month_purchases mp
    left join public.stores s on s.id = mp.store_id
    group by s.name
  ),
  daily_agg as (
    select to_char(mp.purchase_date, 'YYYY-MM-DD') as day,
           sum(mp.purchase_total)::numeric(12,2) as total
    from month_purchases mp
    group by mp.purchase_date
  )
  select
    coalesce(sum(mp.purchase_total), 0)::numeric(12,2),
    (select coalesce(jsonb_object_agg(slug, jsonb_build_object('total', total, 'count', count, 'name', name)), '{}') from cat_agg),
    (select coalesce(jsonb_object_agg(store_name, jsonb_build_object('total', total, 'count', count)), '{}') from store_agg),
    (select coalesce(jsonb_object_agg(day, total), '{}') from daily_agg),
    coalesce((select count(*) from public.purchase_items pi join month_purchases mp on mp.id = pi.purchase_id), 0)
  into v_total, v_category, v_stores, v_daily, v_items_count
  from month_purchases mp;

  -- Upsert cache row
  insert into public.monthly_user_totals
    (user_id, year_month, total, category_totals, store_totals, daily_totals, items_count, updated_at)
  values
    (p_user_id, p_year_month, v_total, v_category, v_stores, v_daily, v_items_count, now())
  on conflict (user_id, year_month) do update set
    total = excluded.total,
    category_totals = excluded.category_totals,
    store_totals = excluded.store_totals,
    daily_totals = excluded.daily_totals,
    items_count = excluded.items_count,
    updated_at = now();
end;
$$;
```

### §4. Trigger

```sql
create or replace function public.trigger_recalculate_monthly_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_ym text;
  v_old_ym text;
begin
  if TG_OP = 'DELETE' then
    v_user_id := OLD.user_id;
    v_ym := to_char(OLD.purchase_date, 'YYYY-MM');
    perform public.recalculate_monthly_totals(v_user_id, v_ym);
  elsif TG_OP = 'UPDATE' then
    v_user_id := NEW.user_id;
    v_ym := to_char(NEW.purchase_date, 'YYYY-MM');
    v_old_ym := to_char(OLD.purchase_date, 'YYYY-MM');
    perform public.recalculate_monthly_totals(v_user_id, v_ym);
    if v_ym != v_old_ym then
      perform public.recalculate_monthly_totals(v_user_id, v_old_ym);
    end if;
  else -- INSERT
    v_user_id := NEW.user_id;
    v_ym := to_char(NEW.purchase_date, 'YYYY-MM');
    perform public.recalculate_monthly_totals(v_user_id, v_ym);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_monthly_totals_recalculate
  after insert or update or delete on public.purchases
  for each row
  execute function public.trigger_recalculate_monthly_totals();
```

### §5. Index

```sql
create index idx_monthly_user_totals_user on public.monthly_user_totals (user_id);
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/0015_monthly_totals_cache.sql` | Create | Table + RPC + trigger + RLS (§ above) |
| `src/types/index.ts` | Modify | Add `MonthlyTotalsCacheRow` interface |
| `src/lib/query-keys.ts` | Modify | Add `monthlyCache(userId, yearMonth)` key |
| `src/lib/supabase/feature-access.ts` | Modify | Add `readMonthlyCacheRow()` and `triggerMonthlyRecalc()` |
| `src/features/analytics/hooks/useMonthlyCache.ts` | Create | New hook: reads cache, fallback to recalc on miss |
| `src/features/analytics/hooks/useMonthlyOverview.ts` | Modify | Use `useMonthlyCache` instead of RPC for total |
| `src/features/analytics/hooks/useMonthlyTotals.ts` | Modify | Use `useMonthlyCache` instead of RPC for categories |
| `src/app/pro/charts.tsx` | Modify | Replace 5 store-based aggregations with cache reads |
| `src/features/analytics/index.ts` | Modify | Export new hook |

## TypeScript Types

```typescript
// src/types/index.ts — new type
export interface MonthlyTotalsCacheRow {
  user_id: string;
  year_month: string;
  total: number;
  category_totals: Record<string, { total: number; count: number; name: string }>;
  store_totals: Record<string, { total: number; count: number }>;
  daily_totals: Record<string, number>; // { "2026-08-15": 1234.56 }
  items_count: number;
  updated_at: string;
}
```

## Query Key

```typescript
// src/lib/query-keys.ts — addition
monthlyCache: (userId: string, yearMonth: string) =>
  ['analytics', 'monthly-cache', userId, yearMonth] as const,
monthlyCachePrefix: (userId: string) =>
  ['analytics', 'monthly-cache', userId] as const,
```

## Client Hook: `useMonthlyCache`

```typescript
// src/features/analytics/hooks/useMonthlyCache.ts
export function useMonthlyCache(yearMonth: string, householdId?: string | null) {
  const { userId } = useSessionUser();

  // Household mode: fall through to existing RPCs (no cache)
  if (householdId) {
    return useMonthlyTotals(yearMonth, householdId);
  }

  const cacheQuery = useQuery({
    queryKey: queryKeys.monthlyCache(userId!, yearMonth),
    enabled: !!userId,
    queryFn: () => readMonthlyCacheRow(userId!, yearMonth).then(toQueryData),
  });

  // Cache miss: trigger one-time recalculation
  const triggerMutation = useMutation({
    mutationFn: () => triggerMonthlyRecalc(userId!, yearMonth),
    onSuccess: () => cacheQuery.refetch(),
  });

  useEffect(() => {
    if (cacheQuery.data === null && !cacheQuery.isLoading && !triggerMutation.isPending) {
      triggerMutation.mutate();
    }
  }, [cacheQuery.data, cacheQuery.isLoading]);

  const row = cacheQuery.data;
  // Transform to CategoryMonthlyTotal[] shape for existing consumers
  const totals = useMemo(() => transformCacheToCategoryTotals(row), [row]);
  const monthTotal = row?.total ?? 0;

  return { totals, monthTotal, isLoading: cacheQuery.isLoading || triggerMutation.isPending, ... };
}
```

## Consumer Migration

| Consumer | Current | After |
|----------|---------|-------|
| `useMonthlyOverview` | `readMonthlyPurchasesTotal` RPC × 2 | `useMonthlyCache(monthKey)` → `monthTotal`; `useMonthlyCache(prevMonth)` → previous |
| `useMonthlyTotals` | `monthly_category_totals` RPC | `useMonthlyCache` → returns `CategoryMonthlyTotal[]` from `category_totals` jsonb |
| `aggregateSpendTrend` | `list` (paginated store) | Query `monthly_user_totals` for last 6 months via `.in('year_month', [...])`, zero-fill |
| `aggregateDailySpend` | `list` | Read `daily_totals` from cache row, map to `{day, total}[]` |
| `aggregateStoresByMonth` | `list` | Read `store_totals` from cache row, map to `StoreSpend[]` |
| `aggregateDailyAverage` | `list` | `total / days_in_month` (or derive from `daily_totals`) |
| `getTopCategory` | `list` | Read `category_totals` from cache, sort by total desc, map through category registry |

**Not migrated (deferred):** `aggregateWeeklySpend` (spans months), `aggregateYearlySpend` (multi-year), `aggregateDayItems` (needs individual items), `aggregateDayTotal` (needs per-receipt data). These remain store-derived.

## Household Support

Personal mode reads from cache. Household mode continues calling existing RPCs (`monthly_category_totals`, `monthly_purchases_total`) with `p_household_id`. The `useMonthlyCache` hook transparently falls through to RPCs when `householdId` is provided. This avoids the complexity of cross-user cache invalidation while keeping the primary (personal) path fast.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| SQL | RPC correctness, trigger fires on all ops | `supabase db reset` + manual inserts/updates/deletes |
| Unit | Cache → `CategoryMonthlyTotal[]` transform | Pure function test with fixture cache rows |
| Integration | `useMonthlyCache` cache-hit and cache-miss paths | Mock Supabase client, verify query/mutation calls |
| E2E | Charts show correct totals after receipt add | Manual: add receipt → charts update within seconds |

## Open Questions

- [x] Weekly chart is broken (same pagination bug) but deferred — should we address it in this change or create a follow-up? → **Resolved in code — no follow-up needed here.** In `/pro/charts`, the weekly daily bars source from `monthList = monthReceiptsQuery.data ?? list`, where `monthReceiptsQuery` uses `readPurchaseListByMonth` (full-month, non-paginated). The weekly chart no longer depends on the paginated store feed for accurate bars, so the pagination bug is effectively eliminated. The weekly chart was *not* migrated to the cache (it remains store/full-month derived, per the deferred set), but it is no longer broken by pagination.
- [x] Backfill: existing users have historical months with no cache rows — the cache-miss fallback handles this, but the first render of old months triggers an RPC. Acceptable? → **Resolved in practice: on-demand recalc, no migration backfill.** No backfill migration exists for `monthly_user_totals`. `useMonthlyCache` auto-triggers `triggerMonthlyRecalc` on a cache miss (first render of any month without a row), so old months are materialized lazily. The tradeoff — one `recalculate_monthly_totals` RPC on first render — is accepted by the implemented design.
