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
 *      on EVERY userId change): `logInRevenueCat(userId)` before reading
 *      `CustomerInfo` so the snapshot is scoped to the Supabase user, then
 *      DB-first resolution into `useProStore`. This is the webhook
 *      identity bridge — without it every purchase lands on
 *      `$RCAnonymousID` and the server-side tier sync never runs.
 *   3. FOREGROUND entitlement refresh (keyed on `[userId]`, added by the
 *      pro-subscription lifecycle fix): the Play Billing Client does not
 *      reliably push an expired entitlement to `customerInfoUpdate` while
 *      the app is open, so on every transition to AppState `'active'` the
 *      entitlement is re-read (`getCustomerInfo`, bounded) and the store
 *      re-resolved — an expiry mid-session now drops the Pro UI without a
 *      sign-out → sign-in cycle.
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
 *     DB-first resolution. A failed bridge must NOT block Pro gating.
 *   - `getCustomerInfo` rejects or overruns its bound → resolved as null
 *     → free default, `isLoading: false`.
 *
 * Per-user race guard: `activeUserIdRef` holds the userId the effects are
 * CURRENTLY resolving for. Every await in the per-user path re-checks it
 * and bails when the user flipped mid-flight (A → B), so an in-flight A
 * resolution can never overwrite B's store state. The `customerInfoUpdate`
 * listener (attached once) uses the same ref — a callback from a previous
 * user's session or from the anonymous identity is dropped.
 *
 * Subscription state (post-cutover 0039, revenuecat-trial-migration slice B):
 *   The DB profile carries `subscription_status` ('none' | 'active')
 *   and `ever_paid` — no `trial_ends_at`, no `'trial'` / `'expired'`.
 *   On every per-user resolution, the profile is read from DB to seed
 *   `everPaid` (the only DB-backed store field beyond `isPro` /
 *   `isLoading`). The pre-cutover `expire_overdue_trials` self-heal
 *   is gone (RPC dropped by 0039 §5).
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSessionUser } from '@/features/auth';
import {
  attachCustomerInfoListener,
  configure as configureRevenueCat,
  getCustomerInfo,
  isNativeAvailable,
  logInRevenueCat,
  logOutRevenueCat,
  REVENUECAT_CALL_TIMEOUT_MS,
} from '@/lib/revenuecat';
import {
  readProfileRow,
} from '@/lib/supabase/feature-access';
import { withTimeout } from '@/lib/with-timeout';
import { useProStore } from '@/stores/use-pro-store';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import type { User } from '@/types';

import { isProExpiredOverrideEnabled, isProOverrideEnabled } from './gate';

const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

/**
 * Tracks whether `configure` has already run this process. Guards ONLY the
 * one-time SDK setup — identity bridging and per-user store resolution are
 * deliberately NOT behind this flag so they re-run for every session flip.
 */
let bootstrapped = false;

/**
 * Read the user's subscription state from the DB profile and push the
 * relevant flags into the store. Called on every per-user resolution
 * path that has a userId. Never throws — a failed read leaves the store
 * defaults (locked).
 * `isCurrent` is the per-user race guard: bails when the user flipped
 * while the profile read was in flight.
 *
 * Post-cutover (0039, revenuecat-trial-migration slice B):
 *   - The trial lifecycle surface is GONE. The DB profile carries
 *     `subscription_status` ('none' | 'active') + `ever_paid` — no
 *     `trial_ends_at` (column dropped by 0039 §7) and no `'trial'` /
 *     `'expired'` values (CHECK narrowed by 0039 §6).
 *   - The bootstrap's job reduces to seeding `everPaid` (the only field
 *     the store still owns besides `isPro` + `isLoading`). The
 *     `isPro` flip is driven by the webhook; this read is purely a
 *     safety net so a returning paid user isn't briefly locked while
 *     waiting for the webhook delivery.
 *   - The pre-cutover `expire_overdue_trials` self-heal call is gone
 *     (RPC dropped by 0039 §5).
 */
async function syncSubscriptionFromDB(
  userId: string,
  isCurrent: () => boolean,
): Promise<void> {
  const result = await readProfileRow(userId);
  if (!isCurrent()) return;
  if (result.status === 'ok' && result.data) {
    const { ever_paid } = result.data;
    // Mirror the DB flag so the paywall + CustomerInfo listener never
    // offer a free trial to an ever-paid user. `setEverPaid` is monotonic:
    // a previously-set true (e.g. by the SDK listener) is never reset.
    if (ever_paid) {
      useProStore.getState().setEverPaid(true);
    }
  }
}

