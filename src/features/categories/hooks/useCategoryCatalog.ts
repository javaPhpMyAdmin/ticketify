/**
 * One React Query hook, one cache, every slug-resolving surface converges
 * here (change `category-management` — D3).
 *
 * The read returns the flat global + own rows and the hook splits them by
 * `user_id` before `mergeCategoryCatalog` (the pure, deterministic merge):
 * the exposed `catalog` is `Record<slug, Category>` with canonical-first
 * ordering and user-first slug shadowing, ready for `resolveCategory`.
 *
 * The query is gated on `userId` (a signed-out render issues zero reads) and
 * every mutation invalidates the same key so the catalog — and everything
 * consuming it — refetches atomically. Errors always surface as user-safe
 * copy via `toQueryErrorMessage` (raw backend text never crosses the seam).
 */
import { useSessionUser } from '@/features/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  FeatureQueryError,
  toQueryData,
  toQueryErrorMessage,
} from '@/lib/supabase/query-adapters';
import { queryKeys } from '@/lib/query-keys';

import {
  CREATE_CATEGORY_ERROR_MESSAGE,
  DELETE_CATEGORY_ERROR_MESSAGE,
  REASSIGN_CATEGORY_ERROR_MESSAGE,
  createCustomCategory,
  deleteCustomCategory,
  readCategoryCatalog,
  reassignCategoryItems,
  type CreateCustomCategoryInput,
} from '../api';
import { mergeCategoryCatalog, type CategoryCatalog } from '../catalog';

export interface UseCategoryCatalogResult {
  /** The merged catalog; `{}` before the first successful load. */
  catalog: CategoryCatalog;
  isLoading: boolean;
  /** User-safe copy of the catalog READ failure, or null. */
  error: string | null;
  create: (input: CreateCustomCategoryInput) => Promise<unknown>;
  isCreating: boolean;
  /** User-safe copy of the CREATE failure (incl. the 23505 duplicate), or null. */
  createError: string | null;
  delete: (categoryId: string) => Promise<unknown>;
  isDeleting: boolean;
  /** User-safe copy of the DELETE failure, or null. */
  deleteError: string | null;
  reassign: (args: { fromId: string; toId: string }) => Promise<unknown>;
  isReassigning: boolean;
  /** User-safe copy of the REASSIGN failure, or null. */
  reassignError: string | null;
}

export function useCategoryCatalog(): UseCategoryCatalogResult {
  const { userId } = useSessionUser();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.categories(userId ?? '');

  const catalogQuery = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: () => readCategoryCatalog(userId as string).then(toQueryData),
    select: (rows) => {
      const uid = userId as string;
      return mergeCategoryCatalog(
        rows.filter((row) => row.user_id === null),
        rows.filter((row) => row.user_id === uid),
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateCustomCategoryInput) => {
      // Mutations are gated on userId exactly like the read: without a
      // signed-in user they fail closed (no backend call, user-safe copy) —
      // the `userId as string` cast below was an inconsistent contract.
      if (!userId) {
        return Promise.reject(
          new FeatureQueryError('error', CREATE_CATEGORY_ERROR_MESSAGE),
        );
      }
      return createCustomCategory(userId, input).then(toQueryData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) => {
      if (!userId) {
        return Promise.reject(
          new FeatureQueryError('error', DELETE_CATEGORY_ERROR_MESSAGE),
        );
      }
      return deleteCustomCategory(userId, categoryId).then(toQueryData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: (args: { fromId: string; toId: string }) => {
      if (!userId) {
        return Promise.reject(
          new FeatureQueryError('error', REASSIGN_CATEGORY_ERROR_MESSAGE),
        );
      }
      return reassignCategoryItems(userId, args.fromId, args.toId).then(
        toQueryData,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    catalog: catalogQuery.data ?? {},
    isLoading: catalogQuery.isLoading,
    error: catalogQuery.isError
      ? toQueryErrorMessage(catalogQuery.error)
      : null,
    create: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.isError
      ? toQueryErrorMessage(createMutation.error)
      : null,
    delete: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    deleteError: deleteMutation.isError
      ? toQueryErrorMessage(deleteMutation.error)
      : null,
    reassign: reassignMutation.mutateAsync,
    isReassigning: reassignMutation.isPending,
    reassignError: reassignMutation.isError
      ? toQueryErrorMessage(reassignMutation.error)
      : null,
  };
}