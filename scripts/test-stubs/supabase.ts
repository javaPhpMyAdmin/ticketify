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

/** What a `from(table).select()…` chain resolves to (per table). */
export interface TableReadState {
  rows: unknown[] | null;
  error: StubError;
}

/** What `rpc(fn)` resolves to (per function name). */
export interface RpcResultState {
  rows: unknown[] | null;
  error: StubError;
}

/** One entry in the double's call log (harness seam for write guards). */
export type CallLogEntry =
  | { kind: 'from'; table: string }
  | { kind: 'rpc'; fn: string; params: Record<string, unknown> | null }
  | { kind: 'upsert'; table: string };

/** The `from(table)` surface: upserts (auth) and a select chain (reads). */
export interface FromBuilder {
  upsert: (row: unknown, opts?: unknown) => Promise<{ error: StubError }>;
  select: (columns?: string) => QueryBuilder;
}

/** Chainable `select` builder with `.single` / `.maybeSingle` terminals. */
export interface QueryBuilder {
  eq: (column: string, value: unknown) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown | null; error: StubError }>;
  single: () => Promise<{ data: unknown | null; error: StubError }>;
}

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
  from: (table: string) => FromBuilder;
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown[] | null; error: StubError }>;
};

/** Per-table read results (harness seam, see `__setTableRead`). */
const tableReads = new Map<string, TableReadState>();

/** Per-function RPC results (harness seam, see `__setRpcResult`). */
const rpcResults = new Map<string, RpcResultState>();

/** Every backend interaction the harness can assert on (write guards). */
const callLog: CallLogEntry[] = [];

/**
 * Builds the `select()…maybeSingle()/single()` chain for a table. Terminal
 * results come from `tableReads` at CALL time, so a harness can arm rows for
 * one test without touching earlier assertions.
 */
function makeQueryBuilder(table: string): QueryBuilder {
  const builder: QueryBuilder = {
    eq: () => builder,
    async maybeSingle() {
      const state = tableReads.get(table) ?? { rows: null, error: null };
      if (state.error) return { data: null, error: state.error };
      const rows = state.rows ?? [];
      return { data: rows.length > 0 ? rows[0] : null, error: null };
    },
    async single() {
      const state = tableReads.get(table) ?? { rows: null, error: null };
      if (state.error) return { data: null, error: state.error };
      const rows = state.rows ?? [];
      if (rows.length !== 1) {
        return {
          data: null,
          error: {
            message:
              'JSON object requested, multiple (or no) rows returned',
            code: 'PGRST116',
          },
        };
      }
      return { data: rows[0], error: null };
    },
  };
  return builder;
}

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
    callLog.push({ kind: 'from', table });
    return {
      upsert: (row: unknown, opts?: unknown) => {
        void opts;
        callLog.push({ kind: 'upsert', table });
        return Promise.resolve({ error: null as StubError, row });
      },
      select: () => makeQueryBuilder(table),
    };
  },
  rpc: (fn: string, params?: Record<string, unknown>) => {
    callLog.push({ kind: 'rpc', fn, params: params ?? null });
    const state = rpcResults.get(fn) ?? { rows: null, error: null };
    if (state.error) return Promise.resolve({ data: null, error: state.error });
    return Promise.resolve({ data: state.rows, error: null });
  },
});

let behavior = defaultBehavior();

let _lastAuthStateListener:
  | ((event: AuthChangeEvent, session: Session | null) => void)
  | undefined;

/** The last callback `onAuthStateChange` was registered with (harness seam). */
export function __getLastAuthStateListener():
  | ((event: AuthChangeEvent, session: Session | null) => void)
  | undefined {
  return _lastAuthStateListener;
}

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

/**
 * Resets the double's swappable behavior only. The app's listener subscription
 * is NOT part of that behavior: the store module registers it once at import
 * (mirroring the real app), so it survives resets — `__getLastAuthStateListener`
 * keeps returning the app callback across tests, exactly as a live app keeps
 * its subscription across restores and sign-outs.
 */
export function __resetSupabaseBehavior(): void {
  behavior = defaultBehavior();
  tableReads.clear();
  rpcResults.clear();
  callLog.length = 0;
}

export function __setSupabaseBehavior(next: Partial<SupabaseBehavior>): void {
  behavior = { ...behavior, ...next };
}

/** Arms the rows (or the error) a `from(table).select()…` chain resolves to. */
export function __setTableRead(
  table: string,
  state: Partial<TableReadState>,
): void {
  tableReads.set(table, { rows: state.rows ?? null, error: state.error ?? null });
}

/** Arms the rows (or the error) `rpc(fn)` resolves to. */
export function __setRpcResult(fn: string, state: Partial<RpcResultState>): void {
  rpcResults.set(fn, { rows: state.rows ?? null, error: state.error ?? null });
}

/** Snapshot of every backend interaction since the last reset. */
export function __getCallLog(): CallLogEntry[] {
  return callLog.slice();
}

/** The most recent `rpc` call (fn + params), or null when none happened. */
export function __lastRpcCall(): {
  fn: string;
  params: Record<string, unknown> | null;
} | null {
  for (let i = callLog.length - 1; i >= 0; i -= 1) {
    const entry = callLog[i];
    if (entry.kind === 'rpc') return { fn: entry.fn, params: entry.params };
  }
  return null;
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
      _lastAuthStateListener = args[0];
      listenerCount += 1;
      return { data: { subscription: makeSubscription(args[0]) } };
    },
  },
  from: (table: string) => behavior.from(table),
  rpc: (fn: string, params?: Record<string, unknown>) =>
    behavior.rpc(fn, params),
};

/**
 * Test-only mirror of the app's `isSupabaseConfigured` (the real module exports
 * a boolean const gating reads on a real URL + anon key). `export let` keeps a
 * live binding so the harness can flip it per test; compiled CommonJS exposes
 * it through a getter, so the seam always sees the current value.
 */
export let isSupabaseConfigured = true;

export function __setSupabaseConfigured(configured: boolean): void {
  isSupabaseConfigured = configured;
}
