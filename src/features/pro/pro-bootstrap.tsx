/**
 * Pro bootstrap (pro-subscription spec — REQ-PRO-1,
 * subscription-trial — DB subscription state).
 *
 * Mounted inside `QueryClientProvider` in `_layout.tsx`; renders `null` so
 * it never affects the visual tree. Four effects, four concerns:
 *
 *   1. ONE-TIME SDK setup (guarded by the module-level `bootstrapped`
 *      flag): `configure` runs at most once per process — REQ-PRO-1.
 *      Re-calling `Purchases.configure` would reset internal SDK state
 *      (cached customerInfo, listener registrations), so a session flip
 *      must never re-configure.
 *   2. PER-USER identity bridge + resolution (keyed on `[userId]`, runs
 *      on EVERY userId change): the DB-authoritative reconciliation STARTS
 *      FIRST and is the only awaited gate; the identity bridge
 *      (`logInRevenueCat(userId)`) and the scoped `CustomerInfo` snapshot
 *      then run in a DETACHED parallel block for the trial pill only. This is
 *      still the webhook identity bridge — without it every purchase lands
 *      on `$RCAnonymousID` and the server-side tier sync never runs — but a
 *      degraded/slow SDK can no longer delay the gate verdict.
 *   3. FOREGROUND entitlement refresh (keyed on `[userId]`): the Play
 *      Billing Client does not reliably push an expired entitlement to
 *      `customerInfoUpdate` while the app is open, so on every transition
 *      to AppState `'active'` the DB verdict is re-read FIRST (bounded);
 *      only then is the SDK cache invalidated and the entitlement re-read
 *      (bounded) for the trial pill — an expiry mid-session drops the Pro UI
 *      without a sign-out → sign-in cycle, with no RC wait in front of it.
 *   4. Tier-transition sync (REQ-PRO-UX): optimistically flips the cached
 *      profile `tier` when the store's `isPro` changes and reconciles the
 *      DB at +5s (the RevenueCat webhook is async).
 *
 * Safe-by-default (REQ-GATE-5):
 *
 *   - Missing API key / native module unavailable (Expo Go / dev client
 *     not rebuilt) → identity bridge is skipped, `getCustomerInfo` returns
 *     null, the store resolves from the DB profile only. The gate locks on
 *     the safe default.
 *   - `logInRevenueCat` fails → `console.warn` and fall through to the
 *     DB reconciliation. A failed bridge must NOT block Pro gating.
 *   - `getCustomerInfo` rejects or overruns its bound → resolved as null;
 *     the DB verdict still decides `isPro`, `isLoading: false`.
 *
 * Per-user race guard: `activeUserIdRef` holds the userId the effects are
 * CURRENTLY resolving for. Every await in the per-user path re-checks it
 * and bails when the user flipped mid-flight (A → B), so an in-flight A
 * resolution can never overwrite B's store state. The `customerInfoUpdate`
 * listener (attached once) uses the same ref — a callback from a previous
 * user's session or from the anonymous identity is dropped.
 *
 * Subscription state (post-cutover 0039 + sandbox-expiry fix):
 *   The DB profile carries `subscription_status` ('none' | 'active')
 *   and `ever_paid` — no `trial_ends_at`, no `'trial'` / `'expired'`.
 *   `entitlement-reconcile.ts` reads that row on EVERY per-user resolution,
 *   on the foreground refresh, and at the scan gate: the DB is authoritative
 *   for revocation (`isPro` is written from the row), while a real
 *   `customerInfoUpdate` grant stays a fast path protected by a 60s grace
 *   window. The webhook is the only writer of tier/status (no client RPC).
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSessionUser } from '@/features/auth';
import {
  attachCustomerInfoListener,
  configure as configureRevenueCat,
  getCustomerInfo,
  invalidateCustomerInfoCache,
  isNativeAvailable,
  logInRevenueCat,
  logOutRevenueCat,
  REVENUECAT_CALL_TIMEOUT_MS,
} from '@/lib/revenuecat';
import { withTimeout } from '@/lib/with-timeout';
import { useProStore } from '@/stores/use-pro-store';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import type { User } from '@/types';

import {
  clearEntitlementCache,
  clearListenerGrant,
  clearListenerGrants,
  markRevoked,
  reconcileEntitlementFromDB,
  recordListenerGrant,
} from './entitlement-reconcile';
import { isProExpiredOverrideEnabled, isProOverrideEnabled } from './gate';

const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

/**
 * Tracks whether `configure` has already run this process. Guards ONLY the
 * one-time SDK setup — identity bridging and per-user store resolution are
 * deliberately NOT behind this flag so they re-run for every session flip.
 */
let bootstrapped = false;

