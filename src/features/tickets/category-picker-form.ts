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
import { EXPENSE_CATEGORIES } from '@/features/home/categories';

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
 */
export function pickerRowsFromCatalog(
  catalog: CategoryCatalog,
): CategoryPickerRow[] {
  return Object.values(catalog).map((entry) => ({
    slug: entry.slug,
    label: entry.name,
    icon: entry.icon as IconName,
    color: entry.color,
  }));
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