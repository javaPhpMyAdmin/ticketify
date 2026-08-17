# Design: Category Budgets

## Technical Approach

Add per-category monthly budget storage and wire it through the existing `monthly_category_totals` RPC via LEFT JOIN. The RPC gains a nullable `budget_limit` field — zero schema breakage for existing consumers. A new settings screen lets users configure budgets for all 13 categories. Progress bars on category rows/cards use the limit for color-coded spend tracking.

## Architecture Decisions

### Decision: LEFT JOIN in RPC vs. separate read

| Option | Tradeoff | Decision |
|--------|----------|----------|
| LEFT JOIN in `monthly_category_totals` | One round-trip; RPC shape grows by 1 nullable field; all consumers auto-inherit | **Chosen** |
| Separate `readCategoryBudgets` + client merge | Two round-trips; RPC untouched; more complex client wiring | Rejected |

**Rationale**: The RPC already returns `category_slug` per row. A LEFT JOIN on `(user_id, category_slug, month)` is trivial and preserves the exact return shape. A separate read adds latency and client-side merge complexity for no benefit.

### Decision: Table shape — no FK to categories

**Choice**: `UNIQUE(user_id, category_slug, month)` without FK to `categories` table.
**Rationale**: Categories are a client-side registry (`EXPENSE_CATEGORIES`). The DB `categories` table is a lookup for purchase items, not a constraint source. Slug alignment is enforced by the settings UI iterating over `EXPENSE_CATEGORIES` keys. A FK would add a migration dependency and an unnecessary join.

### Decision: Settings screen — batch upsert pattern

**Choice**: Load all 13 categories, render one `TextInput` per row, "Guardar" button upserts all non-zero amounts and deletes zero amounts in a single pass.
**Rationale**: Follows the `budget.tsx` pattern (single save button, draft state). Batch upsert is idempotent — re-saving unchanged values is a no-op cost. Deleting zero budgets avoids cluttering the table with meaningless rows.

## Data Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  RPC call    │────▶│ Supabase Edge    │────▶│ category_budgets │
│  (existing)  │     │ monthly_category │     │   LEFT JOIN      │
│              │     │ _totals          │     │   ON user+slug+  │
│              │     │                  │     │   month          │
└──────┬───────┘     └──────────────────┘     └─────────────────┘
       │
       ▼
┌──────────────────┐
│ CategoryMonthlyTotal + budget_limit (nullable)
│                  │
├──────────────────┤
│ useMonthlyTotals │──▶ CategoryBudgetRow.limit
│ hook (existing)  │──▶ CategoryBudgetCard.limit
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐
│ Settings Screen  │────▶│ useCategoryBudgets│
│ /settings/       │     │ (new hook)        │
│ category-budgets │     │                   │
│                  │     ├──────────────────┤
│ 13 TextInput rows│     │ readCategoryBudgets│
│ Guardar button   │     │ (new read fn)     │
└──────────────────┘     └──────────────────┘
```

## Interfaces / Contracts

### New type: `CategoryBudgetRow` (DB row)

```ts
interface CategoryBudget {
  user_id: string;
  category_slug: string;
  month: string;       // 'YYYY-MM'
  amount: number;
}
```

### Extended type: `CategoryMonthlyTotal`

```ts
// Added field (nullable — backward-compatible)
interface CategoryMonthlyTotal {
  // ... existing fields unchanged ...
  budget_limit: number | null;  // NEW
}
```

### New functions

```ts
// feature-access.ts
async function readCategoryBudgets(
  userId: string, yearMonth: string
): Promise<FeatureReadResult<CategoryBudget[]>>;

