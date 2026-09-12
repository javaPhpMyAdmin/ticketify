#!/usr/bin/env node
/**
 * Node harness for the household category drill-down contract.
 *
 * Compiles the REAL production modules (feature-access.ts for
 * `readHouseholdCategoryItems`, useHomeFeed.ts for the pure
 * `aggregateHouseholdCategoryItems` + the `useCategoryDetail` hook, and
 * categoryHref.ts for the scope-parameterized href) plus their dependency
 * graph into a temp directory with an isolated tsconfig that remaps the
 * native/backend imports to the hand-written test doubles (react-native,
 * supabase, storage-adapter, components), then asserts the contract:
 *
 *   - `aggregateHouseholdCategoryItems` groups raw RPC rows by normalized
 *     name (accents fold: "Menú" + "menu" collapse; case + trim), sums
 *     amounts AND quantities, sorts by amount desc, treats a missing
 *     quantity as 1 per row (the `quantity ?? 1` fallback) and preserves
 *     FRACTIONAL quantities (2.5 kg must never truncate — the RPC returns
 *     numeric, no integer coercion),
 *   - empty rows → `[]`,
 *   - `readHouseholdCategoryItems` calls
 *     `rpc('get_household_category_items', { p_household_id, p_year_month,
 *     p_category_slug })` and maps rows to `HouseholdCategoryItem` (ok
 *     data, empty month → ok [], error → user-safe message, fractional
 *     quantity survives the mapping),
 *   - `categoryDetailHref` 4-arg household scope variants and its 3-arg /
 *     4-arg-personal byte-identical output (backward compatibility),
 *   - the `useCategoryDetail` household branch (react-test-renderer):
 *     exact query key shape, RPC params, loading/error/ready/empty states,
 *     disabled-without-household (no fetch), retry recovery, and personal
 *     scope leaving the household query disabled.
 *
 * Hook mechanics mirror scripts/test-profile-hook.mjs: render through
 * react-test-renderer; `act` needs the global IS_REACT_ACT_ENVIRONMENT
 * flag; query observers notify React's onStoreChange through setTimeout(0)
 * (a macrotask), so async transitions `settleUntil` act-ticks. The probe
 * REUSES the compiled `@/lib/query-client` singleton and clears its cache
 * per test. The singleton's retry gate (`shouldRetry`) is pinned by the
 * query-adapters suite in test-features.mjs, so this harness disables
 * retries on the shared client (`setDefaultOptions`) — without that, a
 * failed fetch would wait out v5's exponential retry delays before the
 * error state is observable.
 *
 * Deterministic: no clock, no Intl, fixed fixture inputs.
 *
 * Usage: pnpm test:household-category-items
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
const harnessConfig = join(__dirname, 'tsconfig.household-category-items-test.json');

// The compiled modules load @tanstack/react-query through CJS `require`, and
// the package ships separate ESM/CJS builds. Get the provider through the
// SAME CJS build so a single QueryClientProvider instance is in play.
const { QueryClientProvider } = require('@tanstack/react-query');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'household-category-items-test-'));
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

/**
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `@/…` (or the native-bound modules) in the compiled CommonJS
 * output. The hook rewrites exactly those specifiers to their compiled
 * locations and passes everything else (zustand, react-query, …) through
 * untouched.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'react-native') {
      // query-client.ts (imported by the auth store) touches AppState +
      // Platform.OS; the real package cannot load in plain node.
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request === '@/components') {
      // The drill-down SCREEN imports the atoms at RUNTIME (Text/View/Icon/
      // Divider/EmptyState); the stub renders host elements with children
      // pass-through so react-test-renderer can assert the visible tree.
      request = join(outDir, 'scripts', 'test-stubs', 'components.js');
    } else if (request === '@/features/home') {
      // Barrel alias: the REAL barrel re-exports feature components
      // (ScanQuotaCard…) that cannot load in plain node. The alias
      // re-exports the real hook + monthKeyToLabel from the SAME compiled
      // module instance the harness already loads.
      request = join(outDir, 'scripts', 'test-stubs', 'features-home.js');
    } else if (request === 'expo-router') {
      request = join(outDir, 'scripts', 'test-stubs', 'expo-router.js');
    } else if (request === 'react-native-safe-area-context') {
      request = join(outDir, 'scripts', 'test-stubs', 'safe-area-context.js');
    } else if (request === 'react-i18next') {
      // PR 3 (`app-i18n`): the screen now uses `useTranslation`. Without
      // an i18next runtime in this harness, `t()` would return its key
      // and the literal-string assertions would break. Route to the stub
      // that maps the keys the screen uses back to their es-AR values.
      request = join(outDir, 'scripts', 'test-stubs', 'react-i18next.js');
    } else if (request === 'expo-localization' || request === 'expo-secure-store') {
      // The drill-down screen reads the active locale from
      // `useLocaleStore`, whose detection/storage chain imports the
      // native-bound `expo-localization` + `expo-secure-store` — neither
      // can load in plain node. Route both to the shared stubs (Node
      // strips the erasable TS on require, mirroring test:i18n-init).
      request = join(__dirname, 'test-stubs', request === 'expo-localization' ? 'expo-localization.ts' : 'expo-secure-store.ts');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

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

// Two rows that collapse into one aggregated item (name normalization) —
// the ready/error fixtures for the hook tests.
const ROWS = [
  {
    id: 'i1',
    name: 'Menú',
    amount: 120,
    quantity: 2,
    purchase_date: '2026-08-03',
    store_name: 'Buen Sabor',
    member_name: 'Ana',
  },
  {
    id: 'i2',
    name: 'menu',
    amount: 60,
    quantity: 1,
    purchase_date: '2026-08-05',
    store_name: 'Casa',
    member_name: 'Bob',
  },
];

const READ_ERROR_MESSAGE = 'No se pudieron cargar los datos. Inténtalo de nuevo.';

let captured = null;
// The args the Probe passes to useCategoryDetail (per-test configurable).
let probeArgs = ['carnes', '2026-08', 'household'];

function Probe() {
  captured = useCategoryDetail(...probeArgs);
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

async function mountProbe() {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(probeElement());
  });
  return renderer;
}

async function unmountProbe(renderer) {
  await act(async () => {
    renderer.unmount();
  });
}

let homeMod;
let featureMod;
let stubMod;
let queryClientMod;
let sessionStoreMod;
let householdStoreMod;
let queryKeysMod;
let hrefMod;
let useCategoryDetail;

async function run() {
  console.log('\n[tests] compiling household-category-items modules…');
  await compile();
  // The app reads React Native's `__DEV__` global for dev-only behavior
  // (e.g. the home-feed dev error log); plain node has none. Declared for
  // tsc via test-stubs/globals.d.ts; defined here so the compiled modules
  // behave like a Release build. React 19's `act` also refuses to wrap
  // render work without its environment flag.
  globalThis.__DEV__ = false;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  homeMod = await load('src/features/home/hooks/useHomeFeed.js');
  featureMod = await load('src/lib/supabase/feature-access.js');
  stubMod = await load('scripts/test-stubs/supabase.js');
  queryClientMod = await load('src/lib/query-client.js');
  sessionStoreMod = await load('src/features/auth/use-session-store.js');
  householdStoreMod = await load('src/stores/use-household-store.js');
  queryKeysMod = await load('src/lib/query-keys.js');
  hrefMod = await load('src/features/charts/categoryHref.js');
  useCategoryDetail = homeMod.useCategoryDetail;

  // v5's default retry would wait out exponential delays before the error
  // state surfaces; the retry GATE itself is pinned by the query-adapters
  // suite. Disable retries on the shared singleton so every state settles
  // deterministically and fast.
  queryClientMod.queryClient.setDefaultOptions({ queries: { retry: false } });

  console.log('\n[tests] aggregateHouseholdCategoryItems\n');

  await test('groups by normalized name: "Menú" + "menu" collapse', () => {
    const rows = [
      { name: 'Menú', amount: 100, quantity: 2 },
      { name: 'menu', amount: 50, quantity: 1 },
      { name: '  Menu  ', amount: 25, quantity: 1 },
    ];
    const out = homeMod.aggregateHouseholdCategoryItems(rows);
    assert.deepEqual(out, [{ name: 'menu', amount: 175, quantity: 4 }]);
  });

  await test('sums amounts and quantities across members (case + trim fold)', () => {
    const rows = [
      { name: 'Yerba 1kg', amount: 1000, quantity: 1 },
      { name: 'yerba 1kg', amount: 1400, quantity: 2 },
      { name: 'YERBA   1kg', amount: 500, quantity: 1 },
    ];
    const out = homeMod.aggregateHouseholdCategoryItems(rows);
    assert.deepEqual(out, [{ name: 'yerba', amount: 2900, quantity: 4 }]);
  });

  await test('sorts by amount desc', () => {
    const rows = [
      { name: 'A', amount: 10 },
      { name: 'B', amount: 500 },
      { name: 'C', amount: 100 },
    ];
    const out = homeMod.aggregateHouseholdCategoryItems(rows);
    assert.deepEqual(
      out.map((r) => r.name),
      ['b', 'c', 'a'],
    );
    assert.deepEqual(
      out.map((r) => r.amount),
      [500, 100, 10],
    );
  });

  await test('missing quantity counts as 1 per row (quantity ?? 1 fallback)', () => {
    const rows = [{ name: 'Pan', amount: 30 }, { name: 'pan', amount: 20 }];
    const out = homeMod.aggregateHouseholdCategoryItems(rows);
    assert.deepEqual(out, [{ name: 'pan', amount: 50, quantity: 2 }]);
  });

  await test('empty rows → []', () => {
    const out = homeMod.aggregateHouseholdCategoryItems([]);
    assert.deepEqual(out, []);
  });

  await test('a single row with no duplicate keeps quantity', () => {
    const out = homeMod.aggregateHouseholdCategoryItems([
      { name: 'Agua', amount: 40, quantity: 6 },
    ]);
    assert.deepEqual(out, [{ name: 'agua', amount: 40, quantity: 6 }]);
  });

  await test('preserves fractional quantities (2.5 kg does not truncate)', () => {
    const rows = [{ name: 'Yerba', amount: 2500, quantity: 2.5 }];
    const out = homeMod.aggregateHouseholdCategoryItems(rows);
    assert.deepEqual(out, [{ name: 'yerba', amount: 2500, quantity: 2.5 }]);
  });

  await test('sums fractional quantities across rows (2.5 + 0.5 = 3)', () => {
    const rows = [
      { name: 'Pan', amount: 100, quantity: 2.5 },
      { name: 'pan', amount: 50, quantity: 0.5 },
    ];
    const out = homeMod.aggregateHouseholdCategoryItems(rows);
    assert.deepEqual(out, [{ name: 'pan', amount: 150, quantity: 3 }]);
  });

  console.log('\n[tests] readHouseholdCategoryItems\n');

  await test('calls get_household_category_items RPC and maps rows', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setRpcResult('get_household_category_items', { rows: ROWS });
    const res = await featureMod.readHouseholdCategoryItems('h1', '2026-08', 'carnes');
    assert.equal(res.status, 'ok');
    assert.equal(res.data.length, 2);
    assert.equal(res.data[0].name, 'Menú');
    assert.equal(res.data[0].quantity, 2);
    assert.equal(res.data[1].member_name, 'Bob');
    const last = stubMod.__lastRpcCall();
    assert.equal(last.fn, 'get_household_category_items');
    assert.deepEqual(last.params, {
      p_household_id: 'h1',
      p_year_month: '2026-08',
      p_category_slug: 'carnes',
    });
  });

  await test('RPC rows map quantity through as-is (fractional survives)', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setRpcResult('get_household_category_items', {
      rows: [
        {
          id: 'i1',
          name: 'Yerba',
          amount: 2500,
          quantity: 2.5,
          purchase_date: '2026-08-03',
          store_name: null,
          member_name: null,
        },
      ],
    });
    const res = await featureMod.readHouseholdCategoryItems('h1', '2026-08', 'otros');
    assert.equal(res.status, 'ok');
    assert.equal(res.data[0].quantity, 2.5);
  });

  await test('omits p_year_month and uses default p_category_slug when not given', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setRpcResult('get_household_category_items', { rows: [] });
    const res = await featureMod.readHouseholdCategoryItems('h1');
    assert.equal(res.status, 'ok');
    assert.deepEqual(res.data, []);
    const last = stubMod.__lastRpcCall();
    assert.equal(last.fn, 'get_household_category_items');
    // `readHouseholdCategoryItems` only sets params that are provided, so a
    // yearMonth/categorySlug not given resolve to the RPC defaults anyway via
    // PostgREST argument defaults.
    assert.deepEqual(last.params, { p_household_id: 'h1' });
  });

  await test('empty month resolves ok [] (no spend is a valid month)', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setRpcResult('get_household_category_items', { rows: [] });
    const res = await featureMod.readHouseholdCategoryItems('h1', '2026-08', 'otros');
    assert.equal(res.status, 'ok');
    assert.deepEqual(res.data, []);
  });

  await test('RPC error → user-safe message', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setRpcResult('get_household_category_items', {
      error: { message: 'boom', code: 'P0001' },
    });
    const res = await featureMod.readHouseholdCategoryItems('h1', '2026-08', 'otros');
    assert.equal(res.status, 'error');
    assert.equal(res.message, READ_ERROR_MESSAGE);
  });

  await test('unconfigured → unconfigured', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setSupabaseConfigInputs(
      'https://YOUR-PROJECT.supabase.co',
      'YOUR-ANON-KEY',
    );
    const res = await featureMod.readHouseholdCategoryItems('h1', '2026-08', 'otros');
    assert.equal(res.status, 'unconfigured');
    stubMod.__setSupabaseConfigInputs('https://real-project.supabase.co', 'real-anon-key');
  });

  console.log('\n[tests] categoryDetailHref\n');

  await test('current month + household → /categories/slug?scope=household', () => {
    assert.equal(
      hrefMod.categoryDetailHref('carnes', '2026-08', '2026-08', 'household'),
      '/categories/carnes?scope=household',
    );
  });

  await test('past month + household → /categories/slug?month=…&scope=household', () => {
    assert.equal(
      hrefMod.categoryDetailHref('carnes', '2026-07', '2026-08', 'household'),
      '/categories/carnes?month=2026-07&scope=household',
    );
  });

  await test('3-arg current month → /categories/slug (byte-identical, personal default)', () => {
    assert.equal(
      hrefMod.categoryDetailHref('carnes', '2026-08', '2026-08'),
      '/categories/carnes',
    );
  });

  await test('3-arg past month → /categories/slug?month=… (byte-identical, personal default)', () => {
    assert.equal(
      hrefMod.categoryDetailHref('carnes', '2026-07', '2026-08'),
      '/categories/carnes?month=2026-07',
    );
  });

  await test('4-arg personal === 3-arg (backward compatible)', () => {
    const args = ['carnes', '2026-07', '2026-08'];
    assert.equal(
      hrefMod.categoryDetailHref(...args, 'personal'),
      hrefMod.categoryDetailHref(...args),
    );
  });

  console.log('\n[tests] useCategoryDetail (household branch)\n');

  const expectCacheKey = (key) => {
    const cacheKeys = queryClientMod.queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    assert.ok(
      cacheKeys.some((k) => JSON.stringify(k) === JSON.stringify(key)),
      `query cache contains ${JSON.stringify(key)}`,
    );
  };

  const readHouseholdQuery = () =>
    queryClientMod.queryClient.getQueryCache().find({ queryKey: probeCacheKey() });

  const probeCacheKey = () =>
    queryKeysMod.queryKeys.householdCategoryItems(
      // Mirrors the hook's `?? ''` sentinel: a null/undefined household id
      // resolves to the SAME plain-string key the query is registered under.
      householdStoreMod.useHouseholdStore.getState().household?.id ?? '',
      probeArgs[1],
      probeArgs[0],
    );

  const resetAll = () => {
    stubMod.__resetSupabaseBehavior();
    queryClientMod.queryClient.getQueryCache().clear();
    sessionStoreMod.useSessionStore.setState({ session: null });
    householdStoreMod.useHouseholdStore.setState({ household: null });
    captured = null;
  };

  const signIn = () => {
    sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
  };

  const setHousehold = (id) => {
    // Runtime-only shape (zustand state is untyped at this boundary; the
    // hook only reads `household?.id`).
    householdStoreMod.useHouseholdStore.setState({ household: { id } });
  };

  await test('ready: aggregates rows, pins query key + RPC params', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    stubMod.__setRpcResult('get_household_category_items', { rows: ROWS });
    const renderer = await mountProbe();
    try {
      await settleUntil(
        () => captured.items.length === 1,
        'household rows aggregated',
      );
      assert.equal(captured.isLoading, false);
      assert.equal(captured.isError, false);
      assert.equal(captured.errorMessage, '');
      assert.deepEqual(captured.items, [{ name: 'menu', amount: 180, quantity: 3 }]);
      assert.equal(captured.total, 180);
      assert.equal(typeof captured.retry, 'function');
      // Exact query key shape (factory + literal) — the contract the screen
      // and the cache invalidation rely on.
      const expectedKey = queryKeysMod.queryKeys.householdCategoryItems(
        'h1',
        '2026-08',
        'carnes',
      );
      assert.deepEqual(
        [...expectedKey],
        ['household', 'h1', 'category-items', '2026-08', 'carnes'],
      );
      expectCacheKey(expectedKey);
      const last = stubMod.__lastRpcCall();
      assert.equal(last.fn, 'get_household_category_items');
      assert.deepEqual(last.params, {
        p_household_id: 'h1',
        p_year_month: '2026-08',
        p_category_slug: 'carnes',
      });
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('loading: isLoading true while the first fetch is in flight', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    // Deferred RPC: the fetch CANNOT complete until the harness opens the
    // gate below. Observing the transient unconditionally is racy — the
    // observer notify can land inside the mount act, so the pending state
    // flickers away. With the gate closed, no notify can fire: the pending
    // observation is deterministic.
    let openFetch;
    const gate = new Promise((resolve) => {
      openFetch = resolve;
    });
    stubMod.__setSupabaseBehavior({
      rpc: () => ({
        then: (onFulfilled) =>
          gate.then(() => onFulfilled({ data: ROWS, error: null })),
      }),
    });
    const renderer = await mountProbe();
    try {
      // Fetch in flight and un-resolvable: isLoading true — the screen
      // would render "Cargando datos del hogar…", never a false zero.
      assert.equal(captured.isLoading, true);
      assert.equal(captured.isError, false);
      assert.equal(captured.errorMessage, '');
      assert.equal(captured.items.length, 0);

      openFetch();
      await settleUntil(
        () => captured.isLoading === false && captured.items.length === 1,
        'transitions to ready',
      );
      assert.equal(captured.isError, false);
      assert.deepEqual(captured.items, [
        { name: 'menu', amount: 180, quantity: 3 },
      ]);
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('error: user-safe message + no rows → retry recovers to ready', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    stubMod.__setRpcResult('get_household_category_items', {
      error: { message: 'boom', code: 'P0001' },
    });
    const renderer = await mountProbe();
    try {
      await settleUntil(() => captured.isError === true, 'error state settles');
      assert.equal(captured.isLoading, false);
      assert.equal(captured.items.length, 0);
      assert.equal(captured.total, 0);
      assert.equal(captured.errorMessage, READ_ERROR_MESSAGE);
      assert.equal(typeof captured.retry, 'function');
      // Retry: re-arm the RPC with real rows and re-run the household read.
      stubMod.__setRpcResult('get_household_category_items', { rows: ROWS });
      await act(async () => {
        captured.retry();
      });
      await settleUntil(
        () => captured.isError === false && captured.items.length === 1,
        'retry recovers to ready',
      );
      assert.deepEqual(captured.items, [{ name: 'menu', amount: 180, quantity: 3 }]);
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('ok-empty: ready with items [] (true "no spend" state)', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    stubMod.__setRpcResult('get_household_category_items', { rows: [] });
    const renderer = await mountProbe();
    try {
      await settleUntil(
        () => captured.isLoading === false && captured.isError === false,
        'empty read settles ready',
      );
      assert.deepEqual(captured.items, []);
      assert.equal(captured.total, 0);
      assert.equal(captured.errorMessage, '');
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('no householdId → household query disabled (pending-not-loading, NO fetch)', async () => {
    resetAll();
    signIn();
    // No household set — `enabled: !!householdId` keeps the query disabled.
    probeArgs = ['carnes', '2026-08', 'household'];
    const renderer = await mountProbe();
    try {
      await settleUntil(
        () => captured.isLoading === false,
        'disabled query is not "loading"',
      );
      assert.equal(captured.isLoading, false);
      assert.equal(captured.isError, false);
      assert.equal(captured.errorMessage, '');
      assert.deepEqual(captured.items, []);
      const q = readHouseholdQuery();
      assert.ok(q, 'household query registered in cache');
      assert.equal(q.state.fetchStatus, 'idle');
      assert.equal(stubMod.__lastRpcCall(), null);
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('personal scope → household query stays disabled (no RPC, no states)', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    stubMod.__setRpcResult('get_household_category_items', { rows: ROWS });
    probeArgs = ['carnes', '2026-08', 'personal'];
    const renderer = await mountProbe();
    try {
      await settleUntil(
        () => captured.isLoading === false && captured.isError === false,
        'personal scope settles ready',
      );
      assert.deepEqual(captured.items, []);
      assert.equal(captured.total, 0);
      assert.equal(captured.retry, undefined);
      assert.equal(captured.errorMessage, '');
      // The household RPC must never fire from the personal path.
      assert.equal(stubMod.__lastRpcCall(), null);
      const q = readHouseholdQuery();
      assert.ok(q, 'household query registered (scope key unchanged)');
      assert.equal(q.state.fetchStatus, 'idle');
    } finally {
      await unmountProbe(renderer);
    }
  });

  console.log('\n[tests] CategoryDetailScreen (REAL render)\n');

  const screenMod = await load('scripts/render-drilldown-screen.js');
  const routerMod = await load('scripts/test-stubs/expo-router.js');
  const { CategoryDetailScreen } = screenMod;

  // react-test-renderer's toJSON() host tree: collect every string leaf so
  // assertions read "what the user sees" as plain text.
  const flattenStrings = (node, acc = []) => {
    if (node == null) return acc;
    if (typeof node === 'string') {
      acc.push(node);
      return acc;
    }
    if (Array.isArray(node)) {
      for (const child of node) flattenStrings(child, acc);
      return acc;
    }
    if (node.children) flattenStrings(node.children, acc);
    return acc;
  };
  const renderText = (renderer) => flattenStrings(renderer.toJSON()).join('\n');

  const renderScreen = async () => {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          QueryClientProvider,
          { client: queryClientMod.queryClient },
          React.createElement(CategoryDetailScreen),
        ),
      );
    });
    return renderer;
  };

  const setRoute = (params) => routerMod.__setRouteParams(params);

  // One confirmed `purchases` row for the personal-scope fixture: an
  // "asado" line item under carnes within 2026-08 (the drill-down month).
  const PURCHASE_ROW = {
    id: 'p1',
    store_id: 's1',
    purchase_date: '2026-08-10',
    created_at: '2026-08-10T12:00:00.000Z',
    total: 500,
    payment_method: 'card',
    image_url: null,
    status: 'confirmed',
    stores: [{ name: 'Carnicería Central' }],
    purchase_items: [
      {
        id: 'pi1',
        name: 'asado',
        quantity: 1,
        unit_price: 500,
        total_price: 500,
        is_impulse: false,
        sort_order: 0,
        categories: [{ slug: 'carnes' }],
      },
    ],
  };

  await test('personal: byte-identical baseline (no month data → zero + empty message)', async () => {
    resetAll();
    signIn();
    setRoute({ key: 'carnes', month: '2026-08' });
    const renderer = await renderScreen();
    try {
      await settleUntil(
        () => renderText(renderer).includes('Sin gastos en esta categoría este mes.'),
        'personal empty state settles',
      );
      const text = renderText(renderer);
      assert.ok(text.includes('TOTAL DEL MES'), 'total card header');
      assert.ok(text.includes('$U 0'), 'zero total is legit in personal (no read pending)');
      assert.ok(text.includes('Carnicería'), 'category label from the registry');
      assert.ok(!text.includes('Cargando datos del hogar…'), 'no household placeholder');
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('personal: item rows render with amounts (store-backed read)', async () => {
    resetAll();
    signIn();
    setRoute({ key: 'carnes', month: '2026-08' });
    stubMod.__setTableRead('purchases', { rows: [PURCHASE_ROW] });
    const renderer = await renderScreen();
    try {
      await settleUntil(() => renderText(renderer).includes('Asado'), 'personal rows render');
      const text = renderText(renderer);
      assert.ok(text.includes('Asado'), 'item name capitalized');
      assert.ok(text.includes('$U 500'), 'item amount formatted (whole-number drops trailing cents per PR 2 LATAM convention)');
      assert.ok(!text.includes('Sin gastos'), 'rows replace the empty message');
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('household: loading (RPC in flight) → placeholder + dash total, NO false zero/empty', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    setRoute({ key: 'carnes', month: '2026-08', scope: 'household' });
    // Deferred RPC gate (same trick as the hook loading test): the fetch
    // CANNOT complete until the harness opens it, so the pending render is
    // deterministic — no notify can fire while the gate is closed.
    let openFetch;
    const gate = new Promise((resolve) => {
      openFetch = resolve;
    });
    stubMod.__setSupabaseBehavior({
      rpc: () => ({
        then: (onFulfilled) =>
          gate.then(() => onFulfilled({ data: ROWS, error: null })),
      }),
    });
    const renderer = await renderScreen();
    try {
      const loading = renderText(renderer);
      assert.ok(loading.includes('Cargando datos del hogar…'), 'loading placeholder list');
      assert.ok(loading.includes('—'), 'dash total while the read is pending');
      assert.ok(!loading.includes('$U 0'), 'NO false zero total while loading');
      assert.ok(!loading.includes('Sin gastos'), 'NO false "no spend" while loading');

      openFetch();
      await settleUntil(
        () => renderText(renderer).includes('Menu'),
        'rows render once the read resolves',
      );
      const ready = renderText(renderer);
      assert.ok(ready.includes(' ×3'), 'quantity multiplier shows');
      assert.ok(ready.includes('$U 180'), 'aggregated total');
      assert.ok(!ready.includes('Cargando datos del hogar…'), 'placeholder gone');
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('household: error → EmptyState + user-safe message + Reintentar; retry recovers through the UI', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    setRoute({ key: 'carnes', month: '2026-08', scope: 'household' });
    stubMod.__setRpcResult('get_household_category_items', {
      error: { message: 'boom', code: 'P0001' },
    });
    const renderer = await renderScreen();
    try {
      await settleUntil(
        () => renderText(renderer).includes('Reintentar'),
        'error EmptyState settles',
      );
      const errText = renderText(renderer);
      assert.ok(errText.includes(READ_ERROR_MESSAGE), 'user-safe error message shown');
      assert.ok(errText.includes('—'), 'dash total on error (never a false zero)');
      assert.ok(!errText.includes('Sin gastos'), 'error is NOT rendered as "no spend"');

      // Retry through the UI: re-arm the RPC and press "Reintentar".
      stubMod.__setRpcResult('get_household_category_items', { rows: ROWS });
      // Instance-tree text collector (host instances mix string leaves + child
      // instances; composites are skipped via the string-type guard).
      const flattenInstance = (inst, acc = []) => {
        for (const child of inst.children) {
          if (typeof child === 'string') acc.push(child);
          else flattenInstance(child, acc);
        }
        return acc;
      };
      const retryNode = renderer.root
        .findAll((n) => n.type === 'Pressable')
        .filter((p) => flattenInstance(p).join('') === 'Reintentar');
      assert.equal(retryNode.length, 1, 'exactly one Reintentar pressable');
      await act(async () => {
        retryNode[0].props.onPress();
      });
      await settleUntil(
        () => renderText(renderer).includes('Menu'),
        'retry recovers to rows',
      );
      const recovered = renderText(renderer);
      assert.ok(recovered.includes('$U 180'), 'total after recovery');
      assert.ok(!recovered.includes('Reintentar'), 'error state gone');
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('household: ok-empty (RPC succeeded, zero rows) → true "Sin gastos" + zero total', async () => {
    resetAll();
    signIn();
    setHousehold('h1');
    setRoute({ key: 'carnes', month: '2026-08', scope: 'household' });
    stubMod.__setRpcResult('get_household_category_items', { rows: [] });
    const renderer = await renderScreen();
    try {
      await settleUntil(
        () => renderText(renderer).includes('Sin gastos en esta categoría este mes.'),
        'empty household month settles',
      );
      const text = renderText(renderer);
      assert.ok(text.includes('$U 0'), 'post-success zero total is legit');
      assert.ok(!text.includes('Cargando datos del hogar…'), 'loading placeholder gone');
      assert.ok(!text.includes('Reintentar'), 'no error action');
    } finally {
      await unmountProbe(renderer);
    }
  });

  await test('household + householdId null (store not hydrated) → renders as LOADING, never "Sin gastos"', async () => {
    resetAll();
    signIn();
    // NO setHousehold: a cold start / deep link can land on the screen
    // before the household row hydrates — the query sits disabled, and the
    // screen must treat that as pending, never as a zero/empty read.
    setRoute({ key: 'carnes', month: '2026-08', scope: 'household' });
    const renderer = await renderScreen();
    try {
      await settleUntil(
        () => renderText(renderer).includes('Cargando datos del hogar…'),
        'unhydrated household renders as pending',
      );
      const text = renderText(renderer);
      assert.ok(text.includes('—'), 'dash total (no data to read yet)');
      assert.ok(!text.includes('$U 0'), 'no false zero before hydration');
      assert.ok(!text.includes('Sin gastos'), 'no false "no spend" before hydration');
      assert.equal(stubMod.__lastRpcCall(), null, 'no RPC fired without a householdId');
    } finally {
      await unmountProbe(renderer);
    }
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});