/**
 * Route for the category detail screen, scoped to `monthKey`.
 *
 * The current month omits the month param (the screen's default — it shows
 * the current month); any other month adds `?month=YYYY-MM` so the detail
 * view matches the month the user was browsing. Single source of truth for
 * the History tab's category cards and the Pro charts category rows — the
 * two must never drift apart.
 */
export function categoryDetailHref(
  slug: string,
  monthKey: string,
  currentMonthKey: string,
): `/categories/${string}` | `/categories/${string}?month=${string}` {
  return monthKey === currentMonthKey
    ? `/categories/${slug}`
    : `/categories/${slug}?month=${monthKey}`;
}
