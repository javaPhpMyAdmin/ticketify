/**
 * Pure category-picker logic (change `category-management` — PR 3, D4/D5).
 *
 * The picker's create form lives INSIDE the shared modal
 * (`CategoryPickerModal`), so every decision this form makes is factored
 * into plain functions the node harness can pin
 * (`scripts/test-manual-screen.mjs` section D) without mounting React:
 *
 * - the 40-char guardrail (matches the DB VARCHAR(40) / migration 0032),
 * - the stable color palette (the canonical taxonomy's own backgrounds),
 * - the create-form validation, including the D4 collision pre-block
 *   (`slugify` + `slugCollides` against the CURRENT catalog),
 * - the deterministic grid rows (merged catalog canonical-first + own;
 *   static canonical fallback keeps the grid alive before the catalog
 *   loads or when the read fails — no second fetch),
 * - the i18n bridge: every failure reason maps to a `tickets:` key, and
 *   the collision copy converges with the API seam's
 *   `CATEGORY_ALREADY_EXISTS_MESSAGE` (task 3.3 parity test),
 * - the gate-fix helpers (slice 3/7 REQUIRED): the seam display path
 *   (`seamCreateErrorKey`) always resolves to a localized key — never
 *   raw es-AR copy; the form/name error derivations gate stale
 *   `createError` behind the submit attempt; and the dismissal/session
 *   guards make a cancelled create actually cancel (BottomSheet
 *   `dismissable` + a per-dismissal session token).
 *
 * The modal consumes the merged catalog from `useCategoryCatalog` and
 * hands the user's choices to the hook's `create` mutation — this module
 * stays import-free of supabase so it is testable in plain node exactly
 * like `catalog.ts`.
 */
import type { IconName } from '@/components';
import type { CategoryKind } from '@/types';

import {
  slugCollides,
  slugify,
  type CategoryCatalog,
} from '@/features/categories/catalog';
import {
  EXPENSE_CATEGORIES,
  resolveCategoryDisplay,
} from '@/features/home/categories';

/** DB guardrail (migration 0032): category names are VARCHAR(40). */
export const MAX_CATEGORY_NAME_LENGTH = 40;

/**
 * Fixed icon for rows created through the picker — the same 'otros'
 * fallback glyph the taxonomy uses for unknown keys.
 */
export const CATEGORY_CREATE_DEFAULT_ICON: IconName = 'sparkles';

/**
 * Stable palette for the create form's swatches: the canonical taxonomy's
 * own backgrounds in catalog order (bebidas → otros). Custom rows created
 * with a canonical color stay visually coherent with the global taxonomy.
 */
export const CATEGORY_PALETTE_COLORS: readonly string[] = Object.values(
  EXPENSE_CATEGORIES,
).map((entry) => entry.background);

/** One picker grid row (canonical or custom) — what the modal renders. */
export interface CategoryPickerRow {
  slug: string;
  label: string;
  icon: IconName;
  color: string;
}

/**
 * Grid rows from the merged catalog: `Object.values` preserves the
 * canonical-first + own-appended deterministic order the merge builds.
 *
 * Display convergence (REQ-008 — W-3): canonical slugs render the STATIC
 * taxonomy visuals (label/icon/color) — the DB mirror rows carry legacy
 * visuals that must NEVER leak into the picker, or the same canonical slug
 * would show one look in the grid and another on every display surface.
 * The catalog row is used for custom slugs only, matching
 * `resolveCategoryDisplay`'s contract exactly.
 */
export function pickerRowsFromCatalog(
  catalog: CategoryCatalog,
): CategoryPickerRow[] {
  return Object.values(catalog).map((entry) => {
    const visual = resolveCategoryDisplay(catalog, entry.slug);
    return {
      slug: visual.key,
      label: visual.label,
      icon: visual.icon,
      color: visual.background,
    };
  });
}

