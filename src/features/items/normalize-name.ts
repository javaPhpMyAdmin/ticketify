/**
 * Pure validation helper for renaming a purchase item. Used by both the
 * post-scan rename path (server-side, via `useRenameItem`) and the
 * edit-on-review path (local draft mutation, persisted on CONFIRM) so
 * the rules — trim, collapse whitespace, non-empty, ≤120 chars — live in
 * exactly one place.
 *
 * The 120-char cap matches the column shape in the `purchase_items` table
 * (long enough for any realistic product name; short enough to keep the
 * mobile UI readable and avoid any future "too long" server rejection
 * surfacing as a generic write error).
 */
export type SanitizeItemNameResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Spanish user-facing copy:
 * - Empty after trimming: "El nombre no puede estar vacío."
 * - Over the 120-char cap: "El nombre es demasiado largo."
 *
 * Both messages match the app's tone (short, second-person, ends in a
 * period) and avoid raw backend text reaching the UI (same posture as
 * the profile/budget WRITE_ERROR_MESSAGE).
 */
export const MAX_ITEM_NAME_LENGTH = 120;

export function sanitizeItemName(raw: string): SanitizeItemNameResult {
  // Trim + collapse internal whitespace so a pasted "  Menú   del  día  "
  // lands on a clean "Menú del día" before length validation.
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length === 0) {
    return { ok: false, message: 'El nombre no puede estar vacío.' };
  }
  if (value.length > MAX_ITEM_NAME_LENGTH) {
    return { ok: false, message: 'El nombre es demasiado largo.' };
  }
  return { ok: true, value };
}
