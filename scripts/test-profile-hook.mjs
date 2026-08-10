#!/usr/bin/env node
/**
 * Node harness for the useProfile hook (server-state-caching spec — D3/D5).
 *
 * Renders the compiled `useProfile` hook through react-test-renderer and
 * asserts hook-level behaviors that have no other automated coverage:
 *
 *   - hydration: the profile row's currency hydrates useSettingsStore,
 *   - skip-equal: an equal-currency hydrate and an unchanged re-render never
 *     notify the settings store's subscribers (the effect keys on the VALUE),
 *   - invalidation: a successful setCurrency write invalidates the user's
 *     profile AND budget query keys while another user's budget key stays
 *     untouched, and the invalidated profile query is refetched,
 *   - failure: a failed write returns the user-safe error result and
 *     invalidates nothing,
 *   - convergence: after the post-write refetch returns the persisted
 *     currency, the keyed effect re-hydrates the store (the documented
 *     hydrate-and-converge path),
 *   - no-session: the redundant write guard returns an error before any I/O.
 *
 * Harness mechanics mirror scripts/test-features.mjs: compile TS→CJS with an
 * isolated tsconfig (scripts/tsconfig.profile-hook-test.json), then load the
 * compiled modules behind a Module._resolveFilename hook that rewrites the
 * native/backend + alias specifiers to the scripts/test-stubs doubles. The
 * probe REUSES the compiled `@/lib/query-client` singleton (never creates a
 * fresh QueryClient) and clears its cache per test, exactly like the
 * saveReceipt probe.
 *
 * Two library quirks drive the render mechanics:
 *   - @tanstack/react-query ships separate ESM/CJS builds and the compiled
 *     CJS modules `require` the cjs one, so the harness gets its
 *     QueryClientProvider through `require` too — an ESM import would create
 *     a second instance whose provider context the compiled hooks never read.
 *   - Query observers notify React's onStoreChange through setTimeout(0)
 *     (a macrotask), so async transitions await an explicit `tick()` INSIDE
 *     the act callback; `act` alone only drains microtasks.
 *
 * react-test-renderer is deprecated by React 19 (one warning at import); it
 * is still the plain-node renderer that needs no DOM. React 19's `act`
 * requires the global IS_REACT_ACT_ENVIRONMENT flag to actually wrap and
 * flush render work outside a test framework.
 *
 * Usage: pnpm test:profile-hook
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import React from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.profile-hook-test.json');

// The compiled modules load @tanstack/react-query through CJS `require`, and
// the package ships separate ESM/CJS builds. Get the provider through the
// SAME CJS build so a single QueryClientProvider instance is in play.
const { QueryClientProvider } = require('@tanstack/react-query');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'profile-hook-test-'));
const outDir = join(workdir, 'out');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function compile() {
  console.log('  [compile] tsc -p scripts/tsconfig.profile-hook-test.json --outDir ' + outDir);
  execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
    stdio: 'inherit',
  });
}

const originalResolveFilename = Module._resolveFilename;

function installRequireHook() {
  // Mirror test-features: MUTATE the request, then delegate to the original
  // resolver — it performs extension resolution (tryExtensions) on the
  // rewritten path, which returning a bare path would skip.
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts/test-stubs/supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts/test-stubs/storage-adapter.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts/test-stubs/react-native.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

const load = (rel) => import(pathToFileURL(join(outDir, rel)).href);

let stubMod;
let profileApiMod;
let profileHookMod;
let sessionStoreMod;
let settingsStoreMod;
let queryClientMod;
let useProfile;

// Minimal signed-in session (only user.id/email are read by the hook).
const FAKE_SESSION = {
  access_token: 'access-token-u1',
  refresh_token: 'refresh-token-u1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'u1',
    email: 'user@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  },
};

// Mirrors public.profiles (src/types User) for the signed-in user.
const PROFILE_EUR = {
  id: 'u1',
  full_name: 'Ana',
  avatar_url: null,
  monthly_budget: 900,
  currency: 'EUR',
  tier: 'free',
  created_at: '2026-01-01T00:00:00.000Z',
};

// Mirrors public.scan_usage (src/types ScanUsage); the stub ignores filters.
const SCAN_USAGE_ROW = {
  user_id: 'u1',
  year_month: '2026-08',
  scans_used: 3,
  scans_limit: 10,
};

let captured = null;

function Probe() {
  captured = useProfile();
  return null;
}

const probeElement = () =>
  React.createElement(
    QueryClientProvider,
    { client: queryClientMod.queryClient },
    React.createElement(Probe),
  );

// Query observers notify React's onStoreChange via setTimeout(0) — a
// macrotask. When that notify fires with no act scope active, the re-render
// it schedules can be dropped, so results must never depend on timer
// ordering. `settleUntil` polls act-ticks (each turns the event loop INSIDE
// an act scope, letting a pending notify fire and act drain the queued
// re-render + effects) until `predicate` holds, with a bounded budget.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settleUntil(predicate, what, budget = 30) {
  for (let i = 0; i < budget && !predicate(); i += 1) {
    await act(async () => {
      await tick();
    });
  }
  assert.ok(predicate(), what);
}

const storeHydratedTo = (currency) =>
  () => settingsStoreMod.useSettingsStore.getState().currency === currency;

async function mountProbe(
  settled = storeHydratedTo('EUR'),
) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(probeElement());
  });
  await settleUntil(settled, 'mount settled');
  return renderer;
}

async function unmountProbe(renderer) {
  await act(async () => {
    renderer.unmount();
  });
}

function resetAll() {
  stubMod.__resetSupabaseBehavior();
  queryClientMod.queryClient.getQueryCache().clear();
  settingsStoreMod.useSettingsStore.setState({
    monthly_budget: 1200,
    currency: 'UYU',
    tier: 'free',
    household_sharing: false,
  });
  sessionStoreMod.useSessionStore.setState({ session: null });
}

function signIn() {
  sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
}

async function run() {
  console.log('\n[tests] compiling useProfile + auth graph + query-client + stubs…');
  compile();
  globalThis.__DEV__ = false;
  // React 19's `act` refuses to wrap render work without this flag.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  stubMod = await load('scripts/test-stubs/supabase.js');
  profileApiMod = await load('src/features/profile/api.js');
  profileHookMod = await load('src/features/profile/hooks/useProfile.js');
  sessionStoreMod = await load('src/features/auth/use-session-store.js');
  settingsStoreMod = await load('src/stores/use-settings-store.js');
  queryClientMod = await load('src/lib/query-client.js');
  useProfile = profileHookMod.useProfile;

  console.log('\n[tests] profile hydrate\n');

  await test('hydration: the profile row currency hydrates useSettingsStore', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    assert.equal(settingsStoreMod.useSettingsStore.getState().currency, 'UYU');

    const renderer = await mountProbe();
    try {
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'EUR',
        'profile row currency hydrated the settings store',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('skip-equal: equal-currency hydrate + unchanged re-render never notify subscribers', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    // Pre-seed the store with the row currency BEFORE the hook mounts: the
    // hydrate effect still runs (dep undefined → 'EUR') but the skip-equal
    // guard sees equal values and must not call setCurrency, so a subscriber
    // counter stays at 0.
    settingsStoreMod.useSettingsStore.setState({ currency: 'EUR' });

    let notifications = 0;
    const unsubscribe = settingsStoreMod.useSettingsStore.subscribe(() => {
      notifications += 1;
    });
    try {
      // Settle on the COMPONENT having re-rendered with the row data (not on
      // the store, which is pre-seeded and would settle immediately): the
      // hydrate effect runs on that re-render, hits the skip-equal guard,
      // and must notify no subscribers.
      const renderer = await mountProbe(() => captured?.user?.currency === 'EUR');
      try {
        assert.equal(
          settingsStoreMod.useSettingsStore.getState().currency,
          'EUR',
          'store keeps the pre-seeded currency',
        );
        assert.equal(notifications, 0, 'equal-currency hydrate notified no subscribers');

        // Re-render with the same data: the effect key (the currency VALUE,
        // not the data object) is unchanged, so the effect neither re-runs
        // nor notifies.
        await act(async () => {
          renderer.update(probeElement());
          await tick();
        });
        assert.equal(notifications, 0, 'unchanged re-render notified no subscribers');
      } finally {
        await unmountProbe(renderer);
      }
    } finally {
      unsubscribe();
    }
  });

  console.log('\n[tests] profile currency write\n');

  await test('setCurrency success invalidates the user profile + budget keys, not another user', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const qc = queryClientMod.queryClient;
    // Seed BOTH budget keys (the hook only ever creates the profile query;
    // invalidateQueries can only flip existing entries) to prove the
    // invalidation stays user-scoped.
    qc.setQueryData(['budget', 'u1'], { monthly_budget: 900, currency: 'EUR' });
    qc.setQueryData(['budget', 'u2'], { monthly_budget: 0, currency: 'EUR' });
    const find = (key) => qc.getQueryCache().find({ queryKey: key });

    const renderer = await mountProbe();
    try {
      assert.ok(find(['profile', 'u1']), 'mount created the user profile query');

      await act(async () => {
        const result = await captured.setCurrency('USD');
        assert.equal(result.status, 'ok');
        // invalidateQueries dispatches SYNCHRONOUSLY; the profile refetch is
        // still in flight inside this act callback, so the invalidated flag
        // is observable before the refetch resets it.
        assert.equal(find(['profile', 'u1']).state.isInvalidated, true, 'profile key invalidated');
        assert.equal(find(['budget', 'u1']).state.isInvalidated, true, 'budget key invalidated');
        assert.equal(
          find(['budget', 'u2']).state.isInvalidated,
          false,
          'another user budget untouched',
        );
      });

      // act drained the microtasks: the invalidated profile query was
      // refetched (dataUpdateCount >= 2) and the write payload landed.
      assert.equal(
        find(['profile', 'u1']).state.dataUpdateCount >= 2,
        true,
        'invalidated profile query was refetched',
      );
      assert.deepEqual(
        stubMod.__getUpdated('profiles'),
        { currency: 'USD' },
        'the write carried exactly the currency column',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('setCurrency failure returns the user-safe error and invalidates nothing', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const qc = queryClientMod.queryClient;
    qc.setQueryData(['budget', 'u1'], { monthly_budget: 900, currency: 'EUR' });
    const find = (key) => qc.getQueryCache().find({ queryKey: key });

    const renderer = await mountProbe();
    try {
      stubMod.__failNextUpdate('profiles', { message: 'insert error' });

      await act(async () => {
        const result = await captured.setCurrency('USD');
        assert.equal(result.status, 'error');
        assert.equal(result.message, profileApiMod.WRITE_ERROR_MESSAGE);
      });

      assert.equal(find(['profile', 'u1']).state.isInvalidated, false, 'profile stays clean');
      assert.equal(find(['budget', 'u1']).state.isInvalidated, false, 'budget stays clean');
      assert.deepEqual(
        stubMod.__getUpdated('profiles'),
        { currency: 'USD' },
        'the update was still attempted with the currency column',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('convergence: post-write refetch re-hydrates the store to the persisted currency', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const renderer = await mountProbe();
    try {
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'EUR',
        'initial hydration from the mounted profile row',
      );

      // Arm the POST-WRITE refetch BEFORE the invalidation lands: the refetch
      // returns the persisted USD row, so the effect's dep flips EUR → USD
      // and the store converges on the persisted value (the documented
      // hydrate-and-converge path).
      stubMod.__setTableRead('profiles', {
        rows: [{ ...PROFILE_EUR, currency: 'USD' }],
      });

      await act(async () => {
        const result = await captured.setCurrency('USD');
        assert.equal(result.status, 'ok');
      });
      // The invalidated profile refetch completes on microtasks; its notify
      // lands on a later macrotask. Settle until the refetched USD row
      // re-hydrates the store (the documented hydrate-and-converge path).
      await settleUntil(storeHydratedTo('USD'), 'store converged on the persisted currency');

      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'USD',
        'store converged on the persisted currency after the refetch',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('no session: the write guard returns an error and touches no network', async () => {
    resetAll();
    // No session: both queries stay disabled and the redundant write guard
    // must fail before any I/O happens. No hydration is expected, so the
    // mount settles immediately.
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const renderer = await mountProbe(() => true);
    try {
      await act(async () => {
        const result = await captured.setCurrency('USD');
        assert.equal(result.status, 'error');
        assert.equal(result.message, profileApiMod.WRITE_ERROR_MESSAGE);
      });
      assert.equal(stubMod.__getCallLog().length, 0, 'no network call at all');
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'UYU',
        'store untouched without a session',
      );
    } finally {
      await unmountProbe(renderer);
    }
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
}
// react-query's gc timers keep the event loop alive after the summary prints
// (the same gotcha that hangs the aggregate `pnpm test`); exit explicitly.
process.exit(process.exitCode || 0);
