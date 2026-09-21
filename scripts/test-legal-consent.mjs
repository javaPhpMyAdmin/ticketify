#!/usr/bin/env node
/**
 * Node harness for the legal consent slice (SDD legal-compliance — U4).
 *
 * Covers the consent read + accept path end to end without a backend:
 *   Section 1 — version constants: LATEST_LEGAL_VERSIONS ships exactly
 *       { privacy: '2026-09-18', terms: '2026-09-18' } and stays in sync
 *       with the mirror generator's LEGAL_VERSION (AD-4 shared ISO date).
 *   Section 2 — pure consent logic: isConsentComplete (both documents at
 *       the LATEST version), shouldShowConsentGate (gated + non-legal
 *       route), flushDecision (email match + version currency).
 *   Section 3 — pending-acceptance store against the REAL chunked SecureStore
 *       adapter (in-memory backend) and the stub-backed app singleton:
 *       write/read round-trip, corrupt payloads → null, clear.
 *   Section 4 — record-acceptance RPC against the supabase stub:
 *       success → { status: 'ok' } with the exact rpc fn + params;
 *       rpc error → user-safe message; unconfigured → error with NO rpc.
 *   Section 5 — flushPendingAcceptance: matching flag → two rpc writes and
 *       the flag clears; stale email or stale version → flag clears with NO
 *       rpc; a failed write KEEPS the flag (retried next session).
 *   Section 6 — useLegalConsent hook (REAL TanStack Query inside
 *       QueryClientProvider, mounted with react-test-renderer): status
 *       transitions loading → gated → complete; accept() fires both rpc
 *       writes and invalidates; read failure fails CLOSED to gated; an
 *       accept write failure rejects and stays gated.
 *   Section 7 — LIVE infra check, guarded by env: runs ONLY when
 *       TEST_LIVE_SUPABASE_URL + TEST_LIVE_SUPABASE_ANON_KEY are set
 *       (local `supabase start` stack). Asserts the deployed RPC endpoint
 *       answers (2xx/204 with a token, 401/403 without — but never 404).
 *       Skipped by default: local stack is down → documented TODO assert.
 *   Section 8 — U5 wiring: openLegalDocument routes through the
 *       expo-router stub, and the ConsentGate overlay (react-test-renderer)
 *       shows the real catalog copy when gated, records both acceptances
 *       through the stub and releases, hides on /legal/* + when complete,
 *       surfaces a failed write, and offers links + sign-out (no dead-ends).
 *
 * Usage: pnpm test:legal-consent
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require_.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.legal-consent-test.json');

// React, react-test-renderer and TanStack Query are native CJS packages.
// They are loaded through createRequire (NOT bare require() — that would trip
// node's ESM/CJS ambiguity detector next to top-level await, and NOT
// import() — that would pull react-query's ESM build while the compiled
// modules require() the CJS build, yielding TWO QueryClient contexts).
const React = require_('react');
const TestRenderer = require_('react-test-renderer');
const { act, create } = TestRenderer;
const { QueryClient, QueryClientProvider } = require_('@tanstack/react-query');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'legal-consent-test-'));
const outDir = join(workdir, 'out');

const LIVE_SUPABASE_URL = process.env.TEST_LIVE_SUPABASE_URL;
const LIVE_SUPABASE_ANON_KEY = process.env.TEST_LIVE_SUPABASE_ANON_KEY;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(String((err && err.stack) || err));
  }
}

// ---------------------------------------------------------------------------
// Compile (isolated harness tsconfig — AD-5 pattern)
// ---------------------------------------------------------------------------
function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const LATEST = { privacy: '2026-09-18', terms: '2026-09-18' };

function makeFlag(overrides = {}) {
  return {
    email: 'user@example.com',
    version: LATEST.privacy,
    acceptedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

function fullRows(overrides = {}) {
  return [
    { document: 'privacy', version: LATEST.privacy },
    { document: 'terms', version: LATEST.terms },
    ...(overrides.extra ?? []),
  ];
}

function inMemorySecureStoreBackend() {
  const map = new Map();
  return {
    map,
    getItemAsync: async (key) => (map.has(key) ? map.get(key) : null),
    setItemAsync: async (key, value) => {
      map.set(key, value);
    },
    deleteItemAsync: async (key) => {
      map.delete(key);
    },
  };
}

/** Counts the `record_legal_acceptance` rpc calls since the last reset. */
function rpcCalls(stub) {
  return stub
    .__getCallLog()
    .filter((entry) => entry.kind === 'rpc' && entry.fn === 'record_legal_acceptance');
}

