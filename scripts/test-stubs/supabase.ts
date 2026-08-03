/**
 * Test double for `@/lib/supabase` (reliability re-gate harness).
 *
 * The real `supabase.ts` cannot load in plain node (expo-constants, native
 * SecureStore), so the harness tsconfig remaps `@/lib/supabase` here. The
 * client shape mirrors the slice of auth-js the app uses; behavior is swapped
 * per test through `__setSupabaseBehavior`. Sessions are typed with the real
 * `Session` type so the compiled modules type-check against this double, but
 * the harness (plain JS) supplies fake session objects at runtime.
 */
import type { Session } from '@supabase/supabase-js';

export type StubError = { message: string; code?: string } | null;

export type SupabaseBehavior = {
  signInWithOAuth: (creds: {
    provider: string;
    options?: Record<string, unknown>;
  }) => Promise<{ data: { url: string | null }; error: StubError }>;
  exchangeCodeForSession: (
    code: string,
    options?: { flowId?: string },
  ) => Promise<{ data: { session: Session | null }; error: StubError }>;
  getSession: () => Promise<{
    data: { session: Session | null };
    error: StubError;
  }>;
  signOut: () => Promise<{ error: StubError }>;
  signInWithPassword: (creds: {
    email: string;
    password: string;
  }) => Promise<{ error: StubError }>;
  signUp: (creds: {
    email: string;
    password: string;
  }) => Promise<{ data: { session: Session | null }; error: StubError }>;
  onAuthStateChange: (
    cb: (event: string, session: Session | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
  from: (table: string) => {
    upsert: (row: unknown, opts?: unknown) => Promise<{ error: StubError }>;
  };
};

const defaultBehavior = (): SupabaseBehavior => ({
  signInWithOAuth: async () => ({
    data: { url: 'https://auth.example/authorize' },
    error: null,
  }),
  exchangeCodeForSession: async () => ({ data: { session: null }, error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  signOut: async () => ({ error: null }),
  signInWithPassword: async () => ({ error: null }),
  signUp: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({
    data: { subscription: { unsubscribe: () => {} } },
  }),
  from: (table: string) => {
    void table;
    return {
      upsert: (row: unknown, opts?: unknown) => {
        void opts;
        return Promise.resolve({ error: null as StubError, row });
      },
    };
  },
});

let behavior = defaultBehavior();

/** The last callback `onAuthStateChange` was registered with (harness seam). */
export let __lastAuthStateListener:
  | ((event: string, session: Session | null) => void)
  | undefined;

export function __resetSupabaseBehavior(): void {
  behavior = defaultBehavior();
  __lastAuthStateListener = undefined;
}

export function __setSupabaseBehavior(next: Partial<SupabaseBehavior>): void {
  behavior = { ...behavior, ...next };
}

export const supabase = {
  auth: {
    signInWithOAuth: (
      ...args: Parameters<SupabaseBehavior['signInWithOAuth']>
    ) => behavior.signInWithOAuth(...args),
    exchangeCodeForSession: (
      ...args: Parameters<SupabaseBehavior['exchangeCodeForSession']>
    ) => behavior.exchangeCodeForSession(...args),
    getSession: () => behavior.getSession(),
    signOut: () => behavior.signOut(),
    signInWithPassword: (
      ...args: Parameters<SupabaseBehavior['signInWithPassword']>
    ) => behavior.signInWithPassword(...args),
    signUp: (...args: Parameters<SupabaseBehavior['signUp']>) =>
      behavior.signUp(...args),
    onAuthStateChange: (
      ...args: Parameters<SupabaseBehavior['onAuthStateChange']>
    ) => {
      __lastAuthStateListener = args[0];
      return behavior.onAuthStateChange(...args);
    },
  },
  from: (table: string) => behavior.from(table),
};
