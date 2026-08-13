/**
 * Items feature — item-level UX concerns (rename, future drill-down
 * affordances). The post-scan rename hook owns the only server write for
 * this slice; the edit-on-review path lives in `@/features/tickets` and
 * flows through `saveReceipt` on confirm.
 */
export { useRenameItem, RENAME_ITEM_ERROR_MESSAGE } from './hooks/useRenameItem';
export type {
  UseRenameItemResult,
  RenameItemResult,
} from './hooks/useRenameItem';

export { RenameItemModal } from './components/RenameItemModal';
export type { RenameItemModalProps } from './components/RenameItemModal';

export { sanitizeItemName, MAX_ITEM_NAME_LENGTH } from './normalize-name';
export type { SanitizeItemNameResult } from './normalize-name';
