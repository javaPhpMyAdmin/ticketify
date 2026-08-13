import type { IconName } from '@/components';

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
