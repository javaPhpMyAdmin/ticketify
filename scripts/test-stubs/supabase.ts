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

/** What `functions.invoke(fn)` resolves to (per function name). */
export interface FunctionInvokeState {
  data: unknown;
  error: Error | null;
}

/** One entry in the double's call log (harness seam for write guards). */
export type CallLogEntry =
  | { kind: 'from'; table: string }
  | { kind: 'rpc'; fn: string; params: Record<string, unknown> | null }
  | { kind: 'upsert'; table: string }
  | { kind: 'insert'; table: string }
  | { kind: 'update'; table: string }
  | { kind: 'delete'; table: string }
  | { kind: 'invoke'; fn: string; opts: unknown };

/**
 * The `from(table)` surface: upserts (auth), the select chain (reads), and
 * insert/update/delete (purchase writes, Phase 5).
 */
export interface FromBuilder {
  upsert: (row: unknown, opts?: unknown) => Promise<{ error: StubError }>;
  select: (columns?: string) => QueryBuilder;
  insert: (rows: unknown, opts?: unknown) => QueryBuilder;
  update: (columns: Record<string, unknown>, opts?: unknown) => QueryBuilder;
  delete: (opts?: unknown) => QueryBuilder;
}

/**
 * Chainable builder returned by `select` / `insert` / `update` / `delete`.
 * Mirrors supabase-js: filter/order/limit calls chain, `.single` /
 * `.maybeSingle` are explicit terminals, and the builder itself is
 * thenable, so `await`-ing an unterminated chain resolves the PostgREST
 * response `{ data, error }` (deletes/updates resolve `data: null` unless
 * `.select()` was chained, like the real client).
 */
export interface QueryBuilder extends PromiseLike<{ data: unknown; error: StubError }> {
  eq: (column: string, value: unknown) => QueryBuilder;
  ilike: (column: string, pattern: string) => QueryBuilder;
  gte: (column: string, value: unknown) => QueryBuilder;
  lt: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, opts?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  select: (columns?: string) => QueryBuilder;
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
  functions: {
    invoke: (
      fn: string,
      opts?: { body?: unknown; timeout?: number },
    ) => Promise<{ data: unknown; error: Error | null }>;
  };
};

/** Per-table read results (harness seam, see `__setTableRead`). */
const tableReads = new Map<string, TableReadState>();

/** Per-function RPC results (harness seam, see `__setRpcResult`). */
const rpcResults = new Map<string, RpcResultState>();

/** Per-function edge-invoke results (harness seam, see `__setFunctionInvoke`). */
const functionInvokes = new Map<string, FunctionInvokeState>();

/** Every backend interaction the harness can assert on (write guards). */
const callLog: CallLogEntry[] = [];

/**
 * What a builder chain resolves to without an explicit terminal.
 * - read chains (select): the armed `tableReads` rows for the table,
 * - insert chains: the rows the app passed (decorated with a synthetic id,
 *   since the DB assigns one on insert),
 * - write chains (update/delete without `.select()`): `data: null`,
 *   mirroring the real client.
 */
type BuilderSource = { kind: 'read' } | { kind: 'insert'; rows: unknown[] } | { kind: 'write' };

/**
 * Builds a chainable builder for a table. Terminal results come from
 * `tableReads` at CALL time, so a harness can arm rows for one test without
 * touching earlier assertions.
 */
function makeQueryBuilder(table: string, source: BuilderSource = { kind: 'read' }): QueryBuilder {
  const builder = {
    eq: () => builder,
    ilike: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: () => builder,
    select: () => builder,
    async maybeSingle() {
      if (source.kind !== 'read') {
        return { data: source.kind === 'insert' ? source.rows[0] ?? null : null, error: null };
      }
      const state = tableReads.get(table) ?? { rows: null, error: null };
      if (state.error) return { data: null, error: state.error };
      const rows = state.rows ?? [];
      return { data: rows.length > 0 ? rows[0] : null, error: null };
    },
    async single() {
      if (source.kind !== 'read') {
        return { data: source.kind === 'insert' ? source.rows[0] ?? null : null, error: null };
      }
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
    then: (
      onfulfilled?: (value: { data: unknown; error: StubError }) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ): Promise<unknown> => {
      const state =
        source.kind === 'read'
          ? tableReads.get(table) ?? { rows: null, error: null }
          : { rows: null, error: null };
      const data = source.kind === 'insert' ? source.rows : state.rows;
      return Promise.resolve({ data, error: state.error }).then(onfulfilled, onrejected);
    },
  };
  return builder as QueryBuilder;
}

/** Monotonic id assigned to inserted rows (the DB assigns uuids on insert). */
let insertCounter = 0;

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
      select: () => makeQueryBuilder(table, { kind: 'read' }),
      insert: (rows: unknown) => {
        callLog.push({ kind: 'insert', table });
        // The DB assigns ids; decorate inserted rows so `.select('id')`
        // flows can read one back (saveReceipt returns the new id).
        const decorated = (Array.isArray(rows) ? rows : [rows]).map(
          (row, index) => ({
            id: `stub-insert-${insertCounter++}-${index}`,
            ...(row as object),
          }),
        );
        return makeQueryBuilder(table, { kind: 'insert', rows: decorated });
      },
      update: (columns: Record<string, unknown>) => {
        void columns;
        callLog.push({ kind: 'update', table });
        return makeQueryBuilder(table, { kind: 'write' });
      },
      delete: () => {
        callLog.push({ kind: 'delete', table });
        return makeQueryBuilder(table, { kind: 'write' });
      },
    };
  },
  rpc: (fn: string, params?: Record<string, unknown>) => {
    callLog.push({ kind: 'rpc', fn, params: params ?? null });
    const state = rpcResults.get(fn) ?? { rows: null, error: null };
    if (state.error) return Promise.resolve({ data: null, error: state.error });
    return Promise.resolve({ data: state.rows, error: null });
  },
  functions: {
    invoke: (fn: string, opts?: { body?: unknown; timeout?: number }) => {
      callLog.push({ kind: 'invoke', fn, opts: opts ?? null });
      const state = functionInvokes.get(fn) ?? { data: null, error: null };
      return Promise.resolve({ data: state.data, error: state.error });
    },
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
  functionInvokes.clear();
  callLog.length = 0;
  insertCounter = 0;
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

/** Arms the data (or the error) `functions.invoke(fn)` resolves to. */
export function __setFunctionInvoke(
  fn: string,
  state: Partial<FunctionInvokeState>,
): void {
  functionInvokes.set(fn, { data: state.data ?? null, error: state.error ?? null });
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
  // Edge-function surface: mirrors the slice of supabase-js the tickets
  // feature uses; behavior is armed per function via `__setFunctionInvoke`
  // and the shape follows FunctionResponse.
  functions: {
    invoke: (
      fn: string,
      opts?: { body?: unknown; timeout?: number },
    ) => behavior.functions.invoke(fn, opts),
  },
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
