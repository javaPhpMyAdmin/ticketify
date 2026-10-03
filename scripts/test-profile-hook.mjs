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
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    } else if (request === 'expo-localization') {
      // The device-currency adapter is the sole getLocales() reader in the
      // sign-in path (precedent: test-i18n-init.mjs). Without this branch the
      // compiled use-session-store graph tries to load the real native module.
      request = join(outDir, 'scripts/test-stubs/expo-localization.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

const load = (rel) => import(pathToFileURL(join(outDir, rel)).href);

let stubMod;
let deviceCurrencyMod;
let localizationStubMod;
let profileApiMod;
let profileHookMod;
let profileSyncMod;
let sessionStoreMod;
let settingsStoreMod;
let formatMod;
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
    household_sharing: false,
    currencyHydrated: false,
  });
  formatMod.setCurrencySymbolGate(true);
  sessionStoreMod.useSessionStore.setState({ session: null });
  localizationStubMod.__setDeviceLocales([
    { languageTag: 'en-US', languageCode: 'en', regionCode: 'US', currencyCode: 'USD' },
  ]);
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
localizationStubMod = await load('scripts/test-stubs/expo-localization.js');
deviceCurrencyMod = await load('src/i18n/device-currency.js');
profileApiMod = await load('src/features/profile/api.js');
  profileHookMod = await load('src/features/profile/hooks/useProfile.js');
  profileSyncMod = await load('src/lib/auth/profile-sync.js');
  sessionStoreMod = await load('src/features/auth/use-session-store.js');
  settingsStoreMod = await load('src/stores/use-settings-store.js');
  formatMod = await load('src/lib/format.js');
  queryClientMod = await load('src/lib/query-client.js');
  useProfile = profileHookMod.useProfile;
  // Captured straight off the production store singleton right after import,
  // BEFORE any reset mutates it: this is the cold-boot seed a money screen
  // would read while the profile row is still in flight.
  const storeSeedAtImport = settingsStoreMod.useSettingsStore.getState().currency;

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

    // The invariant is scoped to the CURRENCY VALUE, not to "zero store
    // writes". The same effect also flips the hydration gate, which is a
    // legitimate one-time write; what must never happen is a write carrying a
    // currency that already matched. Recording the value on every
    // notification keeps the original pin honest instead of counting writes.
    const currencyWrites = [];
    const unsubscribe = settingsStoreMod.useSettingsStore.subscribe((s) => {
      currencyWrites.push(s.currency);
    });
    try {
      // Settle on the COMPONENT having re-rendered with the row data (not on
      // the store, which is pre-seeded and would settle immediately): the
      // hydrate effect runs on that re-render, hits the skip-equal guard,
      // and must not write the currency.
      const renderer = await mountProbe(() => captured?.user?.currency === 'EUR');
      try {
        assert.equal(
          settingsStoreMod.useSettingsStore.getState().currency,
          'EUR',
          'store keeps the pre-seeded currency',
        );
        assert.deepEqual(
          currencyWrites.filter((c) => c !== 'EUR'),
          [],
          'equal-currency hydrate never wrote a differing currency',
        );
        const writesAfterFirstLoad = currencyWrites.length;

        // Re-render with the same data: the effect key (the currency VALUE,
        // not the data object) is unchanged, so the effect neither re-runs
        // nor notifies.
        await act(async () => {
          renderer.update(probeElement());
          await tick();
        });
        assert.equal(
          currencyWrites.length,
          writesAfterFirstLoad,
          'unchanged re-render notified no subscribers',
        );
        assert.equal(
          settingsStoreMod.useSettingsStore.getState().currencyHydrated,
          true,
          'the gate did open on the good row',
        );
      } finally {
        await unmountProbe(renderer);
      }
    } finally {
      unsubscribe();
    }
  });

  console.log('\n[tests] currency hydration gate (fail-closed)\n');

  await test('a good profile load flips currencyHydrated to true', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    assert.equal(
      settingsStoreMod.useSettingsStore.getState().currencyHydrated,
      false,
      'the gate starts shut — the seed currency is not a known-truth value',
    );

    const renderer = await mountProbe(() => settingsStoreMod.useSettingsStore.getState().currencyHydrated);
    try {
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        true,
        'good profile data opened the gate',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('the gate stays SHUT while the profile read is in flight', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });
    // Park the profile read so the pending window is deterministic. Without
    // the hold this test is a microtask race — it passes only when the event
    // loop happens not to resolve the stub chain inside `act`, and reports a
    // spurious failure when it does. `__isTableReadHeld` is asserted so the
    // test cannot silently degrade into that race.
    stubMod.__holdTableRead('profiles');

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(probeElement());
    });
    try {
      assert.ok(stubMod.__isTableReadHeld('profiles'), 'the profile read is parked');
      assert.equal(captured?.user, null, 'no profile data has landed yet');
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        false,
        'pending is not "hydrated" — the answer is not known yet',
      );

      // Still shut after the microtask drain that `act` performs: an async
      // query function must not be able to open the gate by resolving early.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await tick();
        });
      }
      assert.equal(captured?.user, null, 'still no data while the read is parked');
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        false,
        'the gate stayed shut for the whole pending window',
      );

      // Release: the row lands and the gate opens.
      stubMod.__releaseTableRead('profiles');
      await settleUntil(
        () => settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        'the released read opened the gate',
      );
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'EUR',
        'the released row hydrated the currency too',
      );
    } finally {
      stubMod.__releaseTableRead('profiles');
      await unmountProbe(renderer);
    }
  });

  await test('a FAILED profile read leaves the gate shut (fails closed, never open on error)', async () => {
    resetAll();
    signIn();
    // `rows: []` is the definitive `missing-profile` read: `shouldRetry`
    // returns false for it, so the error surfaces on the first attempt
    // instead of after two exponential-backoff retries. A RETRYING read is
    // pinned separately below.
    stubMod.__setTableRead('profiles', { rows: [] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const renderer = await mountProbe(() => captured?.error != null);
    try {
      assert.ok(captured.error, 'the read surfaced an error to the hook');
      assert.equal(captured.user, null, 'no profile data');
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        false,
        'an error must never open the symbol gate — the user would see the SEED currency symbol',
      );
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'UYU',
        'the seed currency is left untouched for the UI to handle',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('a RETRYING transient read keeps the gate shut across its attempts', async () => {
    resetAll();
    signIn();
    // A raw transport error is NOT a FeatureQueryError, so `shouldRetry`
    // falls through to `failureCount < 2`: the query stays in flight through
    // two exponential-backoff retries. That whole window is real user time
    // with money on screen, so the gate must be shut for all of it — which
    // is exactly why this test settles nothing and only ticks.
    stubMod.__setTableRead('profiles', {
      error: { message: 'network request failed' },
    });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(probeElement());
    });
    try {
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          await tick();
        });
        assert.equal(
          settingsStoreMod.useSettingsStore.getState().currencyHydrated,
          false,
          `gate opened during a retrying read (attempt ${i + 1})`,
        );
      }
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('a retry after a failed read opens the gate once the row lands', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const renderer = await mountProbe(() => captured?.error != null);
    try {
      assert.equal(settingsStoreMod.useSettingsStore.getState().currencyHydrated, false);

      // Recovery: invalidate the failed query so it refetches. The gate must
      // open — a fail-closed gate that never reopens would strip every
      // currency symbol from the app for the rest of the session.
      stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
      await act(async () => {
        await queryClientMod.queryClient.invalidateQueries({
          queryKey: ['profile', 'u1'],
        });
      });
      await settleUntil(
        () => settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        'the recovered read opened the gate',
      );
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currency,
        'EUR',
        'the recovered row hydrated the currency',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('no session: the gate never opens and no profile query runs', async () => {
    resetAll();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const renderer = await mountProbe(() => captured?.user === null);
    try {
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await tick();
        });
      }
      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        false,
        'a disabled query is never "good data"',
      );
      assert.equal(
        stubMod.__getCallLog().filter((c) => c.table === 'profiles').length,
        0,
        'the profile table was never queried',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('the store DECLARES the gate shut (fail-closed at boot)', () => {
    // Behavioral tests cannot catch this one: every test calls resetAll(),
    // which overwrites the initial value, so flipping the literal in the store
    // to `true` changes nothing they observe — and that is exactly the
    // regression, because it makes every real cold start fail OPEN before a
    // single component mounts. The declared initializer is the contract.
    const src = readFileSync(
      join(root, 'src/stores/use-settings-store.ts'),
      'utf8',
    );
    assert.match(
      src,
      /currencyHydrated:\s*false,/,
      'useSettingsStore must declare currencyHydrated: false — a true literal fails open on every cold start',
    );
    // The seed currency and the gate must not drift apart in the other
    // direction either: a store that shipped `currencyHydrated: false` with a
    // gate-less formatter is the other half of the same bug.
    assert.match(formatMod.isCurrencySymbolGateOpen.toString(), /currencySymbolGateOpen/);
  });

  await test('markCurrencyHydrated is idempotent — a repeat call notifies nobody', async () => {
    resetAll();
    const store = settingsStoreMod.useSettingsStore;
    assert.equal(store.getState().currencyHydrated, false);

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    try {
      await act(async () => {
        store.getState().markCurrencyHydrated();
      });
      assert.equal(notifications, 1, 'the first mark notified once');
      assert.equal(store.getState().currencyHydrated, true);

      await act(async () => {
        store.getState().markCurrencyHydrated();
        store.getState().markCurrencyHydrated();
      });
      assert.equal(
        notifications,
        1,
        're-marking an already-open gate is a no-op — every money screen re-renders for nothing',
      );
    } finally {
      unsubscribe();
    }
  });

  await test('resetHydration re-closes the gate (session teardown path)', async () => {
    resetAll();
    const store = settingsStoreMod.useSettingsStore;
    await act(async () => {
      store.getState().markCurrencyHydrated();
    });
    assert.equal(store.getState().currencyHydrated, true);

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    try {
      await act(async () => {
        store.getState().resetHydration();
      });
      assert.equal(store.getState().currencyHydrated, false, 'the gate is shut again');
      assert.equal(notifications, 1, 'the close notified subscribers once');

      await act(async () => {
        store.getState().resetHydration();
      });
      assert.equal(notifications, 1, 'resetting an already-shut gate is a no-op');
    } finally {
      unsubscribe();
    }
  });

  await test('the SIGNED_OUT listener re-closes the gate (no leak into the next user)', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const renderer = await mountProbe(() => settingsStoreMod.useSettingsStore.getState().currencyHydrated);
    try {
      assert.equal(settingsStoreMod.useSettingsStore.getState().currencyHydrated, true);

      // Fire the real auth listener rather than the store action: the
      // sign-out PATH that matters for a token expiry / bootstrap discard is
      // the listener, and it runs when no screen is mounted to tear anything
      // down.
      await act(async () => {
        await sessionStoreMod.useSessionStore.getState().restore().catch(() => {});
      });
      const listener = stubMod.__getLastAuthStateListener();
      await act(async () => {
        listener('SIGNED_OUT', null);
      });

      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        false,
        'the next session must not inherit this user\'s confirmed currency',
      );
      assert.equal(sessionStoreMod.useSessionStore.getState().session, null);
    } finally {
      await unmountProbe(renderer);
    }
  });

  console.log('\n[tests] currency symbol gate (lib/format)\n');

  await test('the formatter gate withholds the whole UNIT CONVENTION, not just the symbol', async () => {
    formatMod.setCurrencySymbolGate(true);
    assert.equal(formatMod.formatCurrency(1234.5, 'USD'), 'US$ 1,234.50');
    assert.equal(formatMod.formatCurrency(1234.5, 'UYU'), '$U 1.234,50');

    formatMod.setCurrencySymbolGate(false);
    // Grouping is keyed BY CURRENCY CODE, and until the profile row lands the
    // code is only the store's seed — so a shut gate that still grouped would
    // print the seed's conventions over a real balance. `$U`-less but still
    // `1.234,50` is not a neutral placeholder either: it is an INTL seed
    // reading at a LATAM user, off by 1000x. Both codes collapse to the same
    // bare number instead.
    assert.equal(
      formatMod.formatCurrency(1234567.89, 'USD'),
      '1234567.89',
      'the bare INTL-seeded amount: no unit, no thousands separator',
    );
    assert.equal(
      formatMod.formatCurrency(1234567.89, 'UYU'),
      '1234567.89',
      'the bare LATAM-seeded amount: identical, so no convention is claimed',
    );
  });

  await test('the store flag drives the module gate shut until hydration lands', async () => {
    // The end-to-end shape of the F1 fix: the flag the screens read and the
    // module-level gate the formatters read are the same fact, so flipping the
    // store flag must be enough to change what a money screen renders — with
    // no separator left over on either side of the transition.
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const store = settingsStoreMod.useSettingsStore;
    const renderAsScreensWould = (code) => formatMod.formatCurrency(1234567.89, code);

    assert.equal(store.getState().currencyHydrated, false);
    assert.equal(store.getState().currency, 'UYU', 'pre-hydration the store still holds the seed');
    formatMod.setCurrencySymbolGate(false);
    assert.equal(renderAsScreensWould(store.getState().currency), '1234567.89');

    const renderer = await mountProbe(() => store.getState().currencyHydrated);
    try {
      assert.equal(store.getState().currencyHydrated, true, 'the profile row landed');
      assert.equal(store.getState().currency, 'EUR');
      formatMod.setCurrencySymbolGate(store.getState().currencyHydrated);
      assert.equal(
        renderAsScreensWould(store.getState().currency),
        '€ 1,234,567.89',
        'after hydration the real currency renders with BOTH its symbol and its separators',
      );
      assert.equal(
        renderAsScreensWould('UYU'),
        '$U 1.234.567,89',
        'the LATAM family gets LATAM separators back, not the seed\'s INTL ones',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('a shut gate on a negative value leaves no dangling separator', async () => {
    formatMod.setCurrencySymbolGate(true);
    assert.equal(formatMod.formatCurrency(-1234.56, 'USD'), '-US$ 1,234.56');

    formatMod.setCurrencySymbolGate(false);
    assert.equal(
      formatMod.formatCurrency(-1234.56, 'USD'),
      '-1234.56',
      'the sign must sit against the number, not against a missing symbol',
    );
    assert.doesNotMatch(
      formatMod.formatCurrency(-1234.56, 'USD'),
      /^\-\s|-\s+$/,
      'no space where the symbol used to be',
    );
  });

  await test('a shut gate withholds the unknown-code fallback too', async () => {
    formatMod.setCurrencySymbolGate(true);
    assert.equal(
      formatMod.formatCurrency(1234567.89, 'XYZ'),
      'XYZ 1,234,567.89',
      'an unknown code renders as itself while open',
    );

    formatMod.setCurrencySymbolGate(false);
    assert.equal(
      formatMod.formatCurrency(1234567.89, 'XYZ'),
      '1234567.89',
      'the code is not a currency either — withholding it is the whole point',
    );
  });

  await test('formatCurrencyWhole honors the gate as well', async () => {
    formatMod.setCurrencySymbolGate(true);
    assert.equal(formatMod.formatCurrencyWhole(812.24, 'UYU'), '$U 812');
    assert.equal(formatMod.formatCurrencyWhole(1234567.89, 'UYU'), '$U 1.234.568');

    formatMod.setCurrencySymbolGate(false);
    assert.equal(
      formatMod.formatCurrencyWhole(812.24, 'UYU'),
      '812',
      'the whole-number form withholds the symbol as well',
    );
    assert.equal(
      formatMod.formatCurrencyWhole(1234567.89, 'UYU'),
      '1234568',
      'and the grouping — 812 has nothing to group and could not catch a revert',
    );
  });

  await test('a post-write refetch keeps the gate OPEN (hydrate-and-converge regression)', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });
    stubMod.__setDeleteRead('profiles', [{ id: 'u1' }]);

    const renderer = await mountProbe(() => settingsStoreMod.useSettingsStore.getState().currencyHydrated);
    try {
      stubMod.__setTableRead('profiles', {
        rows: [{ ...PROFILE_EUR, currency: 'USD' }],
      });
      await act(async () => {
        assert.equal((await captured.setCurrency('USD')).status, 'ok');
      });
      await settleUntil(storeHydratedTo('USD'), 'store converged on USD');

      assert.equal(
        settingsStoreMod.useSettingsStore.getState().currencyHydrated,
        true,
        'the currency VALUE flipping must not be mistaken for a re-hydration that re-closes the gate',
      );
    } finally {
      await unmountProbe(renderer);
    }
  });

  console.log('\n[tests] profile currency write\n');

  await test('setCurrency success invalidates the user profile + budget keys, not another user', async () => {
    resetAll();
    signIn();
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });
    // The write is verified through `.select('id')` (fail-closed 0-row
    // check), so arm the updated-row representation.
    stubMod.__setDeleteRead('profiles', [{ id: 'u1' }]);

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
    // The write is verified through `.select('id')` (fail-closed 0-row
    // check), so arm the updated-row representation.
    stubMod.__setDeleteRead('profiles', [{ id: 'u1' }]);

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

  console.log('\n[tests] ensureProfileCurrency: create-only region seed\n');

  await test('the settings store seeds USD, not the legacy UYU', () => {
    assert.equal(
      storeSeedAtImport,
      'USD',
      'REQ-4.1 / NFR-7: USD is the single universal default the store seeds before hydration',
    );
  });

  await test('detectDeviceDefaultCurrency derives MXN from an es-MX device', () => {
    resetAll();
    localizationStubMod.__setDeviceLocales([
      { languageTag: 'es-MX', languageCode: 'es', regionCode: 'MX', currencyCode: null },
    ]);
    assert.equal(deviceCurrencyMod.detectDeviceDefaultCurrency(), 'MXN');
  });

  await test('detectDeviceDefaultCurrency derives USD from an en-US device', () => {
    resetAll();
    localizationStubMod.__setDeviceLocales([
      { languageTag: 'en-US', languageCode: 'en', regionCode: 'US', currencyCode: 'USD' },
    ]);
    assert.equal(deviceCurrencyMod.detectDeviceDefaultCurrency(), 'USD');
  });

  await test('detectDeviceDefaultCurrency falls back to USD when the region is unmapped', () => {
    resetAll();
    localizationStubMod.__setDeviceLocales([
      { languageTag: 'sv-SE', languageCode: 'sv', regionCode: 'SE', currencyCode: null },
    ]);
    assert.equal(
      deviceCurrencyMod.detectDeviceDefaultCurrency(),
      'USD',
      'REQ-5.3: an unmapped device region seeds the universal default, never null',
    );
  });

  await test('detectDeviceDefaultCurrency survives a throwing getLocales()', () => {
    resetAll();
    localizationStubMod.__setDeviceLocalesThrow(true);
    try {
      assert.equal(
        deviceCurrencyMod.detectDeviceDefaultCurrency(),
        'USD',
        'a native-bridge failure must degrade to the universal default, not crash sign-in',
      );
    } finally {
      localizationStubMod.__setDeviceLocalesThrow(false);
    }
  });

  await test('the SIGNED_IN chain seeds BEFORE the identity upsert', async () => {
    resetAll();
    localizationStubMod.__setDeviceLocales([
      { languageTag: 'es-MX', languageCode: 'es', regionCode: 'MX', currencyCode: null },
    ]);
    stubMod.__setTableRead('profiles', { rows: [PROFILE_EUR] });
    stubMod.__setTableRead('scan_usage', { rows: [SCAN_USAGE_ROW] });

    const listener = stubMod.__getLastAuthStateListener();
    await act(async () => {
      listener('SIGNED_IN', FAKE_SESSION);
    });

    const writes = stubMod
      .__getCallLog()
      .filter((e) => e.kind === 'insert' || e.kind === 'upsert')
      .map((e) => e.kind);
    assert.deepEqual(
      writes,
      ['insert', 'upsert'],
      'the seed must precede the upsert, or the upsert creates the row first and the seed can never fire',
    );
    assert.deepEqual(
      stubMod.__getInserted('profiles'),
      [{ id: 'u1', currency: 'MXN' }],
      'REQ-5.2: a first sign-in on an MX device creates the row with MXN',
    );
  });

  await test('the restore chain seeds BEFORE the identity upsert', async () => {
    resetAll();
    localizationStubMod.__setDeviceLocales([
      { languageTag: 'es-MX', languageCode: 'es', regionCode: 'MX', currencyCode: null },
    ]);
    stubMod.__setSupabaseBehavior({
      getSession: async () => ({ data: { session: FAKE_SESSION }, error: null }),
    });

    await act(async () => {
      await sessionStoreMod.useSessionStore.getState().restore();
    });

    const writes = stubMod
      .__getCallLog()
      .filter((e) => e.kind === 'insert' || e.kind === 'upsert')
      .map((e) => e.kind);
    assert.deepEqual(
      writes,
      ['insert', 'upsert'],
      'the bootstrap restore seeds first too — both call sites must carry the seed',
    );
    assert.deepEqual(
      stubMod.__getInserted('profiles'),
      [{ id: 'u1', currency: 'MXN' }],
      'the restored session seeds the same region-derived code',
    );
  });

  await test('region seed is a plain INSERT of (id, currency) — never an upsert', async () => {
    resetAll();
    await profileSyncMod.ensureProfileCurrency('u1', 'MXN');

    const log = stubMod.__getCallLog();
    assert.deepEqual(
      log.filter((e) => e.kind === 'upsert'),
      [],
      'the seed must NEVER upsert: an upsert would overwrite a chosen currency on every sign-in',
    );
    assert.deepEqual(
      log.filter((e) => e.kind === 'insert' && e.table === 'profiles'),
      [{ kind: 'insert', table: 'profiles' }],
      'the seed must be exactly one plain INSERT into profiles',
    );
    assert.deepEqual(
      stubMod.__getInserted('profiles'),
      [{ id: 'u1', currency: 'MXN' }],
      'the insert payload carries the profile id and the region-derived code',
    );
  });

  await test('an existing row (23505) is swallowed and produces zero further writes', async () => {
    resetAll();
    // Postgres rejects the seed INSERT with a unique violation once the row
    // exists. The call must resolve (never reject) and write nothing.
    stubMod.__failNextInsert('profiles', {
      message: 'duplicate key value violates unique constraint "profiles_pkey"',
      code: '23505',
    });
    await profileSyncMod.ensureProfileCurrency('u1', 'UYU');

    const log = stubMod.__getCallLog();
    assert.deepEqual(
      log.filter((e) => e.kind === 'insert'),
      [{ kind: 'insert', table: 'profiles' }],
      'only the seed insert itself is attempted',
    );
    assert.deepEqual(
      log.filter((e) => e.kind === 'upsert' || e.kind === 'update'),
      [],
      'a rejected seed must fall back to no write at all (the existing row survives)',
    );
  });

  await test('the seed writes canonical uppercase even from a lowercase code', async () => {
    resetAll();
    await profileSyncMod.ensureProfileCurrency('u1', 'mxn');
    assert.deepEqual(
      stubMod.__getInserted('profiles'),
      [{ id: 'u1', currency: 'MXN' }],
      'NFR-1: every code the app writes is uppercase ISO 4217',
    );
  });

  await test('the identity backfill stays a single upsert — no currency insert', async () => {
    resetAll();
    await profileSyncMod.ensureProfile(FAKE_SESSION.user);
    const log = stubMod.__getCallLog();
    assert.deepEqual(
      log.filter((e) => e.kind === 'upsert'),
      [{ kind: 'upsert', table: 'profiles' }],
      'ensureProfile remains one upsert on profiles',
    );
    assert.deepEqual(
      log.filter((e) => e.kind === 'insert'),
      [],
      'ensureProfile must not seed currency — the seed write is structurally separate',
    );
  });

  console.log(`\n[tests] registered ${passed + failed} pins`);
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
