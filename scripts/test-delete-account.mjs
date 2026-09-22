#!/usr/bin/env node
/**
 * Node harness for the delete-account stack (REQ-ACCTDEL).
 *
 * Compiles the typed-confirmation helper, the feature-access wrapper, and
 * the session store with their stubs into a temp directory, then asserts
 * the three contracts PR1/PR2/PR3 set up:
 *
 *   (a) `matchesTypedConfirmation` (TypedConfirmation organism helper) —
 *       case-insensitive trimmed equality. The button must re-enable on
 *       any case match but stay disabled on incomplete/extra characters
 *       and on empty input. Defensive on null inputs (the rule must not
 *       crash on a future caller that forgets to narrow).
 *
 *   (b) `feature-access.deleteAccount` — discriminated
 *       `DeleteAccountResult` envelope mapping. The wrapper must:
 *         - return `{ status: 'ok', alreadyDeleted? }` on a 200 + ok:true
 *           body, idempotency included,
 *         - read the typed `error` field from the body when present
 *           (the edge function's stable envelope), even when supabase-js
 *           surfaces an `error` alongside `data` for non-2xx responses,
 *         - map HTTP-status-only failures (FunctionsHttpError without a
 *           parseable body) by status: 502 → revenuecat_revoke_failed,
 *           401 → unauthenticated, 409 → household_owner_with_members,
 *           any other status → 'internal',
 *         - never throw: a REJECTING invoke (transport/abort) resolves
 *           to `{ status: 'error', code: 'internal', message: '' }`,
 *         - return `code: 'internal'` when `isSupabaseConfigured` is
 *           false (the harness drives this through the real config-status
 *           derivation via the supabase stub, not a fake flag).
 *
 *   (c) `useSessionStore.deleteAccount` — manual cleanup chain order
 *       (mirrors the SIGNED_OUT listener body verbatim, per design §6).
 *       After a successful delete:
 *         - `logOutRevenueCat()` runs BEFORE the wrapper (best-effort
 *           local SDK clear — the server-side REST revoke is the
 *           authoritative bridge wipe),
 *         - `queryClient.clear()` runs,
 *         - `useReceiptsStore.resetAll()` runs,
 *         - `useProStore.reset()` runs,
 *         - `useHouseholdStore.reset()` runs,
 *         - `useSessionStore.session` becomes null and
 *           `deleteAccountDraft` becomes null,
 *       On a wrapper error, NONE of the cleanup runs (the session and
 *       caches stay intact so the user can retry). A rejecting
 *       `logOutRevenueCat` is swallowed silently — the action still
 *       awaits the wrapper and propagates the result.
 *
 * Harness mechanics mirror `scripts/test-webhook-idempotency.mjs`:
 *   compile TS → CJS into a temp dir with an isolated tsconfig
 *   (`tsconfig.delete-account-test.json`) that remaps `@/lib/supabase`
 *   and `@/lib/revenuecat` to the test doubles, then load the compiled
 *   modules behind a `Module._resolveFilename` hook. The session store
 *   pulls in the receipts / pro / household stores and the real
 *   TanStack singleton (the same `queryClient` the app uses), so the
 *   `clear()` spy runs against the live cache.
 *
 * Usage: pnpm test:delete-account
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.delete-account-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'delete-account-test-'));
const outDir = join(workdir, 'out');

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

async function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

/**
 * Mirror the harness tsconfig's `paths` at runtime: tsc type-checks
 * against the remapped files but emits the original specifier, so plain
 * node cannot resolve `@/…` in the compiled CommonJS output. The hook
 * also remaps the `react-native` native module (the real package uses
 * Flow syntax `import typeof * as …` that Node cannot parse) and the
 * three test doubles (`@/lib/supabase`, `@/lib/supabase/storage-adapter`,
 * `@/lib/revenuecat`) to the compiled stub locations.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === '@/lib/revenuecat') {
      request = join(outDir, 'scripts', 'test-stubs', 'revenuecat.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

const PLACEHOLDER_URL = 'https://YOUR-PROJECT.supabase.co';
const CONFIGURED_URL = 'https://real-project.supabase.co';
const CONFIGURED_ANON_KEY = 'real-anon-key';

/** Resets every stub + store + cache between tests. */
function resetAll() {
  stubMod.__resetSupabaseBehavior();
  stubMod.__setSupabaseConfigInputs(CONFIGURED_URL, CONFIGURED_ANON_KEY);
  revenuecatStubMod.__resetRevenueCatBehavior();
  // Restore the live caches to their bootstrap defaults.
  queryClientMod.queryClient.getQueryCache().clear();
  receiptsStoreMod.useReceiptsStore.setState({
    list: [],
    draft: null,
    scanState: 'idle',
    scanError: null,
    editingId: null,
  });
  proStoreMod.useProStore.setState({
    // Post-cutover (0039): the pro store no longer carries
    // subscriptionStatus / isTrialing / isFrozen. Slice C
    // re-introduced `trialEndsAt` (sourced from CustomerInfo) for
    // REQ-PRO-TRIAL-PILL on the profile screen.
    isPro: false,
    isLoading: true,
    trialEndsAt: null,
    everPaid: false,
  });
  householdStoreMod.useHouseholdStore.setState({
    household: null,
    role: null,
    members: [],
    inviteCode: null,
    isLoading: false,
  });
  sessionStoreMod.useSessionStore.setState({
    session: null,
    isBootstrapping: false,
    deleteAccountDraft: null,
  });
}

