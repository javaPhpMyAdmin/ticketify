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
import type {
  AuthChangeEvent,
  Session,
  Subscription,
} from '@supabase/supabase-js';

export type StubError = { message: string; code?: string } | null;

export type SupabaseBehavior = {
  signInWithOAuth: (creds: {
    provider: string;
    options?: Record<string, unknown>;
  }) => Promise<{
    data: { url: string | null; flowId?: string | null };
    error: StubError;
  }>;
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
    cb: (event: AuthChangeEvent, session: Session | null) => void,
  ) => { data: { subscription: Subscription } };
  from: (table: string) => {
    upsert: (row: unknown, opts?: unknown) => Promise<{ error: StubError }>;
  };
};

const defaultBehavior = (): SupabaseBehavior => ({
  signInWithOAuth: async () => ({
    data: { url: 'https://auth.example/authorize', flowId: null },
    error: null,
  }),
  exchangeCodeForSession: async () => ({ data: { session: null }, error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  signOut: async () => ({ error: null }),
  signInWithPassword: async () => ({ error: null }),
  signUp: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: (cb) => ({ data: { subscription: makeSubscription(cb) } }),
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
  | ((event: AuthChangeEvent, session: Session | null) => void)
  | undefined;

/**
 * Builds a subscription that matches auth-js's `Subscription` shape (it
 * carries `id` and `callback` besides `unsubscribe`). The tracking wrapper
 * below relies on the same counters, so every subscription — including ones
 * created through `__setSupabaseBehavior` overrides — must go through here.
 */
function makeSubscription(
  cb: (event: AuthChangeEvent, session: Session | null) => void,
): Subscription {
  let cancelled = false;
  return {
    id: Symbol('stub-subscription'),
    callback: cb,
    unsubscribe: () => {
      if (!cancelled) {
        cancelled = true;
        listenerCount -= 1;
        unsubscribedCount += 1;
      }
    },
  };
}

/**
 * Lifetime subscription counters (module-scope, never reset): the harness
 * asserts the Fast Refresh guard by registering a second listener and
 * checking the active count stays at one and an unsubscribe actually ran.
 * Exposed as a function because compiled CommonJS exports are copies — a live
 * binding would not be visible through the import.
 */
let listenerCount = 0;
let unsubscribedCount = 0;

export function __listenerStats(): { active: number; unsubscribed: number } {
  return { active: listenerCount, unsubscribed: unsubscribedCount };
}

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
      listenerCount += 1;
      return { data: { subscription: makeSubscription(args[0]) } };
    },
  },
  from: (table: string) => behavior.from(table),
};