/**
 * Static fallback rows (the canonical 13) — keeps the grid alive while
 * the catalog is still loading or after a read failure. Pure fallback,
 * NOT a second fetch: `readCategoryCatalog` stays the single source.
 */
export function canonicalFallbackRows(): CategoryPickerRow[] {
  return Object.values(EXPENSE_CATEGORIES).map((entry) => ({
    slug: entry.key,
    label: entry.label,
    icon: entry.icon,
    color: entry.background,
  }));
}

/**
 * PR 5 (editor wiring): the single catalog-aware row a chip/editor label
 * resolves to for a slug. Static-first, mapping `resolveCategoryDisplay`'s
 * contract onto the picker row shape the Chip renders (label + icon):
 *
 * - a canonical slug → the STATIC taxonomy row (byte-identical with every
 *   display surface; the DB mirror row's legacy visuals never leak — W-3),
 * - a custom slug → its own row (label/icon render the user's category),
 * - an unknown slug → the deterministic static 'otros' row,
 * - a null/empty selection → null (the editor default renders
 *   SIN CATEGORÍA — "No category chosen → category_id = null" never
 *   displays as the otros fallback),
 * - an empty catalog (pre-load/read-failure) → null, so the caller chains
 *   the static `getExpenseCategory(slug)` fallback exactly like the
 *   `resolveCategory ?? getExpenseCategory` consumer pattern.
 */
export function pickerRowForCategory(
  catalog: CategoryCatalog | undefined,
  slug: string | null | undefined,
): CategoryPickerRow | null {
  if (!slug || !catalog) return null;
  const visual = resolveCategoryDisplay(catalog, slug);
  return {
    slug: visual.key,
    label: visual.label,
    icon: visual.icon,
    color: visual.background,
  };
}

/**
 * The slug universe the picker blocks against (D4): the canonical 13 —
 * static, knowable even before the catalog loads — UNION the caller's own
 * catalog as it is known RIGHT NOW. The modal recomputes this on every
 * keystroke, so a row created moments ago blocks the next form
 * immediately (and a 23505 race still maps to the same copy).
 */
export function categoryCollisionSlugs(catalog: CategoryCatalog): Set<string> {
  const slugs = new Set<string>(Object.keys(catalog));
  for (const key of Object.keys(EXPENSE_CATEGORIES)) {
    slugs.add(key);
  }
  return slugs;
}

export type CategoryCreateFailureReason =
  | 'name_required'
  | 'name_too_long'
  | 'kind_required'
  | 'color_required'
  | 'slug_empty'
  | 'slug_collides';

export type CategoryCreateValidation =
  | { ok: true; reason: null; slug: string }
  | { ok: false; reason: CategoryCreateFailureReason; slug: string };

/**
 * Validate the create form before it reaches the mutation (D4/D5).
 *
 * Check order is deliberate: name problems first, then the collision
 * pre-block (a colliding name is blocked even while the kind is still
 * unset — the category exists, the kind is moot), then the explicit
 * kind and palette color choices. `kind` and `color` are runtime-checked
 * so a crafted call can never slip through the TS types.
 */
export function validateCategoryCreateInput(
  name: string,
  kind: CategoryKind | null | undefined,
  color: string | null | undefined,
  catalogSlugs: ReadonlySet<string> | readonly string[],
): CategoryCreateValidation {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'name_required', slug: '' };
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH)
    return { ok: false, reason: 'name_too_long', slug: '' };
  const slug = slugify(trimmed);
  if (!slug) return { ok: false, reason: 'slug_empty', slug: '' };
  if (slugCollides(slug, catalogSlugs))
    return { ok: false, reason: 'slug_collides', slug };
  if (kind !== 'need' && kind !== 'want')
    return { ok: false, reason: 'kind_required', slug };
  if (!color || !CATEGORY_PALETTE_COLORS.includes(color))
    return { ok: false, reason: 'color_required', slug };
  return { ok: true, reason: null, slug };
}

