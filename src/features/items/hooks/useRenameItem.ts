import { useCallback, useState } from 'react';

import { useSessionUser } from '@/features/auth';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

import { sanitizeItemName } from '../normalize-name';

/**
 * User-safe copy when a rename write fails. Matches the WRITE_ERROR_MESSAGE
 * posture used by `setProfileCurrency` / `setProfileBudget` (raw backend
 * text never reaches the UI), but lives in this module because item rename
 * is its own feature concern and we don't want cross-feature coupling on
 * the constant.
 */
export const RENAME_ITEM_ERROR_MESSAGE =
  'No se pudo guardar el cambio. Inténtalo de nuevo.';

/**
 * Discriminated result every rename mutation returns: `ok` carries the
 * sanitised name the parent should use to navigate / display, `error`
 * carries a user-safe message (never raw PostgREST text).
 */
export type RenameItemResult =
  | { status: 'ok'; newName: string }
  | { status: 'error'; message: string };

export interface UseRenameItemResult {
  /**
   * Persist the rename server-side. Resolves with a discriminated result;
   * the parent (the item detail screen) handles navigation on `ok` and the
   * inline error message on `error`.
   */
  mutate: (itemId: string, newName: string) => Promise<RenameItemResult>;
  /** True while the rename write is in flight (modal disables the save button). */
  isLoading: boolean;
  /** Last user-safe error message; cleared on the next attempt. */
  error: string | null;
}

/**
 * Single entry point for renaming a purchase item from the post-scan
 * detail screen. The edit-on-review path is intentionally OUT of scope
 * here — it mutates the local draft (`upsertItem`) and persists on CONFIRM
 * via the existing `saveReceipt` flow, so calling this hook from review
 * would touch the DB twice (once for the edit, once for the confirm).
 *
 * Write semantics:
 *   - `isSupabaseConfigured` gate: an unconfigured client returns
 *     `RENAME_ITEM_ERROR_MESSAGE` without touching the network.
 *   - `sanitizeItemName` is invoked BEFORE the round trip so an empty or
 *     over-long name never leaves the device; both flows share the same
 *     validation through this hook.
 *   - The update is scoped to a single `purchase_items` row by id; RLS
 *     (`purchase_items_update_parent_owner`) validates ownership via the
 *     `purchases.user_id` join, so non-owner rows reject server-side with
 *     `42501`. Raw `error.code` is logged but the user sees only the
 *     user-safe copy.
 *   - `name_search` is a GENERATED column (public.f_unaccent(name)) that
 *     Postgres re-derives on every UPDATE — no trigger, no separate write.
 *
 * Cache invalidation (on success only):
 *   - `queryKeys.homeFeed(userId)` — the receipts store previously hydrated
 *     from this query; the feed now lives in month-scoped TanStack queries
 *     but the key is still invalidated for downstream consumers.
 *   - `queryKeys.itemSearchPrefix(userId)` — matches every month/query
 *     variant of the History item search; invalidating the prefix is the
 *     shared idiom across the codebase (same as `saveReceipt`).
 *   - `queryKeys.monthReceiptsPrefix(userId)` — the month-scoped receipts
 *     queries (useMonthReceipts, receipts/[id].tsx) read full-month rows;
 *     a renamed item must refresh those so the detail screen shows the new
 *     name on next render.
 *   - `queryKeys.profile` / `queryKeys.budget` — defensive: they don't
 *     read items, but a single invalidate call is cheap and shields any
 *     future surface that joins profile + items.
 */
export function useRenameItem(): UseRenameItemResult {
  const { userId } = useSessionUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (
      itemId: string,
      newName: string,
    ): Promise<RenameItemResult> => {
      // Clear any prior message so the modal's error slot doesn't show a
      // stale failure while the new attempt is in flight.
      setError(null);
      setIsLoading(true);
      try {
        if (!isSupabaseConfigured) {
          const message = RENAME_ITEM_ERROR_MESSAGE;
          setError(message);
          return { status: 'error', message };
        }
        const sanitised = sanitizeItemName(newName);
        if (!sanitised.ok) {
          setError(sanitised.message);
          return { status: 'error', message: sanitised.message };
        }
        const { error: writeError } = await supabase
          .from('purchase_items')
          .update({ name: sanitised.value })
          .eq('id', itemId);
        if (writeError) {
          // Same posture as the profile writes: log the raw code for
          // debugging but never surface it to the user.
          console.warn(
            '[write] rename purchase_item failed:',
            writeError.code,
            writeError.message,
          );
          const message = RENAME_ITEM_ERROR_MESSAGE;
          setError(message);
          return { status: 'error', message };
        }
        if (userId) {
          // See the header doc for why each key is invalidated.
          void queryClient.invalidateQueries({
            queryKey: queryKeys.homeFeed(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.itemSearchPrefix(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.monthReceiptsPrefix(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.profile(userId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.budget(userId),
          });
        }
        return { status: 'ok', newName: sanitised.value };
      } finally {
        setIsLoading(false);
      }
    },
    [userId],
  );

  return { mutate, isLoading, error };
}
