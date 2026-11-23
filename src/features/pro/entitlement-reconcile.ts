/**
 * DB-authoritative entitlement reconciliation (sandbox-expiry fix).
 *
 * RevenueCat stays the FAST-PATH GRANT: the `customerInfoUpdate` listener
 * flips `isPro` immediately on a real purchase. The `profiles` row is the
 * AUTHORITY FOR REVOCATION: the RevenueCat webhook writes `tier='free'`,
 * `subscription_status='none'` and `scans_limit=15` when a sandbox
 * subscription expires, so a cached `CustomerInfo` must never keep the gate
 * open after that write lands.
 *
 * This module owns the decision and its side effects, and deliberately
 * imports ONLY leaf modules — no `pro-bootstrap`, no scan-gate hook — so
 * neither caller creates an import cycle. `reconcileEntitlementFromDB` takes
 * an injectable deps object so the truth table can be EXECUTED in node with
 * fake readers/setters instead of source-pinned.
 *
 * Grace rule: a listener-driven `isPro=true` recorded in the last 60 seconds
 * protects the user from webhook lag (the webhook lands 1-3s after the SDK
 * grant). Generic cached reads in `resolveProSession` are NOT grants and
 * never touch the timestamp map.
 *
 * The DB read is bounded by `RECONCILE_TIMEOUT_MS` so a scan tap cannot hang.
 * Successful reads populate a per-user verdict cache; a later failed read
 * prefers that verdict ONLY inside `DB_VERDICT_TTL_MS`, and always preserves a
 * fresh listener grant even when the cache is empty or expired. A listener-
 * reported revoke writes a fresh `false` via `markRevoked` AND flags a pending
 * revoke, so a later failed read cannot re-open Pro from an old cached `true`
 * and the scan gate forces a new DB check instead of using the fast path.
 * `getFastPathVerdict` exposes a synchronous, network-free snapshot for the
 * gate; every per-user collection is cleared on sign-out / user change.
 */
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { readProfileRow } from '@/lib/supabase/feature-access';
import { withTimeout } from '@/lib/with-timeout';
import { useProStore } from '@/stores/use-pro-store';

import { isProExpiredOverrideEnabled, isProOverrideEnabled } from './gate';

/** The narrow slice of `profiles` this decision reads. */
export interface ProfileEntitlementRow {
  tier?: string | null;
  subscription_status?: string | null;
  ever_paid?: boolean | null;
}

type ProfileReadResult = Awaited<ReturnType<typeof readProfileRow>>;

/**
 * Webhook-lag protection window. A real `customerInfoUpdate` grant younger
 * than this survives a DB row that still says free.
 */
export const FRESH_GRANT_WINDOW_MS = 60_000;

/** Upper bound for the profile read at a scan-gate tap or bootstrap. */
export const RECONCILE_TIMEOUT_MS = 2_500;

/**
 * How long a DB-verified verdict may stand in for a failed/timed-out read.
 * Older verdicts are ignored: without a fresh DB answer we must not fabricate
 * one from stale state.
 */
export const DB_VERDICT_TTL_MS = 30_000;

/** Failure-shaped result used when the bounded read times out. */
const TIMEOUT_READ: Awaited<ReturnType<typeof readProfileRow>> = {
  status: 'error',
  message: 'profile reconciliation timed out',
};

/** Per-user timestamps of real listener-driven grants (epoch ms). */
const listenerGrantAtMs = new Map<string, number>();

/**
 * Last known verdict per user — DB-verified on a successful read, OR written
 * as `false` by `markRevoked` when the listener reports a revoke. Only entries
 * younger than `DB_VERDICT_TTL_MS` may stand in for a failed read.
 */
const dbVerdictCache = new Map<
  string,
  { isPro: boolean; verifiedAt: number }
>();

/**
 * Users whose listener reported a revoke since the last successful DB read.
 * A pending signal forces a fresh DB check — the scan gate must not reuse a
 * cached verdict (or a stale grant) while the authoritative row is unknown.
 */
const pendingRevokes = new Set<string>();

/** Per-user in-flight reconciliations so concurrent same-user taps share one read. */
const inFlightReconciliations = new Map<string, Promise<boolean>>();

/**
 * Record a REAL `customerInfoUpdate` grant for `userId`. Called by the
 * bootstrap listener only when `snapshot.isPro === true`; cached SDK reads
 * must never call this (they would reintroduce the stale-cache bug).
 */
export function recordListenerGrant(
  userId: string,
  nowMs: number = Date.now(),
): void {
  listenerGrantAtMs.set(userId, nowMs);
}

/** Clear a single user's grant stamp when a callback reports `isPro=false`. */
export function clearListenerGrant(userId: string): void {
  listenerGrantAtMs.delete(userId);
}