/**
 * i18n bridge: each failure reason resolves to the `tickets:` error key
 * the picker renders (task 3.3 parity test pins every key in all three
 * locales). `slug_empty` reuses the "unusable name" copy (letters and
 * numbers guidance) and `slug_collides` converges on `categoryCreateExists`
 * — text-identical to the API seam's `CATEGORY_ALREADY_EXISTS_MESSAGE`.
 *
 * The key values are LITERAL types so `t(CATEGORY_CREATE_ERROR_KEYS[r])`
 * type-checks against i18next's resource-derived key union
 * (`src/i18n/types.ts` derives it from the on-disk es-AR catalog).
 */
export type CategoryCreateErrorKey =
  | 'tickets:categoryCreateNameRequired'
  | 'tickets:categoryCreateNameTooLong'
  | 'tickets:categoryCreateKindRequired'
  | 'tickets:categoryCreateColorRequired'
  | 'tickets:categoryCreateNameInvalid'
  | 'tickets:categoryCreateExists'
  | 'tickets:categoryCreateError';

export const CATEGORY_CREATE_ERROR_KEYS: Record<
  CategoryCreateFailureReason,
  CategoryCreateErrorKey
> = {
  name_required: 'tickets:categoryCreateNameRequired',
  name_too_long: 'tickets:categoryCreateNameTooLong',
  kind_required: 'tickets:categoryCreateKindRequired',
  color_required: 'tickets:categoryCreateColorRequired',
  slug_empty: 'tickets:categoryCreateNameInvalid',
  slug_collides: 'tickets:categoryCreateExists',
};

/**
 * Display-path bridge for the API seam's raw failure copy (gate fix: the
 * modal NEVER renders `createError` verbatim — en/pt-BR users would see
 * the es-AR constant otherwise). The 23505 duplicate (text-identical to
 * `CATEGORY_ALREADY_EXISTS_MESSAGE`) converges on the SAME key as the
 * client-side pre-block; every other seam failure (network, timeout,
 * fail-closed no-session) lands on the generic localized key.
 *
 * `collisionLiteral` is the seam's `CATEGORY_ALREADY_EXISTS_MESSAGE`
 * text, passed in — api.ts pulls supabase and stays out of this module.
 */
export function seamCreateErrorKey(
  createError: string | null | undefined,
  collisionLiteral: string,
): CategoryCreateErrorKey | null {
  if (!createError) return null;
  return createError === collisionLiteral
    ? 'tickets:categoryCreateExists'
    : 'tickets:categoryCreateError';
}

/**
 * Form-level error derivation for the create screen. `attempted` gates
 * the WHOLE fall-through: a pristine — or reopened, or name-edited —
 * form shows no error even while the hook's `createError` is stale, and
 * the name field owns the name-family messages (they never appear here
 * twice). Kind/color requirements surface on submit; anything else falls
 * through to the seam key (always localized).
 */
export function categoryCreateFormError(
  validation: CategoryCreateValidation,
  attempted: boolean,
  seamKey: CategoryCreateErrorKey | null,
): CategoryCreateErrorKey | null {
  if (!attempted) return null;
  if (validation.ok === false) {
    if (validation.reason === 'kind_required')
      return CATEGORY_CREATE_ERROR_KEYS.kind_required;
    if (validation.reason === 'color_required')
      return CATEGORY_CREATE_ERROR_KEYS.color_required;
  }
  return seamKey;
}

/**
 * Name-field error derivation. The name-family reasons (required / too
 * long / unusable) surface once the user attempts; a live collision
 * shows IMMEDIATELY while typing regardless of `attempted` (the D4
 * pre-block's feedback) — exactly one copy, in the field.
 */
