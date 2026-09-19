/**
 * Auth session store (ADR-5).
 *
 * Owns the live `Session` and the bootstrapping flag. Session presence is the
 * single source of truth for the root gate: sign-in is mandatory from launch
 * (scope amendment 2026-08-03), so there is no mode to reconcile. `restore()`
 * reads the persisted session through the chunked SecureStore adapter: a
 * valid session is applied and its profile row ensured; an invalid or expired
 * one is discarded so the gate shows the sign-in screen.
 *
 * Web has no native SecureStore backend, so restore() gates on
 * `isSecureStoreAvailable()` and settles in the safe no-session state there —
 * there is deliberately no insecure fallback storage. The whole restore is
 * bounded by `AUTH_RESTORE_TIMEOUT_MS` so a hung storage backend can never
 * leave the splash up forever.
 */
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { flushPendingAcceptance } from '@/features/legal/pending-acceptance';
import { registerAuthStateListener } from '@/lib/auth/auth-listener-registry';
import { ensureProfile } from '@/lib/auth/profile-sync';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { logOutRevenueCat } from '@/lib/revenuecat';
import { supabase } from '@/lib/supabase';
import {
  type DeleteAccountResult,
  deleteAccount as deleteAccountFn,
} from '@/lib/supabase/feature-access';
import { isSecureStoreAvailable } from '@/lib/supabase/storage-adapter';
import { withTimeout } from '@/lib/with-timeout';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useProStore } from '@/stores/use-pro-store';
import { useReceiptsStore } from '@/stores/use-receipts-store';

/** A store action result: a user-displayable message, or null on success. */
export type AuthActionError = string | null;

export interface SignUpResult {
  error: AuthActionError;
  /**
   * True when the account was created but no session was issued — email
   * confirmation is enabled on the project. The screen shows a
   * confirmation state instead of navigating (design open question).
   */
  needsEmailConfirmation: boolean;
}

interface SessionState {
  /** The live Supabase session, or null when signed out. */
  session: Session | null;
  /** True while `restore()` runs at launch; the root gate holds the splash. */
  isBootstrapping: boolean;
  restore: () => Promise<void>;
  signInWithEmail: (
    email: string,
    password: string,
  ) => Promise<AuthActionError>;
  signUpWithEmail: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  /**
   * Hard-delete the signed-in user's account (REQ-ACCTDEL). Runs the manual
   * cleanup chain on success because the SIGNED_OUT listener does NOT fire
   * after a hard delete (auth.users is gone, no JWT to invalidate,
   * supabase.auth.signOut() is never called). Returns the wrapper's
   * discriminated `DeleteAccountResult` for the screen to map to UX.
   */
  deleteAccount: () => Promise<DeleteAccountResult>;
  /**
   * Cross-route preservation for the typed-confirmation input
   * (REQ-HOUSE-DEL-2): when the user is redirected to /settings/household
   * (because they're a household owner with active members), the typed
   * value must survive the trip back. The screen writes on every keystroke
   * and clears it on mount/unmount (success or give-up).
   */
  deleteAccountDraft: { typedValue: string } | null;
  setDeleteAccountDraft: (draft: { typedValue: string } | null) => void;
}

/**
 * Bounded wait for the launch restore (reliability re-gate): if storage or
 * the session read never resolves, restore settles to a safe no-session state
 * instead of leaving the splash up forever. Exported as a mutable test seam so
 * the node harness can exercise the timeout branch without waiting.
 */
export let AUTH_RESTORE_TIMEOUT_MS = 10_000;

/**
 * Test seam: shrink `AUTH_RESTORE_TIMEOUT_MS` for the node harness. A setter
 * is required because compiled CommonJS exports are copies — mutating
 * `exports.AUTH_RESTORE_TIMEOUT_MS` from the harness would not change the
 * module's internal binding. No-op in production.
 */
export function __setAuthRestoreTimeout(ms: number): void {
  AUTH_RESTORE_TIMEOUT_MS = ms;
}

/** Generic sign-up failure copy — never a raw GoTrue message (no enumeration). */
const SIGN_UP_GENERIC_ERROR = 'No se pudo crear la cuenta. Inténtalo de nuevo.';

