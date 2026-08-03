/**
 * Auth session store (ADR-4).
 *
 * Owns the live `Session` and the bootstrapping flag; the data-source mode
 * itself lives in `useSettingsStore.mode` (single source of truth). Every
 * event that produces a session — restore, sign-in, OAuth exchange, password
 * recovery — promotes the mode to `'authenticated'` and runs `ensureProfile`.
 * Sign-out only clears the session and leaves the mode `'authenticated'`, so
 * the root gate routes the user to the sign-in screen instead of falling back
 * to demo fixtures.
 *
 * The mode is persisted through the chunked SecureStore adapter (same backend
 * as the session), so after a relaunch the gate is reconciled BEFORE the
 * session read: a user who previously authenticated lands on sign-in when no
 * session is restored, while a fresh install keeps the demo default.
 * Persistence: `useSettingsStore.mode` is the source of truth; only
 * `'authenticated'` is written, `'demo'` is the implicit default.
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
    // previously authenticated user, demo for a fresh install).
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
          const session = data.session;
          if (error) {
            // The stored token could not be refreshed and its access token has
            // expired: discard it and land on the sign-in screen (spec: expired
            // stored session → session cleared → sign-in shown).
            await supabase.auth.signOut().catch(() => {
              // Best effort — the client may already have cleared storage.
            });
            useSettingsStore.getState().setMode('authenticated');
            await savePersistedAuthMode('authenticated');
            return;
          }
          if (session) {
            set({ session });
            useSettingsStore.getState().setMode('authenticated');
            await savePersistedAuthMode('authenticated');
            if (session.user) void ensureProfile(session.user.id);
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
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return error.message;
    // SIGNED_IN fires through onAuthStateChange: session set, mode promoted,
    // profile synced. Nothing else to do here.
    return null;
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
    if (error) throw new Error(error.message);
    // SIGNED_OUT fires through onAuthStateChange and clears the session. The
    // mode stays 'authenticated' (persisted) so the gate shows the sign-in
    // screen, including after a relaunch.
  },
}));

/**
 * Promotes state whenever supabase-js reports a session-bearing event
 * (SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY) and clears it
 * on SIGNED_OUT.
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
        useSessionStore.setState({ session });
        useSettingsStore.getState().setMode('authenticated');
        void savePersistedAuthMode('authenticated');
        if (session.user) void ensureProfile(session.user.id);
      }
    },
  );
}

initAuthStateListener();