/**
 * Record a listener-reported revoke for `userId`. The listener calls this
 * alongside `clearListenerGrant` so a subsequent failed DB read cannot fall
 * back to an older cached `true` and re-open the gate.
 */
export function markRevoked(userId: string, nowMs: number = Date.now()): void {
  dbVerdictCache.set(userId, { isPro: false, verifiedAt: nowMs });
  pendingRevokes.add(userId);
}

/** Drop all grant timestamps — sign-out and every userId change call this. */
export function clearListenerGrants(): void {
  listenerGrantAtMs.clear();
}

/**
 * Drop ALL per-user state — sign-out and every userId change call this.
 * Clearing only verdicts would leave another user's 60s grant stamp or a
 * pending revoke behind. In-flight reads are detached so an old-user result
 * cannot be reused by or applied to the next user.
 */
export function clearEntitlementCache(): void {
  listenerGrantAtMs.clear();
  dbVerdictCache.clear();
  pendingRevokes.clear();
  inFlightReconciliations.clear();
}

/** True when a grant for THIS user landed inside the grace window. */
export function isFreshListenerGrant(
  userId: string,
  nowMs: number = Date.now(),
): boolean {
  const grantedAt = listenerGrantAtMs.get(userId);
  if (grantedAt === undefined) return false;
  const age = nowMs - grantedAt;
  // `age >= 0` guards against a backwards system clock turning a stale
  // grant "fresh" again.
  return age >= 0 && age < FRESH_GRANT_WINDOW_MS;
}

/** A verdict the scan gate may use WITHOUT awaiting a network read. */
export interface FastPathVerdict {
  isPro: boolean;
  verifiedAt: number;
}

/**
 * Snapshot of the freshest usable verdict for `userId`, or `null` when the
 * caller MUST force a fresh DB check (no verdict, expired verdict, or a
 * listener-reported revoke still pending).
 *
 * The DB verdict is combined with the 60s listener grace here so the fast
 * path cannot revoke a purchase whose webhook has not landed yet — the same
 * rule `decideReconciledEntitlement` applies on a successful read. Pure and
 * synchronous: the scan gate can decide before any network round trip.
 */
export function getFastPathVerdict(
  userId: string,
  nowMs: number = Date.now(),
): FastPathVerdict | null {
  if (pendingRevokes.has(userId)) return null;
  const cached = dbVerdictCache.get(userId);
  if (cached === undefined) return null;
  const age = nowMs - cached.verifiedAt;
  if (age < 0 || age >= DB_VERDICT_TTL_MS) return null;
  return {
    isPro: cached.isPro || isFreshListenerGrant(userId, nowMs),
    verifiedAt: cached.verifiedAt,
  };
}

/** Pure projection of the DB row — BOTH columns must agree on Pro. */
export function isProFromProfileRow(row: ProfileEntitlementRow | null): boolean {
  return row?.tier === 'pro' && row?.subscription_status === 'active';
}

export interface ReconcileInput {
  readOk: boolean;
  dbIsPro: boolean;
  dbEverPaid: boolean;
  previousIsPro: boolean;
  previousEverPaid: boolean;
  freshGrant: boolean;
}

export interface ReconcileDecision {
  /** The verdict returned to the caller (always a plain boolean). */
  isPro: boolean;
  /** Whether the caller should write `isPro` to the store. */
  apply: boolean;
  /** Whether to write ever_paid (only when the DB newly sets it). */
  setEverPaid: boolean;
  /** Whether the profile query needs settling — true only on an actual change. */
  invalidate: boolean;
}

/**
 * Pure decision function for a SUCCESSFUL read. Dev overrides and failed
 * reads are handled by the async wrapper before this is called.
 */
export function decideReconciledEntitlement(
  input: ReconcileInput,
): ReconcileDecision {
  // A failed (or empty) read is not evidence of revocation. Leave the last
  // verdict untouched and do NOT invalidate — an invalidation would just
  // re-read the same failing row.
  if (!input.readOk) {
    return { isPro: false, apply: false, setEverPaid: false, invalidate: false };
  }

  // DB wins revocations; a fresh listener grant wins the 60s lag window.
  const isPro = input.dbIsPro || input.freshGrant;
  const setEverPaid = input.dbEverPaid && !input.previousEverPaid;

  return {
    isPro,
    apply: true,
    setEverPaid,
    invalidate: isPro !== input.previousIsPro || setEverPaid,
  };
}

/** Injectable seams. Production uses `defaultDeps`; tests pass fakes. */
export interface ReconcileDeps {
  readProfile: (userId: string) => Promise<ProfileReadResult>;
  getStore: () => { isPro: boolean; everPaid: boolean };
  setPro: (isPro: boolean) => void;
  setEverPaid: (everPaid: boolean) => void;
  invalidateProfile: (userId: string) => void;
  now: () => number;
  timeoutMs: number;
  /** Injectable so tests need not depend on module-level grant-map ordering. */
  freshGrantFor: (userId: string, nowMs: number) => boolean;
  overrides: {
    isProOverrideEnabled: () => boolean;
    isProExpiredOverrideEnabled: () => boolean;
  };
}

