/**
 * Auth session store (ADR-4).
 *
 * Owns the live `Session` and the bootstrapping flag; the data-source mode
 * itself lives in `useSettingsStore.mode` (single source of truth). The mode
 * is promoted to `'authenticated'` ONLY when identity changes — the
 * SIGNED_IN event (password sign-in, sign-up auto-sign-in, OAuth exchange)
 * and the launch restore when the persisted mode is not an explicit demo
 * choice. Passive events (TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY)
 * refresh the session object but never override an explicit demo-mode
 * choice: mode is a user control, and auth events that do not change
 * identity must not flip it back. Sign-out only clears the session and
 * leaves the mode `'authenticated'`, so the root gate routes the user to the
 * sign-in screen instead of falling back to demo fixtures.
 *
 * The mode is persisted through the chunked SecureStore adapter (same backend
 * as the session) whenever the user explicitly switches it on the profile
 * screen, and by the session store whenever it promotes. After a relaunch
 * the gate is reconciled BEFORE the session read: a user who previously
 * authenticated lands on sign-in when no session is restored, a fresh
 * install keeps the demo default, and an EXPLICIT demo choice survives
 * relaunch even when a stored session exists — restore() never re-promotes a
 * mode the user deliberately set to demo. Persistence:
 * `useSettingsStore.mode` is the source of truth; both values are written,
 * `'demo'` is the implicit default when nothing is persisted.
 *
 * Web has no native SecureStore backend, so restore() gates on
 * `isSecureStoreAvailable()` and the app degrades to demo mode there — there
 * is deliberately no insecure fallback storage. The whole restore is bounded
 * by `AUTH_RESTORE_TIMEOUT_MS` so a hung storage backend can never leave the
 * splash up forever.
 */
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

import { registerAuthStateListener } from '@/lib/auth/auth-listener-registry';
import {
  loadPersistedAuthMode,
  savePersistedAuthMode,
} from '@/lib/auth/auth-mode-storage';
import { ensureProfile } from '@/lib/auth/profile-sync';
import { supabase } from '@/lib/supabase';
import { isSecureStoreAvailable } from '@/lib/supabase/storage-adapter';
import { useSettingsStore, type AuthMode } from '@/stores/use-settings-store';

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
  signInWithEmail: (email: string, password: string) => Promise<AuthActionError>;
  signUpWithEmail: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
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

/**
 * Last restore() phase-1 outcome (mode read). Test seam: the harness asserts
 * a hung mode read settles to 'timed-out' and forces the sign-in gate rather
 * than leaving the mode untouched. Live through compiled CJS imports.
 */
let lastModeReadOutcome: 'resolved' | 'timed-out' | 'not-run' = 'not-run';

export function __lastModeReadOutcome(): 'resolved' | 'timed-out' | 'not-run' {
  return lastModeReadOutcome;
}

/**
 * Races `promise` against a timer and ALWAYS cancels the timer once either
 * side wins. Cancelling matters beyond hygiene: a restore that settles early
 * must not leave a pending timeout keeping the process alive (the node test
 * harness previously lingered ~10 s per restore test on leaked timers).
 * `fallback` is the race result when the bound fires first.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      handle = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

/** Signals that the mode read hit the restore bound (see restore()). */
const MODE_READ_TIMED_OUT = Symbol('mode-read-timed-out');

/** Generic sign-up failure copy — never a raw GoTrue message (no enumeration). */
const SIGN_UP_GENERIC_ERROR = 'Sign-up failed. Please try again.';

/**
 * Generic sign-in failure copy — never a raw GoTrue message (no
 * enumeration). GoTrue distinguishes `email_not_confirmed` from
 * `invalid_credentials`; surfacing that would reveal whether an address
 * exists and whether it is confirmed. Every sign-in failure — wrong
 * password, nonexistent account, unconfirmed email, network — maps to this
 * single message, the same posture as sign-up and password reset.
 */
const SIGN_IN_GENERIC_ERROR = 'Invalid email or password.';

/** GoTrue duplicate-account markers: message text and API error codes. */
const DUPLICATE_ACCOUNT_MARKERS = [
  'already registered',
  'already been registered',
  'user_already_exists',
  'email_exists',
];

