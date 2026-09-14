// Category-catalog feature module (change `category-management` — PR 2).
// Pure helpers + data-access seam + the single catalog hook every
// slug-resolving surface converges on (D3).
export {
  slugify,
  slugCollides,
  mergeCategoryCatalog,
  resolveCategory,
} from './catalog';
export type { CategoryCatalog, CategoryRow } from './catalog';
export {
  CATEGORY_ALREADY_EXISTS_MESSAGE,
  CREATE_CATEGORY_ERROR_MESSAGE,
  CUSTOM_CATEGORY_SORT_ORDER,
  DELETE_CATEGORY_ERROR_MESSAGE,
  REASSIGN_CATEGORY_ERROR_MESSAGE,
  countCategoryItems,
  createCustomCategory,
  deleteCustomCategory,
  readCategoryCatalog,
  reassignCategoryItems,
} from './api';
export type { CreateCustomCategoryInput } from './api';
export { useCategoryCatalog } from './hooks/useCategoryCatalog';
export type { UseCategoryCatalogResult } from './hooks/useCategoryCatalog';