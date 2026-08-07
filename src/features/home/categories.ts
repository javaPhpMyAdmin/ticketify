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
 * Mock slice: the feed aggregates each receipt's `category_totals` through
 * this registry. Phase 5 persists `category_id` per item server-side and
 * moves the taxonomy to a DB table.
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
  | 'carniceria'
  | 'verduleria'
  | 'farmacia'
  | 'servicios'
  | 'otros';

export interface ExpenseCategory {
  key: ExpenseCategoryKey;
  label: string;
  icon: IconName;
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategoryKey, ExpenseCategory> = {
  bebidas: {
    key: 'bebidas',
    label: 'Bebidas',
    icon: 'waterbottle.fill',
  },
  refrescos: {
    key: 'refrescos',
    label: 'Refrescos',
    icon: 'takeoutbag.and.cup.and.straw.fill',
  },
  lacteos: {
    key: 'lacteos',
    label: 'Lácteos',
    icon: 'drop.fill',
  },
  panaderia: {
    key: 'panaderia',
    label: 'Panadería',
    icon: 'birthday.cake.fill',
  },
  snacks: {
    key: 'snacks',
    label: 'Snacks',
    icon: 'bag.fill',
  },
  alimentos: {
    key: 'alimentos',
    label: 'Alimentos',
    icon: 'cart.fill',
  },
  higiene: {
    key: 'higiene',
    label: 'Higiene',
    icon: 'soap.fill',
  },
  limpieza: {
    key: 'limpieza',
    label: 'Limpieza',
    icon: 'bubbles.and.sparkles.fill',
  },
  carniceria: {
    key: 'carniceria',
    label: 'Carnicería',
    icon: 'fork.knife',
  },
  verduleria: {
    key: 'verduleria',
    label: 'Frutas y verduras',
    icon: 'leaf.fill',
  },
  farmacia: {
    key: 'farmacia',
    label: 'Farmacia',
    icon: 'pills.fill',
  },
  servicios: {
    key: 'servicios',
    label: 'Servicios',
    icon: 'bolt.fill',
  },
  otros: {
    key: 'otros',
    label: 'Otros',
    icon: 'sparkles',
  },
};

/** Unknown keys (e.g. a category the registry does not know yet) bucket into Otros. */
export function getExpenseCategory(key: string): ExpenseCategory {
  return EXPENSE_CATEGORIES[key as ExpenseCategoryKey] ?? EXPENSE_CATEGORIES.otros;
}