/**
 * Per-user resolution: bridge the RevenueCat identity, read the scoped
 * CustomerInfo snapshot, then resolve the store DB-first. Runs for EVERY
 * userId change (not just the first), so a sign-out → sign-in cycle in the
 * same process re-bridges the new user's identity.
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

  // Bridge identity FIRST so the CustomerInfo snapshot below is scoped to
  // this Supabase user. A failed bridge must NOT block Pro gating — warn,
  // then resolve DB-first (the RC snapshot is not trustworthy for this
  // user when the bridge failed; it could still belong to the anonymous or
  // a previous identity).
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

  // CustomerInfo snapshot, bounded so a hung native call cannot keep the
  // gate locked (isLoading stays true → free users blocked from scanning).
  // A failure/timeout resolves as null → safe free default.
  const info = await withTimeout(
    getCustomerInfo(),
    REVENUECAT_CALL_TIMEOUT_MS,
    null,
  );
  if (!isCurrent()) return;

  // Sync subscription state from DB FIRST — the DB is authoritative for
  // trial/active status. RevenueCat entitlements are only relevant for paid
  // subscriptions, not for our custom trial flow.
  await syncSubscriptionFromDB(userId, isCurrent);
  if (!isCurrent()) return;

  // Only set isPro from RevenueCat when (a) the identity bridge actually
  // succeeded (the snapshot is scoped to THIS user) and (b) the DB didn't
  // already set it (DB trial/active status overrides RC entitlements).
  const store = useProStore.getState();
  if (identityOk && !store.isPro) {
    useProStore.setState({
      isPro: info?.isPro ?? false,
    });
  }
  useProStore.setState({ isLoading: false });
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
      if (activeUserIdRef.current === null || !identityBridgedRef.current) {
        return;
      }
      setProEntitlement(snapshot);
      // A real purchase activating the `pro` entitlement is a MONOTONIC
      // event (migration 0021): the webhook sets ever_paid=true in the DB,
      // but `syncSubscriptionFromDB` only runs per session — NOT on this
      // listener. Mirror the DB flag immediately so the store never offers
      // a free trial the server would reject for an ever-paid user. This
      // is the only caller of `setEverPaid`.
      if (snapshot.isPro) setEverPaid(true);
    });
  }, [userId, setProEntitlement, setEverPaid]);

  // Effect 2 — PER-USER identity bridge + resolution. Keyed on `[userId]`
  // so it runs on EVERY userId change, including the null (sign-out) case.
  // This is what keeps the RevenueCat identity in sync across
  // sign-out → sign-in cycles in the same process.
  useEffect(() => {
    // Keep the ref in sync FIRST so in-flight resolutions and listener
    // callbacks compare against the latest identity.
    activeUserIdRef.current = userId;

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
        // Still sync subscription state from DB for frozen-state resolution
        // (mirror of the true-override branch below).
        void syncSubscriptionFromDB(
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
        // Still sync subscription state from DB for frozen-state resolution.
        void syncSubscriptionFromDB(
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
  // Guards (all must pass before the SDK read):
  //   - `activeUserIdRef.current !== null` — a signed-out app never resolves
  //   - `identityBridgedRef.current === true` — only a bridged user's
  //     snapshot is trustworthy; this ALSO implies the SDK is available AND
  //     configured (the bridge only succeeds after `logInRevenueCat`, which
  //     requires the native module + API key + `configure` — revenuecat.ts)
  //   - `!isProOverrideEnabled()` — never touch the store under the dev
  //     override (same rule as the listener)
  //   - `!isProExpiredOverrideEnabled()` — a real re-read would fight the
  //     simulated downgrade (fix 2), so the expired override also blocks it
  //
  // After the await the per-user race guard re-checks `userId`, so an
  // in-flight foreground refresh for user A can never write B's store state
  // (same pattern as `resolveProSession`). The store write goes through the
  // slice-C `setProEntitlement` setter — `isPro` + `trialEndsAt` land in one
  // atomic `set`, keeping the gate + the profile trial pill consistent.
  useEffect(() => {
    if (!userId) return; // signed out: no subscription (and `userId` narrows to string below)

    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (status !== 'active') return;
        if (
          activeUserIdRef.current === null ||
          !identityBridgedRef.current ||
          isProOverrideEnabled() ||
          isProExpiredOverrideEnabled()
        ) {
          return;
        }

        void (async () => {
          const info = await withTimeout(
            getCustomerInfo(),
            REVENUECAT_CALL_TIMEOUT_MS,
            null,
          );
          if (activeUserIdRef.current !== userId) return; // user flipped mid-flight
          if (isProOverrideEnabled()) return; // never touch the store under the dev override

          setProEntitlement({
            isPro: info?.isPro ?? false,
            trialEndsAt: info?.trialEndsAt ?? null,
          });
          useProStore.setState({ isLoading: false });

          // The tier-transition effect below flips the cached `tier`
          // optimistically when `isPro` changes and reconciles at +5s (the
          // RevenueCat webhook is async). Invalidating the profile query now
          // re-reads the webhook-painted DB row so the header settles on the
          // new tier immediately.
          if (activeUserIdRef.current === userId) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.profile(userId),
            });
          }
        })();
      },
    );
    return () => subscription.remove();
  }, [userId, setProEntitlement]);

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