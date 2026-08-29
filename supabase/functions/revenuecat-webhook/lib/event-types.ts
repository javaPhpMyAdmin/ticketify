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
  'TRIAL_STARTED',
  'TRIAL_ENDED',
]);

/**
 * Events that grant Pro entitlement (REQ-SYNC-1).
 * `TRIAL_STARTED` grants Pro during the trial window.
 */
export const GRANT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'TRIAL_STARTED',
]);

/**
 * Events that revoke Pro entitlement (REQ-SYNC-2). `BILLING_ISSUE`
 * is intentionally in this set — REQ-SYNC-2's BILLING_ISSUE scenario
 * pins it as a free transition. `TRIAL_ENDED` revokes Pro when the
 * trial period expires.
 */
export const REVOKE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'TRIAL_ENDED',
]);

export type Tier = 'pro' | 'free';

/**
 * Events that carry trial-specific subscription_status values.
 * The webhook handler calls `sync_subscription_status` in addition to
 * `set_profile_tier` for these events so the lifecycle column reflects
 * the trial state accurately.
 */
export const TRIAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'TRIAL_STARTED',
  'TRIAL_ENDED',
]);

/**
 * Map a trial event type to the subscription_status value to persist.
 */
export function mapTrialStatus(eventType: string): string | null {
  if (eventType === 'TRIAL_STARTED') return 'trial';
  if (eventType === 'TRIAL_ENDED') return 'expired';
  return null;
}

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
 * True when the event is a REAL paid grant — money actually changing hands
 * (initial purchase, renewal, or uncancellation). Used to set the monotonic
 * `profiles.ever_paid` flag: a TRIAL_STARTED (however it maps for tier) is
 * NOT a real payment, so it must NEVER flip ever_paid.
 */
export function isRealGrant(eventType: string): boolean {
  return (
    eventType === 'INITIAL_PURCHASE' ||
    eventType === 'RENEWAL' ||
    eventType === 'UNCANCELLATION'
  );
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
