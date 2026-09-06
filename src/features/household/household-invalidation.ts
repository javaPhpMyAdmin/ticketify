/**
 * Pure helper that invalidates the household + profile caches after a user
 * joins a household.
 *
 * MUST only be called AFTER the `joinHousehold` RPC succeeds server-side:
 * the client caches still hold the pre-join state (household null / profile
 * without `household_id`, both fresh for 60s), so invalidating forces a
 * refetch. This drives `useHousehold` to hydrate the store (Home shows the
 * household card without a toggle dance) and keeps `profiles.household_id`
 * in sync — which also feeds the household-sharing auto-enable (useProfile)
 * and the profile toggle's cached household_id. The join flow's ERROR path
 * must never call this: there is nothing to invalidate when the join failed.
 *
 * The signature is intentionally narrow — it only needs `invalidateQueries` —
 * so a test double is a trivial `{ invalidateQueries }` spy.
 */
import { queryKeys } from '@/lib/query-keys';

/** Minimal structural type: only the query-invalidation surface is used. */
export interface HouseholdCacheInvalidator {
  invalidateQueries: (opts: {
    queryKey: readonly unknown[];
  }) => Promise<unknown> | unknown;
}

export function invalidateHouseholdAfterJoin(
  queryClient: HouseholdCacheInvalidator,
  userId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.household(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
}
