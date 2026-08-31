#!/usr/bin/env node
/**
 * Node harness for the monthly-cache module
 * (`src/features/analytics/hooks/useMonthlyCache.ts`).
 *
 * Covers:
 *   - 5.1: transformCacheToCategoryTotals (pure function)
 *   - 5.2: useMonthlyCache hook — REAL mount via jsdom + react-dom + act()
 *
 * Compiles the analytics hook module plus its dependency graph into a temp
 * directory. A require-hook redirects `@/` paths, `react-native`, and
 * `@/lib/supabase/feature-access` to stubs / controllable mocks.
 * `@tanstack/react-query` is NOT redirected — the real library is used.
 *
 * 5.2 mounts the REAL useMonthlyCache function (its real useEffect,
 * useMutation, and onSuccess→refetch) inside a React tree
 * (jsdom + react-dom/client + act()) wrapped in a real QueryClientProvider.
 * Data functions are controlled via the feature-access mock seams; a
 * `waitFor` poll flushes async query/mutation/refetch work deterministically.
 *
 * Usage: pnpm test:monthly-cache
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require_.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.monthly-cache-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'monthly-cache-test-'));
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

// ---------------------------------------------------------------------------
// Require-hook: redirect problematic modules to stubs / mocks.
// @tanstack/react-query is NOT redirected — the real package is used.
// ---------------------------------------------------------------------------
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/features/auth') {
      request = join(outDir, 'scripts', 'test-stubs', 'auth.js');
    } else if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/feature-access') {
      request = join(__dirname, 'test-mocks', 'feature-access.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

// ---------------------------------------------------------------------------
// Compile
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
// Helpers
// ---------------------------------------------------------------------------
function makeCategoryEntry(slug, name, total, count) {
  return { total, count, name };
}

function makeCacheRow(overrides) {
  return {
    user_id: 'test-user-id',
    year_month: '2026-08',
    total: 0,
    category_totals: {},
    store_totals: {},
    daily_totals: {},
    items_count: 0,
    updated_at: '2026-08-31T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function run() {
  console.log('\n[tests] compiling monthly-cache modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const hookMod = await load('src/features/analytics/hooks/useMonthlyCache.js');
  const { transformCacheToCategoryTotals, useMonthlyCache } = hookMod;

  const authStub = await load('scripts/test-stubs/auth.js');
  if (typeof authStub.__setUserId === 'function') {
    authStub.__setUserId('test-user-id');
  }

  // Feature-access mock (controllable per test via __set* seams)
  const faMock = require_(join(__dirname, 'test-mocks', 'feature-access.js'));

  // Real React + react-query + react-dom for mounting hooks
  const React = require_('react');
  const { act } = React;
  const { createRoot } = require_('react-dom/client');
  const { QueryClient, QueryClientProvider } = require_('@tanstack/react-query');

  // React 19 requires this flag for act() to work outside Jest/Vitest
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom for a minimal DOM (react-dom/client needs a container element)
  const { JSDOM } = require_('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  // -----------------------------------------------------------------------
  // Hook-mount helpers
  // -----------------------------------------------------------------------
  function makeQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  /**
   * Mount a hook inside a real React tree with QueryClientProvider.
   * Returns { ref, unmount, waitFor } — ref.current is always the latest hook
   * return. `waitFor(predicate)` polls until `predicate(ref.current)` is
   * truthy (bounded), flushing async query/mutation/refetch work each round.
   */
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

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(TestComp),
        ),
      );
    });

    // Wait until predicate passes, flushing async work each round.
    const waitFor = async (predicate, { timeout = 2000 } = {}) => {
      const deadline = Date.now() + timeout;
      // Flush once before first poll so the initial query can resolve.
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
              JSON.stringify(hookResult),
          );
        }
      }
    };

    return {
      ref: {
        get current() { return hookResult; },
        get error() { return hookError; },
      },
      unmount: () => {
        act(() => root.unmount());
        if (container.parentNode) container.parentNode.removeChild(container);
      },
      queryClient,
      waitFor,
    };
  }

  // =========================================================================
  // 5.1 — transformCacheToCategoryTotals (pure function)
  // =========================================================================
  console.log('\n[tests] 5.1 transformCacheToCategoryTotals\n');

  await test('null row returns empty array', () => {
    const result = transformCacheToCategoryTotals(null);
    assert.deepEqual(result, []);
  });

  await test('empty category_totals returns empty array', () => {
    const result = transformCacheToCategoryTotals(
      makeCacheRow({ total: 5000, category_totals: {} }),
    );
    assert.deepEqual(result, []);
  });

  await test('single category maps all fields correctly', () => {
    const row = makeCacheRow({
      total: 1000,
      category_totals: {
        supermercado: makeCategoryEntry('supermercado', 'Supermercado', 600, 5),
      },
    });
    const result = transformCacheToCategoryTotals(row);
    assert.equal(result.length, 1);
    assert.equal(result[0].category_id, 'supermercado');
    assert.equal(result[0].category_name, 'Supermercado');
    assert.equal(result[0].category_slug, 'supermercado');
    assert.equal(result[0].total, 600);
    assert.equal(result[0].item_count, 5);
    assert.equal(result[0].budget_limit, null);
  });

  await test('percent_of_total computed correctly', () => {
    const row = makeCacheRow({
      total: 1000,
      category_totals: {
        food: makeCategoryEntry('food', 'Food', 333, 2),
      },
    });
    const result = transformCacheToCategoryTotals(row);
    // 333/1000 = 0.333 → *1000 = 333 → round = 333 → /10 = 33.3
    assert.equal(result[0].percent_of_total, 33.3);
  });

  await test('percent_of_total is 0 when row.total is 0', () => {
    const row = makeCacheRow({
      total: 0,
      category_totals: {
        food: makeCategoryEntry('food', 'Food', 100, 1),
      },
    });
    const result = transformCacheToCategoryTotals(row);
    assert.equal(result[0].percent_of_total, 0);
  });

  await test('results sorted by total descending', () => {
    const row = makeCacheRow({
      total: 1500,
      category_totals: {
        small: makeCategoryEntry('small', 'Small', 200, 1),
        big: makeCategoryEntry('big', 'Big', 800, 3),
        mid: makeCategoryEntry('mid', 'Mid', 500, 2),
      },
    });
    const result = transformCacheToCategoryTotals(row);
    assert.equal(result[0].category_slug, 'big');
    assert.equal(result[0].total, 800);
    assert.equal(result[1].category_slug, 'mid');
    assert.equal(result[1].total, 500);
    assert.equal(result[2].category_slug, 'small');
    assert.equal(result[2].total, 200);
  });

  await test('multiple categories all mapped correctly', () => {
    const row = makeCacheRow({
      total: 2000,
      category_totals: {
        restaurants: makeCategoryEntry('restaurants', 'Restaurants', 800, 4),
        transport: makeCategoryEntry('transport', 'Transport', 300, 2),
        groceries: makeCategoryEntry('groceries', 'Groceries', 900, 6),
      },
    });
    const result = transformCacheToCategoryTotals(row);
    assert.equal(result.length, 3);
    // Sorted desc: groceries (900), restaurants (800), transport (300)
    assert.equal(result[0].category_slug, 'groceries');
    assert.equal(result[0].percent_of_total, 45); // 900/2000 = 0.45 → 45.0
    assert.equal(result[1].category_slug, 'restaurants');
    assert.equal(result[1].percent_of_total, 40); // 800/2000 = 0.40 → 40.0
    assert.equal(result[2].category_slug, 'transport');
    assert.equal(result[2].percent_of_total, 15); // 300/2000 = 0.15 → 15.0
    assert.equal(result[2].budget_limit, null);
  });

  await test('percent_of_total rounds to one decimal', () => {
    const row = makeCacheRow({
      total: 3000,
      category_totals: {
        misc: makeCategoryEntry('misc', 'Misc', 1001, 1),
      },
    });
    const result = transformCacheToCategoryTotals(row);
    // 1001/3000 = 0.333666… → *1000 = 333.666… → round = 334 → /10 = 33.4
    assert.equal(result[0].percent_of_total, 33.4);
  });

  // =========================================================================
  // 5.2 — useMonthlyCache hook (REAL mount: jsdom + react-query + act)
  //
  // Each test:
  //   1. Arms the feature-access mock seams
  //   2. Mounts the REAL useMonthlyCache via createRoot + act
  //   3. Asserts against the real hook's return values
  //   4. Unmounts and clears the QueryClient
  // =========================================================================
  console.log('\n[tests] 5.2 useMonthlyCache hook (real mount)\n');

  // --- 5.2.1 Personal cache-hit: row present → totals mapped, no recalc ---
  await test('cache hit: row present → totals mapped (real hook)', async () => {
    faMock.__reset();
    const cacheRow = makeCacheRow({
      total: 1000,
      category_totals: {
        food: makeCategoryEntry('food', 'Food', 1000, 5),
      },
    });
    faMock.__setReadMonthlyCacheRow(async () => ({
      status: 'ok',
      data: cacheRow,
    }));
    faMock.__setTriggerMonthlyRecalc(async () => ({
      status: 'ok',
      data: undefined,
    }));

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.hasData === true && r.monthTotal === 1000,
      );
      assert.equal(ref.current.totals.length, 1);
      assert.equal(ref.current.totals[0].total, 1000);
      assert.equal(ref.current.totals[0].category_slug, 'food');
      assert.equal(ref.current.monthTotal, 1000);
      assert.equal(ref.current.isLoading, false);
      assert.equal(ref.current.hasData, true);
      assert.equal(ref.current.error, null);
    } finally {
      unmount();
    }
  });

  // --- 5.2.2 Personal cache-miss → triggerMonthlyRecalc → refetch populates ---
  await test('cache miss: triggers recalc, refetch populates totals (real hook)', async () => {
    faMock.__reset();
    const refetchedRow = makeCacheRow({
      total: 500,
      category_totals: {
        food: makeCategoryEntry('food', 'Food', 500, 3),
      },
    });

    // Counter-based mock: 1st call = null (cache miss), 2nd+ = the row
    let fetchCount = 0;
    faMock.__setReadMonthlyCacheRow(async () => {
      fetchCount += 1;
      if (fetchCount === 1) return { status: 'ok', data: null };
      return { status: 'ok', data: refetchedRow };
    });

    let recalcCalled = false;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalled = true;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08'),
      makeQueryClient(),
    );

    try {
      // After mount + resolve: data should be the refetched row
      // (useEffect saw null → mutated → onSuccess → refetch → got row)
      await waitFor(
        (r) => !!r && r.hasData === true && r.totals.length === 1,
      );
      assert.equal(ref.current.totals[0].total, 500);
      assert.equal(ref.current.monthTotal, 500);
      assert.equal(ref.current.hasData, true);
      // The recalc mutation was triggered
      assert.equal(recalcCalled, true);
    } finally {
      unmount();
    }
  });

  // --- 5.2.3 Household mode: uses fetchMonthlyTotals, no recalc ---
  await test('household mode: uses fetchMonthlyTotals, no recalc (real hook)', async () => {
    faMock.__reset();
    const householdTotals = [
      {
        category_id: 'groceries',
        category_name: 'Groceries',
        category_slug: 'groceries',
        total: 500,
        item_count: 3,
        percent_of_total: 100,
        budget_limit: null,
      },
    ];

    let recalcCalled = false;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalled = true;
      return { status: 'ok', data: undefined };
    });

    // readCategoryTotals is used by the analytics api.ts module's
    // fetchMonthlyTotals — control household data through this seam
    faMock.__setReadCategoryTotals(async (yearMonth, householdId) => {
      assert.equal(!!householdId, true, 'householdId should be truthy');
      return { status: 'ok', data: householdTotals };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08', 'hh-123'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.hasData === true && r.totals.length === 1,
      );
      assert.equal(ref.current.totals[0].category_slug, 'groceries');
      assert.equal(ref.current.monthTotal, 500);
      assert.equal(ref.current.hasData, true);
      // Household mode should NOT trigger recalc
      assert.equal(recalcCalled, false);
    } finally {
      unmount();
    }
  });

  // --- 5.2.4 Household mode: empty data → monthTotal is 0 ---
  await test('household mode: empty data → monthTotal is 0 (real hook)', async () => {
    faMock.__reset();
    faMock.__setReadCategoryTotals(async () => ({
      status: 'ok',
      data: [],
    }));

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08', 'hh-123'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.hasData === true && r.totals.length === 0,
      );
      assert.equal(ref.current.monthTotal, 0);
      assert.equal(ref.current.hasData, true);
    } finally {
      unmount();
    }
  });

  // --- 5.2.5 Cache hit: multiple categories → sorted desc by total ---
  await test('cache hit: multiple categories → sorted desc by total (real hook)', async () => {
    faMock.__reset();
    const cacheRow = makeCacheRow({
      total: 2000,
      category_totals: {
        cheap: makeCategoryEntry('cheap', 'Cheap', 100, 1),
        expensive: makeCategoryEntry('expensive', 'Expensive', 1200, 4),
        mid: makeCategoryEntry('mid', 'Mid', 700, 2),
      },
    });
    faMock.__setReadMonthlyCacheRow(async () => ({
      status: 'ok',
      data: cacheRow,
    }));

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.hasData === true && r.totals.length === 3,
      );
      assert.equal(ref.current.totals[0].category_slug, 'expensive');
      assert.equal(ref.current.totals[1].category_slug, 'mid');
      assert.equal(ref.current.totals[2].category_slug, 'cheap');
    } finally {
      unmount();
    }
  });

  // --- 5.2.6 Personal cache-hit: no recalc side effect ---
  await test('cache hit: no recalc triggered (real hook, verifies side-effect)', async () => {
    faMock.__reset();
    let recalcCalls = 0;
    faMock.__setReadMonthlyCacheRow(async () => ({
      status: 'ok',
      data: makeCacheRow({ total: 100 }),
    }));
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.hasData === true && r.monthTotal === 100,
      );
      // Recalc should NEVER have been called
      assert.equal(recalcCalls, 0);
    } finally {
      unmount();
    }
  });

  // --- 5.2.7 Cache-miss: after settling, not loading and totals empty ---
  await test('cache miss initial: not loading, totals empty (real hook)', async () => {
    faMock.__reset();
    faMock.__setReadMonthlyCacheRow(async () => ({
      status: 'ok',
      data: null,
    }));
    faMock.__setTriggerMonthlyRecalc(async () => ({
      status: 'ok',
      data: undefined,
    }));

    const { ref, unmount, waitFor } = mountHook(
      () => useMonthlyCache('2026-08'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.hasData === true && r.isLoading === false,
      );
      // Data is null (cache miss), not loading
      assert.equal(ref.current.hasData, true);
      assert.equal(ref.current.isLoading, false);
      assert.equal(ref.current.totals.length, 0);
      assert.equal(ref.current.monthTotal, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
