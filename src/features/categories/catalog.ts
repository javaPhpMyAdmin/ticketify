/**
 * Pure category-catalog helpers (change `category-management` — D3/D4).
 *
 * This module is deliberately free of supabase imports so every helper is
 * unit-testable in plain node (scripts/test-categories.mjs section A). The
 * data-access seam (`api.ts`) imports the `CategoryRow` type from here; the
 * merged catalog's value type is the app-wide `Category` shape.
 *
 * The catalog is `Record<slug, Category>` — every entry carries the DB row's
 * `{ id, slug, name, kind, icon, color, sort_order }`. `resolveCategory`
 * replaces bare `getExpenseCategory` call sites while preserving the
 * fallback contract exactly: unknown slug → the 'otros' entry (renders the
 * deterministic fallback visuals); a consumer chains
 * `?? getExpenseCategory(slug)` only for the pre-load empty-catalog case.
 *
 * The merged record is built on a NULL prototype (prototype-pollution safe):
 * a crafted row whose slug is `__proto__` can never hijack the prototype
 * chain — lookups stay purely own-property.
 */
import type { Category } from '@/types';

/**
 * One raw `categories` row (migration 0032 shape). `user_id === null` is a
 * canonical global row; `user_id = <uid>` is a user-scoped custom row.
 * The hook splits the flat read by `user_id` BEFORE `mergeCategoryCatalog`,
 * so the merged catalog never carries the column.
 */
export interface CategoryRow extends Category {
  user_id: string | null;
}

/** The merged catalog: global entries first, custom rows appended. */
export type CategoryCatalog = Record<string, Category>;

/**
 * Turn a category name into a URL-style slug (D4, es-AR friendly, matches
 * canonical style like `lacteos`, `frutas-verduras`):
 *
 * 1. NFKD normalize (decompose accents),
 * 2. strip combining marks (`\p{M}`),
 * 3. lowercase,
 * 4. trim,
 * 5. collapse runs of non-`[a-z0-9]` to `-`,
 * 6. trim leading/trailing `-`.
 *
 * Examples: `Café & Deli` → `cafe-deli`; `Frutas y Verduras` →
 * `frutas-y-verduras`; `Lácteos` → `lacteos`. Emoji and symbols collapse to
 * dashes; a name with no slugifiable characters slugs to `''` — the create
 * seam rejects empty slugs fail-closed (server-side duplicate keys would
 * otherwise be unreachable/ambiguous).
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Client-side collision block (D4): true when `slug` already exists in the
 * canonical 13 OR in the caller's own catalog. Accepts either a Set (the
 * canonical `EXPENSE_CATEGORIES` keys + own slugs, as the picker holds them)
 * or a plain array defensively.
 */
export function slugCollides(
  slug: string,
  existingSlugs: ReadonlySet<string> | readonly string[],
): boolean {
  const set = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);
  return set.has(slug);
}

/**
 * Merge the flat global + own reads into one deterministic catalog (D3):
 *
 * - canonical-first: global rows are assigned FIRST, ordered by
 *   `(sort_order, slug)`,
 * - then custom rows, ordered the same way, appended after the canonical
 *   entries,
 * - an own row SHADOWING a canonical slug wins the key (user-first by
 *   construction — the merge never lets a stale global row hide the user's
 *   own row),
 * - `user_id` is stripped: merged entries carry exactly the `Category`
 *   shape.
 *
 * Input order never matters — both inputs are sorted before assignment, so
 * the resulting record (key order included) is fully deterministic.
 */
export function mergeCategoryCatalog(
  global: readonly CategoryRow[],
  own: readonly CategoryRow[],
): CategoryCatalog {
  const pick = (rows: readonly CategoryRow[]): Category[] =>
    [...rows]
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
      )
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        kind: row.kind,
        icon: row.icon,
        color: row.color,
        sort_order: row.sort_order,
      }));

  // Null-prototype record: a crafted row whose slug is `__proto__` (or
  // `constructor`) can never replace the prototype — `catalog[key]` stays a
  // pure own-property lookup. Assignment through a null-prototype object is
  // also setters-free, so `__proto__` lands as a plain own data property.
  const catalog: CategoryCatalog = Object.create(null);
  for (const entry of [...pick(global), ...pick(own)]) {
    catalog[entry.slug] = entry;
  }
  return catalog;
}

/**
 * The catalog entry for a slug with the deterministic 'otros' fallback
 * (D3 — spec-critical, unchanged): an unknown slug renders the 'otros'
 * entry. Returns `undefined` only when the catalog itself lacks it (the
 * pre-load empty-catalog case, or a malformed catalog) — consumers chain
 * `?? getExpenseCategory(slug)` for exactly that state.
 */
export function resolveCategory(
  catalog: CategoryCatalog,
  slug: string | null | undefined,
): Category | undefined {
  const key = slug ?? 'otros';
  return catalog[key] ?? catalog['otros'] ?? undefined;
}