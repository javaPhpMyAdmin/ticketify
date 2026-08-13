#!/usr/bin/env node
/**
 * Node harness for the Pro charts' pure aggregations
 * (`src/features/charts/aggregate.ts` → `aggregateSpendTrend`,
 * `aggregateStoresByMonth`, `aggregateMonthlyDelta`, and the
 * `aggregateCategoriesByMonth` re-export parity check).
 *
 * Compiles `aggregate.ts` plus its dependency graph (home feed hook,
 * categories registry, auth/session plumbing, receipts store, react-query)
 * into a temp directory using the same stub set as the price-alerts and
 * home harnesses — the charts aggregators consume the same
 * `ReceiptSpendRecord[]` shape as the free analytics, so the dependency
 * surface is identical. Then asserts:
 *
 *   `aggregateSpendTrend`:
 *     - empty input → zero-fill across the entire `months` window,
 *     - records in the current month → that month gets the sum, others 0,
 *     - multiple receipts in the same month → summed (not last-write-wins),
 *     - months outside the `months` array → ignored (the array drives
 *       output order; the receipts never influence x-axis order).
 *
 *   `aggregateStoresByMonth`:
 *     - single store, single receipt → that store appears with its total,
 *     - multiple stores → sorted by total descending,
 *     - tie-break: same total → sorted by storeName ascending (locale-aware),
 *     - receipts in other months → ignored.
 *
 *   `aggregateMonthlyDelta`:
 *     - receipts in both months → `current` and `previous` sums correct,
 *     - percentage is rounded and matches `(current - previous) / previous * 100`,
 *     - `isImprovement` is true when delta < 0 (less spent = good),
 *     - previous month has zero records → `previous` is null (not 0),
 *     - previous month has records totalling zero → `previous === 0`,
 *     - deltaPct is null when `previous` is null (no division by zero).
 *
 *   `aggregateCategoriesByMonth` re-export parity:
 *     - reference equality: `charts/aggregate` re-export is the SAME
 *       function object as `home/hooks/useHomeFeed` — no shadow copy,
 *     - behavioral parity: same input → same output on both paths.
 *
 * Usage: pnpm test:charts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.charts-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'charts-test-'));
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

function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
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

/** Minimal `ReceiptSpendRecord` shape with category_totals + items. */
function receipt(overrides = {}) {
  return {
    id: 'r-default',
    store_name: 'Mercado',
    purchase_date: '2026-08-05',
    total: 100,
    category_totals: {},
    items: [],
    ...overrides,
  };
}

/** A category totals entry like `category_totals: { lacteos: 50 }`. */
function cats(map) {
  return map;
}