// api.ts (analytics feature)
async function upsertCategoryBudgets(
  budgets: { category_slug: string; amount: number }[],
  yearMonth: string
): Promise<ProfileWriteResult>;
```

### New hook

```ts
// hooks/useCategoryBudgets.ts
function useCategoryBudgets(yearMonth?: string): {
  budgets: CategoryBudget[];
  isLoading: boolean;
  save: (budgets: Record<string, number>) => Promise<void>;
};
```

### Progress bar color logic

```ts
function budgetProgressColor(spent: number, limit: number): string {
  const ratio = spent / limit;
  if (ratio > 1) return colors.danger;        // red
  if (ratio >= 0.7) return '#D97706';         // amber/yellow
  return colors.primary;                       // emerald green
}
```

## File Changes

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `supabase/migrations/0013_category_budgets.sql` | Create | ~80 | `category_budgets` table DDL + RPC replacement |
| `src/types/index.ts` | Modify | +2 | Add `budget_limit` to `CategoryMonthlyTotal` |
| `src/lib/supabase/feature-access.ts` | Modify | +25 | Add `readCategoryBudgets` and `upsertCategoryBudgets` |
| `src/lib/query-keys.ts` | Modify | +4 | Add `categoryBudgets` key factory |
| `src/features/analytics/hooks/useCategoryBudgets.ts` | Create | ~50 | New hook: read budgets for a month, save function |
| `src/features/analytics/components/CategoryBudgetRow.tsx` | Modify | +15 | Add ProgressBar below limit text, color logic |
| `src/features/home/components/CategoryBudgetCard.tsx` | Modify | +20 | Add `limit` prop, ProgressBar, color-coded spend text |
| `src/app/settings/category-budgets.tsx` | Create | ~180 | New settings screen: list of 13 category inputs |
| `src/app/(tabs)/profile.tsx` | Modify | +5 | Add "Presupuestos por categoría" navigation row |
| `src/features/analytics/components/CategoryBreakdownList.tsx` | Modify | +20 | Pass `budget_limit` to `CategoryBudgetRow`, empty-state CTA |

**Estimated total**: ~400 lines (3 new files + 7 modified)

## Migration SQL

```sql
-- 0013_category_budgets.sql

-- 1. category_budgets table
create table public.category_budgets (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  category_slug text not null,
  month         text not null,  -- 'YYYY-MM'
  amount        numeric(12,2) not null check (amount >= 0),
  primary key (user_id, category_slug, month)
);

alter table public.category_budgets enable row level security;

create policy "Users can manage own category budgets"
  on public.category_budgets
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 2. Replace monthly_category_totals with LEFT JOIN version
create or replace function public.monthly_category_totals(p_year_month text)
returns table (
  category_id uuid, category_name text, category_slug text,
  total numeric, item_count bigint, percent_of_total numeric,
  budget_limit numeric  -- NEW nullable field
)
language sql security invoker stable set search_path = public as $$
  with fallback_otros as (
    select id, name, slug
    from public.categories
    where slug = 'otros'
  ),
  category_spend as (
    select coalesce(c.id, o.id) as category_id,
           coalesce(c.name, o.name) as category_name,
           coalesce(c.slug, o.slug) as category_slug,
           sum(pi.total_price)::numeric(12,2) as total,
           count(*)::bigint as item_count
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    left join public.categories c on c.id = pi.category_id
    left join fallback_otros o on pi.category_id is null
    where p.user_id = auth.uid()
      and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
    group by 1, 2, 3
  )
  select cs.category_id, cs.category_name, cs.category_slug,
         cs.total, cs.item_count,
         round(100.0 * cs.total / nullif(sum(cs.total) over (), 0), 1),
         cb.amount as budget_limit
  from category_spend cs
  left join public.category_budgets cb
    on cb.user_id = auth.uid()
    and cb.category_slug = cs.category_slug
    and cb.month = p_year_month
  order by cs.total desc
$$;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Type | `pnpm typecheck` passes after all changes | Existing build command |
| Manual | RPC returns `budget_limit` for set categories, null for unset | SQL console + app verification |
| Manual | Progress bar colors: green <70%, yellow 70–100%, red >100% | Set budgets, spend, verify colors |
| Manual | Settings screen: save, zero clears, navigation round-trip | End-to-end manual test |
| Manual | Empty state CTA visible when no budgets, hidden when budgets exist | Fresh month test |

## Migration / Rollout

- Single migration: `0013_category_budgets.sql` (table + RPC replace)
- RPC replacement preserves exact return shape — `budget_limit` is additive nullable
- No data migration needed — existing rows unaffected, new field defaults to null via LEFT JOIN
- No feature flag required — null `budget_limit` means "no budget set" = existing behavior

## Open Questions

- None — all technical decisions are resolved by the spec and codebase patterns.