let stubMod;
let seamMod;
let matchMod;
let revenuecatStubMod;
let sessionStoreMod;
let queryClientMod;
let receiptsStoreMod;
let proStoreMod;
let householdStoreMod;

async function run() {
  console.log('\n[tests] compiling delete-account modules…');
  await compile();
  console.log('[tests] loading compiled modules…');
  installRequireHook();

  stubMod = await load('scripts/test-stubs/supabase.js');
  revenuecatStubMod = await load('scripts/test-stubs/revenuecat.js');
  matchMod = await load(
    'src/components/organisms/TypedConfirmation/lib/match.js',
  );
  seamMod = await load('src/lib/supabase/feature-access.js');
  sessionStoreMod = await load('src/features/auth/use-session-store.js');
  queryClientMod = await load('src/lib/query-client.js');
  receiptsStoreMod = await load('src/stores/use-receipts-store.js');
  proStoreMod = await load('src/stores/use-pro-store.js');
  householdStoreMod = await load('src/stores/use-household-store.js');

  // ---------------------------------------------------------------------
  // (a) TypedConfirmation match helper — pure function, exported for the
  // harness so we can exercise every whitespace/casing branch without
  // rendering React or pulling the native TextInput module into node.
  // ---------------------------------------------------------------------
  console.log('\n[tests] matchesTypedConfirmation — case + whitespace\n');

  await test('exact match → true', () => {
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINAR', 'ELIMINAR'), true);
  });

  await test('case-insensitive (lowercase value, uppercase prompt) → true', () => {
    assert.equal(matchMod.matchesTypedConfirmation('eliminar', 'ELIMINAR'), true);
  });

  await test('both sides lowercased → true', () => {
    assert.equal(matchMod.matchesTypedConfirmation('eliminar', 'eliminar'), true);
  });

  await test('trailing whitespace on the value → true (trimmed)', () => {
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINAR ', 'ELIMINAR'), true);
  });

  await test('leading whitespace on the value → true (trimmed)', () => {
    assert.equal(matchMod.matchesTypedConfirmation('  ELIMINAR', 'ELIMINAR'), true);
  });

  await test('surrounding whitespace on both sides → true (trimmed)', () => {
    assert.equal(
      matchMod.matchesTypedConfirmation('  eliminar  ', 'ELIMINAR'),
      true,
    );
  });

  await test('prompt casing does not matter → true', () => {
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINAR', 'eliminar'), true);
  });

  await test('incomplete word (one char short) → false', () => {
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINA', 'ELIMINAR'), false);
  });

  await test('extra trailing character → false', () => {
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINARR', 'ELIMINAR'), false);
  });

  await test('empty value → false', () => {
    assert.equal(matchMod.matchesTypedConfirmation('', 'ELIMINAR'), false);
  });

  await test('empty prompt → false (defensive)', () => {
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINAR', ''), false);
  });

  await test('null inputs do not crash (defensive)', () => {
    // @ts-expect-error — exercising the runtime guard, not the type contract.
    assert.equal(matchMod.matchesTypedConfirmation(null, 'ELIMINAR'), false);
    // @ts-expect-error — same.
    assert.equal(matchMod.matchesTypedConfirmation('ELIMINAR', null), false);
    // @ts-expect-error — same.
    assert.equal(matchMod.matchesTypedConfirmation(null, null), false);
  });

  // ---------------------------------------------------------------------
  // (b) feature-access.deleteAccount envelope mapping.
  // The wrapper is exported as `deleteAccount` from the compiled seam;
  // we drive it through the supabase stub's `__setFunctionInvoke` seam.
  // ---------------------------------------------------------------------
  console.log('\n[tests] deleteAccount wrapper — envelope mapping\n');

  await test('happy path: 200 + { ok: true } → { status: "ok", alreadyDeleted: undefined }', async () => {
    resetAll();
    stubMod.__setFunctionInvoke('delete-account', {
      data: { ok: true },
      error: null,
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'ok');
    assert.equal(result.alreadyDeleted, undefined);
  });

  await test('idempotent: 200 + { ok: true, already_deleted: true } → alreadyDeleted is true', async () => {
    resetAll();
    stubMod.__setFunctionInvoke('delete-account', {
      data: { ok: true, already_deleted: true },
      error: null,
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'ok');
    assert.equal(result.alreadyDeleted, true);
  });

  await test('household-owner: body carries typed error → mapped to household_owner_with_members', async () => {
    resetAll();
    // The edge function maps the SQLSTATE 'P0001' + 'owner_must_disband_first'
    // exception text into a 409 envelope with `error: 'household_owner_with_members'`.
    // supabase-js parses the body into `data` even for non-2xx; the wrapper
    // must prefer the typed envelope over the generic HTTP-status mapping.
    stubMod.__setFunctionInvoke('delete-account', {
      data: {
        ok: false,
        error: 'household_owner_with_members',
        message: 'Tenés que disolver el hogar antes de eliminar tu cuenta.',
      },
      error: { message: 'FunctionsHttpError', context: { status: 409 } },
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'household_owner_with_members');
    assert.equal(result.message, '');
  });

  await test('RC revoke failed: body carries typed error → mapped to revenuecat_revoke_failed', async () => {
    resetAll();
    // The edge function returns 502 with `{ ok: false, error: 'revenuecat_revoke_failed' }`.
    stubMod.__setFunctionInvoke('delete-account', {
      data: {
        ok: false,
        error: 'revenuecat_revoke_failed',
        message: 'No se pudo revocar la suscripción de RevenueCat.',
      },
      error: { message: 'FunctionsHttpError', context: { status: 502 } },
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'revenuecat_revoke_failed');
    assert.equal(result.message, '');
  });

  await test('HTTP-status-only 401 (no body) → mapped to unauthenticated', async () => {
    resetAll();
    // Gateway rejected the JWT before the edge function ran — body is empty.
    stubMod.__setFunctionInvoke('delete-account', {
      data: null,
      error: { message: 'FunctionsHttpError', context: { status: 401 } },
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'unauthenticated');
  });

  await test('HTTP-status-only 500 (no body) → mapped to internal', async () => {
    resetAll();
    stubMod.__setFunctionInvoke('delete-account', {
      data: null,
      error: { message: 'FunctionsHttpError', context: { status: 500 } },
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'internal');
  });

  await test('HTTP-status-only 400 (unmapped status) → falls back to internal', async () => {
    resetAll();
    stubMod.__setFunctionInvoke('delete-account', {
      data: null,
      error: { message: 'FunctionsHttpError', context: { status: 400 } },
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'internal');
  });

  await test('transport rejection (invoke throws) → wrapper returns internal, never throws', async () => {
    resetAll();
    // A network/timeout abort REJECTS instead of resolving { data, error }.
    stubMod.__setFunctionInvoke('delete-account', {
      reject: new Error('network down'),
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'internal');
    assert.equal(result.message, '');
  });

  await test('unconfigured supabase → wrapper returns internal without invoking', async () => {
    resetAll();
    stubMod.__setSupabaseConfigInputs(PLACEHOLDER_URL, CONFIGURED_ANON_KEY);
    const invokesBefore = stubMod
      .__getCallLog()
      .filter((e) => e.kind === 'invoke').length;
    const result = await seamMod.deleteAccount();
    const invokesAfter = stubMod
      .__getCallLog()
      .filter((e) => e.kind === 'invoke').length;
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'internal');
    assert.equal(invokesAfter, invokesBefore, 'no invoke when unconfigured');
  });

  await test('unknown typed error code in body → falls back to internal (defensive)', async () => {
    resetAll();
    // A drift between the edge function and the client would otherwise let
    // an unknown server value reach the screen — the screen has no mapping
    // for it. The wrapper narrows against the known-code set.
    stubMod.__setFunctionInvoke('delete-account', {
      data: { ok: false, error: 'something_new_we_dont_know_yet' },
      error: null,
    });
    const result = await seamMod.deleteAccount();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'internal');
  });

  // ---------------------------------------------------------------------
  // (c) useSessionStore.deleteAccount — cleanup chain order.
  //
  // Patches `queryClient.clear()` and the three store `reset*` actions at
  // runtime to capture a call-order log, then restores them in `finally`.
  // Verifies that on success the manual cleanup chain runs in the
  // documented order (queryClient.clear → receipts.resetAll →
  // pro.reset → household.reset → session=null) and that on error the
  // chain is GATED (none of them run). Also proves that a rejecting
  // logOutRevenueCat is swallowed (the wrapper still runs; the rejection
  // never bubbles up to the caller).
  // ---------------------------------------------------------------------
  console.log('\n[tests] useSessionStore.deleteAccount — cleanup chain\n');

  /**
   * Installs a one-shot spy on `queryClient.clear()` plus the three store
   * reset actions. Returns the `events` array they push into plus a
   * restore thunk that undoes every monkey-patch in the same try/finally
   * the test should use.
   */
  function spyOnCleanupChain() {
    const events = [];
    const origClear = queryClientMod.queryClient.clear.bind(
      queryClientMod.queryClient,
    );
    queryClientMod.queryClient.clear = () => {
      events.push('queryClient.clear');
      return origClear();
    };

    const origReceiptsReset = receiptsStoreMod.useReceiptsStore.getState().resetAll;
    const origProReset = proStoreMod.useProStore.getState().reset;
    const origHouseholdReset =
      householdStoreMod.useHouseholdStore.getState().reset;
    receiptsStoreMod.useReceiptsStore.setState({
      resetAll: () => {
        events.push('receipts.resetAll');
        return origReceiptsReset();
      },
    });
    proStoreMod.useProStore.setState({
      reset: () => {
        events.push('pro.reset');
        return origProReset();
      },
    });
    householdStoreMod.useHouseholdStore.setState({
      reset: () => {
        events.push('household.reset');
        return origHouseholdReset();
      },
    });

    const restore = () => {
      queryClientMod.queryClient.clear = origClear;
      receiptsStoreMod.useReceiptsStore.setState({
        resetAll: origReceiptsReset,
      });
      proStoreMod.useProStore.setState({ reset: origProReset });
      householdStoreMod.useHouseholdStore.setState({
        reset: origHouseholdReset,
      });
    };
    return { events, restore };
  }

  /** Pin the session store to a signed-in session so the action can run. */
  function signIn() {
    sessionStoreMod.useSessionStore.setState({
      session: {
        access_token: 'fake-access',
        refresh_token: 'fake-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: 'u-delete',
          email: 'user@example.com',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      },
    });
  }

  await test('on success: logOutRevenueCat runs BEFORE the wrapper, then the full cleanup chain runs', async () => {
    resetAll();
    signIn();
    const { events, restore } = spyOnCleanupChain();
    try {
      // Seed a deleteAccountDraft so we can prove it gets cleared too.
      sessionStoreMod.useSessionStore.setState({
        deleteAccountDraft: { typedValue: 'ELIMINAR' },
      });
      // Seed dirty store state so a successful cleanup changes them.
      receiptsStoreMod.useReceiptsStore.setState({
        list: [{ id: 'p-1' }],
        draft: { id: 'p-1' },
      });
      proStoreMod.useProStore.setState({ isPro: true, isLoading: false });
      householdStoreMod.useHouseholdStore.setState({
        household: { id: 'h-1', name: 'X', created_by: 'u-delete' },
        role: 'owner',
        members: [{ household_id: 'h-1', user_id: 'u-delete', role: 'owner' }],
      });

      revenuecatStubMod.__setLogOutRevenueCat(async () => {
        return { ok: true };
      });

      stubMod.__setFunctionInvoke('delete-account', {
        data: { ok: true },
        error: null,
      });
      const result = await sessionStoreMod.useSessionStore.getState().deleteAccount();
      assert.equal(result.status, 'ok');
      // The stub's call log carries every backend interaction in order:
      // the only entry here is the function invoke (the storage seams,
      // rpc, table reads, etc. are not on this path). logOutRevenueCat
      // is local SDK only — it never reaches the backend seam.
      const callLog = stubMod.__getCallLog();
      assert.equal(callLog.length, 1, 'exactly one backend call');
      assert.equal(callLog[0].kind, 'invoke');
      assert.equal(callLog[0].fn, 'delete-account');
      // logOutRevenueCat ran — the stub's counter proves it.
      assert.equal(revenuecatStubMod.__logOutCallCount(), 1);
      // The full cleanup chain ran in the documented order (mirror of the
      // SIGNED_OUT listener body — design §6).
      assert.deepEqual(events, [
        'queryClient.clear',
        'receipts.resetAll',
        'pro.reset',
        'household.reset',
      ]);
      // Session is gone and the draft is cleared so the next user on this
      // device never sees the previous user's typed value.
      assert.equal(sessionStoreMod.useSessionStore.getState().session, null);
      assert.equal(sessionStoreMod.useSessionStore.getState().deleteAccountDraft, null);
      // Stores were reset to their bootstrap defaults.
      assert.equal(proStoreMod.useProStore.getState().isPro, false);
      assert.equal(proStoreMod.useProStore.getState().isLoading, true);
      assert.equal(householdStoreMod.useHouseholdStore.getState().household, null);
      assert.equal(householdStoreMod.useHouseholdStore.getState().role, null);
      assert.deepEqual(receiptsStoreMod.useReceiptsStore.getState().list, []);
      assert.equal(receiptsStoreMod.useReceiptsStore.getState().draft, null);
      // RevenueCat was called exactly once.
      assert.equal(revenuecatStubMod.__logOutCallCount(), 1);
    } finally {
      restore();
    }
  });

  await test('on wrapper error: logOut runs but NO cleanup runs, error is returned', async () => {
    resetAll();
    signIn();
    const { events, restore } = spyOnCleanupChain();
    try {
      receiptsStoreMod.useReceiptsStore.setState({
        list: [{ id: 'p-1' }],
      });
      proStoreMod.useProStore.setState({ isPro: true });
      householdStoreMod.useHouseholdStore.setState({
        household: { id: 'h-1', name: 'X', created_by: 'u-delete' },
      });

      stubMod.__setFunctionInvoke('delete-account', {
        data: { ok: false, error: 'household_owner_with_members' },
        error: null,
      });
      const result = await sessionStoreMod.useSessionStore.getState().deleteAccount();
      assert.equal(result.status, 'error');
      assert.equal(result.code, 'household_owner_with_members');
      // Cleanup chain is GATED on success — none of the resets ran.
      assert.equal(events.length, 0, 'no cleanup chain on wrapper error');
      // Session and stores stay intact for a retry.
      assert.ok(sessionStoreMod.useSessionStore.getState().session, 'session preserved');
      assert.equal(proStoreMod.useProStore.getState().isPro, true);
      assert.equal(householdStoreMod.useHouseholdStore.getState().household?.id, 'h-1');
      assert.equal(
        receiptsStoreMod.useReceiptsStore.getState().list.length,
        1,
        'receipts list preserved on error',
      );
      // logOut still ran (best-effort before the wrapper).
      assert.equal(revenuecatStubMod.__logOutCallCount(), 1);
    } finally {
      restore();
    }
  });

  await test('a rejecting logOutRevenueCat is swallowed silently (no throw, wrapper still runs)', async () => {
    resetAll();
    signIn();
    const { events, restore } = spyOnCleanupChain();
    try {
      // The real logOutRevenueCat never throws by contract (it catches
      // native errors internally). The session store must mirror that
      // contract — a thrown rejection here must be absorbed so the
      // wrapper still runs and the user still gets a definitive result.
      revenuecatStubMod.__setLogOutRevenueCat(async () => {
        throw new Error('native sdk boom');
      });
      stubMod.__setFunctionInvoke('delete-account', {
        data: { ok: true },
        error: null,
      });
      const result = await sessionStoreMod.useSessionStore.getState().deleteAccount();
      assert.equal(result.status, 'ok', 'wrapper ran despite logOut throwing');
      // The cleanup chain still ran.
      assert.deepEqual(events, [
        'queryClient.clear',
        'receipts.resetAll',
        'pro.reset',
        'household.reset',
      ]);
      assert.equal(sessionStoreMod.useSessionStore.getState().session, null);
    } finally {
      restore();
    }
  });

  await test('a REJECTING invoke is absorbed (no throw, internal error returned)', async () => {
    resetAll();
    signIn();
    const { events, restore } = spyOnCleanupChain();
    try {
      // Transport/abort failure: the invoke rejects instead of resolving.
      stubMod.__setFunctionInvoke('delete-account', {
        reject: new Error('network down'),
      });
      const result = await sessionStoreMod.useSessionStore.getState().deleteAccount();
      assert.equal(result.status, 'error');
      assert.equal(result.code, 'internal');
      // No cleanup — the wrapper failed.
      assert.equal(events.length, 0, 'no cleanup on transport failure');
      // Session preserved so the user can retry (no destructive action ran).
      assert.ok(sessionStoreMod.useSessionStore.getState().session, 'session preserved on transport error');
    } finally {
      restore();
    }
  });

  await test('idempotent re-delete: 200 + already_deleted:true → cleanup chain still runs', async () => {
    resetAll();
    signIn();
    const { events, restore } = spyOnCleanupChain();
    try {
      proStoreMod.useProStore.setState({ isPro: true });
      stubMod.__setFunctionInvoke('delete-account', {
        data: { ok: true, already_deleted: true },
        error: null,
      });
      const result = await sessionStoreMod.useSessionStore.getState().deleteAccount();
      assert.equal(result.status, 'ok');
      assert.equal(result.alreadyDeleted, true);
      // The cleanup chain still runs — a previously-deleted user on the
      // same device MUST see the same clean slate as a fresh sign-out.
      assert.deepEqual(events, [
        'queryClient.clear',
        'receipts.resetAll',
        'pro.reset',
        'household.reset',
      ]);
      assert.equal(sessionStoreMod.useSessionStore.getState().session, null);
      assert.equal(proStoreMod.useProStore.getState().isPro, false);
    } finally {
      restore();
    }
  });

  // ---------------------------------------------------------------------
  // (d) delete-account SCREEN wiring — manage-subscription error surface.
  // The regression: `handleManageSubscription` awaited
  // `showManageSubscriptions()` and IGNORED the result envelope, so a
  // misconfigured install (RC not configured, native module missing)
  // produced a dead button — no error, no feedback. The profile screen
  // handles this right (result.error → local state → rendered inline);
  // the delete-account screen must mirror it. Source-level pins (the
  // F4 pattern from test-legal-content.mjs): the handler captures the
  // result and stores its error; the error renders inline near the
  // banner link.
  // ---------------------------------------------------------------------
  console.log('\n[tests] delete-account screen — manage-subscription error surface\n');

  const deleteAccountScreen = readFileSync(
    join(root, 'src', 'app', 'settings', 'delete-account.tsx'),
    'utf8',
  );

  await test('handler captures the showManageSubscriptions() result (no more bare await)', () => {
    assert.ok(
      deleteAccountScreen.includes('const result = await showManageSubscriptions();'),
      'handleManageSubscription must capture the result envelope',
    );
  });

  await test('a failed result stores its error in local state', () => {
    assert.ok(
      deleteAccountScreen.includes('setManageSubscriptionError(result.error)'),
      'a non-ok result.error must be stored into local state',
    );
    assert.ok(
      deleteAccountScreen.includes('manageSubscriptionError'),
      'local state for the manage-subscription error must exist',
    );
  });

  await test('the error renders inline near the banner', () => {
    assert.ok(
      deleteAccountScreen.includes('<Text style={styles.bannerError}>'),
      'the error must render inline as banner error text',
    );
    assert.ok(
      deleteAccountScreen.includes('bannerError: {'),
      'a bannerError style must exist (inline error copy pattern)',
    );
  });

  // ---------------------------------------------------------------------
  // (e) delete-account ROUTE registration — session-gate membership.
  // `/settings/delete-account` reads AND deletes the user's own account
  // data, so it must live INSIDE Stack.Protected like the currency /
  // budget editors — without registration it auto-registers OUTSIDE the
  // guard and a signed-out deep link would reach a destructive screen.
  // Mirrors the F4 slicing technique from test-legal-content.mjs (which
  // separately pins the LEGAL screens OUTSIDE the guard — that boundary
  // is asserted there and must not move).
  // ---------------------------------------------------------------------
  console.log('\n[tests] delete-account route — session-gate registration\n');

  const layoutSource = readFileSync(
    join(root, 'src', 'app', '_layout.tsx'),
    'utf8',
  );
  const protectedBlock =
    layoutSource.match(/<Stack\.Protected[^>]*>[\s\S]*?<\/Stack\.Protected>/)?.[0] ?? '';

  await test('settings/delete-account is registered INSIDE Stack.Protected', () => {
    assert.ok(
      protectedBlock.includes('Stack.Screen name="settings/delete-account"'),
      'delete-account must be registered inside the session gate (it reads/writes the user\'s own data)',
    );
  });

  await test('gate sanity: known protected siblings (settings/currency, settings/budget) are also inside', () => {
    assert.ok(
      protectedBlock.includes('Stack.Screen name="settings/currency"'),
      'control: settings/currency must stay inside the protected block',
    );
    assert.ok(
      protectedBlock.includes('Stack.Screen name="settings/budget"'),
      'control: settings/budget must stay inside the protected block',
    );
  });

  console.log('');
  if (failed > 0) {
    console.error(`[tests] ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`[tests] all ${passed} tests passed`);
  }
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
  // The compiled session-store eagerly subscribes to supabase.auth.onAuthStateChange
  // (initAuthStateListener runs at import time). The stub's listener is harmless
  // but the compiled queryClient.js keeps a gc timer alive, so the loop never
  // drains on its own. Exit explicitly after the cleanup runs.
  process.exit(process.exitCode ?? 0);
}
