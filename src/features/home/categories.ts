import type { IconName } from '@/components';
import type { CategoryCatalog } from '@/features/categories/catalog';

/**
 * Spending-category taxonomy for the Home feed.
 *
 * The parser already suggests a per-item category
 * (`ai_suggested_category_id`); this registry turns those keys into the
 * visible label and icon. The per-category drill-down groups identical
 * items and sums them, so "cuánto gasté en cada cosa al mes" comes from
 * the item rows, not from the taxonomy.
 *
 * The feed aggregates each receipt's `category_totals` through this
 * registry. Phase 5 persists `category_id` per item server-side and moves
 * the taxonomy to a DB table.
 */
export type ExpenseCategoryKey =
  | 'bebidas'
  | 'refrescos'
  | 'lacteos'
  | 'panaderia'
  | 'snacks'
  | 'alimentos'
  | 'higiene'
  | 'limpieza'
  | 'carnes'
  | 'frutas-verduras'
  | 'farmacia'
  | 'servicios'
  | 'otros';

export interface ExpenseCategory {
  key: ExpenseCategoryKey;
  label: string;
  icon: IconName;
  /** Stable background color for category cards, chart segments, and budget bars. */
  background: string;
  /** Foreground color (text/icon) that contrasts against `background`. */
  foreground: string;
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategoryKey, ExpenseCategory> = {
  bebidas: {
    key: 'bebidas',
    label: 'Bebidas',
    icon: 'waterbottle.fill',
    background: '#2563EB',
    foreground: '#FFFFFF',
  },
  refrescos: {
    key: 'refrescos',
    label: 'Refrescos',
    icon: 'takeoutbag.and.cup.and.straw.fill',
    background: '#EA580C',
    foreground: '#FFFFFF',
  },
  lacteos: {
    key: 'lacteos',
    label: 'Lácteos',
    icon: 'drop.fill',
    background: '#0284C7',
    foreground: '#FFFFFF',
  },
  panaderia: {
    key: 'panaderia',
    label: 'Panadería',
    icon: 'birthday.cake.fill',
    background: '#D97706',
    foreground: '#FFFFFF',
  },
  snacks: {
    key: 'snacks',
    label: 'Snacks',
    icon: 'bag.fill',
    background: '#7C3AED',
    foreground: '#FFFFFF',
  },
  alimentos: {
    key: 'alimentos',
    label: 'Alimentos',
    icon: 'cart.fill',
    background: '#059669',
    foreground: '#FFFFFF',
  },
  higiene: {
    key: 'higiene',
    label: 'Higiene',
    icon: 'soap.fill',
    background: '#0D9488',
    foreground: '#FFFFFF',
  },
  limpieza: {
    key: 'limpieza',
    label: 'Limpieza',
    icon: 'bubbles.and.sparkles.fill',
    background: '#10B981',
    foreground: '#064E3B',
  },
  carnes: {
    key: 'carnes',
    label: 'Carnicería',
    icon: 'fork.knife',
    background: '#E11D48',
    foreground: '#FFFFFF',
  },
  'frutas-verduras': {
    key: 'frutas-verduras',
    label: 'Frutas y verduras',
    icon: 'leaf.fill',
    background: '#65A30D',
    foreground: '#FFFFFF',
  },
  farmacia: {
    key: 'farmacia',
    label: 'Farmacia',
    icon: 'pills.fill',
    background: '#DB2777',
    foreground: '#FFFFFF',
  },
  servicios: {
    key: 'servicios',
    label: 'Servicios',
    icon: 'bolt.fill',
    background: '#4F46E5',
    foreground: '#FFFFFF',
  },
  otros: {
    key: 'otros',
    label: 'Otros',
    icon: 'sparkles',
    background: '#4B5563',
    foreground: '#FFFFFF',
  },
};

/** Unknown keys (e.g. a category the registry does not know yet) bucket into Otros. */
export function getExpenseCategory(key: string): ExpenseCategory {
  return EXPENSE_CATEGORIES[key as ExpenseCategoryKey] ?? EXPENSE_CATEGORIES.otros;
}

/**
 * Stable color pair for a category key. Unknown or null keys fall back to
 * `otros` so every call site gets a deterministic color instead of having
 * to branch on registry membership.
 */
export function getCategoryColor(
  key: string | null | undefined,
): Pick<ExpenseCategory, 'background' | 'foreground'> {
  const def = EXPENSE_CATEGORIES[(key ?? 'otros') as ExpenseCategoryKey] ?? EXPENSE_CATEGORIES.otros;
  return { background: def.background, foreground: def.foreground };
}

/**
 * Own-property membership in the static canonical taxonomy. The registry is
 * a plain object literal, so `EXPENSE_CATEGORIES['constructor']` (or any
 * other inherited member such as `toString`/`valueOf`) is TRUTHY — an
 * own-property check keeps prototype keys out of the canonical branch
 * (proto-key trap, W-1). Production catalogs are null-prototype records;
 * harness/plain-literal catalogs get the same guard at the lookup site.
 */
export function isCanonicalCategoryKey(
  key: string | null | undefined,
): key is ExpenseCategoryKey {
  return (
    key != null &&
    Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, key)
  );
}

