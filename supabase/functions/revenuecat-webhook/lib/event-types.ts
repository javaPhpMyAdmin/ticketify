/**
 * RevenueCat entitlement event set and tier mapping
 * (REQ-SYNC-1 / REQ-SYNC-2 / REQ-SYNC-7, design D6).
 *
 * Pin the contract:
 *   - GRANT_EVENT_TYPES  → tier 'pro'  (INITIAL_PURCHASE, RENEWAL, UNCANCELLATION)
 *   - REVOKE_EVENT_TYPES → tier 'free' (CANCELLATION, EXPIRATION, BILLING_ISSUE)
 *   - everything else    → mapTier returns null → handler answers 200 no-op
 *
 * The function `mapTier` is the single source of truth: the handler
 * asks `mapTier(event.type)`, branches on the result (pro / free /
 * null no-op), and never re-encodes the allow-list inline. A future
 * event-type addition (e.g. PRODUCT_CHANGE) only touches this file.
 *
 * Pure functions, no Deno globals, no I/O — mirrorable in the future
 * node `.mjs` test harness (M8.1).
 */

/**
 * All event types the webhook recognizes. Anything outside this set is
 * a 200 no-op per REQ-SYNC-7 ("ignored events MUST NOT surface as
 * errors"). The handler does NOT use this set to decide whether to
 * apply — it uses `mapTier` so that the GRANT/REVOKE membership is the
 * single source of truth and `ALLOWED_EVENT_TYPES` stays a convenience
 * for debugging / future introspection.
 */
export const ALLOWED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
]);

/**
 * Events that grant Pro entitlement (REQ-SYNC-1).
 */
export const GRANT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
]);

/**
 * Events that revoke Pro entitlement (REQ-SYNC-2). `BILLING_ISSUE`
 * is intentionally in this set — REQ-SYNC-2's BILLING_ISSUE scenario
 * pins it as a free transition.
 */
export const REVOKE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
]);

export type Tier = 'pro' | 'free';

/**
 * Map a RevenueCat event type to the target tier.
 *
 * Returns:
 *   - `'pro'`  when the event type is in GRANT_EVENT_TYPES
 *   - `'free'` when the event type is in REVOKE_EVENT_TYPES
 *   - `null`  for any other input (handler answers 200 no-op)
 *
 * Pure: no side effects, no allocation beyond the literal return.
 */
export function mapTier(eventType: string): Tier | null {
  if (GRANT_EVENT_TYPES.has(eventType)) return 'pro';
  if (REVOKE_EVENT_TYPES.has(eventType)) return 'free';
  return null;
}

/**
 * True unless the function was configured for sandbox deliveries.
 *
 * The webhook reads `Deno.env.get('REVENUECAT_ENVIRONMENT')`:
 *   - `'production'` (or unset)  → production mode → sandbox events are 200 no-op
 *   - `'sandbox'`                → sandbox mode     → all events are accepted
 *
 * The default behavior (env var unset) is production: ignoring
 * sandbox events is the safe-by-default posture (REQ-SYNC-7).
 */
export function isProductionEnvironment(env: string): boolean {
  return env !== 'sandbox';
}