/**
 * Per-user resolution: start the DB-authoritative reconciliation FIRST, then
 * bridge the RevenueCat identity and read the scoped `CustomerInfo` snapshot
 * (trial pill only) in a DETACHED parallel block. Only the bounded DB verdict
 * gates `isLoading`, so a slow/degraded SDK cannot hold the gate closed.
 * Runs for EVERY userId change (not just the first), so a sign-out → sign-in
 * cycle in the same process re-bridges the new user's identity.
 *
 * `isCurrent` is the per-user race guard (bails after every await when the
 * user flipped); `identityBridged` mirrors `identityBridgedRef` so the
 * customerInfoUpdate listener only dispatches callbacks for a successfully
 * bridged, still-current user.
 */
async function resolveProSession(
  userId: string,
  isCurrent: () => boolean,
  identityBridged: { current: boolean },
): Promise<void> {
  // DEV-ONLY (downgrade QA): simulate an EXPIRED entitlement — `gate.ts` →
  // `isProExpiredOverrideEnabled`. Lock the store and skip ALL RevenueCat
  // reads; the downgrade UI must be observable without touching the SDK.
  // `isCurrent()` is checked even though nothing awaited yet, matching the
  // file's per-user race-guard style. Mutual exclusivity: when BOTH
  // overrides are set, the EXPIRED one wins (it is the conservative/locked
  // default — the true-override branch in the per-user effect returns
  // first, so this path is only reached with the true override off; the
  // check stays explicit so the contract holds if that ordering changes).
  if (isProExpiredOverrideEnabled()) {
    useProStore.setState({ isPro: false, isLoading: false });
    if (!isCurrent()) return;
    return;
  }

  // DB authority FIRST. Starting the bounded read here — without awaiting RC
  // — caps gate settling at RECONCILE_TIMEOUT_MS even when the SDK identity
  // bridge or cache read degrades (each bounded at ~10s). A failed bridge
  // must NOT skip this: the webhook writes the profile by Supabase user id.
  const reconciliation = reconcileEntitlementFromDB(userId, isCurrent);

  // Optional RC work runs in PARALLEL and is deliberately detached: the gate
  // never waits on it. It includes the webhook identity bridge (so purchases
  // land on the Supabase user, not $RCAnonymousID) and a cached snapshot used
  // only for the trial-pill UI. A failed bridge is warned, not fatal.
  const bridgedRcWork = (async () => {
    let identityOk = false;
    if (isNativeAvailable() && REVENUECAT_API_KEY) {
      const identity = await logInRevenueCat(userId);
      if (!isCurrent()) return;
      identityOk = identity.ok;
      identityBridged.current = identityOk;
      if (!identityOk) {
        console.warn(
          '[pro-bootstrap] RevenueCat logIn failed, continuing:',
          identity.message,
        );
      }
    }

    // CACHED snapshot: feeds only the trial pill, never `isPro`. A sandbox
    // expiry can leave it reporting an active entitlement for minutes.
    const info = await withTimeout(
      getCustomerInfo(),
      REVENUECAT_CALL_TIMEOUT_MS,
      null,
    );
    if (!isCurrent()) return;
    if (identityOk) {
      useProStore.setState({ trialEndsAt: info?.trialEndsAt ?? null });
    }
  })().catch((err) => {
    console.warn('[pro-bootstrap] optional RevenueCat background refresh failed:', err);
  });

  // The ONLY awaited gate is the bounded DB verdict: it writes `isPro`,
  // seeds monotonic `ever_paid`, and invalidates the profile query. Clearing
  // isLoading AFTER it lands keeps the gate locked (not falsely open) while
  // the authority is unknown.
  await reconciliation;
  if (!isCurrent()) return;
  useProStore.setState({ isLoading: false });
  void bridgedRcWork;
}

/**
 * Bootstraps RevenueCat on mount. Returns null — the bootstrap is a
 * pure side-effect carrier.
 */