function isDuplicateAccountError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  const haystack = `${error.message ?? ''} ${error.code ?? ''}`.toLowerCase();
  return DUPLICATE_ACCOUNT_MARKERS.some((marker) => haystack.includes(marker));
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  isBootstrapping: true,

  restore: async () => {
    set({ isBootstrapping: true });
    const deadline = Date.now() + AUTH_RESTORE_TIMEOUT_MS;
    const remaining = (): number => Math.max(0, deadline - Date.now());

    // Phase 1 — reconcile the persisted mode FIRST (ADR-4/ADR-5), bounded by
    // the same overall deadline as the session read. Its result is the ONLY
    // input to the fallback-mode decision: if the read times out, storage
    // could not serve even the mode key, so it cannot restore a session
    // either — settle on the sign-in gate, NEVER demo, so a previously
    // authenticated user can never be dropped into demo fixtures.
    const modeReadResult = await withTimeout<
      AuthMode | null | typeof MODE_READ_TIMED_OUT
    >(loadPersistedAuthMode(), remaining(), MODE_READ_TIMED_OUT);
    lastModeReadOutcome =
      modeReadResult === MODE_READ_TIMED_OUT ? 'timed-out' : 'resolved';

    if (modeReadResult === MODE_READ_TIMED_OUT) {
      // Hung mode read: keep the sign-in gate. A fresh install with hung
      // storage sees the sign-in screen once (recoverable) — strictly safer
      // than the reverse, which silently drops an authenticated user into
      // fixtures. Persist nothing: the backend is unresponsive.
      useSettingsStore.setState({ mode: 'authenticated' });
      set({ isBootstrapping: false });
      return;
    }
    if (modeReadResult) {
      // Nothing persisted → the default 'demo' stays.
      useSettingsStore.setState({ mode: modeReadResult });
    }

    // Phase 2 — the session read, bounded by whatever time phase 1 left. A
    // timeout here keeps the already-reconciled mode (sign-in gate for a
    // previously authenticated user, demo for a fresh install). The read's
    // continuation is GUARDED: once the store has reconciled — bootstrap
    // finished on the bound, or a newer session appeared while the read was
    // in flight (e.g. an OAuth cold-start exchange completing through the
    // callback route) — late results must never destroy or clobber the
    // reconciled state. Without this guard, a read that outlived the bound
    // could `signOut()` over a fresh session or overwrite it with a stale one.
    const sessionAtPhase2Start = useSessionStore.getState().session;
    await withTimeout(
      (async () => {
        try {
          if (!(await isSecureStoreAvailable())) {
            // Web / unsupported platform: no persistence exists, so there is
            // nothing to restore. Stay in the reconciled mode (demo default,
            // or the persisted mode when storage just became unavailable).
            return;
          }
          const { data, error } = await supabase.auth.getSession();
          // Late continuation guard (reliability re-gate): `withTimeout`
          // cannot cancel the read, so after the bound fires the store keeps
          // running this body. A late result is a no-op when bootstrap
          // already completed (the gate settled on the bound outcome) or a
          // newer session replaced the one present when phase 2 began.
          const stale = (): boolean =>
            !useSessionStore.getState().isBootstrapping ||
            useSessionStore.getState().session !== sessionAtPhase2Start;
          const session = data.session;
          if (error) {
            if (stale()) return;
            // The stored token could not be refreshed and its access token
            // has expired: discard it and land on the sign-in screen (spec:
            // expired stored session → session cleared → sign-in shown) —
            // unless the user explicitly chose demo mode, which survives
            // relaunch like any other explicit choice: the dead session is
            // cleared, but the mode is NOT force-promoted.
            await supabase.auth.signOut().catch(() => {
              // Best effort — the client may already have cleared storage.
            });
            if (modeReadResult !== 'demo') {
              useSettingsStore.getState().setMode('authenticated');
              await savePersistedAuthMode('authenticated');
            }
            return;
          }
          if (session) {
            if (stale()) return;
            set({ session });
            // Restore-mode reconciliation: a persisted 'demo' is an EXPLICIT
            // user choice and survives relaunch even with a stored session —
            // mode is a user control, and a session placed by a passive event
            // (e.g. PASSWORD_RECOVERY while in demo) must not silently
            // promote it at launch. Persisted 'authenticated' (or nothing — a
            // fresh install with a stored session, e.g. an OAuth cold-start
            // exchange) promotes exactly as before: mode, persistence, and
            // the profile upsert stay bundled, so demo mode also keeps its
            // zero-network fixtures posture.
            if (modeReadResult !== 'demo') {
              useSettingsStore.getState().setMode('authenticated');
              await savePersistedAuthMode('authenticated');
              if (session.user) void ensureProfile(session.user.id);
            }
          }
          // No stored session at all: the mode keeps whatever was reconciled
          // above — persisted 'authenticated' closes the gate so the user
          // lands on sign-in (fresh install / nothing persisted → demo).
        } catch {
          // Corrupt storage or a storage-backend failure: keep the
          // persisted/default mode — never force demo, which would silently
          // drop a previously authenticated user into fixtures — and resolve
          // to a safe no-session state rather than crashing at launch.
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
      // SIGNED_IN fires through onAuthStateChange: session set, mode promoted,
      // profile synced. Nothing else to do here.
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
    // SIGNED_OUT fires through onAuthStateChange and clears the session. The
    // mode stays 'authenticated' (persisted) so the gate shows the sign-in
    // screen, including after a relaunch.
  },
}));

/**
 * Keeps the store in sync with supabase-js auth events and clears it on
 * SIGNED_OUT. The session object is applied for EVERY session-bearing event
 * (the token/user data it carries is always newer), but the mode is promoted
 * only on SIGNED_IN — passive events (TOKEN_REFRESHED, USER_UPDATED,
 * PASSWORD_RECOVERY) must not override an explicit demo-mode choice.
 *
 * `ensureProfile` (ADR-6) runs only on SIGNED_IN, so a profile insert that
 * fails (missing table pre-migration, RLS denial, network) is NOT retried on
 * the next passive event. This is deliberate: gating identity sync on an
 * actual identity change avoids pointless network work on silent refreshes,
 * and the failure is non-fatal by design — reads surface a recoverable
 * missing-profile state until the row exists (the next explicit sign-in
 * re-runs the upsert).
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
        useSessionStore.setState({ session: null });
        return;
      }
      if (session) {
        // Always apply the refreshed session object: TOKEN_REFRESHED and
        // USER_UPDATED carry newer token/user data the store must reflect
        // even when the mode is not promoted.
        useSessionStore.setState({ session });
        if (event === 'SIGNED_IN') {
          // Identity changed: promote the mode (bootstrap restore handles
          // the relaunch case separately) and ensure the profile row exists.
          useSettingsStore.getState().setMode('authenticated');
          void savePersistedAuthMode('authenticated');
          if (session.user) void ensureProfile(session.user.id);
        }
      }
    },
  );
}

initAuthStateListener();