async function run() {
  console.log('\n[tests] compiling charts aggregator + dependency graph…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');
  const chartsMod = await import(
    pathToFileURL(join(outDir, 'src/features/charts/aggregate.js')).href
  );
  const homeFeedMod = await import(
    pathToFileURL(join(outDir, 'src/features/home/hooks/useHomeFeed.js')).href
  );
  const { aggregateSpendTrend, aggregateStoresByMonth, aggregateMonthlyDelta, aggregateCategoriesByMonth } =
    chartsMod;
  const { aggregateCategoriesByMonth: directAggregate } = homeFeedMod;

  console.log('\n[tests] aggregateSpendTrend\n');

  await test('empty records → all months get total: 0 (zero-fill)', () => {
    const out = aggregateSpendTrend([], ['2026-06', '2026-07', '2026-08']);
    assert.deepEqual(out, [
      { month: '2026-06', total: 0 },
      { month: '2026-07', total: 0 },
      { month: '2026-08', total: 0 },
    ]);
  });

  await test('records in the current month → that month gets the sum, others 0', () => {
    const out = aggregateSpendTrend(
      [receipt({ id: 'r1', total: 50, purchase_date: '2026-08-03' })],
      ['2026-06', '2026-07', '2026-08'],
    );
    assert.deepEqual(out, [
      { month: '2026-06', total: 0 },
      { month: '2026-07', total: 0 },
      { month: '2026-08', total: 50 },
    ]);
  });

  await test('multiple receipts in the same month → summed (not last-write-wins)', () => {
    const out = aggregateSpendTrend(
      [
        receipt({ id: 'r1', total: 30, purchase_date: '2026-08-01' }),
        receipt({ id: 'r2', total: 45, purchase_date: '2026-08-15' }),
        receipt({ id: 'r3', total: 25, purchase_date: '2026-08-28' }),
      ],
      ['2026-08'],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].total, 100);
  });

  await test('months outside the requested window are ignored (output order from `months`)', () => {
    const out = aggregateSpendTrend(
      [
        receipt({ id: 'r1', total: 100, purchase_date: '2026-05-01' }), // outside
        receipt({ id: 'r2', total: 50, purchase_date: '2026-08-03' }), // inside
      ],
      ['2026-08'],
    );
    assert.deepEqual(out, [{ month: '2026-08', total: 50 }]);
  });

  await test('output preserves `months` order regardless of receipt insertion order', () => {
    const out = aggregateSpendTrend(
      [
        receipt({ id: 'r1', total: 5, purchase_date: '2026-08-01' }),
        receipt({ id: 'r2', total: 7, purchase_date: '2026-06-01' }),
      ],
      ['2026-08', '2026-07', '2026-06'], // deliberately NOT in chronological order
    );
    assert.deepEqual(out, [
      { month: '2026-08', total: 5 },
      { month: '2026-07', total: 0 },
      { month: '2026-06', total: 7 },
    ]);
  });

  console.log('\n[tests] aggregateStoresByMonth\n');

  await test('single store, single receipt → that store appears once with the total', () => {
    const out = aggregateStoresByMonth(
      [receipt({ id: 'r1', store_name: 'Coto', total: 42, purchase_date: '2026-08-05' })],
      '2026-08',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].storeName, 'Coto');
    assert.equal(out[0].total, 42);
  });

  await test('multiple stores → sorted by total descending', () => {
    const out = aggregateStoresByMonth(
      [
        receipt({ id: 'r1', store_name: 'Coto', total: 10, purchase_date: '2026-08-05' }),
        receipt({ id: 'r2', store_name: 'Disco', total: 30, purchase_date: '2026-08-06' }),
        receipt({ id: 'r3', store_name: 'Carrefour', total: 20, purchase_date: '2026-08-07' }),
      ],
      '2026-08',
    );
    assert.deepEqual(
      out.map((s) => s.storeName),
      ['Disco', 'Carrefour', 'Coto'],
    );
  });

  await test('tie-break: same total → sorted by storeName ascending', () => {
    const out = aggregateStoresByMonth(
      [
        receipt({ id: 'r1', store_name: 'Zapata', total: 10, purchase_date: '2026-08-05' }),
        receipt({ id: 'r2', store_name: 'Alvarez', total: 10, purchase_date: '2026-08-06' }),
      ],
      '2026-08',
    );
    assert.deepEqual(
      out.map((s) => s.storeName),
      ['Alvarez', 'Zapata'],
    );
  });

  await test('different months → only the requested month is included', () => {
    const out = aggregateStoresByMonth(
      [
        receipt({ id: 'r1', store_name: 'Coto', total: 10, purchase_date: '2026-07-05' }),
        receipt({ id: 'r2', store_name: 'Disco', total: 30, purchase_date: '2026-08-06' }),
      ],
      '2026-08',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].storeName, 'Disco');
  });

  await test('same store across multiple receipts → summed into one row', () => {
    const out = aggregateStoresByMonth(
      [
        receipt({ id: 'r1', store_name: 'Coto', total: 10, purchase_date: '2026-08-05' }),
        receipt({ id: 'r2', store_name: 'Coto', total: 15, purchase_date: '2026-08-12' }),
        receipt({ id: 'r3', store_name: 'Coto', total: 5, purchase_date: '2026-08-19' }),
      ],
      '2026-08',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].storeName, 'Coto');
    assert.equal(out[0].total, 30);
  });

  await test('store name with only whitespace → falls back to "Sin tienda"', () => {
    const out = aggregateStoresByMonth(
      [receipt({ id: 'r1', store_name: '   ', total: 10, purchase_date: '2026-08-05' })],
      '2026-08',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].storeName, 'Sin tienda');
  });

  console.log('\n[tests] aggregateMonthlyDelta\n');

  await test('receipts in both current and previous month → both sums correct', () => {
    const out = aggregateMonthlyDelta(
      [
        receipt({ id: 'r1', total: 50, purchase_date: '2026-07-05' }), // previous
        receipt({ id: 'r2', total: 30, purchase_date: '2026-07-12' }), // previous
        receipt({ id: 'r3', total: 100, purchase_date: '2026-08-03' }), // current
      ],
      '2026-08',
    );
    assert.equal(out.current, 100);
    assert.equal(out.previous, 80);
    // (100 - 80) / 80 * 100 = 25
    assert.equal(Math.round(out.deltaPct), 25);
    assert.equal(out.isImprovement, false, '+25% is more spend, not an improvement');
  });

  await test('less current than previous → negative deltaPct, isImprovement true', () => {
    const out = aggregateMonthlyDelta(
      [
        receipt({ id: 'r1', total: 200, purchase_date: '2026-07-05' }), // previous
        receipt({ id: 'r2', total: 100, purchase_date: '2026-08-03' }), // current
      ],
      '2026-08',
    );
    assert.equal(out.current, 100);
    assert.equal(out.previous, 200);
    assert.equal(Math.round(out.deltaPct), -50);
    assert.equal(out.isImprovement, true, 'less spend = improvement');
  });

  await test('no records in the previous month → previous is null (NOT zero)', () => {
    const out = aggregateMonthlyDelta(
      [receipt({ id: 'r1', total: 42, purchase_date: '2026-08-05' })],
      '2026-08',
    );
    assert.equal(out.current, 42);
    assert.equal(
      out.previous,
      null,
      'no records must be null, not 0 — "no data" is different from "you spent $0"',
    );
    assert.equal(out.deltaPct, null, 'cannot compute a percentage against null');
    // isImprovement is false when there's no comparison to make — the UI
    // hides the delta pill in this case, so the value is informational.
    assert.equal(out.isImprovement, false);
  });

  await test('previous month has a receipt but the receipt\'s total is 0 → previous IS 0 (not null)', () => {
    const out = aggregateMonthlyDelta(
      [
        receipt({ id: 'r1', total: 0, purchase_date: '2026-07-05' }), // previous exists, but $0
        receipt({ id: 'r2', total: 100, purchase_date: '2026-08-03' }),
      ],
      '2026-08',
    );
    assert.equal(out.current, 100);
    assert.equal(out.previous, 0);
    // 100 / 0 → Infinity → the aggregator returns null for the pct
    // (same "cannot compute against null" defensive path).
    assert.equal(out.deltaPct, null);
  });

  await test('equal current and previous → deltaPct === 0, isImprovement false (neutral)', () => {
    const out = aggregateMonthlyDelta(
      [
        receipt({ id: 'r1', total: 100, purchase_date: '2026-07-05' }),
        receipt({ id: 'r2', total: 100, purchase_date: '2026-08-03' }),
      ],
      '2026-08',
    );
    assert.equal(out.current, 100);
    assert.equal(out.previous, 100);
    assert.equal(Math.round(out.deltaPct), 0);
    assert.equal(out.isImprovement, false, 'equal is neutral, not an improvement');
  });

  await test('receipts with undefined `total` are treated as 0 (defensive)', () => {
    const out = aggregateMonthlyDelta(
      [
        receipt({ id: 'r1', total: undefined, purchase_date: '2026-07-05' }),
        receipt({ id: 'r2', total: 50, purchase_date: '2026-08-03' }),
      ],
      '2026-08',
    );
    assert.equal(out.current, 50);
    assert.equal(out.previous, 0);
  });

  await test('no records at all → current=0, previous=null', () => {
    const out = aggregateMonthlyDelta([], '2026-08');
    assert.equal(out.current, 0);
    assert.equal(out.previous, null);
    assert.equal(out.deltaPct, null);
    assert.equal(out.isImprovement, false);
  });

  console.log('\n[tests] aggregateCategoriesByMonth re-export parity\n');

  await test('re-export is the same function reference as the source (no shadow copy)', () => {
    assert.equal(
      aggregateCategoriesByMonth,
      directAggregate,
      'charts/aggregate.ts must re-export the SAME function — no shadow copy',
    );
  });

  await test('behavioral parity: same input → same output on both paths', () => {
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-08-05',
        category_totals: cats({ lacteos: 50, panaderia: 30 }),
      }),
      receipt({
        id: 'r2',
        purchase_date: '2026-08-12',
        category_totals: cats({ lacteos: 20, limpieza: 15 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08');
    const viaHome = directAggregate(records, '2026-08');
    assert.deepEqual(viaCharts, viaHome);
    // Spot-check the merged totals — sum across the two receipts.
    const lacteos = viaCharts.find((c) => c.key === 'lacteos');
    assert.equal(lacteos?.amount, 70);
  });

  await test('donut parity: receipts in other months are excluded on both paths', () => {
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-07-05', // different month
        category_totals: cats({ lacteos: 99 }),
      }),
      receipt({
        id: 'r2',
        purchase_date: '2026-08-05',
        category_totals: cats({ lacteos: 5 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08');
    const viaHome = directAggregate(records, '2026-08');
    assert.deepEqual(viaCharts, viaHome);
    assert.equal(viaCharts.find((c) => c.key === 'lacteos')?.amount, 5);
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
