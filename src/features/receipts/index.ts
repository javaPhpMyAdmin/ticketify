/**
 * Receipts feature barrel.
 *
 *   import { ReceiptCategoryItemsModal } from '@/features/receipts';
 *
 * The modal lives HERE, not under `src/app/receipts/`, because every file
 * inside `app/` is a route: expo-router requires a default export and logs
 * a "missing the required default export" warning for named-only modules.
 * Route helpers and modals belong to the feature layer (same pattern as
 * `@/features/charts` exporting `DayDetailModal`).
 */
export { ReceiptCategoryItemsModal } from './components/ReceiptCategoryItemsModal';
export type {
  ReceiptCategoryItem,
  ReceiptCategoryItemsModalProps,
} from './components/ReceiptCategoryItemsModal';