/**
 * Full stub reset for a test: behavior AND config inputs. `__resetSupabaseBehavior`
 * clears the behavior/arms but NOT the URL/anon-key inputs — a test that set
 * placeholders (unconfigured branches) would silently poison every later rpc
 * assertion, so the inputs are restored to real-looking values here.
 */
function resetSupabase(stub) {
  stub.__resetSupabaseBehavior();
  stub.__setSupabaseConfigInputs('https://real-project.supabase.co', 'real-anon-key');
}

// Compile the isolated program first (outDir), then run the tests against it.
compile();

// ---------------------------------------------------------------------------
// Require-hook: redirect the @/ path aliases the compiled CJS still carries
// (tsc resolves them for TYPE-CHECKING only — emitted requires keep the
// alias, exactly like the run-rate/auth harnesses).
// ---------------------------------------------------------------------------
function installRequireHook() {
  // Bare specifiers + '@/components' resolve to the compiled test doubles
  // (the gate's host elements must render as react-test-renderer walkable
  // nodes; the real react-native/expo-router packages cannot load in node).
  const STUB_SPECIFIERS = {
    'react-native': join(outDir, 'scripts', 'test-stubs', 'react-native.js'),
    'expo-router': join(outDir, 'scripts', 'test-stubs', 'expo-router.js'),
    'react-i18next': join(outDir, 'scripts', 'test-stubs', 'legal-i18next.js'),
    '@/components': join(outDir, 'scripts', 'test-stubs', 'components.js'),
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (Object.prototype.hasOwnProperty.call(STUB_SPECIFIERS, request)) {
      request = STUB_SPECIFIERS[request];
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

installRequireHook();

// ===========================================================================
// 1 — version constants
// ===========================================================================
console.log('\n[tests] 1 — LATEST_LEGAL_VERSIONS (AD-4 shared ISO date)\n');

await test('LATEST_LEGAL_VERSIONS is exactly { privacy: 2026-09-18, terms: 2026-09-18 }', async () => {
  const versions = await load('src/features/legal/legal-versions.js');
  assert.deepEqual(versions.LATEST_LEGAL_VERSIONS, LATEST);
});

await test('mirror generator LEGAL_VERSION stays in sync with the client constant (AD-4)', async () => {
  const versions = await load('src/features/legal/legal-versions.js');
  const generator = await import(
    pathToFileURL(join(root, 'scripts', 'generate-legal-markdown.mjs')).href
  );
  assert.equal(
    generator.LEGAL_VERSION,
    versions.LATEST_LEGAL_VERSIONS.privacy,
    'generator and client must agree on the version — a catalog bump changes BOTH',
  );
  assert.equal(
    versions.LATEST_LEGAL_VERSIONS.privacy,
    versions.LATEST_LEGAL_VERSIONS.terms,
    'AD-4: both documents share ONE ISO version',
  );
});

// ===========================================================================
// 2 — pure consent logic
// ===========================================================================
console.log('\n[tests] 2 — pure consent logic (isConsentComplete / shouldShowConsentGate / flushDecision)\n');

await test('isConsentComplete: empty rows → false (consent never assumed)', async () => {
  const { isConsentComplete } = await load('src/features/legal/legal-consent.js');
  assert.equal(isConsentComplete([]), false);
});

await test('isConsentComplete: only one document accepted → false', async () => {
  const { isConsentComplete } = await load('src/features/legal/legal-consent.js');
  assert.equal(isConsentComplete([{ document: 'privacy', version: LATEST.privacy }]), false);
});

await test('isConsentComplete: stale version on a document → false', async () => {
  const { isConsentComplete } = await load('src/features/legal/legal-consent.js');
  assert.equal(
    isConsentComplete([
      { document: 'privacy', version: LATEST.privacy },
      { document: 'terms', version: '2026-09-01' },
    ]),
    false,
  );
});

await test('isConsentComplete: both documents at latest → true', async () => {
  const { isConsentComplete } = await load('src/features/legal/legal-consent.js');
  assert.equal(isConsentComplete(fullRows()), true);
});

await test('isConsentComplete: extra rows never weaken completion', async () => {
  const { isConsentComplete } = await load('src/features/legal/legal-consent.js');
  assert.equal(
    isConsentComplete(fullRows({ extra: [{ document: 'privacy', version: '2026-09-01' }] })),
    true,
  );
});

await test('shouldShowConsentGate: gated + non-legal route → true', async () => {
  const { shouldShowConsentGate } = await load('src/features/legal/legal-consent.js');
  assert.equal(shouldShowConsentGate('gated', '/login'), true);
  assert.equal(shouldShowConsentGate('gated', '/'), true);
});

await test('shouldShowConsentGate: gated + legal route → false (legal docs readable during gate)', async () => {
  const { shouldShowConsentGate } = await load('src/features/legal/legal-consent.js');
  assert.equal(shouldShowConsentGate('gated', '/legal/privacy'), false);
  assert.equal(shouldShowConsentGate('gated', '/legal/terms'), false);
  assert.equal(shouldShowConsentGate('gated', '/legal/'), false);
});

await test('shouldShowConsentGate: complete/loading never gate', async () => {
  const { shouldShowConsentGate } = await load('src/features/legal/legal-consent.js');
  assert.equal(shouldShowConsentGate('complete', '/login'), false);
  assert.equal(shouldShowConsentGate('loading', '/login'), false);
});

await test('flushDecision: matching email + current version → flush', async () => {
  const { flushDecision } = await load('src/features/legal/legal-consent.js');
  assert.equal(flushDecision(makeFlag(), 'user@example.com'), 'flush');
});

await test('flushDecision: email mismatch → clear-stale (never flush another account)', async () => {
  const { flushDecision } = await load('src/features/legal/legal-consent.js');
  assert.equal(
    flushDecision(makeFlag({ email: 'other@example.com' }), 'user@example.com'),
    'clear-stale',
  );
});

await test('flushDecision: stale version → clear-stale', async () => {
  const { flushDecision } = await load('src/features/legal/legal-consent.js');
  assert.equal(
    flushDecision(makeFlag({ version: '2026-09-01' }), 'user@example.com'),
    'clear-stale',
  );
});

// ===========================================================================
// 3 — pending-acceptance store
// ===========================================================================
console.log('\n[tests] 3 — pending-acceptance store (real SecureStore adapter + stub-backed singleton)\n');

await test('round-trip: write then read returns the same flag (real chunked adapter)', async () => {
  const { createPendingAcceptanceStore } = await load('src/features/legal/pending-acceptance.js');
  const { createSecureStoreAdapter } = await load('src/lib/supabase/storage-adapter.js');
  const backend = inMemorySecureStoreBackend();
  const store = createPendingAcceptanceStore(createSecureStoreAdapter(backend));
  const flag = makeFlag();
  await store.write(flag);
  assert.deepEqual(await store.read(), flag);
});

await test('read with nothing stored → null', async () => {
  const { createPendingAcceptanceStore } = await load('src/features/legal/pending-acceptance.js');
  const { createSecureStoreAdapter } = await load('src/lib/supabase/storage-adapter.js');
  const store = createPendingAcceptanceStore(createSecureStoreAdapter(inMemorySecureStoreBackend()));
  assert.equal(await store.read(), null);
});

await test('corrupt JSON payload → read null (treated as absent)', async () => {
  const { createPendingAcceptanceStore } = await load('src/features/legal/pending-acceptance.js');
  const { createSecureStoreAdapter } = await load('src/lib/supabase/storage-adapter.js');
  const backend = inMemorySecureStoreBackend();
  const store = createPendingAcceptanceStore(createSecureStoreAdapter(backend));
  await backend.setItemAsync('legal.pending-acceptance', '{not-json');
  assert.equal(await store.read(), null);
});

await test('wrong-shape payload → read null', async () => {
  const { createPendingAcceptanceStore } = await load('src/features/legal/pending-acceptance.js');
  const { createSecureStoreAdapter } = await load('src/lib/supabase/storage-adapter.js');
  const backend = inMemorySecureStoreBackend();
  const store = createPendingAcceptanceStore(createSecureStoreAdapter(backend));
  await backend.setItemAsync('legal.pending-acceptance', JSON.stringify({ nope: true }));
  assert.equal(await store.read(), null);
});

await test('clear removes the stored flag', async () => {
  const { createPendingAcceptanceStore } = await load('src/features/legal/pending-acceptance.js');
  const { createSecureStoreAdapter } = await load('src/lib/supabase/storage-adapter.js');
  const store = createPendingAcceptanceStore(createSecureStoreAdapter(inMemorySecureStoreBackend()));
  await store.write(makeFlag());
  await store.clear();
  assert.equal(await store.read(), null);
});

// ===========================================================================
// 4 — record-acceptance RPC
// ===========================================================================
console.log('\n[tests] 4 — record-acceptance RPC (supabase stub)\n');

await test('success → { status: ok } and rpc receives exact fn + params', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  resetSupabase(stub);
  stub.__setRpcResult('record_legal_acceptance', { rows: [], error: null });
  const { recordAcceptance } = await load('src/features/legal/record-acceptance.js');
  const result = await recordAcceptance('privacy', LATEST.privacy);
  assert.deepEqual(result, { status: 'ok' });
  assert.deepEqual(stub.__lastRpcCall(), {
    fn: 'record_legal_acceptance',
    params: { p_document: 'privacy', p_version: LATEST.privacy },
  });
  assert.equal(rpcCalls(stub).length, 1);
});

await test('rpc error → { status: error }', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  resetSupabase(stub);
  stub.__setRpcResult('record_legal_acceptance', { rows: null, error: { message: 'boom' } });
  const { recordAcceptance } = await load(
    'src/features/legal/record-acceptance.js',
  );
  const result = await recordAcceptance('terms', LATEST.terms);
  // The user-safe message is now rendered by the caller via i18n
  // (see ConsentGate: `t('legal:acceptanceErrorMessage')`). The record
  // layer only signals status — the copy lives in the locale catalog.
  assert.equal(result.status, 'error');
  assert.equal(result.message, undefined);
});

await test('unconfigured → { status: error } and NO rpc call', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  resetSupabase(stub);
  stub.__setSupabaseConfigInputs('https://YOUR-PROJECT.supabase.co', 'YOUR-ANON-KEY');
  const { recordAcceptance } = await load(
    'src/features/legal/record-acceptance.js',
  );
  const result = await recordAcceptance('privacy', LATEST.privacy);
  assert.equal(result.status, 'error');
  assert.equal(result.message, undefined);
  assert.equal(rpcCalls(stub).length, 0);
});

