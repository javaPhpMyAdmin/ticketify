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
 * Persistence is handled by supabase-js through the chunked SecureStore
 * adapter (slice 1). Web has no native SecureStore backend, so restore()
 * gates on `isSecureStoreAvailable()` and the app degrades to demo mode there
 * — there is deliberately no insecure fallback storage.
 */
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

import { ensureProfile } from '@/lib/auth/profile-sync';
import { supabase } from '@/lib/supabase';
import { isSecureStoreAvailable } from '@/lib/supabase/storage-adapter';
import { useSettingsStore } from '@/stores/use-settings-store';

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

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  isBootstrapping: true,

  restore: async () => {
    set({ isBootstrapping: true });
    try {
      if (!(await isSecureStoreAvailable())) {
        // Web / unsupported platform: no persistence exists, so there is
        // nothing to restore. Stay in the default demo mode.
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
        return;
      }
      if (session) {
        set({ session });
        useSettingsStore.getState().setMode('authenticated');
        if (session.user) void ensureProfile(session.user.id);
      }
      // No stored session at all (fresh install): mode keeps its default
      // 'demo' so the demo path stays fully usable without auth.
    } catch {
      // Corrupt storage or a storage-backend failure: treat as signed out and
      // fall back to the demo path rather than crashing at launch.
      useSettingsStore.getState().setMode('demo');
    } finally {
      set({ isBootstrapping: false });
    }
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
    if (error) return { error: error.message, needsEmailConfirmation: false };
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
    // mode stays 'authenticated' so the gate shows the sign-in screen.
  },
}));

/**
 * Promotes state whenever supabase-js reports a session-bearing event
 * (SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY) and clears it
 * on SIGNED_OUT. Registered once at module load — the client's docs recommend
 * subscribing immediately after createClient.
 */
function initAuthStateListener(): void {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      useSessionStore.setState({ session: null });
      return;
    }
    if (session) {
      useSessionStore.setState({ session });
      useSettingsStore.getState().setMode('authenticated');
      if (session.user) void ensureProfile(session.user.id);
    }
  });
}

initAuthStateListener();
