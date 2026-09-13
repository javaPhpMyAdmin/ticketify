/**
 * Category-catalog data access (change `category-management` — PR 2).
 *
 * Every read funnels through the feature-access seam contract
 * (`FeatureReadResult` + `READ_ERROR_MESSAGE()`): a read either returns real
 * rows or a detectable error state, never throws, never fabricates data, and
 * never leaks raw PostgREST text to the UI.
 *
 * Reads follow the D2 scoping contract shared with `fetchCategoryIdsBySlug`
 * (tickets/api.ts): global rows (`user_id IS NULL`) ∨ the caller's own rows
 * in ONE query, ordered `sort_order, slug`, bounded — so no two users' custom
 * rows can ever mix in a catalog read. The hook splits the flat result back
 * into global/own before the pure merge (`catalog.ts`).
 *
 * Writes are user-scoped: `createCustomCategory` writes `user_id = uid`,
 * `deleteCustomCategory` guards on `id AND user_id` (RLS-parity at the query
 * level), and `reassignCategoryItems` is a bulk UPDATE that RLS scopes to
 * the caller's own `purchase_items` (that table has no `user_id` column —
 * it is parent-scoped through `purchases`).
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  READ_ERROR_MESSAGE,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';
import type { CategoryKind } from '@/types';

import { slugify, type CategoryRow } from './catalog';

/**
 * User-safe copy when the user tries to create a category whose slug
 * already exists in their catalog (client collision check + partial-index
 * 23505 backstop converge on this same copy, D4).
 */
export const CATEGORY_ALREADY_EXISTS_MESSAGE = 'Esa categoría ya existe.';

/** User-safe copy for any non-duplicate create failure. */
export const CREATE_CATEGORY_ERROR_MESSAGE =
  'No se pudo crear la categoría. Inténtalo de nuevo.';

/** User-safe copy for delete failures — including the fail-closed 0-row case. */
export const DELETE_CATEGORY_ERROR_MESSAGE =
  'No se pudo eliminar la categoría. Inténtalo de nuevo.';

/** User-safe copy for reassignment (bulk UPDATE) failures. */
export const REASSIGN_CATEGORY_ERROR_MESSAGE =
  'No se pudieron reasignar los gastos. Inténtalo de nuevo.';

/**
 * Base `sort_order` for custom rows. Canonical rows are seeded with
 * `sort_order < 100` (migration 0032 CHECK requires custom rows ≥ 100, and
 * the merge orders canonical-first). All custom rows share the base —
 * ordering among them is deterministic through the merge's slug tie-break.
 */
export const CUSTOM_CATEGORY_SORT_ORDER = 100;

/** What the picker's create form sends (kind is an explicit choice, D5). */
export interface CreateCustomCategoryInput {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
}

/**
 * Read the user's category catalog: global rows (`user_id IS NULL`) plus the
 * caller's own rows in one query, ordered `sort_order, slug`, bounded to 500
 * (mirrors `fetchCategoryIdsBySlug`, tickets/api.ts). The raw rows carry
 * `user_id` so the hook can split global vs own before merging.
 */
export async function readCategoryCatalog(
  userId: string,
): Promise<FeatureReadResult<CategoryRow[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, kind, icon, color, sort_order, user_id')
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .order('sort_order,slug')
    .limit(500);
  if (error) {
    console.warn('[read] category catalog failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE() };
  }
  return { status: 'ok', data: (data ?? []) as CategoryRow[] };
}

/**
 * Create a user-scoped custom category. The slug is derived from the name
 * via `slugify` (D4); the partial unique index raises 23505 on any collision
 * race and the mutation maps it to the same friendly copy the client-side
 * collision check shows.
 *
 * Defense-in-depth: `user_id` and `slug` are SERVER-issued values, not
 * client-controlled — the row is built with `...input` FIRST so a crafted
 * payload can never override them (the cross-user write would be RLS-blocked
 * anyway, but the invariant must not depend on the DB backstop). Fail-closed:
 * a name with no slugifiable characters (emoji-only, symbols, whitespace)
 * slugs to `''` and is rejected here — the API seam is the last line today
 * (the picker's validation lands with PR 3).
 */
export async function createCustomCategory(
  userId: string,
  input: CreateCustomCategoryInput,
): Promise<FeatureReadResult<CategoryRow>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const slug = slugify(input.name);
  if (!slug) {
    return { status: 'error', message: CREATE_CATEGORY_ERROR_MESSAGE };
  }
  const row = {
    ...input,
    user_id: userId,
    slug,
    sort_order: CUSTOM_CATEGORY_SORT_ORDER,
  };
  const { data, error } = await supabase
    .from('categories')
    .insert(row)
    .select('id, slug, name, kind, icon, color, sort_order, user_id')
    .single();
  if (error) {
    console.warn('[write] create category failed:', error.code, error.message);
    if (error.code === '23505') {
      return { status: 'error', message: CATEGORY_ALREADY_EXISTS_MESSAGE };
    }
    return { status: 'error', message: CREATE_CATEGORY_ERROR_MESSAGE };
  }
  return { status: 'ok', data: data as CategoryRow };
}

/**
 * Delete one of the caller's custom categories. Guarded on `id AND user_id`
 * (an RLS-breach would affect zero rows). Fail-closed: deleting zero rows is
 * reported as an error — callers must never silently assume a delete that
 * did not happen (the picker only offers the affordance after the count
 * check, D1).
 */
export async function deleteCustomCategory(
  userId: string,
  categoryId: string,
): Promise<FeatureReadResult<null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    console.warn('[write] delete category failed:', error.code, error.message);
    return { status: 'error', message: DELETE_CATEGORY_ERROR_MESSAGE };
  }
  const deleted = (data as unknown[] | null) ?? [];
  if (deleted.length === 0) {
    return { status: 'error', message: DELETE_CATEGORY_ERROR_MESSAGE };
  }
  return { status: 'ok', data: null };
}

/**
 * Reassign all the caller's items from one category to another (bulk UPDATE,
 * D1). `purchase_items` has no `user_id` column — RLS scopes the statement
 * to the caller's own items server-side, so the client only filters on the
 * source `category_id`. Returns the number of items moved (the affected
 * rows) so the caller can confirm the reassignment did something.
 */
export async function reassignCategoryItems(
  userId: string,
  fromId: string,
  toId: string,
): Promise<FeatureReadResult<{ moved: number }>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('purchase_items')
    .update({ category_id: toId })
    .eq('category_id', fromId)
    .select('id');
  if (error) {
    console.warn('[write] reassign category items failed:', error.code, error.message);
    return { status: 'error', message: REASSIGN_CATEGORY_ERROR_MESSAGE };
  }
  const moved = (data as unknown[] | null) ?? [];
  return { status: 'ok', data: { moved: moved.length } };
}