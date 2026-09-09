#!/usr/bin/env node
/**
 * Node harness for the run-rate hook
 * (`src/features/home/hooks/useRunRate.ts`, spec `monthly-run-rate`).
 *
 * The R3 review of slice 2 (PR 2) flagged the hook as having zero automated
 * coverage. This harness closes that gap by mounting the REAL useRunRate
 * function (its real useEffect, useMutation and onSuccess→refetch) inside a
 * React tree (jsdom + react-dom/client + act()) wrapped in a real
 * QueryClientProvider — the exact pattern scripts/test-monthly-cache.mjs
 * uses for useMonthlyCache.
 *
 * Determinism: the clock-sensitive helpers are stubbed via test doubles —
 * `@/features/home/hooks/useHomeFeed` (controllable currentMonthKey) and
 * `@/lib/format` (controllable todayLocalISO) — and the data layer is
 * controlled through the feature-access mock seams
 * (scripts/test-mocks/feature-access.js). No real clock, no network.
 *
 * Covers the review gates:
 *   - REQ-5a: past month / no user → `{ data: null }`, ZERO reads fire.
 *   - Current month + user: single batch read of 5 trailing month keys;
 *     the result equals `aggregateRunRate` over the returned rows
 *     (mom fixture and fallback fixture).
 *   - Cache-miss: missing current-month row → triggerMonthlyRecalc fires
 *     EXACTLY ONCE and the success refetch populates the row (double-fire
 *     regression guard).
 *   - Read error with no data → `{ data: null }` (never fabricated
 *     numbers; recalc must not fire).
 *   - Mid-session navigation past ⇄ current: no reads fire while a past
 *     month is selected; returning to the current month re-serves data.
 *   - Background refetch failure WITH last-good data → card stays (repo
 *     last-good policy, same as the budget card): `{ data }` preserved.
 *
 * Usage: pnpm test:run-rate-hook
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
const harnessConfig = join(__dirname, 'tsconfig.run-rate-hook-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'run-rate-hook-test-'));
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
    } else if (request === '@/features/home/hooks/useHomeFeed') {
      request = join(outDir, 'scripts', 'test-stubs', 'useHomeFeed.js');
    } else if (request === '@/lib/format') {
      request = join(outDir, 'scripts', 'test-stubs', 'format.js');
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
// Fixtures
// ---------------------------------------------------------------------------

/** One `monthly_user_totals` cache row (migration 0015 shape). */
function makeCacheRow(overrides) {
  return {
    user_id: 'test-user-id',
    year_month: '2026-09',
    total: 0,
    category_totals: {},
    store_totals: {},
    daily_totals: {},
    items_count: 0,
    updated_at: '2026-09-30T00:00:00Z',
    ...overrides,
  };
}

/**
 * `daily_totals` with the same value on days 1..N of a month key —
 * `dailyRange('2026-09', 8, 900)` → `{ '2026-09-01': 900, …, '2026-09-08': 900 }`.
 */
function dailyRange(monthKey, days, value) {
  const totals = {};
  for (let day = 1; day <= days; day += 1) {
    totals[`${monthKey}-${String(day).padStart(2, '0')}`] = value;
  }
  return totals;
}