const defaultDeps: ReconcileDeps = {
  readProfile: (userId) => readProfileRow(userId),
  getStore: () => useProStore.getState(),
  setPro: (isPro) => useProStore.setState({ isPro }),
  setEverPaid: (everPaid) => useProStore.getState().setEverPaid(everPaid),
  invalidateProfile: (userId) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
  },
  now: () => Date.now(),
  timeoutMs: RECONCILE_TIMEOUT_MS,
  freshGrantFor: (userId, nowMs) => isFreshListenerGrant(userId, nowMs),
  overrides: { isProOverrideEnabled, isProExpiredOverrideEnabled },
};

async function reconcileEntitlementFromDBImpl(
  userId: string,
  isCurrent: () => boolean,
  deps: ReconcileDeps,
): Promise<boolean> {
  if (!isCurrent()) return Promise.resolve(deps.getStore().isPro);
  if (deps.overrides.isProExpiredOverrideEnabled()) return Promise.resolve(false);
  if (deps.overrides.isProOverrideEnabled()) return Promise.resolve(true);

  return withTimeout(
    deps.readProfile(userId),
    deps.timeoutMs,
    TIMEOUT_READ,
  ).then((read) => {
    // Capture read completion immediately after the bounded DB read resolves.
    // Downstream store writes may be slow; the verdict TTL must be anchored to
    // when the DB answer was actually known.
    const readCompletedAt = deps.now();
    if (!isCurrent()) return deps.getStore().isPro;

    // Re-read AFTER the await: the listener may have granted Pro mid-flight.
    const current = deps.getStore();
    const row = read.status === 'ok' ? read.data : null;
    const freshGrant = deps.freshGrantFor(userId, readCompletedAt);

    if (row != null) {
      const dbIsPro = isProFromProfileRow(row);
      const decision = decideReconciledEntitlement({
        readOk: true,
        dbIsPro,
        dbEverPaid: row?.ever_paid === true,
        previousIsPro: current.isPro,
        previousEverPaid: current.everPaid,
        freshGrant,
      });
      // Cache the pure DB verdict, NOT the grace-adjusted value: a 60s grant
      // must not outlive its window on a later failed read. The timestamp makes
      // the fallback expire even when no listener revoke arrives.
      dbVerdictCache.set(userId, { isPro: dbIsPro, verifiedAt: readCompletedAt });
      pendingRevokes.delete(userId);
      deps.setPro(decision.isPro);
      if (decision.setEverPaid) deps.setEverPaid(true);
      if (decision.invalidate) deps.invalidateProfile(userId);
      return decision.isPro;
    }

    // Failed/empty/timed-out read: a FRESH DB-verified verdict beats a stale
    // RevenueCat value in the store. Past the TTL — or with no verdict at all —
    // keep the store untouched instead of fabricating a verdict. A real listener
    // grant is never a fabricated verdict: it must survive the failed read even
    // when there is no usable cache entry (it is the bounded false → true path).
    const cached = dbVerdictCache.get(userId);
    const cacheAge =
      cached === undefined
        ? Number.POSITIVE_INFINITY
        : readCompletedAt - cached.verifiedAt;
    if (cached !== undefined && cacheAge >= 0 && cacheAge < DB_VERDICT_TTL_MS) {
      const effective = cached.isPro || freshGrant;
      if (effective !== current.isPro) deps.setPro(effective);
      return effective;
    }
    return current.isPro || freshGrant;
  });
}

/**
 * Read the profile, apply the DB verdict to the store, and return the
 * effective `isPro` so callers (the scan gate) can use the FRESH value
 * instead of a stale hook snapshot from `useScanQuota`.
 *
 * Never throws: `readProfileRow` collapses errors into a discriminated
 * status and `withTimeout` bounds a hung read. `isCurrent` is optional (a
 * plain call from a short-lived gate is already scoped by its closure); when
 * supplied it guards every store write against a user change mid-flight.
 *
 * No RevenueCat bridge-flag parameter: a failed identity bridge must not
 * prevent DB revocation. The webhook writes the profile by Supabase user id.
 */
export async function reconcileEntitlementFromDB(
  userId: string,
  isCurrent: () => boolean = () => true,
  deps: ReconcileDeps = defaultDeps,
): Promise<boolean> {
  const inFlight = inFlightReconciliations.get(userId);
  if (inFlight) return inFlight;

  const promise = reconcileEntitlementFromDBImpl(userId, isCurrent, deps).finally(() => {
    if (inFlightReconciliations.get(userId) === promise) {
      inFlightReconciliations.delete(userId);
    }
  });
  inFlightReconciliations.set(userId, promise);
  return promise;
}