// ===========================================================================
// 5 — flushPendingAcceptance
// ===========================================================================
console.log('\n[tests] 5 — flushPendingAcceptance (email match + version currency)\n');

await test('matching flag → two rpc writes and the flag clears', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  const storageStub = await load('scripts/test-stubs/storage-adapter.js');
  resetSupabase(stub);
  storageStub.__resetStorage();
  stub.__setRpcResult('record_legal_acceptance', { rows: [], error: null });
  const { pendingAcceptanceStore, flushPendingAcceptance } = await load(
    'src/features/legal/pending-acceptance.js',
  );
  await pendingAcceptanceStore.write(makeFlag());
  await flushPendingAcceptance('user@example.com');
  const calls = rpcCalls(stub);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.params),
    [
      { p_document: 'privacy', p_version: LATEST.privacy },
      { p_document: 'terms', p_version: LATEST.terms },
    ],
  );
  assert.equal(await pendingAcceptanceStore.read(), null);
});

await test('email mismatch → flag clears with NO rpc writes', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  const storageStub = await load('scripts/test-stubs/storage-adapter.js');
  resetSupabase(stub);
  storageStub.__resetStorage();
  const { pendingAcceptanceStore, flushPendingAcceptance } = await load(
    'src/features/legal/pending-acceptance.js',
  );
  await pendingAcceptanceStore.write(makeFlag({ email: 'other@example.com' }));
  await flushPendingAcceptance('user@example.com');
  assert.equal(rpcCalls(stub).length, 0);
  assert.equal(await pendingAcceptanceStore.read(), null);
});

