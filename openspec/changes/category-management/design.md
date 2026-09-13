# Design — User Categories + Category Budgets

## Status

Proposed

## Context

Change `category-management` layers user-scoped custom categories over the canonical 13-slug taxonomy (`EXPENSE_CATEGORIES`) and extends category budgets to the dynamic catalog. Sources: `proposal.md`, `specs/user-categories/spec.md`, `specs/category-budgets/spec.md`.

Key structural facts (verified against the codebase):

- `public.categories` already exists with `id, slug (unique), name, kind (CHECK need/want), icon, color, sort_order` and an aspirational column comment: *"user_id is null for global rows"* (0001). RLS is **already enabled** on it (migration 0002) with a select-only policy `categories_select_auth` (`for select to authenticated using (true)`) — there are deliberately no write policies today.
- `purchase_items.category_id` is an inline FK `references public.categories(id) on delete set null` (auto-named `purchase_items_category_id_fkey`); `purchase_items` is RLS-parent-scoped via `purchases` (0001) — bulk `UPDATE` on own items works today.
- The save seam `fetchCategoryIdsBySlug()` (module-private in `src/features/tickets/api.ts:477`) fetches ALL rows with no user filter, `.limit(200)`, ordered by slug. Callers: `buildSaveReceiptArgs` (line 649) and `updateReceipt` (line 1197) — both already receive `userId`.
- `stores` is the exact existing pattern for global + own rows (nullable `user_id`, RLS policies `stores_select_own_or_global` / `_insert_own` / `_update_own` / `_delete_own`, `resolveStoreId` in the same module).
- Migration ceiling: 0031 → next file is `0032_user_categories.sql`.
- Monthly aggregation RPCs are uuid-FK-based (`monthly_category_totals`, `get_household_category_items`) — custom rows already aggregate under their own slug server-side with no change.
- Stack: Expo SDK 54 / RN 0.81 / React 19 / expo-router 6 / Zustand 5 / TanStack Query 5 / Supabase JS v2, strict TS.

## Goals / Non-goals

**Goals**

1. User-scoped custom categories (create, assign, edit, display, budget, delete-with-guard).
2. Full round-trip: slug at the app boundary (branded `CategorySlug` in `manual-receipt.ts`), uuid only at the DB/RPC boundary (`save_receipt`).
3. Every display surface renders a custom category with its own slug/label/color/kind from its DB row; unknown slugs keep the deterministic 'otros' fallback.
4. Category budgets: settings screen lists the dynamic catalog; rollover copies only catalog slugs.
5. The canonical 13 and the parser vocabulary remain untouched.

**Non-goals (explicitly out of scope)**

- Parser changes: it keeps emitting only canonical slugs; custom assignment is always post-parse.
- Client-side need/want *classification*: no kind consumer exists today (the "wants" strip is impulse-based on `is_impulse`). The spec's kind-parity requirement is satisfied by carrying `kind` end-to-end via the catalog, not by introducing new classification logic.
- Household mode changes (v1 behavior preserved).
- Server-side category management UI.

## Architecture Approach

### Storage

Same table, new nullable column — mirrors `stores`:

```sql
alter table public.categories
  add column user_id uuid references public.profiles(id) on delete cascade;
```

`user_id IS NULL` = canonical global row (the 13, untouched); `user_id = <uid>` = user-scoped custom row. No backfill, no rewrite, additive.

### New client feature module `src/features/categories/`

| File | Responsibility |
| --- | --- |
| `api.ts` | `readCategoryCatalog(userId)` (global + own rows, one `.or('user_id.is.null,user_id.eq.<uid>')` query ordered by `sort_order, slug`), `createCustomCategory(userId, input)`, `deleteCustomCategory(userId, categoryId)`, `reassignCategoryItems(userId, fromId, toId)` (bulk UPDATE, RLS-scoped to own items). |
| `catalog.ts` | Pure helpers (unit-testable, no supabase imports): `slugify(name)`, `slugCollides(slug, catalogSlugs)`, `mergeCategoryCatalog(global, own)` (deterministic: canonical first by sort_order, then custom), `resolveCategory(catalog, slug)` (row or fallback). |
| `hooks/useCategoryCatalog.ts` | TanStack Query hook: `queryKey = ['categories', userId]`, enabled when `userId` present, refetch + invalidation after mutations. |

The merged catalog is `Record<slug, Category>` where every entry carries `{ id, slug, name, kind, icon, color, sort_order }` from the DB row. `resolveCategory` replaces bare `getExpenseCategory` call sites while preserving the fallback contract exactly: unknown slug → 'otros' visuals.

## Design Decisions