/**
 * Generic sign-in failure copy — never a raw GoTrue message (no
 * enumeration). GoTrue distinguishes `email_not_confirmed` from
 * `invalid_credentials`; surfacing that would reveal whether an address
 * exists and whether it is confirmed. Every sign-in failure — wrong
 * password, nonexistent account, unconfirmed email, network — maps to this
 * single message, the same posture as sign-up and password reset.
 */
const SIGN_IN_GENERIC_ERROR = 'Correo o contraseña inválidos.';

/** GoTrue duplicate-account markers: message text and API error codes. */
const DUPLICATE_ACCOUNT_MARKERS = [
  'already registered',
  'already been registered',
  'user_already_exists',
  'email_exists',
];

function isDuplicateAccountError(
  error: {
    message?: string;
    code?: string;
  } | null,
): boolean {
  if (!error) return false;
  const haystack = `${error.message ?? ''} ${error.code ?? ''}`.toLowerCase();
  return DUPLICATE_ACCOUNT_MARKERS.some((marker) => haystack.includes(marker));
}

export const useSessionStore = create<SessionState>((set) => ({
  // Real auth: start signed out until restore() finds a stored session.
  session: null,
  isBootstrapping: true,
  // Cross-route typed-confirmation draft (REQ-HOUSE-DEL-2). Always starts
  // null; the delete-account screen seeds it from local state when it
  // mounts and writes through on every keystroke. Cleared on success or
  // unmount by the screen.
  deleteAccountDraft: null,

  restore: async () => {
    set({ isBootstrapping: true });
    const deadline = Date.now() + AUTH_RESTORE_TIMEOUT_MS;
    const remaining = (): number => Math.max(0, deadline - Date.now());

    // The session read, bounded so a hung storage backend can never leave the
    // splash up forever. The read's continuation is GUARDED: once the store
    // has reconciled — bootstrap finished on the bound, or a newer session
    // appeared while the read was in flight (e.g. an OAuth cold-start exchange
    // completing through the callback route) — late results must never destroy
    // or clobber the reconciled state. Without this guard, a read that
    // outlived the bound could `signOut()` over a fresh session or overwrite
    // it with a stale one.
    const sessionAtPhase2Start = useSessionStore.getState().session;
    await withTimeout(
      (async () => {
        try {
          if (!(await isSecureStoreAvailable())) {
            // Web / unsupported platform: no persistence exists, so there is
            // nothing to restore. Stay signed out; the gate shows sign-in.
            return;
          }
          const { data, error } = await supabase.auth.getSession();
          // Late continuation guard (reliability re-gate): `withTimeout`
          // cannot cancel the read, so after the bound fires the store keeps
          // running this body. A late result is a no-op when bootstrap
          // already completed (the gate settled on the bound outcome) or a
          // newer session replaced the one present when the read began.
          const stale = (): boolean =>
            !useSessionStore.getState().isBootstrapping ||
            useSessionStore.getState().session !== sessionAtPhase2Start;
          const session = data.session;
          if (error) {
            if (stale()) return;
            // The stored token could not be refreshed and its access token
            // has expired: discard it and land on the sign-in screen (spec:
            // expired stored session → session cleared → sign-in shown).
            await supabase.auth.signOut().catch(() => {
              // Best effort — the client may already have cleared storage.
            });
            return;
          }
          if (session) {
            if (stale()) return;
            set({ session });
            if (session.user) {
              // Backfill the profile row, then invalidate the profile query
              // so a read that already resolved shows the backfilled identity
              // instead of "You" until the query goes stale (60s) or relaunch.
              // ensureProfile never rejects, so the .then chain cannot produce
              // an unhandled rejection; fire-and-forget stays non-blocking.
              void ensureProfile(session.user).then(() =>
                queryClient.invalidateQueries({
                  queryKey: queryKeys.profile(session.user.id),
                }),
              );
            }
          }
          // No stored session: stay signed out; the gate shows the sign-in
          // screen.
        } catch {
          // Corrupt storage or a storage-backend failure: resolve to a safe
          // no-session state rather than crashing at launch.
        }
      })(),
      remaining(),
      undefined,
    );
    set({ isBootstrapping: false });
  },

  signInWithEmail: async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        // Anti-enumeration (user-auth spec): every sign-in failure — wrong
        // password, nonexistent account, unconfirmed email — is
        // indistinguishable, so a raw GoTrue message (which separates
        // `email_not_confirmed` from `invalid_credentials`) never reaches the
        // UI. Same posture as sign-up and password reset.
        return SIGN_IN_GENERIC_ERROR;
      }
      // SIGNED_IN fires through onAuthStateChange: session set, profile
      // synced. Nothing else to do here.
      return null;
    } catch {
      // Network/storage failure: also generic — the UI must not render raw
      // error text that could distinguish account state.
      return SIGN_IN_GENERIC_ERROR;
    }
  },

  signUpWithEmail: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) {
      // Anti-enumeration (reliability re-gate): whether the address already
      // has an account must be indistinguishable from a fresh sign-up. A
      // duplicate-account error maps to the same confirmation state as a new
      // account waiting for confirmation; any other failure (weak password,
      // network) surfaces generic copy — never the raw GoTrue message.
      if (isDuplicateAccountError(error)) {
        return { error: null, needsEmailConfirmation: true };
      }
      return { error: SIGN_UP_GENERIC_ERROR, needsEmailConfirmation: false };
    }
    if (!data.session) {
      // Account created but email confirmation is enabled: no session yet.
      return { error: null, needsEmailConfirmation: true };
    }
    // Auto-signed-in; the SIGNED_IN event completes the state transition.
    return { error: null, needsEmailConfirmation: false };
  },

  signOut: async () => {
    // Bridge identity (webhook identity bridge): clear the RevenueCat
    // app-user mapping BEFORE the Supabase sign-out so the next user never
    // inherits this user's RevenueCat identity. Best-effort by contract —
    // logOutRevenueCat never throws, so a failed logOut cannot block the
    // sign-out itself.
    await logOutRevenueCat();
    const { error } = await supabase.auth.signOut();
    if (error) {
      // auth-js clears the local session and fires SIGNED_OUT BEFORE
      // returning a server-revoke error (verified against GoTrueClient
      // `_signOut`: `removeCurrentSession()` runs, then the revoke error is
      // returned). An offline/5xx revoke is therefore NOT a sign-out failure
      // — the user IS signed out on this device and the gate routes to
      // sign-in. Only a failure that left the local session intact is a
      // genuine error worth surfacing (the UI would otherwise show a dead
      // "could not sign out" on a screen that is about to unmount).
      if (!useSessionStore.getState().session) return;
      throw new Error(error.message);
    }
    // SIGNED_OUT fires through onAuthStateChange and clears the session; the
    // gate then shows the sign-in screen.
  },

  deleteAccount: async () => {
    // (a) Best-effort local SDK clear; the real `logOutRevenueCat` never
    //     throws by contract (it catches native errors internally and
    //     returns `{ ok: false }` on failure), but we wrap defensively
    //     here so a future native SDK that DOES throw can never block
    //     the destructive RPC path — the server-side REST revoke in
    //     step (b) is authoritative for the bridge wipe. Mirrors
    //     signOut() — keep the bridge semantics identical so the same
    //     regression-test covers both paths.
    try {
      await logOutRevenueCat();
    } catch (err) {
      console.warn('[deleteAccount] logOutRevenueCat threw (continuing):', err);
    }

    // (b) Server: storage sweep + parse_attempts scrub + RC revoke +
    //     auth.users delete inside the RPC transaction (PR2). Throws
    //     NOTHING useful — returns a discriminated DeleteAccountResult the
    //     caller maps to UX. Cleanup below is GATED on success so a
    //     failed RPC leaves the user's session and caches intact for a
    //     retry.
    const result = await deleteAccountFn();
    if (result.status === 'error') return result;

    // (c) Manual cleanup — the SIGNED_OUT listener does NOT fire after
    //     hard delete (auth.users is gone, no JWT to invalidate; we
    //     never call supabase.auth.signOut()). Replicate the listener
    //     body verbatim so the next user on this device sees the same
    //     clean slate they would after a sign-out.
    queryClient.clear();
    useReceiptsStore.getState().resetAll();
    useProStore.getState().reset();
    useHouseholdStore.getState().reset();
    useSessionStore.setState({ session: null });

    // Drop the typed-confirmation draft — the next user on this device
    // must never see the previous user's typed value when the screen is
    // re-opened.
    useSessionStore.setState({ deleteAccountDraft: null });

    return result; // { status: 'ok', alreadyDeleted?: boolean }
  },

  setDeleteAccountDraft: (draft) => set({ deleteAccountDraft: draft }),
}));