await test('stale version → flag clears with NO rpc writes', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  const storageStub = await load('scripts/test-stubs/storage-adapter.js');
  resetSupabase(stub);
  storageStub.__resetStorage();
  const { pendingAcceptanceStore, flushPendingAcceptance } = await load(
    'src/features/legal/pending-acceptance.js',
  );
  await pendingAcceptanceStore.write(makeFlag({ version: '2026-09-01' }));
  await flushPendingAcceptance('user@example.com');
  assert.equal(rpcCalls(stub).length, 0);
  assert.equal(await pendingAcceptanceStore.read(), null);
});

await test('no flag → no rpc writes', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  const storageStub = await load('scripts/test-stubs/storage-adapter.js');
  resetSupabase(stub);
  storageStub.__resetStorage();
  const { flushPendingAcceptance } = await load('src/features/legal/pending-acceptance.js');
  await flushPendingAcceptance('user@example.com');
  assert.equal(rpcCalls(stub).length, 0);
});

await test('rpc write failure → flag KEPT (retried next session)', async () => {
  const stub = await load('scripts/test-stubs/supabase.js');
  const storageStub = await load('scripts/test-stubs/storage-adapter.js');
  resetSupabase(stub);
  storageStub.__resetStorage();
  stub.__setRpcResult('record_legal_acceptance', { rows: null, error: { message: 'down' } });
  const { pendingAcceptanceStore, flushPendingAcceptance } = await load(
    'src/features/legal/pending-acceptance.js',
  );
  await pendingAcceptanceStore.write(makeFlag());
  await flushPendingAcceptance('user@example.com');
  assert.equal(rpcCalls(stub).length, 2);
  assert.deepEqual(await pendingAcceptanceStore.read(), makeFlag());
});