### D1 — Block-delete mechanism: FK RESTRICT (DB backstop) + app-side count check (UX) — combination

- **DB level**: `purchase_items.category_id` FK changes from `ON DELETE SET NULL` to `ON DELETE RESTRICT`. Single-statement deletes behave identically for RESTRICT vs NO ACTION in Postgres; RESTRICT is chosen because it documents intent and can never be silently deferred. This is the guarantee that survives raw SQL / `service_role` console deletes, which bypass RLS.
- **App level**: before deleting, the client counts `purchase_items` with that `category_id` (RLS-scoped to own items). `count > 0` → blocked, explanation surfaced, reassignment offered (bulk `UPDATE ... SET category_id = <toId> WHERE category_id = <fromId>`), retry allowed; `count = 0` → delete the row.
- **Why this combination**: `SET NULL` would silently re-bucket to 'otros' — exactly what the spec forbids. RLS alone is insufficient (service-role/console bypasses it). RESTRICT alone would give a raw pg error with no UX. The combination gives UX + enforcement.
- **Safety**: no migration deletes categories, so the stricter FK cannot break any existing migration path. Insert-path FK checks are unchanged (restoring a receipt references an existing category). The account-deletion cascade (`profiles` → `categories` AND `purchases` → `purchase_items`) removes referencing rows in the same statement, so RESTRICT does not block it.

### D2 — Save-seam slug resolution scope: explicit global + own fetch

`fetchCategoryIdsBySlug()` becomes `fetchCategoryIdsBySlug(userId)` and fetches two explicit sets in one query:

- global rows (`user_id IS NULL`, the 13 canonical),
- the caller's own rows (`user_id = userId`).

Then builds the slug→id map in deterministic order (`order('sort_order').order('slug')`, no `.limit(200)` reliance). Both callers (`buildSaveReceiptArgs` line 649, `updateReceipt` line 1197) already hold `userId`. The `'otros' ?? null` fallback is preserved: a slug in neither map (unreachable in practice) still maps to 'otros'.

This removes the current cross-user nondeterminism: today a custom row from *any* user can collide in the map, and the 200-row cap could theoretically truncate entries.

### D3 — Client catalog read: `useCategoryCatalog()` + pure merge

One React Query hook, one cache, every consumer converges on `resolveCategory`. The catalog is the single source of truth for slugs a given user can see/pick; the picker, budgets settings, rollover `validKeys`, and all display surfaces consume it.

Cache: `queryKeys.categories(userId)` (new factory in `src/lib/query-keys.ts`). Invalidated after `createCustomCategory` / `deleteCustomCategory` / `reassignCategoryItems`.

Fallback semantics (spec-critical, unchanged): `resolveCategory(catalog, slug) ?? getExpenseCategory(slug)` — canonical rows render exactly as today; unknown slugs render 'otros'.

### D4 — Slugify + collision handling

Algorithm (es-AR friendly, matches canonical style like `lacteos`, `frutas-verduras`):

1. NFKD normalize (decompose accents),
2. strip combining marks (`\p{M}`),
3. lowercase,
4. trim,
5. collapse runs of non-`[a-z0-9]` to `-`,
6. trim leading/trailing `-`.

Examples: `Café & Deli` → `cafe-deli`; `Frutas y Verduras` → `frutas-y-verduras`; `Lácteos` → `lacteos`.

Collision handling:

- **Client-side block (primary UX)**: after slugify, reject if the slug is in the canonical 13 keys **or** in the caller's own catalog slugs; show user-visible feedback, create nothing.
- **DB backstop (integrity)**: partial unique indexes (see Migration) raise 23505 on any race; the mutation maps 23505 to the same friendly error.

Kind is **not** part of the slug (a kind edit never changes the slug — kinds are 'need'/'want' and EACH is stored on the row; see D5).

### D5 — Kind handling: explicit choice at creation, carried via catalog

- The creation form requires an explicit need/want selection before confirm (`CHECK (kind in ('need','want'))` is the DB backstop — null kind never reaches the insert).
- `kind` lives on the catalog row and flows to every consumer unchanged. Because **no client-side need/want classification exists today** (verified: the "wants" strip sums `is_impulse`, and `CategoryDonut` "isKnown" is a color comparison), the spec's kind-parity clause is satisfied by parity: custom rows carry kind exactly like canonical rows, so any future kind consumer (donut need/want classification, analytics) reads it from the catalog. Server aggregation returns category name/label from the existing uuid-FK join without schema changes.

### D6 — Picker-in-editor for BOTH flows: shared picker, two hosts

The enhancement is entirely inside `CategoryPickerModal` (list canonical + own custom rows from catalog, create affordance, delete affordance on custom rows) plus per-flow wiring:

- **Manual flow (`ticket/manual.tsx`)**: `ItemEditorModal` gains a category row that stacks `CategoryPickerModal` over it (sheet-on-sheet). `initialValues` gains `category_id` (slug or null); `onSave` carries it so the item saves with the resolved uuid. The existing chip → picker path stays as a secondary route; both write `category_id`.
- **Camera review flow (`ticket/review/[id].tsx`)**: the reviewer does **not** use `ItemEditorModal` — the editor is `ReviewItemRow` (chip → `CategoryPickerModal`) with `RenameItemModal` for names. The chip → picker path IS the editor here; it reuses the identical enhanced picker. Add/edit timing comes free: chips render on every row at review and the rounded trip runs through `purchaseToDraft` (`item.category?.slug ?? null` — the embedded join returns the custom row's slug naturally, no change needed).

Round-trip summary: slug at app layer (branded type) → uuid at save (`fetchCategoryIdsBySlug(userId)` map) → slug again on read (embedded `categories` join). Custom slugs survive every hop without new plumbing.

## Migration Design — `supabase/migrations/0032_user_categories.sql`

```sql
-- ---------------------------------------------------------------------------
-- 1. user-scoped ownership (mirrors stores)
-- ---------------------------------------------------------------------------
alter table public.categories
  add column user_id uuid references public.profiles(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. replace global UNIQUE(slug) with partial unique indexes
-- ---------------------------------------------------------------------------
alter table public.categories drop constraint categories_slug_key;

create unique index categories_global_slug_idx
  on public.categories (slug) where user_id is null;

create unique index categories_user_slug_idx
  on public.categories (user_id, slug) where user_id is not null;

create index categories_user_sort_idx on public.categories (user_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. RLS: add write policies (select-all policy already exists from 0002)
-- ---------------------------------------------------------------------------
create policy "categories_insert_own" on public.categories
  for insert to authenticated with check (auth.uid() = user_id);

create policy "categories_update_own" on public.categories
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "categories_delete_own" on public.categories
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. block-delete guarantee
-- ---------------------------------------------------------------------------
alter table public.purchase_items drop constraint purchase_items_category_id_fkey;

alter table public.purchase_items
  add constraint purchase_items_category_id_fkey
  foreign key (category_id) references public.categories(id) on delete restrict;
```

Notes:

- **Select behavior preserved**: existing `categories_select_auth` (`using (true)` for authenticated) remains — authenticated users read all rows, per spec. RLS is already ON (0002), so this migration only adds write policies.
- **Additive and nullable**: no backfill, no data rewrite, no cascade deletes in the change itself; the 13 canonical rows are untouched.
- **The `kind` CHECK** already exists (0001) — nothing to add.
- Constraint drops use the auto-generated name `categories_slug_key` (from `slug text unique not null` in 0001) and `purchase_items_category_id_fkey` (inline FK name). Verified against the 0001 DDL.

## Client Data Flow

### Create → assign → save → display (both entry flows)

```mermaid
sequenceDiagram
  participant U as User
  participant E as ItemEditor (manual) / ReviewItemRow (review)
  participant P as CategoryPickerModal
  participant C as useCategoryCatalog
  participant S as Save seam (api.ts)

  U->>E: open editor for item (add or edit)
  E->>C: resolveCategory(catalog, item.category?.slug)
  E-->>U: render current category (slug/label/color)
  U->>E: tap category row / chip
  E->>P: open picker (canonical 13 + own custom rows)
  alt create new category
    U->>P: name "Delivery", color, kind 'want', confirm
    P->>P: slugify → 'delivery'; collision check (canonical ∪ own slugs)
    alt collision
      P-->>U: "already exists" feedback, no row created
    else free slug
      P->>P: insert with user_id = auth.uid()
      P->>C: invalidate ['categories', userId]
      P-->>U: row selected, assignable in same session
    end
  else select existing
    U->>P: tap 'delivery' (canonical or own)
  end
  P-->>E: category_id (slug) back to editor
  U->>E: save item
  E->>S: saveReceipt / updateReceipt (userId, draft)
  S->>S: fetchCategoryIdsBySlug(userId) → global + own map
  S->>S: resolve each slug → uuid (fallback 'otros')
  S->>S: persist purchase_items.category_id = uuid
  S->>S: invalidate feed/totals queries
  S-->>U: saved; display surfaces refetch via catalog
```

### Delete flow (blocked/reassign/empty)

```mermaid
sequenceDiagram
  participant U as User
  participant P as CategoryPickerModal
  participant D as deleteCustomCategory

  U->>P: delete affordance on custom row (long-press)
  P->>D: count purchase_items where category_id = row.id
  alt count > 0
    D-->>P: blocked — in use (n purchases)
    P-->>U: explanation; offer reassignment
    U->>P: choose target category
    P->>D: reassign ALL own items fromId → toId (bulk UPDATE)
    D->>D: retry delete (now count = 0) → row removed
    D->>P: invalidate catalog + feed/totals
  else count = 0
    D->>D: delete row (RESTRICT backstop)
    D->>P: invalidate catalog
  end
```

## Edge Cases & Guardrails

| Edge case | Guardrail |
| --- | --- |
| Same slug, different users | Partial index `(user_id, slug) WHERE user_id IS NOT NULL` allows it; save-seam scoped fetch never mixes them. |
| Duplicate slug, same user | Client collision check + partial index 23505 → friendly error. |
| Collision with canonical slug | Blocked client-side (canonical 13 in `EXPENSE_CATEGORIES`); 23505 backstop. |
| Delete while in use | Count check (UX) + FK RESTRICT (enforcement); never re-buckets to 'otros'. |
| Reassign then delete | Bulk RLS-scoped UPDATE; delete succeeds when count = 0. |
| Custom slug at the save seam | `fetchCategoryIdsBySlug(userId)` includes own rows → real uuid; unknown → 'otros' fallback unchanged. |
| Custom slug without a DB row reaching the seam | Impossible: slug is only assignable after the row exists (row-first creation). |
| Parser output | Unchanged: canonical 13 only, null / SIN CATEGORÍA behavior preserved. |
| Rollover with deleted/non-catalog slugs | `validKeys` becomes the dynamic catalog; orphan slugs are not copied (spec scenario covered). |
| RLS cross-user writes | `using`/`with check` on `auth.uid() = user_id`; zero rows affected for foreign users. |
| Account deletion | `profiles` cascade removes own categories AND purchases in the same statement; RESTRICT unaffected. |
| Sentinel `__rollover__` | Lives in `category_budgets`, never in `categories`; slugify can't produce `__` (underscores collapse to `-`). |
| Long/empty names | Trim + non-empty validation; length cap (≤ 40 chars, slug ≤ 40) as UI guardrail (not a spec constraint). |

## What Stays Unchanged

- Parser vocabulary + parse-ticket edge function (canonical 13 only).
- `EXPENSE_CATEGORIES` as the pure fallback source + `getExpenseCategory` fallback behavior (unknown → 'otros').
- The 13 canonical rows: slug, name, kind, icon, color, sort_order.
- `monthly_category_totals` / `get_household_category_items` server aggregations (uuid-FK joins already carry custom slugs + labels).
- `categories_select_auth` select policy (authenticated reads all rows) — spec-required.
- `save_receipt` RPC contract and the branded `CategorySlug` app-level identity.
- Budget mechanics: `currentMonthKey()` single month key, one-shot rollover marker + sentinel row, `budgets.length > 0` gate, delete-on-zero, household v1.
- `stores` behavior (mirrored, not modified).

## Testing Implications

- **Unit (pure, no supabase)**: `slugify` (accents, emoji, symbols, collapse, canonical-style output); `mergeCategoryCatalog` (determinism, canonical-first ordering); `resolveCategory` fallback to 'otros'; collision detection.
- **SQL smoke tests** (`supabase/tests/*.sql`): partial indexes accept same slug across users / reject per user; RLS write policies block cross-user update/delete; FK RESTRICT blocks delete of a referenced category.
- **Harness updates**: `test-category-budget-rollover` validKeys feed becomes catalog-aware (stub `readCategoryCatalog`); `test-manual-receipt` round-trip keeps passing unchanged (slug contract untouched).
- **Manual/e2e script**: create → assign (manual + review) → save → display (chips/history/analytics/receipts/charts/donut) → budget + rollover → blocked delete → reassign → delete.

## Risks & Consequences

- **FK reconstruction** (`DROP CONSTRAINT` + re-add) is a write lock on `purchase_items`; must run during low-traffic and be covered by the SQL smoke suite (0009's restore path depends on insert behavior, which is unchanged).
- **Display parity timing**: screens render static-registry visuals until their `useCategoryCatalog()` wiring lands; intermediate "custom slug shows 'otros' visuals" states must land in the same change as the catalog to avoid regression windows.
- **`fetchCategoryIdsBySlug` scope change** must ship with (or before) custom creation — otherwise a custom row from another user can still collide in the save map.
- **Rollover harness** becomes catalog-dependent; the removed-slug scenario (spec "Category removed from the catalog is not copied") is the regression to watch.
- **supabase CLI is not installed locally** (prior apply-phase discovery): migrations are applied via CI/remote; SQL smoke tests bear the verification load.