/**
 * Keeps the store in sync with supabase-js auth events and clears it on
 * SIGNED_OUT. The session object is applied for EVERY session-bearing event
 * (the token/user data it carries is always newer).
 *
 * `ensureProfile` (ADR-6) runs only on SIGNED_IN, so a profile backfill that
 * fails (missing table pre-migration, RLS denial, network) is NOT retried on
 * the next passive event. This is deliberate: gating identity sync on an
 * actual identity change avoids pointless network work on silent refreshes,
 * and the failure is non-fatal by design — reads surface a recoverable
 * missing-profile state until the row exists (the next explicit sign-in
 * re-runs the upsert). After the upsert settles, the `profile` query key is
 * invalidated so screens showing the pre-backfill row re-render immediately;
 * on a swallowed upsert error the invalidation is a harmless refetch of the
 * unchanged row.
 *
 * The subscription goes through the shared listener registry instead of a
 * module-scope flag: a flag resets when Metro re-executes this module on Fast
 * Refresh while the old subscription persists on the client, stacking
 * duplicate listeners. The registry keeps the previous handle, so re-init
 * unsubscribes it first — exactly one listener even across refreshes.
 */
function initAuthStateListener(): void {
  registerAuthStateListener(
    // `onAuthStateChange` is a class method that reads `this`, so it must be
    // bound before it can be handed to the registry as a plain function.
    supabase.auth.onAuthStateChange.bind(supabase.auth),
    (event, session) => {
      if (event === 'SIGNED_OUT') {
        // Wipe the in-memory server-state cache (server-state-caching spec):
        // no previous user's rows may survive to the next session. Co-located
        // with the session clear so it fires even for bootstrap discards of an
        // expired token — a layout effect would miss events fired before it
        // subscribed (D6).
        queryClient.clear();
        useReceiptsStore.getState().resetAll();
        // Reset the Pro entitlement store too: the previous user's
        // isPro/subscription state must never leak into the next session
        // (first-frame flash of Pro UI for the wrong user). reset() restores
        // the locked defaults (`isLoading: true`), so the gate cannot open
        // until the next user's session resolves.
        useProStore.getState().reset();
        useSessionStore.setState({ session: null });
        return;
      }
      if (session) {
        // Always apply the refreshed session object: TOKEN_REFRESHED and
        // USER_UPDATED carry newer token/user data the store must reflect.
        useSessionStore.setState({ session });
        if (event === 'SIGNED_IN') {
          // Identity changed: backfill the profile row, then invalidate the
          // profile query so the UI re-renders with the fresh identity (the
          // bootstrap restore handles the relaunch case separately).
          if (session.user) {
            // ensureProfile never rejects, so the .then chain cannot produce
            // an unhandled rejection; fire-and-forget stays non-blocking.
            void ensureProfile(session.user).then(() =>
              queryClient.invalidateQueries({
                queryKey: queryKeys.profile(session.user.id),
              }),
            );
            // Legal-consent queue-then-flush (legal-compliance U5, AD-2):
            // replay any pending acceptances the sign-up screen queued BEFORE
            // the network sign-up call — the email on the flag may differ from
            // this session's email, and the flush guards that. Fire-and-forget
            // by contract (flushPendingAcceptance never rejects) beside the
            // profile backfill; a failure only loses the queued markers, and
            // the consent gate falls back to prompting again. An undefined
            // session email (rare) cannot match any flag, so skip the flush.
            if (session.user.email) {
              void flushPendingAcceptance(session.user.email);
            }
          }
        }
      }
    },
  );
}

initAuthStateListener();
