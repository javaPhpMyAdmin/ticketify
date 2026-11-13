/**
 * Stable React key for a per-category spend row.
 *
 * Since the 0044 grouped aggregation a mixed-currency month emits ONE ROW
 * PER UNIT for the same category (`category_id` is the category slug), so
 * the id alone collides between the viewer-unit row and a foreign-unit row
 * ("Encountered two children with the same key"). Appending the row's unit
 * keeps the key unique without reordering the rendered list.
 *
 * A row with no unit (legacy/pre-0044 shape) falls back to the viewer
 * profile at render time, so the literal `viewer` keeps that row unique
 * against a unit-bearing row for the same category.
 */
export function categoryRowKey(
  categoryId: string,
  currency?: string | null,
): string {
  return `${categoryId}:${currency ?? 'viewer'}`;
}