export function ProBootstrap(): null {
  const { userId } = useSessionUser();
  const setProEntitlement = useProStore((s) => s.setProEntitlement);
  const setEverPaid = useProStore((s) => s.setEverPaid);
  const isPro = useProStore((s) => s.isPro);

  /**
   * The userId the effects are CURRENTLY resolving for. Every await in the
   * per-user path and every listener callback re-checks this ref so a
   * resolution from a previous user can never overwrite the current user's
   * store state.
   */
  const activeUserIdRef = useRef<string | null>(null);
  /** True when the CURRENT user's RevenueCat identity bridge succeeded. */
  const identityBridgedRef = useRef(false);
  /** Previous listener-reported entitlement — stamps only false → true. */
  const lastListenerIsProRef = useRef(false);

  // Effect 1 — ONE-TIME SDK setup. Configure runs at most once per process;
  // everything else about a session (identity bridge, snapshot, store
  // resolution) belongs to the per-user effect below.
  useEffect(() => {
    if (bootstrapped) return;
    if (!userId) return; // no session yet: nothing to configure
    if (isProOverrideEnabled()) {
      // DEV-ONLY: never touch the SDK when the override is on (see the
      // safety note in `gate.ts`); the per-user effect flips the store.
      return;
    }
    if (!isNativeAvailable()) return; // per-user effect degrades to DB-only
    if (!REVENUECAT_API_KEY) return; // same — warning emitted per-user
    const ok = configureRevenueCat(REVENUECAT_API_KEY);
    if (!ok) return;
    bootstrapped = true;

    // Live entitlement changes arrive through the SDK's customerInfoUpdate
    // listener (registered ONCE, after configure). The callback dispatches
    // ONLY for the current bridged user: a callback from a previous user's
    // session or from the anonymous identity must never overwrite the
    // current user's store state.
    //
    // Slice C: the listener now receives the full CustomerInfoSnapshot
    // ({ isPro, trialEndsAt }) instead of just the boolean. The store
    // setter is atomic — both fields are written in a single `set`
    // call so the gate + the profile pill never disagree mid-update.
    attachCustomerInfoListener((snapshot) => {
      const currentUserId = activeUserIdRef.current;
      if (currentUserId === null || !identityBridgedRef.current) {
        return;
      }
      const previous = lastListenerIsProRef.current;
      setProEntitlement(snapshot);

      if (!snapshot.isPro) {
        // A revoke callback invalidates any pending fast-path grant AND
        // overwrites the cached verdict: a later failed DB read must not
        // resurrect an older cached `true` and re-open the gate.
        clearListenerGrant(currentUserId);
        markRevoked(currentUserId);
        lastListenerIsProRef.current = false;
        return;
      }

      // Only a REAL false → true transition stamps a 60s grant. Repeated
      // `isPro=true` callbacks are cache echoes, not fresh purchases.
      if (!previous) recordListenerGrant(currentUserId);
      // A real purchase is MONOTONIC (migration 0021): mirror the DB flag
      // so a paid user is never offered a free trial the server rejects.
      setEverPaid(true);
      lastListenerIsProRef.current = true;
    });
  }, [userId, setProEntitlement, setEverPaid]);

  // Effect 2 — PER-USER identity bridge + resolution. Keyed on `[userId]`
  // so it runs on EVERY userId change, including the null (sign-out) case.
  // This is what keeps the RevenueCat identity in sync across
  // sign-out → sign-in cycles in the same process.
  useEffect(() => {
    // Every userId change (including null/sign-out) drops the previous
    // user's fast-path grants AND last DB-verified verdict.
    clearEntitlementCache();
    lastListenerIsProRef.current = false;
    activeUserIdRef.current = userId;
    clearListenerGrants();
    if (isProExpiredOverrideEnabled()) {
      // DEV-ONLY (downgrade QA): mirror the `isProOverrideEnabled` branch
      // but force the EXPIRED state — the store resolves locked so the
      // downgrade UI is observable without touching RevenueCat. The ref is
      // cleared so the SDK's customerInfoUpdate listener and the foreground
      // refresh effect (both keyed on the bridged-identity ref) never
      // re-write a live entitlement on top of the simulated expiry. When
      // BOTH overrides are set, the EXPIRED override wins — it is the
      // conservative/locked default.
      identityBridgedRef.current = false;
      if (userId) {
        useProStore.setState({ isPro: false, isLoading: false });
        // Reconciliation still respects the override (returns false) while
        // keeping the monotonic ever_paid seed from the profile.
        void reconcileEntitlementFromDB(
          userId,
          () => activeUserIdRef.current === userId,
        );
      }
      return;
    }

    if (isProOverrideEnabled()) {
      // DEV-ONLY: see the safety note in `gate.ts`. Flips the store to Pro
      // BEFORE any RevenueCat work so the gate opens without the SDK. When
      // `EXPO_PUBLIC_PRO_EXPIRED_OVERRIDE` is ALSO set, the expired branch
      // above wins — the two overrides are mutually exclusive by contract.
      if (userId) {
        useProStore.setState({ isPro: true, isLoading: false });
        // Reconciliation still respects the override (returns true) while
        // keeping the monotonic ever_paid seed from the profile.
        void reconcileEntitlementFromDB(
          userId,
          () => activeUserIdRef.current === userId,
        );
      }
      return;
    }

    if (!userId) {
      // Signed out: clear the previous user's store state (locked defaults,
      // so no Pro UI can flash for a future user) and detach the RC app-user
      // mapping defensively (idempotent; a no-op when the SDK was never
      // configured).
      identityBridgedRef.current = false;
      useProStore.getState().reset();
      void logOutRevenueCat();
      return;
    }

    // Real user: reset to safe defaults (gate locked) BEFORE resolving so a
    // previous user's Pro state can never flash during this resolution.
    identityBridgedRef.current = false;
    useProStore.getState().reset();
    if (isNativeAvailable() && !REVENUECAT_API_KEY) {
      // SDK is reachable but the project is missing its API key: log a
      // warning so the misconfiguration is observable.
      console.warn(
        '[pro-bootstrap] EXPO_PUBLIC_REVENUECAT_API_KEY is empty; the paywall will report a configuration error.',
      );
    }
    void resolveProSession(
      userId,
      () => activeUserIdRef.current === userId,
      identityBridgedRef,
    );
  }, [userId]);

  // Effect 3 — FOREGROUND entitlement refresh (play-billing dead-air fix).
  //
  // The Play Billing Client does NOT reliably push an entitlement change to
  // the SDK's `customerInfoUpdate` listener while the app sits in the
  // foreground — it usually syncs on resume/reconnect. A subscription that
  // EXPIRES while the app is open would therefore leave the store
  // `isPro=true` (profile + Pro gates still paid) until the user signs out
  // and back in. This effect re-runs the entitlement read whenever the app
  // transitions to `'active'`, with the same bounded pattern as
  // `resolveProSession`.
  //
  // Top guard: signed-out and dev overrides block the whole refresh. The
  // bridge ref is deliberately NOT here — a degraded RC bridge must never
  // skip DB reconciliation. It gates only the optional RC read below.
  // After each await the per-user guard re-checks `userId`, so an in-flight
  // refresh for user A can never write B's store state.
  useEffect(() => {
    if (!userId) return; // signed out: no subscription (and `userId` narrows to string below)

    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (status !== 'active') return;
        if (
          activeUserIdRef.current === null ||
          isProOverrideEnabled() ||
          isProExpiredOverrideEnabled()
        ) {
          return;
        }

        void (async () => {
          // DB verdict FIRST — the only awaited gate. The reconciler
          // invalidates the profile query on success, so no second
          // invalidation is needed here. A slow RC cache read must not delay
          // an expiry from dropping the Pro UI.
          await reconcileEntitlementFromDB(
            userId,
            () => activeUserIdRef.current === userId,
          );
          if (activeUserIdRef.current !== userId) return;
          useProStore.setState({ isLoading: false });

          // Cached SDK read for the TRIAL PILL ONLY, bounded and after the
          // verdict: it must never write `isPro` — a failed DB read would
          // leave a stale RC true in the store.
          if (identityBridgedRef.current) {
            await withTimeout(
              invalidateCustomerInfoCache(),
              REVENUECAT_CALL_TIMEOUT_MS,
              undefined,
            );
            if (activeUserIdRef.current !== userId) return;

            const info = await withTimeout(
              getCustomerInfo(),
              REVENUECAT_CALL_TIMEOUT_MS,
              null,
            );
            if (activeUserIdRef.current !== userId) return;
            if (isProOverrideEnabled() || isProExpiredOverrideEnabled()) return;
            useProStore.setState({ trialEndsAt: info?.trialEndsAt ?? null });
          }
        })();
      },
    );
    return () => subscription.remove();
  }, [userId]);

  // Tier-transition sync (REQ-PRO-UX): when the store reports a tier
  // flip (typically from the customerInfoUpdate listener after a
  // purchase, or from a webhook-driven DB change surfaced via the next
  // bootstrap), the profile header MUST reflect the new entitlement
  // without requiring an app restart.
  //
  // The store (useProStore.isPro) updates synchronously via the SDK
  // listener, but useProfile reads `user.tier` from a TanStack Query
  // cache that lives outside the store. Two-step sync:
  //
  //   1. Optimistic: setQueryData flips `tier` in the cached profile
  //      IMMEDIATELY so the header changes with the store (no 5s wait).
  //   2. Reconcile: invalidateQueries at +5s re-reads the DB. The
  //      RevenueCat webhook is async — it lands 1-3s after the SDK
  //      listener — so this catches the case where step 1 wrote a tier
  //      the DB hadn't yet caught up with (e.g. an `active` write that
  //      was rejected server-side, or a free-trial conversion the SDK
  //      saw but the webhook hadn't painted).
  //
  // The `activeUserIdRef` check inside the timer is a belt-and-suspenders
  // guard for a sign-out within the 5s window (the effect cleanup also
  // clears the timer, but the ref check makes the intent explicit).
  useEffect(() => {
    if (!userId) return;
    queryClient.setQueryData<User | null>(queryKeys.profile(userId), (old) =>
      old ? { ...old, tier: isPro ? 'pro' : 'free' } : old,
    );
    const timer = setTimeout(() => {
      if (activeUserIdRef.current === userId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.profile(userId),
        });
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isPro, userId]);

  return null;
}