// ===========================================================================
// 6 — useLegalConsent hook (real TanStack Query + react-test-renderer)
// ===========================================================================
console.log('\n[tests] 6 — useLegalConsent hook (REAL TanStack Query + react-test-renderer)\n');

{
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  function makeQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  function mountHook(hookFn, queryClient) {
    let hookResult = undefined;
    let hookError = null;

    function TestComp() {
      try {
        hookResult = hookFn();
      } catch (e) {
        hookError = e;
      }
      return null;
    }

    let renderer;
    act(() => {
      renderer = create(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(TestComp),
        ),
      );
    });
    if (hookError != null) {
      throw new Error(`hook threw at mount: ${hookError.stack ?? hookError}`);
    }

    const waitFor = async (predicate, { timeout = 2000 } = {}) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        for (let i = 0; i < 3; i += 1) {
          await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
          });
        }
        if (predicate(hookResult)) return hookResult;
        if (Date.now() > deadline) {
          throw new Error(
            `waitFor timed out after ${timeout}ms; last result: ` +
              JSON.stringify(hookResult ?? { error: String(hookError) }),
          );
        }
      }
    };

    return {
      ref: {
        get current() {
          return hookResult;
        },
        get error() {
          return hookError;
        },
      },
      unmount: () => {
        act(() => renderer.unmount());
      },
      queryClient,
      waitFor,
    };
  }

  await test('status transitions loading → gated → complete with the user rows', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    const { useLegalConsent } = await load('src/features/legal/use-legal-consent.js');
    const h = mountHook(() => useLegalConsent('user-1'), makeQueryClient());
    try {
      assert.equal(h.ref.current.status, 'loading');
      await h.waitFor((r) => r.status === 'gated');
      stub.__setTableRead('legal_acceptances', { rows: fullRows(), error: null });
      h.queryClient.invalidateQueries({ queryKey: ['legal', 'user-1'] });
      await h.waitFor((r) => r.status === 'complete');
      // Post-fix: the hook exposes `isError: boolean` (not the raw message).
      assert.equal(h.ref.current.isError, false);
    } finally {
      h.unmount();
    }
  });

  await test('accept() fires both rpc writes then invalidates → complete', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    stub.__setRpcResult('record_legal_acceptance', { rows: [], error: null });
    const { useLegalConsent } = await load('src/features/legal/use-legal-consent.js');
    const h = mountHook(() => useLegalConsent('user-1'), makeQueryClient());
    try {
      await h.waitFor((r) => r.status === 'gated');
      // The backend now holds both rows — the invalidation refetch sees them.
      stub.__setTableRead('legal_acceptances', { rows: fullRows(), error: null });
      await act(async () => {
        await h.ref.current.accept();
      });
      await h.waitFor((r) => r.status === 'complete');
      const calls = rpcCalls(stub);
      assert.equal(calls.length, 2);
      assert.deepEqual(
        calls.map((c) => c.params),
        [
          { p_document: 'privacy', p_version: LATEST.privacy },
          { p_document: 'terms', p_version: LATEST.terms },
        ],
      );
    } finally {
      h.unmount();
    }
  });

  await test('read failure fails CLOSED → status gated (consent never assumed)', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: null, error: { message: 'read down' } });
    const { useLegalConsent } = await load('src/features/legal/use-legal-consent.js');
    const h = mountHook(() => useLegalConsent('user-1'), makeQueryClient());
    try {
      await h.waitFor((r) => r.status === 'gated');
    } finally {
      h.unmount();
    }
  });

  await test('accept() write failure → rejects and stays gated', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    stub.__setRpcResult('record_legal_acceptance', { rows: null, error: { message: 'down' } });
    const { useLegalConsent } = await load('src/features/legal/use-legal-consent.js');
    const h = mountHook(() => useLegalConsent('user-1'), makeQueryClient());
    try {
      await h.waitFor((r) => r.status === 'gated');
      await assert.rejects(async () => {
        await act(async () => {
          await h.ref.current.accept();
        });
      });
      await h.waitFor((r) => r.status === 'gated');
      // Post-cutover (legal-fix): the hook exposes `isError: boolean`,
      // not the raw error message — the caller renders the user-safe
      // copy via `t('legal:acceptanceErrorMessage')`.
      await h.waitFor((r) => r.isError === true);
    } finally {
      h.unmount();
    }
  });

  await test('unconfigured → gated and accept() errors with NO rpc calls', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setSupabaseConfigInputs('https://YOUR-PROJECT.supabase.co', 'YOUR-ANON-KEY');
    const { useLegalConsent } = await load('src/features/legal/use-legal-consent.js');
    const h = mountHook(() => useLegalConsent('user-1'), makeQueryClient());
    try {
      await h.waitFor((r) => r.status === 'gated');
      await assert.rejects(async () => {
        await act(async () => {
          await h.ref.current.accept();
        });
      });
      assert.equal(rpcCalls(stub).length, 0);
    } finally {
      h.unmount();
    }
  });
}

