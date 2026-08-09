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
import { isSupabaseConfigured as computeIsSupabaseConfigured } from '@/lib/supabase/config-status';

export type StubError = { message: string; code?: string; statusCode?: number } | null;

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
  | { kind: 'invoke'; fn: string; opts: unknown }
  | { kind: 'storage-upload'; bucket: string; path: string; contentType?: string }
  | { kind: 'storage-signed'; bucket: string; path: string; expiresIn: number };

/**
 * One transform/filter call applied to a `from(table)` builder chain.
 * Recorded per chain so the harness can assert the query the app builds
 * (server-side filters, ordering, limits) without a real PostgREST —
 * e.g. `status='confirmed'` filtering or a deterministic `.order()`.
 */
export type QueryOp =
  | { op: 'eq'; column: string; value: unknown }
  | { op: 'ilike'; column: string; pattern: string }
  | { op: 'gte'; column: string; value: unknown }
  | { op: 'lt'; column: string; value: unknown }
  | { op: 'order'; column: string; opts?: { ascending?: boolean } }
  | { op: 'limit'; count: number };

/** One builder chain: the table it queried and the ops applied to it. */
export interface QueryCall {
  table: string;
  ops: QueryOp[];
}

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
  /** Storage surface: the `receipts` bucket upload + signed-URL reads. */
  storage: {
    upload: (
      bucket: string,
      path: string,
      contentType?: string,
    ) => Promise<{ data: { path: string } | null; error: StubError }>;
    createSignedUrl: (
      bucket: string,
      path: string,
      expiresIn: number,
    ) => Promise<{ data: { signedUrl: string } | null; error: StubError }>;
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
 * Every builder chain created via `from(table)`, in order (harness seam,
 * see `__getQueryCalls`). The entry holds the SAME ops array the builder
 * pushes into, so the recorded ops reflect the full chain once a terminal
 * has been awaited.
 */
const queryLog: QueryCall[] = [];

/**
 * One-shot insert failures per table (harness seam, see `__failNextInsert`):
 * the next `from(table).insert()` resolves `{ error }` and reverts, so a
 * test can exercise the write-failure branches of `saveReceipt` without
 * touching the default success behavior.
 */
const insertFailures = new Map<string, StubError>();

/** Storage bucket behaviors: per-bucket upload/signed-url error, armed via
 *  the `__setStorageBehavior` seam; uploads log to `callLog`. */
const storageBehaviors = new Map<
  string,
  { uploadError?: StubError; signedUrlError?: StubError; signedUrl?: string | null }
>();
/** Rows the app passed to `from(table).insert()`, per table (harness seam,
 *  see `__getInserted`). Decorated with the synthetic ids, exactly as the
 *  builder would resolve them. */
const insertedRows = new Map<string, unknown[]>();

/**
 * What a builder chain resolves to without an explicit terminal.
 * - read chains (select): the armed `tableReads` rows for the table,
 * - insert chains: the rows the app passed (decorated with a synthetic id,
 *   since the DB assigns one on insert),
 * - insert-failure chains: an armed one-shot error (see `__failNextInsert`),
 * - write chains (update/delete without `.select()`): `data: null`,
 *   mirroring the real client.
 */
type BuilderSource =
  | { kind: 'read' }
  | { kind: 'insert'; rows: unknown[] }
  | { kind: 'insert-failure'; error: StubError }
  | { kind: 'write' };

/**
 * Builds a chainable builder for a table. Terminal results come from
 * `tableReads` at CALL time, so a harness can arm rows for one test without
 * touching earlier assertions. Every filter/order/limit call is recorded in
 * the shared `queryLog` (see `__getQueryCalls`) so the harness can assert
 * the query the app builds server-side.
 */
function makeQueryBuilder(table: string, source: BuilderSource = { kind: 'read' }): QueryBuilder {
  const ops: QueryOp[] = [];
  queryLog.push({ table, ops });
  const builder = {
    eq: (column: string, value: unknown) => {
      ops.push({ op: 'eq', column, value });
      return builder;
    },
    ilike: (column: string, pattern: string) => {
      ops.push({ op: 'ilike', column, pattern });
      return builder;
    },
    gte: (column: string, value: unknown) => {
      ops.push({ op: 'gte', column, value });
      return builder;
    },
    lt: (column: string, value: unknown) => {
      ops.push({ op: 'lt', column, value });
      return builder;
    },
    order: (column: string, opts?: { ascending?: boolean }) => {
      ops.push({ op: 'order', column, opts });
      return builder;
    },
    limit: (count: number) => {
      ops.push({ op: 'limit', count });
      return builder;
    },
    select: () => builder,
    async maybeSingle() {
      if (source.kind === 'insert-failure') {
        return { data: null, error: source.error };
      }
      if (source.kind !== 'read') {
        return { data: source.kind === 'insert' ? source.rows[0] ?? null : null, error: null };
      }
      const state = tableReads.get(table) ?? { rows: null, error: null };
      if (state.error) return { data: null, error: state.error };
      const rows = state.rows ?? [];
      return { data: rows.length > 0 ? rows[0] : null, error: null };
    },
    async single() {
      if (source.kind === 'insert-failure') {
        return { data: null, error: source.error };
      }
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
      let data: unknown = null;
      let error: StubError = null;
      if (source.kind === 'read') {
        const state = tableReads.get(table) ?? { rows: null, error: null };
        data = state.rows;
        error = state.error;
      } else if (source.kind === 'insert') {
        data = source.rows;
      } else if (source.kind === 'insert-failure') {
        error = source.error;
      }
      return Promise.resolve({ data, error }).then(onfulfilled, onrejected);
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
        // One-shot armed failure (see `__failNextInsert`): the insert errors
        // and reverts to success behavior for the next call, so `saveReceipt`'s
        // write-failure branches can be exercised without a live backend.
        const armedFailure = insertFailures.get(table);
        if (armedFailure !== undefined) {
          insertFailures.delete(table);
          return makeQueryBuilder(table, { kind: 'insert-failure', error: armedFailure });
        }
        // The DB assigns ids; decorate inserted rows so `.select('id')`
        // flows can read one back (saveReceipt returns the new id). The
        // decorated rows are also exposed via `__getInserted` so tests can
        // assert the exact payloads (slug→id mapping, purchase_id linkage).
        const decorated = (Array.isArray(rows) ? rows : [rows]).map(
          (row, index) => ({
            id: `stub-insert-${insertCounter++}-${index}`,
            ...(row as object),
          }),
        );
        insertedRows.set(table, decorated);
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
  storage: {
    upload: (bucket: string, path: string, contentType?: string) => {
      callLog.push({ kind: 'storage-upload', bucket, path, contentType });
      const state = storageBehaviors.get(bucket) ?? {};
      if (state.uploadError) {
        return Promise.resolve({ data: null, error: state.uploadError });
      }
      return Promise.resolve({ data: { path }, error: null });
    },
    createSignedUrl: (bucket: string, path: string, expiresIn: number) => {
      callLog.push({ kind: 'storage-signed', bucket, path, expiresIn });
      const state = storageBehaviors.get(bucket) ?? {};
      if (state.signedUrlError) {
        return Promise.resolve({ data: null, error: state.signedUrlError });
      }
      return Promise.resolve({
        data: { signedUrl: state.signedUrl ?? `https://signed.example/${path}` },
        error: null,
      });
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
  queryLog.length = 0;
  insertFailures.clear();
  insertedRows.clear();
  insertCounter = 0;
  storageBehaviors.clear();
}

/** Arms per-bucket storage behavior for the `receipts` bucket (upload /
 *  signed-url failures, or a fixed signed URL); a fresh object replaces any
 *  prior state for that bucket. */
export function __setStorageBehavior(
  bucket: string,
  state: {
    uploadError?: StubError;
    signedUrlError?: StubError;
    signedUrl?: string | null;
  },
): void {
  storageBehaviors.set(bucket, state);
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

/**
 * The transform/filter ops of the most recent builder chain for `table`
 * (empty when none was built since the last reset). Lets the harness assert
 * the server-side query the app builds — e.g. that `readPurchaseList`
 * filters `status='confirmed'` and orders `created_at` desc, or that
 * `searchPurchaseItems` bounds the purchase date to the month.
 */
export function __getQueryCalls(table: string): QueryOp[] {
  for (let i = queryLog.length - 1; i >= 0; i -= 1) {
    const entry = queryLog[i];
    if (entry.table === table) return entry.ops;
  }
  return [];
}

/**
 * Arms the next `from(table).insert()` to resolve `{ data: null, error }`
 * (one-shot — the following insert succeeds again). Default behavior for
 * every other call is unchanged, so suites that never call this seam keep
 * their exact current semantics.
 */
export function __failNextInsert(
  table: string,
  error?: { message?: string; code?: string },
): void {
  insertFailures.set(table, {
    message: error?.message ?? 'insert failed',
    code: error?.code,
  });
}

/**
 * The rows the app passed to the most recent successful `from(table).insert()`
 * (decorated with the synthetic ids the builder resolves), or null when no
 * insert happened since the last reset. Lets the harness assert the exact
 * write payload: slug→uuid category resolution, `purchase_id` linkage,
 * `user_id`, `is_impulse`, `sort_order`.
 */
export function __getInserted(table: string): unknown[] | null {
  return insertedRows.get(table) ?? null;
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
  storage: {
    from: (bucket: string) => ({
      upload: (
        path: string,
        _body?: unknown,
        opts?: { contentType?: string },
      ) => behavior.storage.upload(bucket, path, opts?.contentType),
      createSignedUrl: (path: string, expiresIn: number) =>
        behavior.storage.createSignedUrl(bucket, path, expiresIn),
    }),
  },
};

/**
 * The configured URL/anon key the double's `isSupabaseConfigured` derives
 * from (harness seam, see `__setSupabaseConfigInputs`). Defaults to
 * real-looking values so the flag starts `true`, exactly as the pre-seam
 * behavior expected.
 */
let configuredUrl = 'https://real-project.supabase.co';
let configuredAnonKey = 'real-anon-key';

/**
 * Test-only mirror of the app's `isSupabaseConfigured` (the real module
 * derives a boolean const from a real URL + anon key). The flag is DERIVED
 * through the real pure derivation (`config-status`) over the armed inputs,
 * so the unconfigured branch is exercised via the real contract — env
 * parsing + placeholder rejection — not a fake boolean. `export let` keeps a
 * live binding so the harness can flip it per test; compiled CommonJS
 * exposes it through a getter, so the seam always sees the current value.
 */
export let isSupabaseConfigured = computeIsSupabaseConfigured(
  configuredUrl,
  configuredAnonKey,
);

/**
 * Arms the inputs the double's `isSupabaseConfigured` derives from (harness
 * seam). Passing the `app.json` fallback placeholders (e.g.
 * `https://YOUR-PROJECT.supabase.co`, `YOUR-ANON-KEY`) makes the flag derive
 * `false` through the real placeholder-rejection contract, so the compiled
 * feature modules' unconfigured branch is reached without faking the flag.
 */
export function __setSupabaseConfigInputs(url: string, anonKey: string): void {
  configuredUrl = url;
  configuredAnonKey = anonKey;
  isSupabaseConfigured = computeIsSupabaseConfigured(url, anonKey);
}
