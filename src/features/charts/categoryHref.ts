/**
 * Route for the category detail screen, scoped to `monthKey`.
 *
 * The current month omits the month param (the screen's default — it shows
 * the current month); any other month adds `?month=YYYY-MM` so the detail
 * view matches the month the user was browsing. Single source of truth for
 * the History tab's category cards and the Pro charts category rows — the
 * two must never drift apart.
 *
 * When `scope === 'household'` the href also carries `&scope=household` so
 * the detail screen renders the household drill-down instead of personal.
 * Personal callers (default) keep the exact previous href — backward
 * compatible.
 */
export function categoryDetailHref(
  slug: string,
  monthKey: string,
  currentMonthKey: string,
  scope: 'personal' | 'household' = 'personal',
):
  | `/categories/${string}`
  | `/categories/${string}?month=${string}`
  | `/categories/${string}?scope=household`
  | `/categories/${string}?month=${string}&scope=household` {
  const isCurrent = monthKey === currentMonthKey;
  const monthQuery = isCurrent ? '' : `month=${monthKey}`;
  const scopeQuery = scope === 'household' ? 'scope=household' : '';
  const parts = [monthQuery, scopeQuery].filter(Boolean);
  const query = parts.length > 0 ? `?${parts.join('&')}` : '';
  return `/categories/${slug}${query}` as
    | `/categories/${string}`
    | `/categories/${string}?month=${string}`
    | `/categories/${string}?scope=household`
    | `/categories/${string}?month=${string}&scope=household`;
}