// Fixtures: Sep 1..8 = $7.200 (5+ spend days) and Aug 1..8 = $6.000 — the
// design MoM happy path (mtd 7200, baseline 6000, deltaPct 20, proj 27000).
const sep7200 = makeCacheRow({
  year_month: '2026-09',
  total: 7200,
  daily_totals: {
    '2026-09-01': 1000,
    '2026-09-02': 900,
    '2026-09-03': 800,
    '2026-09-04': 700,
    '2026-09-05': 1000,
    '2026-09-06': 900,
    '2026-09-07': 800,
    '2026-09-08': 1100,
  },
});
const aug6000 = makeCacheRow({
  year_month: '2026-08',
  total: 6000,
  daily_totals: {
    '2026-08-01': 800,
    '2026-08-02': 700,
    '2026-08-03': 600,
    '2026-08-04': 900,
    '2026-08-05': 700,
    '2026-08-06': 800,
    '2026-08-07': 900,
    '2026-08-08': 600,
  },
});
// Fallback fixtures: May/Jun/Jul completed rows, no Aug — design AD-1
// example (baseline = 24000 × 8/30 = 6400, deltaPct 12.5, source fallback).
const may21000 = makeCacheRow({ year_month: '2026-05', total: 21000 });
const jun24000 = makeCacheRow({ year_month: '2026-06', total: 24000 });
const jul27000 = makeCacheRow({ year_month: '2026-07', total: 27000 });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function run() {
  console.log('\n[tests] compiling run-rate hook modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const hookMod = await load('src/features/home/hooks/useRunRate.js');
  const { useRunRate } = hookMod;

  const authStub = await load('scripts/test-stubs/auth.js');
  const clockStubs = await load('scripts/test-stubs/format.js');
  const homeFeedStub = await load('scripts/test-stubs/useHomeFeed.js');

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

  // Deterministic clock: current month key + local "today" are pinned.
  homeFeedStub.__setCurrentMonthKey('2026-09');
  clockStubs.__setTodayISO('2026-09-08');

  // -----------------------------------------------------------------------
  // Hook-mount helpers (pattern: test-monthly-cache.mjs)
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

  /**
   * mountHook variant that supports re-rendering with new args — used by the
   * mid-session navigation test to flip monthKey past ⇄ current on a LIVE
   * mount. Identical flushing semantics to `waitFor` above.
   */
  function mountHookRerender(renderHook, initialArgs, queryClient) {
    let hookResult = undefined;
    let hookError = null;
    let argsRef = { ...initialArgs };

    function TestComp() {
      try {
        hookResult = renderHook(argsRef);
      } catch (e) {
        hookError = e;
      }
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const render = () => {
      act(() => {
        root.render(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(TestComp),
          ),
        );
      });
    };

    render();

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
      rerender: (nextArgs) => {
        argsRef = { ...argsRef, ...nextArgs };
        render();
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
  // REQ-5a gate: past month / no user → data null, ZERO reads
  // =========================================================================
  console.log('\n[tests] REQ-5a visibility gate\n');

  await test('past month selected → data null, no reads fire (real hook)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    let readRowsCalls = 0;
    faMock.__setReadMonthlyCacheRows(async () => {
      readRowsCalls += 1;
      return { status: 'ok', data: [sep7200, aug6000] };
    });
    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useRunRate('2026-08'),
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.data === null && readRowsCalls === 0);
      // The gate is `enabled`-based: a disabled query never fetches, but let
      // a few flush rounds pass to prove nothing fires late.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.equal(ref.current.data, null);
      assert.equal(readRowsCalls, 0, 'no reads must fire for a past month');
      assert.equal(recalcCalls, 0);
    } finally {
      unmount();
    }
  });

  await test('no user with current month → data null, no reads fire (real hook)', async () => {
    faMock.__reset();
    authStub.__setUserId(null);
    let readRowsCalls = 0;
    faMock.__setReadMonthlyCacheRows(async () => {
      readRowsCalls += 1;
      return { status: 'ok', data: [sep7200, aug6000] };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useRunRate('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.data === null && readRowsCalls === 0);
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.equal(ref.current.data, null);
      assert.equal(readRowsCalls, 0, 'no reads must fire without a user id');
    } finally {
      unmount();
      authStub.__setUserId('test-user-id');
    }
  });

  // =========================================================================
  // Current month + user: 5-month batch read, aggregate result (REQ-6a/NFR-1)
  // =========================================================================
  console.log('\n[tests] current month, batch read, aggregate result\n');

  await test('current month: one batch of 5 keys, result = aggregateRunRate (mom)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    let readRowsCalls = 0;
    let lastReadArgs = null;
    faMock.__setReadMonthlyCacheRows(async (userId, yearMonths) => {
      readRowsCalls += 1;
      lastReadArgs = { userId, yearMonths };
      return { status: 'ok', data: [sep7200, aug6000] };
    });
    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useRunRate('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.data !== null && r.data.mtd === 7200,
      );
      assert.deepEqual(lastReadArgs.yearMonths, [
        '2026-09',
        '2026-08',
        '2026-07',
        '2026-06',
        '2026-05',
      ], 'single batch read of current + 4 previous months (NFR-1)');
      assert.equal(lastReadArgs.userId, 'test-user-id');
      assert.equal(readRowsCalls, 1, 'exactly ONE batch read (no double-fetch)');
      assert.deepEqual(ref.current.data, {
        mtd: 7200,
        baseline: 6000,
        deltaPct: 20,
        projection: 27000,
        source: 'mom',
      });
      assert.equal(recalcCalls, 0, 'cache hit must not trigger recalc');
    } finally {
      unmount();
    }
  });

  await test('current month: fallback source from batch rows (AD-1 fixture)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    faMock.__setReadMonthlyCacheRows(async () => ({
      status: 'ok',
      data: [sep7200, jul27000, jun24000, may21000],
    }));
    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useRunRate('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.data !== null && r.data.source === 'fallback',
      );
      // No Aug row → MoM window unavailable → prorated mean of May+Jun+Jul.
      assert.deepEqual(ref.current.data, {
        mtd: 7200,
        baseline: 6400,
        deltaPct: 12.5,
        projection: 27000,
        source: 'fallback',
      });
      assert.equal(recalcCalls, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // Cache-miss → triggerMonthlyRecalc once → refetch populates (REQ-6)
  // =========================================================================
  console.log('\n[tests] cache-miss auto-recalc\n');

  await test('cache miss: recalc fires EXACTLY once, refetch populates (real hook)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');

    // Counter-based mock: 1st batch read misses the current-month row;
    // 2nd+ (post-recalc refetch) includes it — the RPC upsert semantics.
    let fetchCount = 0;
    faMock.__setReadMonthlyCacheRows(async () => {
      fetchCount += 1;
      if (fetchCount === 1) return { status: 'ok', data: [aug6000, jul27000] };
      return { status: 'ok', data: [sep7200, aug6000, jul27000] };
    });

    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useRunRate('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && r.data !== null && r.data.mtd === 7200,
      );
      assert.equal(fetchCount, 2, 'initial read + post-recalc refetch');
      assert.equal(recalcCalls, 1, 'recalc must fire EXACTLY once');
      assert.deepEqual(ref.current.data, {
        mtd: 7200,
        baseline: 6000,
        deltaPct: 20,
        projection: 27000,
        source: 'mom',
      });
      // Regression guard: flush extra rounds — a double-fire would bump the
      // counter past 1 once the refetch resolves (or hang the waitFor).
      for (let i = 0; i < 4; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.equal(recalcCalls, 1, 'recalc must stay at EXACTLY one after settle');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // Read error → { data: null } (REQ-6 — never fabricate numbers)
  // =========================================================================
  console.log('\n[tests] read failure\n');

  await test('read error with no data → data null, no recalc (real hook)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    let readRowsCalls = 0;
    faMock.__setReadMonthlyCacheRows(async () => {
      readRowsCalls += 1;
      return {
        status: 'error',
        message: 'No se pudieron cargar los datos. Inténtalo de nuevo.',
      };
    });
    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useRunRate('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(
        (r) => !!r && readRowsCalls === 1 && r.data === null,
      );
      // `retry: false` — the query settles on the first failure; flush a few
      // rounds so a hypothetical retry/late re-render would surface.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.equal(ref.current.data, null, 'failed read must hide the card');
      assert.equal(recalcCalls, 0, 'recalc must not fire on a failed read');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // Mid-session navigation: past ⇄ current without reads for the past month
  // =========================================================================
  console.log('\n[tests] mid-session navigation\n');

  await test('navigate past ⇄ current: no reads while past, data re-served (real hook)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    let readRowsCalls = 0;
    faMock.__setReadMonthlyCacheRows(async () => {
      readRowsCalls += 1;
      return { status: 'ok', data: [sep7200, aug6000] };
    });
    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, rerender, unmount, waitFor } = mountHookRerender(
      (args) => useRunRate(args.monthKey),
      { monthKey: '2026-09' },
      makeQueryClient(),
    );

    try {
      // Current month loaded.
      await waitFor((r) => !!r && r.data !== null && r.data.mtd === 7200);
      assert.equal(readRowsCalls, 1);

      // Navigate to the PAST month: data null, and NOT a single extra read.
      rerender({ monthKey: '2026-08' });
      await waitFor((r) => !!r && r.data === null);
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.equal(ref.current.data, null);
      assert.equal(readRowsCalls, 1, 'zero reads while a past month is selected');

      // Navigate BACK to the current month: data re-served (the re-enabled
      // query refetches — exactly one more read, never one per past render).
      rerender({ monthKey: '2026-09' });
      await waitFor((r) => !!r && r.data !== null && r.data.mtd === 7200);
      assert.equal(readRowsCalls, 2, 'only the re-enable refetch after return');
      assert.equal(recalcCalls, 0, 'no recalc across the navigation round trip');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // Last-good on background refetch failure (isRefetchError decision, R3)
  // =========================================================================
  console.log('\n[tests] background refetch failure (last-good)\n');

  await test('failed background refetch keeps last-good data (real hook)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');

    // 1st read succeeds with real rows; any later read (the background
    // refetch) fails — v5 keeps `data` and reports the error observably.
    let readRowsCalls = 0;
    faMock.__setReadMonthlyCacheRows(async () => {
      readRowsCalls += 1;
      if (readRowsCalls === 1) return { status: 'ok', data: [sep7200, aug6000] };
      return {
        status: 'error',
        message: 'No se pudieron cargar los datos. Inténtalo de nuevo.',
      };
    });
    let recalcCalls = 0;
    faMock.__setTriggerMonthlyRecalc(async () => {
      recalcCalls += 1;
      return { status: 'ok', data: undefined };
    });

    const { ref, unmount, waitFor, queryClient } = mountHook(
      () => useRunRate('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.data !== null && r.data.mtd === 7200);

      // Force a background refetch (as a receipt-write invalidation would);
      // the mock fails it. Last-good policy: the card MUST stay visible with
      // the previously verified figures — no fabricated numbers, no blank.
      await act(async () => {
        queryClient.invalidateQueries({
          queryKey: ['analytics', 'monthly-cache'],
        });
        await new Promise((r) => setTimeout(r, 0));
      });
      await waitFor((r) => !!r && readRowsCalls === 2);
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }

      assert.equal(readRowsCalls, 2, 'background refetch was attempted');
      assert.notEqual(ref.current.data, null, 'last-good data must survive');
      assert.equal(ref.current.data.mtd, 7200);
      assert.equal(ref.current.data.baseline, 6000);
      assert.equal(recalcCalls, 0);
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