export function categoryCreateNameFieldError(
  validation: CategoryCreateValidation,
  attempted: boolean,
): CategoryCreateErrorKey | null {
  if (validation.ok === false) {
    if (validation.reason === 'slug_collides')
      return CATEGORY_CREATE_ERROR_KEYS.slug_collides;
    if (
      attempted &&
      (validation.reason === 'name_required' ||
        validation.reason === 'name_too_long' ||
        validation.reason === 'slug_empty')
    ) {
      return CATEGORY_CREATE_ERROR_KEYS[validation.reason];
    }
  }
  return null;
}

/**
 * Dismissal gate (cancel-must-cancel): the sheet cannot be torn down
 * while the create mutation is in flight. Backdrop tap, system back and
 * the close button all route through BottomSheet's `dismissable` — an
 * abrupt dismissal mid-create must not read as success, because the
 * parent's `lastCategoryTarget` fallback would silently categorize the
 * item on the next save.
 */
export function canDismissCategoryPicker(isCreating: boolean): boolean {
  return !isCreating;
}

/**
 * Session guard for the post-await selection: only the sheet session
 * that STARTED the create may call `onSelect` on success. The modal
 * bumps the session on every dismissal, so a create that resolves after
 * the sheet was closed — or closed and reopened — is dropped, never
 * selected.
 */
export function isCurrentCategoryCreateSession(
  session: number,
  current: number,
): boolean {
  return session === current;
}

// ---------------------------------------------------------------------------
// Delete flow (PR 4 — D1 block-delete policy)
//
// Spec REQ-BLOCK-DELETE: a custom category in use (has purchase_items) MUST
// NOT be deleted; the flow blocks with an explanation and OFFERS explicit
// reassignment of its purchases to another category before deletion. There
// is NO silent re-bucket to 'otros': the target is an explicit choice and
// canonical rows (including 'otros') stay valid targets. An empty category
// MAY be deleted directly.
//
// These functions are pure and supabase-free: api.ts owns the actual count /
// reassign / delete seams (RLS-scoped), and the modal injects them as
// `CategoryDeleteActions` — exactly like the create path's seam-error bridge.
// ---------------------------------------------------------------------------

/**
 * Own custom rows live at `sort_order >= 100` (migration 0032 CHECK; the
 * canonical seed rows are all < 100). The merged catalog strips `user_id`,
 * so this is the delete affordance's ownership signal.
 */
export const CUSTOM_CATEGORY_MIN_SORT_ORDER = 100;

/** The delete operations the modal wires to the RLS-scoped API seams. */
export interface CategoryDeleteActions {
  /** Count the caller's purchase_items for a category (RLS-scoped). */
  count: (categoryId: string) => Promise<{ ok: boolean; count: number }>;
  /** Bulk-update the caller's items from → to. */
  reassign: (fromId: string, toId: string) => Promise<{ ok: boolean }>;
  /** Delete one of the caller's own category rows. */
  deleteRow: (categoryId: string) => Promise<{ ok: boolean }>;
}

export type CategoryDeleteErrorStep = 'count' | 'reassign' | 'delete';

export type CategoryDeleteOutcome =
  | { status: 'in-use'; count: number }
  | { status: 'empty' }
  | { status: 'deleted' }
  | { status: 'error'; step: CategoryDeleteErrorStep };

/**
 * The slugs of the caller's OWN custom rows in the merged catalog
 * (sort_order >= 100). Canonical rows — and anything else — never gain a
 * delete affordance here.
 */
export function customCategorySlugs(catalog: CategoryCatalog): string[] {
  return Object.values(catalog)
    .filter((entry) => entry.sort_order >= CUSTOM_CATEGORY_MIN_SORT_ORDER)
    .map((entry) => entry.slug);
}

/** D1 count check: any purchase item referencing the category blocks delete. */
export function isCategoryInUse(count: number): boolean {
  return count > 0;
}

/**
 * Valid reassignment targets for a blocked delete: the WHOLE picker grid
 * minus the deleted row itself. Canonical rows — including the 'otros'
 * fallback — stay valid explicit targets (spec scenario moves purchases to
 * 'otros'); the choice is never automatic.
 */