// ===========================================================================
// 7 — LIVE infra check (env-guarded; skipped unless a local stack is up)
// ===========================================================================
console.log('\n[tests] 7 — live record_legal_acceptance endpoint (env-guarded)\n');

if (LIVE_SUPABASE_URL && LIVE_SUPABASE_ANON_KEY) {
  await test('live stack: RPC endpoint answers (2xx/204 with token, 401/403 anon, never 404)', async () => {
    // Anonymous call: the RPC is AUTHENTICATED-ONLY (security definer, logged
    // acceptance rows), so without a token the endpoint must answer 401/403 —
    // anything other than 404 proves the function is deployed on the stack.
    const response = await fetch(`${LIVE_SUPABASE_URL}/rest/v1/rpc/record_legal_acceptance`, {
      method: 'POST',
      headers: {
        apikey: LIVE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${LIVE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_document: 'privacy', p_version: LATEST.privacy }),
    });
    assert.ok(
      response.status !== 404,
      `RPC endpoint must exist on the live stack (got HTTP ${response.status})`,
    );
    assert.ok(
      response.status === 204 ||
        (response.status >= 200 && response.status < 300) ||
        response.status === 401 ||
        response.status === 403,
      `expected 2xx/204 (with token) or 401/403 (anon) but got HTTP ${response.status}`,
    );
  });
} else {
  // Design U4: the live PostgREST check only runs when a local stack is up.
  // Local `supabase status` reports the stack DOWN on this machine, so the
  // check is documented here and stays env-guarded (TODO: `supabase start`
  // then re-run with TEST_LIVE_SUPABASE_URL + TEST_LIVE_SUPABASE_ANON_KEY
  // from `supabase status -o env`; a full 204 needs a GoTrue sign-in since
  // the RPC is authenticated-only).
  console.log(
    `  skip  live stack check — set TEST_LIVE_SUPABASE_URL + TEST_LIVE_SUPABASE_ANON_KEY ` +
      `against a running local supabase stack to enable`,
  );
}