/**
 * The visuals a category renders with (REQ-008 — display convergence).
 *
 * Phase 6 splits "the catalog entry" from "what the app displays": the
 * display layer resolves through the merged catalog (custom rows carry
 * their own name/icon/color) while keeping canonical rows byte-identical
 * with today. `CategoryVisuals` is the resolved, render-ready shape:
 * label/icon/background/foreground for one slug — plus the slug itself so
 * callers can key lists without re-resolving.
 */
export interface CategoryVisuals {
  key: string;
  label: string;
  icon: IconName;
  background: string;
  foreground: string;
}

/**
 * Deterministic foreground for a custom row's background: custom rows pick
 * their color from the canonical palette, so the canonical background →
 * foreground mapping yields a coherent text/icon color. Unknown colors
 * (a malformed/legacy row outside the palette) fall back to white.
 */
const FOREGROUND_BY_BACKGROUND = new Map(
  Object.values(EXPENSE_CATEGORIES).map((entry) => [entry.background, entry.foreground]),
);

export function foregroundByBackground(background: string): string {
  return FOREGROUND_BY_BACKGROUND.get(background) ?? '#FFFFFF';
}

/**
 * Static-first category display resolution (REQ-008 — design D3/D4,
 * spec-critical): the display layer resolves visuals from the merged
 * catalog, but canonical slugs ALWAYS render the static taxonomy — the DB
 * mirror rows may carry different icons/colors (the canonical 13 must stay
 * byte-identical with today).
 *
 * - canonical slug (in the static taxonomy) → static entry, unchanged
 * - custom slug (in the catalog, not canonical) → the catalog row's own
 *   name/icon/color, with a derived foreground
 * - unknown slug, absent catalog, or null slug → static 'otros'
 *   (deterministic fallback visuals)
 */
export function resolveCategoryDisplay(
  catalog: CategoryCatalog | null | undefined,
  slug: string | null | undefined,
): CategoryVisuals {
  const key = slug ?? 'otros';
  const staticDef = isCanonicalCategoryKey(key)
    ? EXPENSE_CATEGORIES[key]
    : undefined;
  if (staticDef) {
    return {
      key: staticDef.key,
      label: staticDef.label,
      icon: staticDef.icon,
      background: staticDef.background,
      foreground: staticDef.foreground,
    };
  }
  // Own-property lookup: production catalogs are null-prototype records
  // (mergeCategoryCatalog), but a plain-literal catalog must not leak
  // Object.prototype members either ('constructor' is inherited; a custom
  // row legitimately keyed 'constructor' is an OWN property and resolves).
  const custom =
    catalog &&
    Object.prototype.hasOwnProperty.call(catalog, key)
      ? catalog[key]
      : undefined;
  if (custom) {
    return {
      key: custom.slug,
      label: custom.name,
      icon: custom.icon as IconName,
      background: custom.color,
      foreground: foregroundByBackground(custom.color),
    };
  }
  const otros = EXPENSE_CATEGORIES.otros;
  return {
    key: otros.key,
    label: otros.label,
    icon: otros.icon,
    background: otros.background,
    foreground: otros.foreground,
  };
}

/**
 * Household-RPC row visual resolution (W-5 — display convergence).
 *
 * Household `monthly_category_totals` rows carry their OWN category_id —
 * the categories row the SPENDING member's purchase items reference — with
 * NO ownership marker in the RPC output (migration 0031 returns only
 * category_id/category_name/category_slug/total/item_count/
 * percent_of_total/budget_limit). Resolving such a row through the
 * VIEWER's merged personal catalog would contaminate another member's
 * visuals with the viewer's rows (slug-collision case: the viewer's own
 * 'delivery' row hijacking the other member's 'delivery').
 *
 * Only a row whose category_id IS the viewer's catalog entry — the
 * viewer's own custom row, or the SHARED canonical/global row — renders
 * through `resolveCategoryDisplay` (own-row convergence kept). Every other
 * row — another member's custom category, an unknown slug, an absent
 * catalog — resolves against the STATIC taxonomy ONLY: canonical slugs
 * keep their static visuals, custom slugs bucket to 'otros'-class visuals.
 * The components render the DB-provided `category_name` regardless,
 * preserving pre-PR6 household behavior.
 */
export function resolveHouseholdCategoryVisuals(
  catalog: CategoryCatalog | null | undefined,
  categoryId: string | null | undefined,
  slug: string,
): CategoryVisuals {
  const own =
    catalog && Object.prototype.hasOwnProperty.call(catalog, slug)
      ? catalog[slug]
      : undefined;
  if (own && categoryId != null && own.id === categoryId) {
    return resolveCategoryDisplay(catalog, slug);
  }
  return resolveCategoryDisplay(null, slug);
}