export function reassignmentTargets(
  catalog: CategoryCatalog,
  deletedSlug: string,
): CategoryPickerRow[] {
  return pickerRowsFromCatalog(catalog).filter(
    (row) => row.slug !== deletedSlug,
  );
}

/**
 * Step 1 of the delete flow: the RLS-scoped count. `count > 0` → blocked
 * in-use (the modal surfaces the count + reassignment); `0` → empty delete
 * allowed; any count failure (backend error, unconfigured, rejected) fails
 * closed to a user-safe error — the modal never guesses.
 */
export async function requestCategoryDelete(
  actions: CategoryDeleteActions,
  categoryId: string,
): Promise<CategoryDeleteOutcome> {
  try {
    const result = await actions.count(categoryId);
    if (!result.ok) return { status: 'error', step: 'count' };
    return isCategoryInUse(result.count)
      ? { status: 'in-use', count: result.count }
      : { status: 'empty' };
  } catch {
    return { status: 'error', step: 'count' };
  }
}

/**
 * Blocked-path orchestration (D1): reassign the category's items to the
 * EXPLICIT target, then delete the row — the category is now empty, and FK
 * RESTRICT is the backstop against a concurrent insert race. Fail-closed:
 * a failed reassign means NO delete attempt (moved items must never be left
 * pointing at a row that is about to vanish).
 */
export async function confirmCategoryReassignDelete(
  actions: CategoryDeleteActions,
  fromId: string,
  toId: string,
): Promise<CategoryDeleteOutcome> {
  let reassigned: { ok: boolean };
  try {
    reassigned = await actions.reassign(fromId, toId);
  } catch {
    return { status: 'error', step: 'reassign' };
  }
  if (!reassigned.ok) return { status: 'error', step: 'reassign' };
  let deleted: { ok: boolean };
  try {
    deleted = await actions.deleteRow(fromId);
  } catch {
    return { status: 'error', step: 'delete' };
  }
  return deleted.ok
    ? { status: 'deleted' }
    : { status: 'error', step: 'delete' };
}

/** Empty-path orchestration: delete the row directly (RESTRICT backstop). */
export async function confirmCategoryDelete(
  actions: CategoryDeleteActions,
  categoryId: string,
): Promise<CategoryDeleteOutcome> {
  try {
    const deleted = await actions.deleteRow(categoryId);
    return deleted.ok
      ? { status: 'deleted' }
      : { status: 'error', step: 'delete' };
  } catch {
    return { status: 'error', step: 'delete' };
  }
}

/**
 * After a successful delete, the item being categorized must never keep a
 * dangling slug: if its current selection WAS the deleted category, fall
 * back to the caller-provided resolution (the explicit reassignment target,
 * or 'otros' on an empty delete — the app-wide persisted fallback, "NULLs
 * never persist"; the DRAFT-level rule is `sweepDraftAfterDelete` below).
 * `ItemEditorModal` applies this to its OWN buffer when a delete resolves
 * inside the stacked picker (the modal also forwards the resolution so the
 * parent sweeps the WHOLE draft — W1); the node harness pins it too. Any
 * other selection (or null) passes through untouched.
 */
export function categoryAfterDelete(
  selectedSlug: string | null,
  deletedSlug: string,
  fallbackSlug: string,
): string | null {
  return selectedSlug === deletedSlug ? fallbackSlug : selectedSlug;
}

/**
 * A draft item the delete sweep can rewrite. `category_id` is the APP-LEVEL
 * SLUG at draft level (manual-receipt.ts: the user pick) and
 * `ai_suggested_category_id` is the AI suggestion — BOTH are slug references
 * that would drift at save time if they pointed at a deleted category
 * (`fetchCategoryIdsBySlug` maps unknown slugs to 'otros', api.ts
 * buildSaveReceiptArgs / updateReceipt).
 */
