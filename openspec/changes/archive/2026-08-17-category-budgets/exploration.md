## Exploration: Monthly Category Budgets

### Current State

The app already has a **global** monthly budget (`profiles.monthly_budget`) displayed on the Home screen via `BudgetCard` + `ProgressBar`. The user sets it in `/settings/budget` and the app tracks "X% used" against the total.

**Per-category budgets do not exist yet**, but significant infrastructure is already in place:

- `CategoryBudgetRow` (charts screen) already has an **unused `limit?: number` prop** — when present it renders `"$X of $Y"` text. Just needs values.
- `CategoryBudgetCard` (history tab) has no limit prop yet but follows the same pattern.
- `ProgressBar` component accepts a `color` prop — yellow/red states are trivial.
- `monthly_category_totals` RPC already returns per-category spend, scoped to `auth.uid()`.
- 13 canonical categories are seeded in DB and matched by a client-side registry (`EXPENSE_CATEGORIES`).

### Schema Summary

| Table | Key Columns | RLS | Notes |
|-------|-------------|-----|-------|
| `profiles` | id (uuid PK, FK auth.users), **monthly_budget** (numeric 12,2), currency, tier | own (auth.uid() = id) | Global budget lives here |
| `categories` | id (uuid PK), slug (unique), name, kind, icon, color, sort_order | **none** (global read) | 13 rows, seeded via migrations |
| `purchases` | id, user_id, purchase_date, total, status | own (auth.uid() = user_id) | Confirmed receipts |
| `purchase_items` | id, purchase_id, name, total_price, **category_id** (FK categories), is_impulse | via purchases join | Line items with category assignment |

**No declarative schema** — imperative migrations (12 files in `supabase/migrations/`).

### Existing Aggregation Path

```
monthly_category_totals(p_year_month) RPC
  → SECURITY INVOKER, auth.uid()-scoped
  → LEFT JOIN categories + COALESCE to 'otros' for NULL category_id
  → Returns: category_id, category_name, category_slug, total, item_count, percent_of_total

feature-access.ts → readCategoryTotals(yearMonth)
  → analytics/api.ts → fetchMonthlyTotals(yearMonth)
  → useMonthlyTotals hook (TanStack Query, queryKeys.monthlyTotals)
  → Charts: renders CategoryBudgetRow per total
  → History: renders CategoryBudgetCard per total
```

The RPC sums `purchase_items.total_price` per category. A **JOIN to a new `category_budgets` table** inside this RPC would be the most efficient way to return budget limits alongside spend — one round-trip, server-side.

### Where Budget UI Naturally Lives

1. **`CategoryBudgetRow`** (charts screen, `src/features/analytics/components/CategoryBudgetRow.tsx`) — ALREADY has `limit?: number`. Needs: (a) pass budget values from a new hook, (b) add progress bar coloring (yellow ≥80%, red ≥100%).

2. **`CategoryBudgetCard`** (history tab, `src/features/home/components/CategoryBudgetCard.tsx`) — Extend with `limit` prop + ProgressBar below the amount.

3. **New settings screen** `src/app/settings/category-budgets.tsx` — List of all 13 categories, each with a numeric input for the monthly limit. Pattern: follow `/settings/budget.tsx` (single-field editor) but as a list.

4. **Profile screen** `src/app/(tabs)/profile.tsx` — Add a "Presupuestos por categoría" row in the settings list that navigates to the new screen.

### Reusable Infrastructure

| Component/Module | What to reuse | How |
|-----------------|---------------|-----|
| `ProgressBar` | Color prop for yellow/red | Pass `color={percent >= 1 ? colors.danger : percent >= 0.8 ? '#F59E0B' : colors.primary}` |
| `CategoryBudgetRow` | `limit` prop already exists | Pass the per-category budget value |
| `monthly_category_totals` RPC | Extend with budget JOIN | Add LEFT JOIN category_budgets, return limit alongside spend |
| `feature-access.ts` | Discriminated result pattern | New read function follows same `FeatureReadResult<T>` contract |
| `query-keys.ts` | Key factory | Add `categoryBudgets(userId)` key |
| `useProfile()` / `setProfileBudget` | Write pattern | New `setCategoryBudget` follows same RLS-scoped update |
| `useSettingsStore` | Local state | Extend or create sibling store for per-category budgets |

### Recommended Schema for `category_budgets`

```sql
create table public.category_budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  monthly_limit numeric(12, 2) not null check (monthly_limit > 0),
  created_at  timestamptz not null default now(),
  unique(user_id, category_id)
);

create index category_budgets_user_idx on public.category_budgets (user_id);

alter table public.category_budgets enable row level security;

-- RLS: same pattern as all other user-scoped tables
create policy "category_budgets_select_own" on public.category_budgets
  for select using (auth.uid() = user_id);
create policy "category_budgets_insert_own" on public.category_budgets
  for insert with check (auth.uid() = user_id);
create policy "category_budgets_update_own" on public.category_budgets
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "category_budgets_delete_own" on public.category_budgets
  for delete using (auth.uid() = user_id);
```

**Why this schema:**
- `unique(user_id, category_id)` — one budget per category per user, natural constraint
- `monthly_limit numeric(12, 2)` — matches `profiles.monthly_budget` type
- `check (monthly_limit > 0)` — budgets must be positive; "remove budget" = DELETE the row
- Index on `user_id` — covers the main query (all budgets for a user)
- RLS follows the exact same pattern as purchases/stores — no new security model

**Alternative considered (JSONB on profiles):** A `category_budgets jsonb` column on `profiles` (e.g. `{"snacks": 5000, "limpieza": 3000}`) would avoid a new table but loses: FK integrity, type safety, RLS granularity, andQueryable/filterable access. The normalized table is better.

### RPC Extension

The existing `monthly_category_totals` RPC can be extended to JOIN budget limits:

```sql
-- Add to the existing RPC (or create a new one):
LEFT JOIN public.category_budgets cb
  ON cb.user_id = p.user_id AND cb.category_id = coalesce(c.id, o.id)
-- Return: ..., cb.monthly_limit as budget_limit
```

This returns budget limits alongside spend in one query — no extra round-trip. The client hook already destructures the RPC result, so adding a `budget_limit` field is backward-compatible (undefined when no budget is set).

### Risks

- **Migration complexity**: Extending the RPC means a new migration file that replaces the function. Must preserve the exact return shape for existing consumers.
- **No test runner**: The project has no tests (`tdd: false`, no test runner). Verification will be manual (typecheck + visual).
- **13 categories × unlimited budgets**: Users could set budgets for all 13 categories. The UI needs to handle "no budget set" gracefully (skip progress bar, show only percent).

### Ready for Proposal

**Yes.** The infrastructure is remarkably well-prepared — `CategoryBudgetRow.limit`, `ProgressBar` color support, the RPC pattern, and the settings screen pattern all exist. The main work is:
1. New `category_budgets` table + migration (with RPC extension)
2. Data access layer (feature-access + hooks)
3. Settings UI for budget configuration
4. Wire budget values into CategoryBudgetRow/CategoryBudgetCard + progress coloring