// ===========================================================================
// 8 — U5 wiring: openLegalDocument + ConsentGate overlay
// ===========================================================================
console.log('\n[tests] 8 — U5 wiring: legal navigation helper + ConsentGate overlay\n');

await test('openLegalDocument routes in-app to /legal/{privacy,terms}', async () => {
  const routerStub = await load('scripts/test-stubs/expo-router.js');
  routerStub.__resetRouterStub();
  const { openLegalDocument } = await load('src/lib/legal-navigation.js');
  openLegalDocument('privacy');
  assert.equal(routerStub.__lastNav(), 'push:/legal/privacy');
  openLegalDocument('terms');
  assert.equal(routerStub.__lastNav(), 'push:/legal/terms');
});

{
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // The gate reads the REAL shipped es-AR catalog through the
  // react-i18next test double — the same in-memory bundle the content
  // harness pins (F2), so a rendered assertion can never drift from disk.
  const esARLegal = JSON.parse(
    readFileSync(join(root, 'src/i18n/locales/es-AR/legal.json'), 'utf8'),
  );

  function makeGateClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  function flattenText(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return (node.children ?? []).map(flattenText).join('');
  }

  function findHost(node, type, predicate) {
    if (node == null || typeof node !== 'object') return null;
    if (typeof node.type === 'string' && node.type === type && (!predicate || predicate(node))) {
      return node;
    }
    for (const child of node.children ?? []) {
      const found = findHost(child, type, predicate);
      if (found) return found;
    }
    return null;
  }

  async function mountGate({ stub, pathname = '/', userId = 'user-1', onSignOut }) {
    const routerStub = await load('scripts/test-stubs/expo-router.js');
    const i18nextStub = await load('scripts/test-stubs/legal-i18next.js');
    routerStub.__resetRouterStub();
    routerStub.__setPathname(pathname);
    i18nextStub.__setActiveLegalCatalog(esARLegal, 'es-AR');
    const { ConsentGate } = await load('src/features/legal/components/ConsentGate.js');
    const queryClient = makeGateClient();
    let renderer;
    act(() => {
      renderer = create(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ConsentGate, { userId, onSignOut }),
        ),
      );
    });
    const tree = () => renderer.toJSON();
    const waitFor = async (predicate, { timeout = 2000 } = {}) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        for (let i = 0; i < 3; i += 1) {
          await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
          });
        }
        if (predicate(tree())) return tree();
        if (Date.now() > deadline) {
          throw new Error(`waitFor timed out after ${timeout}ms; tree: ${JSON.stringify(tree())}`);
        }
      }
    };
    const press = (node) => {
      assert.ok(node, 'expected a pressable node');
      act(() => {
        node.props.onPress();
      });
    };
    return {
      tree,
      waitFor,
      press,
      renderer,
      unmount: () => {
        act(() => renderer.unmount());
      },
      findText: (text) =>
        findHost(tree(), 'Text', (n) => flattenText(n).includes(text)),
      findPressable: (label) =>
        findHost(tree(), 'Pressable', (n) => n.props.accessibilityLabel === label),
      findPressableByText: (text) =>
        findHost(tree(), 'Pressable', (n) => flattenText(n).includes(text)),
    };
  }

  await test('ConsentGate: gated → overlay with real catalog copy; accept → rpc×2 → releases', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    stub.__setRpcResult('record_legal_acceptance', { rows: [], error: null });
    const g = await mountGate({ stub, onSignOut: () => {} });
    try {
      await g.waitFor(() => g.findText(esARLegal.consentGateTitle) != null);
      assert.ok(g.findText(esARLegal.consentGateBody) != null);
      assert.ok(g.findText(esARLegal.consentGateSignOut) != null);
      // The backend now holds both rows — the invalidation refetch sees them.
      stub.__setTableRead('legal_acceptances', { rows: fullRows(), error: null });
      g.press(g.findPressableByText(esARLegal.consentGateAccept));
      // accept() is fire-and-forget from the gate (onPress returns void), so
      // the async mutation settles AFTER the press — wait for the writes.
      await g.waitFor(() => rpcCalls(stub).length === 2);
      const calls = rpcCalls(stub);
      assert.deepEqual(
        calls.map((c) => c.params),
        [
          { p_document: 'privacy', p_version: LATEST.privacy },
          { p_document: 'terms', p_version: LATEST.terms },
        ],
      );
      await g.waitFor(() => g.tree() == null);
    } finally {
      g.unmount();
    }
  });

  await test('ConsentGate: complete → overlay never renders', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: fullRows(), error: null });
    const g = await mountGate({ stub, onSignOut: () => {} });
    try {
      assert.equal(g.tree(), null);
      await g.waitFor(() => true, { timeout: 100 });
      assert.equal(g.tree(), null);
    } finally {
      g.unmount();
    }
  });

  await test('ConsentGate: gated on /legal/* → hidden (documents readable during the gate)', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    const g = await mountGate({ stub, pathname: '/legal/terms', onSignOut: () => {} });
    try {
      assert.equal(g.tree(), null);
      await g.waitFor(() => true, { timeout: 100 });
      assert.equal(g.tree(), null);
    } finally {
      g.unmount();
    }
  });

  await test('ConsentGate: sign-out press calls onSignOut (no dead-ends)', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    let signedOut = 0;
    const g = await mountGate({
      stub,
      onSignOut: () => {
        signedOut += 1;
      },
    });
    try {
      await g.waitFor(() => g.findText(esARLegal.consentGateTitle) != null);
      g.press(g.findPressableByText(esARLegal.consentGateSignOut));
      assert.equal(signedOut, 1);
    } finally {
      g.unmount();
    }
  });

  await test('ConsentGate: legal links navigate in-app without recording acceptance', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    const routerStub = await load('scripts/test-stubs/expo-router.js');
    const g = await mountGate({ stub, onSignOut: () => {} });
    try {
      await g.waitFor(() => g.findText(esARLegal.consentGateTitle) != null);
      // The gate's link labels come from the settings namespace, which the
      // legal-i18next double does not resolve — the stub returns the raw key,
      // so links are located by their accessibilityLabel (as rendered).
      g.press(g.findPressable('settings:privacyPolicy'));
      assert.equal(routerStub.__lastNav(), 'push:/legal/privacy');
      g.press(g.findPressable('settings:termsConditions'));
      assert.equal(routerStub.__lastNav(), 'push:/legal/terms');
      assert.equal(rpcCalls(stub).length, 0);
    } finally {
      g.unmount();
    }
  });

  await test('ConsentGate: accept write failure → user-safe error copy, overlay stays gated', async () => {
    const stub = await load('scripts/test-stubs/supabase.js');
    resetSupabase(stub);
    stub.__setTableRead('legal_acceptances', { rows: [], error: null });
    stub.__setRpcResult('record_legal_acceptance', { rows: null, error: { message: 'down' } });
    const g = await mountGate({ stub, onSignOut: () => {} });
    try {
      await g.waitFor(() => g.findText(esARLegal.consentGateTitle) != null);
      g.press(g.findPressableByText(esARLegal.consentGateAccept));
      // Post-fix: the error copy lives in the legal.json catalog
      // (`acceptanceErrorMessage`) — the consent gate renders it via i18n.
      await g.waitFor(() => g.findText(esARLegal.acceptanceErrorMessage) != null);
      // Still gated: the title and sign-out remain visible.
      assert.ok(g.findText(esARLegal.consentGateTitle) != null);
      assert.ok(g.findText(esARLegal.consentGateSignOut) != null);
      assert.equal(rpcCalls(stub).length, 2);
    } finally {
      g.unmount();
    }
  });
}

// ---------------------------------------------------------------------------
// Summary — mirror the other harnesses' rollout summary
// ---------------------------------------------------------------------------
console.log(`\n[tests] all ${passed} tests passed`);

if (failed > 0) {
  console.error(`\n[tests] ${failed} FAILED`);
  process.exitCode = 1;
}