export interface CategoryDraftItemLike {
  category_id: string | null;
  ai_suggested_category_id?: string | null;
}

/**
 * W1 (gate fix, both lenses): after a delete/reassign resolves, the WHOLE
 * receipt draft is swept so NO item keeps a dangling reference to the deleted
 * slug. Every matching reference (the user pick AND the AI suggestion)
 * resolves to the SAME explicit resolution the primary item got — the
 * reassignment target (blocked delete) or the EXPLICIT 'otros' slug (empty
 * delete). 'otros' is the empty-path resolution ON PURPOSE: the save seams
 * persist `null → categoryIds['otros']` (the app-wide invariant "NULLs never
 * persist", tickets api.ts:678-682 / 1218-1222), so an explicit-null sweep
 * would only have deferred the re-bucket to save time — SILENTLY. Sweeping
 * to 'otros' re-buckets VISIBLY: the picker shows the fallback category
 * on the very items it frees. The source array is never mutated; new item
 * objects are returned.
 */
export function sweepDraftAfterDelete<T extends CategoryDraftItemLike>(
  items: readonly T[],
  deletedSlug: string,
  fallbackSlug: string,
): T[] {
  return items.map((item) => ({
    ...item,
    category_id:
      item.category_id === deletedSlug ? fallbackSlug : item.category_id,
    ai_suggested_category_id:
      item.ai_suggested_category_id === deletedSlug
        ? fallbackSlug
        : item.ai_suggested_category_id,
  }));
}

/**
 * W1 (gate fix, both lenses): a resolved delete/reassign sweeps the WHOLE
 * draft — every item whose category (user pick OR AI suggestion) references
 * the deleted slug resolves to the SAME explicit resolution: the
 * reassignment target (blocked) or the EXPLICIT 'otros' slug (empty — the
 * app-wide persisted fallback, "NULLs never persist"), never per-item silent
 * drift. The picker's target item is part of the sweep, exactly like every
 * sibling. The factory binds the sweep to the screen's state: `items` is
 * captured at render (the current draft), `setItems` commits the swept
 * array, and `clearTarget` closes the picker's target item. The primary
 * item's OWN buffer is rebucketed separately by `categoryAfterDelete` in
 * `ItemEditorModal`.
 */
export function createCategoryDeleteHandler<T extends CategoryDraftItemLike>(
  items: readonly T[],
  setItems: (items: T[]) => void,
  clearTarget: () => void,
): (deletedSlug: string, fallbackSlug: string) => void {
  return (deletedSlug: string, fallbackSlug: string) => {
    setItems(sweepDraftAfterDelete(items, deletedSlug, fallbackSlug));
    clearTarget();
  };
}

/**
 * W5 (gate fix, reliability): the reassignment target row must be present in
 * the catalog before the delete handler dereferences it. A concurrent
 * refetch can drop the row mid-flow; dereferencing a vanished entry would
 * throw inside the async handler and leave the sheet stuck on the blocked
 * view. The modal guards the lookup through this predicate and surfaces the
 * reassign error step instead of throwing.
 */
export function hasReassignTarget(
  catalog: CategoryCatalog,
  targetSlug: string | null,
): boolean {
  return targetSlug !== null && catalog[targetSlug] !== undefined;
}

/**
 * i18n bridge for the delete flow's failure steps: every step resolves to a
 * `tickets:` key (never the raw es-AR seam copy). The reassign step has its
 * own key; count and delete failures share the generic delete copy.
 */
export type CategoryDeleteErrorKey =
  | 'tickets:categoryDeleteError'
  | 'tickets:categoryReassignError';

export const CATEGORY_DELETE_ERROR_KEYS: Record<
  CategoryDeleteErrorStep,
  CategoryDeleteErrorKey
> = {
  count: 'tickets:categoryDeleteError',
  reassign: 'tickets:categoryReassignError',
  delete: 'tickets:categoryDeleteError',
};