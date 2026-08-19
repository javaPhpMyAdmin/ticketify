#!/usr/bin/env node
/**
 * Node harness for the Pro charts' pure aggregations
 * (`src/features/charts/aggregate.ts` → `aggregateSpendTrend`,
 * `aggregateStoresByMonth`, `aggregateMonthlyDelta`, `aggregateWeeklySpend`,
 * `aggregateDailyAverage`, `aggregateDailySpend`, `aggregateYearlySpend`,
 * `aggregateDayItems`, `aggregateDayTotal`, `buildVisibleDailySeries`,
 * `weekdayInitialsForMonth`, `buildDailyInsight`, and the
 * `aggregateCategoriesByMonth` re-export parity check; plus
 * `src/features/charts/categoryHref.ts` → `categoryDetailHref`).
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
 *   `aggregateDailySpend`:
 *     - every day of the month is present, zero-filled (31 in August 2026),
 *     - receipts sum `receipt.total` per day (servicios included),
 *     - days outside the month are ignored,
 *     - a 28-day February (2026) yields exactly 28 entries,
 *     - receipts without a `total` are treated as 0.
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
  const {
    aggregateSpendTrend,
    aggregateStoresByMonth,
    aggregateMonthlyDelta,
    aggregateCategoriesByMonth,
    aggregateWeeklySpend,
    aggregateDailyAverage,
    aggregateDailySpend,
    aggregateDayItems,
    aggregateDayTotal,
    aggregateYearlySpend,
    getTopCategory,
    pickMaxSpendIndex,
    buildVisibleDailySeries,
    weekdayInitialsForMonth,
    buildDailyInsight,
  } = chartsMod;
  const categoryHrefMod = await import(
    pathToFileURL(join(outDir, 'src/features/charts/categoryHref.js')).href
  );
  const { categoryDetailHref } = categoryHrefMod;
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

  console.log('\n[tests] aggregateWeeklySpend\n');

  await test('empty records → seven zero-filled days starting on Monday', () => {
    const out = aggregateWeeklySpend([], '2026-08-10');
    assert.equal(out.length, 7);
    assert.deepEqual(
      out.map((p) => ({ day: p.day, initial: p.initial, amount: p.amount })),
      [
        { day: 'Lun', initial: 'L', amount: 0 },
        { day: 'Mar', initial: 'M', amount: 0 },
        { day: 'Mié', initial: 'M', amount: 0 },
        { day: 'Jue', initial: 'J', amount: 0 },
        { day: 'Vie', initial: 'V', amount: 0 },
        { day: 'Sáb', initial: 'S', amount: 0 },
        { day: 'Dom', initial: 'D', amount: 0 },
      ],
    );
  });

  await test('receipts in the week → summed by day, zero-fill outside days', () => {
    const out = aggregateWeeklySpend(
      [
        receipt({ id: 'r1', total: 50, purchase_date: '2026-08-10' }), // Mon
        receipt({ id: 'r2', total: 30, purchase_date: '2026-08-10' }), // Mon
        receipt({ id: 'r3', total: 20, purchase_date: '2026-08-12' }), // Wed
      ],
      '2026-08-10',
    );
    assert.equal(out[0].amount, 80, 'Monday total');
    assert.equal(out[1].amount, 0, 'Tuesday empty');
    assert.equal(out[2].amount, 20, 'Wednesday total');
    assert.equal(out[3].amount, 0, 'Thursday empty');
    assert.equal(out[4].amount, 0, 'Friday empty');
    assert.equal(out[5].amount, 0, 'Saturday empty');
    assert.equal(out[6].amount, 0, 'Sunday empty');
  });

  await test('receipts outside the requested week are ignored', () => {
    const out = aggregateWeeklySpend(
      [
        receipt({ id: 'r1', total: 99, purchase_date: '2026-08-03' }), // previous week
        receipt({ id: 'r2', total: 10, purchase_date: '2026-08-11' }), // current week Tue
      ],
      '2026-08-10',
    );
    assert.equal(out[0].amount, 0);
    assert.equal(out[1].amount, 10);
    assert.equal(out.reduce((sum, p) => sum + p.amount, 0), 10);
  });

  await test('max-day highlight can be derived from the returned amounts', () => {
    const out = aggregateWeeklySpend(
      [
        receipt({ id: 'r1', total: 10, purchase_date: '2026-08-10' }), // Mon
        receipt({ id: 'r2', total: 45, purchase_date: '2026-08-14' }), // Fri
        receipt({ id: 'r3', total: 30, purchase_date: '2026-08-12' }), // Wed
      ],
      '2026-08-10',
    );
    const max = out.reduce((best, p) => (p.amount > best.amount ? p : best), out[0]);
    assert.equal(max.day, 'Vie');
    assert.equal(max.amount, 45);
  });

  await test('undefined receipt totals are treated as 0', () => {
    const out = aggregateWeeklySpend(
      [receipt({ id: 'r1', total: undefined, purchase_date: '2026-08-10' })],
      '2026-08-10',
    );
    assert.equal(out[0].amount, 0);
  });

  await test('excluded categories are removed from the day totals (servicios)', () => {
    const out = aggregateWeeklySpend(
      [
        receipt({
          id: 'r1',
          total: 100,
          purchase_date: '2026-08-10', // Mon
          category_totals: cats({ servicios: 30, lacteos: 70 }),
        }),
        receipt({
          id: 'r2',
          total: 50,
          purchase_date: '2026-08-12', // Wed
          category_totals: cats({ lacteos: 50 }), // no servicios
        }),
      ],
      '2026-08-10',
      ['servicios'],
    );
    assert.equal(out[0].amount, 70, 'Monday: 100 - 30 servicios');
    assert.equal(out[2].amount, 50, 'Wednesday: nothing to exclude');
    assert.equal(out.reduce((sum, p) => sum + p.amount, 0), 120);
  });

  await test('empty exclusion list keeps the exact previous output (total as-is)', () => {
    const out = aggregateWeeklySpend(
      [
        receipt({
          id: 'r1',
          total: 100,
          purchase_date: '2026-08-10',
          category_totals: cats({ servicios: 30 }),
        }),
      ],
      '2026-08-10',
    );
    assert.equal(out[0].amount, 100, 'receipt.total used as-is without exclusions');
  });

  await test('excluded slug absent from category_totals contributes 0', () => {
    const out = aggregateWeeklySpend(
      [
        receipt({
          id: 'r1',
          total: 80,
          purchase_date: '2026-08-10',
          category_totals: cats({ lacteos: 80 }), // no `servicios` key
        }),
      ],
      '2026-08-10',
      ['servicios'],
    );
    assert.equal(out[0].amount, 80, 'missing slug → nothing removed');
  });

  await test('excluded amount exceeding the total clamps the day to 0 (never negative)', () => {
    // `receipt.total` is the FINAL discounted amount while category_totals
    // are pre-discount lines — a receipt-level discount (or multi-merchant
    // edge) makes servicios > total NORMAL. A negative bar would lie, so
    // the effective total must clamp at 0.
    const out = aggregateWeeklySpend(
      [
        receipt({
          id: 'r1',
          total: 50,
          purchase_date: '2026-08-10',
          category_totals: cats({ servicios: 80 }), // more than the total
        }),
      ],
      '2026-08-10',
      ['servicios'],
    );
    assert.equal(out[0].amount, 0, '50 - 80 would be -30; clamped to 0');
  });

  console.log('\n[tests] aggregateYearlySpend\n');

  await test('empty records → last three years zero-filled, oldest → newest', () => {
    const current = new Date().getFullYear();
    const out = aggregateYearlySpend([]);
    assert.deepEqual(
      out.map((p) => p.year),
      [String(current - 2), String(current - 1), String(current)],
    );
    assert.deepEqual(
      out.map((p) => p.total),
      [0, 0, 0],
    );
  });

  await test('receipts are summed per calendar year', () => {
    const current = new Date().getFullYear();
    const out = aggregateYearlySpend([
      receipt({ id: 'r1', total: 50, purchase_date: `${current}-03-10` }),
      receipt({ id: 'r2', total: 30, purchase_date: `${current}-08-15` }),
      receipt({ id: 'r3', total: 100, purchase_date: `${current - 1}-11-20` }),
    ]);
    const byYear = Object.fromEntries(out.map((p) => [p.year, p.total]));
    assert.equal(byYear[String(current)], 80, 'current year sums both receipts');
    assert.equal(byYear[String(current - 1)], 100);
    assert.equal(byYear[String(current - 2)], 0);
  });

  await test('years outside the last-three window are ignored (zero-filled output)', () => {
    const current = new Date().getFullYear();
    const out = aggregateYearlySpend([
      receipt({ id: 'r1', total: 999, purchase_date: `${current - 5}-05-01` }),
      receipt({ id: 'r2', total: 10, purchase_date: `${current}-01-01` }),
    ]);
    assert.equal(out.length, 3);
    assert.equal(out.reduce((sum, p) => sum + p.total, 0), 10);
  });

  await test('undefined receipt totals are treated as 0', () => {
    const current = new Date().getFullYear();
    const out = aggregateYearlySpend([
      receipt({ id: 'r1', total: undefined, purchase_date: `${current}-01-01` }),
    ]);
    assert.equal(out.find((p) => p.year === String(current))?.total, 0);
  });

  console.log('\n[tests] aggregateDailyAverage\n');

  await test('daily average = month total / days in month', () => {
    const out = aggregateDailyAverage(
      [
        receipt({ id: 'r1', total: 310, purchase_date: '2026-08-05' }),
        receipt({ id: 'r2', total: 90, purchase_date: '2026-08-12' }),
      ],
      '2026-08',
    );
    // August 2026 has 31 days; total = 400 → 400 / 31
    assert.equal(out, 400 / 31);
  });

  await test('receipts outside the requested month are ignored', () => {
    const out = aggregateDailyAverage(
      [
        receipt({ id: 'r1', total: 300, purchase_date: '2026-07-05' }),
        receipt({ id: 'r2', total: 100, purchase_date: '2026-08-12' }),
      ],
      '2026-08',
    );
    assert.equal(out, 100 / 31);
  });

  await test('empty month → daily average is 0', () => {
    const out = aggregateDailyAverage([], '2026-08');
    assert.equal(out, 0);
  });

  await test('February non-leap year has 28 days', () => {
    const out = aggregateDailyAverage(
      [receipt({ id: 'r1', total: 280, purchase_date: '2026-02-10' })],
      '2026-02',
    );
    assert.equal(out, 280 / 28);
  });

  await test('excluded categories are removed before averaging (servicios)', () => {
    const out = aggregateDailyAverage(
      [
        receipt({
          id: 'r1',
          total: 310,
          purchase_date: '2026-08-05',
          category_totals: cats({ servicios: 100, lacteos: 210 }),
        }),
        receipt({ id: 'r2', total: 90, purchase_date: '2026-08-12' }),
      ],
      '2026-08',
      ['servicios'],
    );
    // (310 - 100) + 90 = 300 over August's 31 days.
    assert.equal(out, 300 / 31);
  });

  await test('empty exclusion list keeps the exact previous output', () => {
    const out = aggregateDailyAverage(
      [
        receipt({
          id: 'r1',
          total: 310,
          purchase_date: '2026-08-05',
          category_totals: cats({ servicios: 100 }),
        }),
      ],
      '2026-08',
    );
    assert.equal(out, 310 / 31);
  });

  console.log('\n[tests] aggregateDailySpend\n');

  await test('every day of the month present, zero-filled (August 2026 → 31 entries)', () => {
    const out = aggregateDailySpend([], '2026-08');
    assert.equal(out.length, 31);
    assert.equal(out[0].day, 1);
    assert.equal(out[30].day, 31);
    assert.ok(
      out.every((p) => p.total === 0),
      'days without receipts must be 0, not omitted',
    );
  });

  await test('receipts sum per day (receipt.total, servicios included)', () => {
    const out = aggregateDailySpend(
      [
        receipt({
          id: 'r1',
          total: 100,
          purchase_date: '2026-08-05',
          category_totals: cats({ servicios: 30, lacteos: 70 }),
        }),
        receipt({ id: 'r2', total: 50, purchase_date: '2026-08-05' }),
        receipt({ id: 'r3', total: 30, purchase_date: '2026-08-20' }),
      ],
      '2026-08',
    );
    assert.equal(out[4].total, 150, 'day 5 sums both receipts (servicios INCLUDED)');
    assert.equal(out[19].total, 30, 'day 20');
    assert.equal(out[0].total, 0, 'day 1 zero-filled');
    assert.equal(out[30].total, 0, 'day 31 zero-filled');
  });

  await test('days outside the month are ignored', () => {
    const out = aggregateDailySpend(
      [
        receipt({ id: 'r1', total: 999, purchase_date: '2026-07-31' }),
        receipt({ id: 'r2', total: 10, purchase_date: '2026-08-01' }),
      ],
      '2026-08',
    );
    assert.equal(out.length, 31);
    assert.equal(out.reduce((sum, p) => sum + p.total, 0), 10);
  });

  await test('February non-leap year (2026) has exactly 28 entries', () => {
    const out = aggregateDailySpend(
      [receipt({ id: 'r1', total: 280, purchase_date: '2026-02-28' })],
      '2026-02',
    );
    assert.equal(out.length, 28);
    assert.equal(out[0].day, 1);
    assert.equal(out[27].day, 28);
    assert.equal(out[27].total, 280, 'Feb 28 lands on the last entry');
  });

  await test('30-day month (April 2026) has exactly 30 entries', () => {
    const out = aggregateDailySpend(
      [receipt({ id: 'r1', total: 30, purchase_date: '2026-04-30' })],
      '2026-04',
    );
    assert.equal(out.length, 30);
    assert.equal(out[0].day, 1);
    assert.equal(out[29].day, 30);
    assert.equal(out[29].total, 30, 'Apr 30 lands on the last entry');
  });

  await test('leap-year February (2024) has exactly 29 entries', () => {
    const out = aggregateDailySpend(
      [receipt({ id: 'r1', total: 290, purchase_date: '2024-02-29' })],
      '2024-02',
    );
    assert.equal(out.length, 29);
    assert.equal(out[28].day, 29);
    assert.equal(out[28].total, 290, 'Feb 29 exists on leap years');
  });

  await test('receipts without a `total` are treated as 0 (defensive)', () => {
    const out = aggregateDailySpend(
      [receipt({ id: 'r1', total: undefined, purchase_date: '2026-08-10' })],
      '2026-08',
    );
    assert.equal(out[9].total, 0);
  });

  console.log('\n[tests] aggregateDayItems\n');

  await test('items on the day merge by name and sort by amount desc', () => {
    const out = aggregateDayItems(
      [
        receipt({
          id: 'r1',
          purchase_date: '2026-08-10',
          items: [
            { name: 'leche', amount: 50, category: 'lacteos', quantity: 1 },
            { name: 'pan', amount: 20, category: 'panaderia', quantity: 2 },
          ],
        }),
        receipt({
          id: 'r2',
          purchase_date: '2026-08-10',
          items: [
            { name: 'leche', amount: 60, category: 'lacteos', quantity: 2 },
          ],
        }),
      ],
      '2026-08-10',
    );
    assert.deepEqual(out, [
      { name: 'leche', quantity: 3, amount: 110, store: 'Mercado' },
      { name: 'pan', quantity: 2, amount: 20, store: 'Mercado' },
    ]);
  });

  await test('items from other days are ignored', () => {
    const out = aggregateDayItems(
      [
        receipt({
          id: 'r1',
          purchase_date: '2026-08-10',
          items: [{ name: 'leche', amount: 50, category: 'lacteos' }],
        }),
        receipt({
          id: 'r2',
          purchase_date: '2026-08-11',
          items: [{ name: 'arroz', amount: 999, category: 'alimentos' }],
        }),
      ],
      '2026-08-10',
    );
    assert.deepEqual(out, [{ name: 'leche', quantity: 0, amount: 50, store: 'Mercado' }]);
  });

  await test('excluded categories never appear (servicios)', () => {
    const out = aggregateDayItems(
      [
        receipt({
          id: 'r1',
          purchase_date: '2026-08-10',
          items: [
            { name: 'Luz', amount: 300, category: 'servicios' },
            { name: 'leche', amount: 50, category: 'lacteos' },
          ],
        }),
      ],
      '2026-08-10',
      ['servicios'],
    );
    assert.deepEqual(out, [{ name: 'leche', quantity: 0, amount: 50, store: 'Mercado' }]);
  });

  await test('first-seen casing wins for the display name', () => {
    const out = aggregateDayItems(
      [
        receipt({
          id: 'r1',
          purchase_date: '2026-08-10',
          items: [{ name: 'Leche', amount: 50, category: 'lacteos' }],
        }),
        receipt({
          id: 'r2',
          purchase_date: '2026-08-10',
          items: [{ name: 'leche', amount: 60, category: 'lacteos' }],
        }),
      ],
      '2026-08-10',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Leche', 'first-seen casing preserved');
    assert.equal(out[0].amount, 110);
  });

  await test('whitespace-only item names are skipped', () => {
    const out = aggregateDayItems(
      [
        receipt({
          id: 'r1',
          purchase_date: '2026-08-10',
          items: [
            { name: '   ', amount: 5, category: 'otros' },
            { name: 'pan', amount: 20, category: 'panaderia' },
          ],
        }),
      ],
      '2026-08-10',
    );
    assert.deepEqual(out, [{ name: 'pan', quantity: 0, amount: 20, store: 'Mercado' }]);
  });

  await test('empty day → empty list', () => {
    const out = aggregateDayItems([], '2026-08-10');
    assert.deepEqual(out, []);
  });

  console.log('\n[tests] aggregateDayTotal\n');

  await test('day total = sum of effective receipt totals (servicios removed)', () => {
    const out = aggregateDayTotal(
      [
        receipt({
          id: 'r1',
          total: 100,
          purchase_date: '2026-08-10',
          category_totals: cats({ servicios: 30, lacteos: 70 }),
        }),
        receipt({
          id: 'r2',
          total: 50,
          purchase_date: '2026-08-10',
          category_totals: cats({ lacteos: 50 }), // no servicios
        }),
      ],
      '2026-08-10',
      ['servicios'],
    );
    assert.equal(out, 120, '(100 - 30) + 50');
  });

  await test('day total matches the weekly bar amount for the same day', () => {
    const records = [
      receipt({
        id: 'r1',
        total: 100,
        purchase_date: '2026-08-10',
        category_totals: cats({ servicios: 30 }),
      }),
      receipt({ id: 'r2', total: 20, purchase_date: '2026-08-12' }),
    ];
    const week = aggregateWeeklySpend(records, '2026-08-10', ['servicios']);
    assert.equal(aggregateDayTotal(records, '2026-08-10', ['servicios']), week[0].amount);
  });

  await test('receipts from other days are ignored', () => {
    const out = aggregateDayTotal(
      [
        receipt({ id: 'r1', total: 999, purchase_date: '2026-08-11' }),
        receipt({ id: 'r2', total: 10, purchase_date: '2026-08-10' }),
      ],
      '2026-08-10',
    );
    assert.equal(out, 10);
  });

  await test('clamps at 0 when excluded amounts exceed the receipt total', () => {
    const out = aggregateDayTotal(
      [
        receipt({
          id: 'r1',
          total: 50,
          purchase_date: '2026-08-10',
          category_totals: cats({ servicios: 80 }),
        }),
      ],
      '2026-08-10',
      ['servicios'],
    );
    assert.equal(out, 0, '50 - 80 clamps to 0, not -30');
  });

  await test('undefined receipt totals are treated as 0', () => {
    const out = aggregateDayTotal(
      [receipt({ id: 'r1', total: undefined, purchase_date: '2026-08-10' })],
      '2026-08-10',
    );
    assert.equal(out, 0);
  });

  await test('no receipts on the day → 0', () => {
    const out = aggregateDayTotal([], '2026-08-10');
    assert.equal(out, 0);
  });

  console.log('\n[tests] getTopCategory\n');

  await test('top category is the highest-spend category in the month', () => {
    const out = getTopCategory(
      [
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
      ],
      '2026-08',
    );
    assert.equal(out?.key, 'lacteos');
    assert.equal(out?.amount, 70);
  });

  await test('other months are excluded when computing the top category', () => {
    const out = getTopCategory(
      [
        receipt({
          id: 'r1',
          purchase_date: '2026-07-05',
          category_totals: cats({ lacteos: 999 }),
        }),
        receipt({
          id: 'r2',
          purchase_date: '2026-08-05',
          category_totals: cats({ panaderia: 10 }),
        }),
      ],
      '2026-08',
    );
    assert.equal(out?.key, 'panaderia');
    assert.equal(out?.amount, 10);
  });

  await test('empty month → top category is null', () => {
    const out = getTopCategory([], '2026-08');
    assert.equal(out, null);
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

  console.log('\n[tests] pickMaxSpendIndex\n');

  await test('returns the index of the highest amount (first max wins on ties)', () => {
    assert.equal(pickMaxSpendIndex([10, 50, 30]), 1);
    assert.equal(pickMaxSpendIndex([40, 40, 10]), 0, 'first max on ties');
    assert.equal(pickMaxSpendIndex([0, 0, 5]), 2);
  });

  await test('all-zero or empty series returns -1 (no highlight)', () => {
    assert.equal(pickMaxSpendIndex([0, 0, 0]), -1);
    assert.equal(pickMaxSpendIndex([]), -1);
    assert.equal(pickMaxSpendIndex([-1, 0]), -1, 'non-positive values never highlight');
  });

  await test('ignores the week-day index position, not the calendar day', () => {
    // Shape mirrors `aggregateWeeklySpend` output amounts (Sunday → Monday
    // ordering is irrelevant to the helper: it only compares amounts).
    assert.equal(pickMaxSpendIndex([5, 100, 3, 2, 1, 0, 50]), 1);
  });

  console.log('\n[tests] buildVisibleDailySeries\n');

  await test('cbrt scale: small days keep visible wave next to outliers', () => {
    const { points, yMax } = buildVisibleDailySeries([
      { day: 1, total: 20289.51 },
      { day: 2, total: 5862 },
      { day: 3, total: 812.24 },
      { day: 4, total: 560 },
    ]);
    const cbrt = (n) => Math.cbrt(n);
    const maxCbrt = cbrt(20289.51);
    assert.equal(yMax, maxCbrt * 1.1);
    // Heights (scaled) — the point of the transform: $560 reaches ~30% of
    // the plot (560/20289 = 2.8% raw and ~15% sqrt would be invisible).
    assert.equal(points[0].total, maxCbrt);
    assert.equal(points[3].total, cbrt(560));
    assert.ok(points[3].total / yMax > 0.25, 'small day occupies >25% height');
    assert.ok(
      points[2].total / yMax < points[1].total / yMax,
      'monotonic: 812 < 5862 in scaled space',
    );
    // Outlier is compressed: 20289 vs 5862 is 3.46x raw but ~1.5x scaled.
    assert.ok(points[0].total / points[1].total < 1.7);
  });

  await test('zero days stay zero, negative never goes below zero', () => {
    const { points } = buildVisibleDailySeries([
      { day: 1, total: 0 },
      { day: 2, total: -5 },
      { day: 3, total: 100 },
    ]);
    assert.equal(points[0].total, 0);
    assert.equal(points[1].total, 0);
    assert.equal(points[2].total, Math.cbrt(100));
  });

  await test('all-zero series: yMax falls back to 1', () => {
    const { points, yMax } = buildVisibleDailySeries([
      { day: 1, total: 0 },
      { day: 2, total: 0 },
    ]);
    assert.equal(yMax, 1);
    assert.deepEqual(points, [
      { day: 1, total: 0 },
      { day: 2, total: 0 },
    ]);
  });

  await test('real august shape: every spend day gets visible wave', () => {
    const points = [572.27, 762.77, 20289.51, 4820.72, 3367.32, 1973.37, 1276.71, 0, 0, 560.45, 526.42, 381.58, 5862, 812.24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const data = points.map((total, index) => ({ day: index + 1, total }));
    const { points: out, yMax } = buildVisibleDailySeries(data);
    assert.equal(out[2].total, Math.cbrt(20289.51), 'day 3 highest');
    assert.ok(out[9].total / yMax > 0.25, 'day 10 ($560) clear wave');
    assert.ok(out[10].total / yMax > 0.25, 'day 11 ($526) clear wave');
    assert.ok(out[12].total / yMax > out[13].total / yMax, 'day 13 taller than day 14');
    assert.equal(out[14].total, 0, 'day 15 stays zero');
    assert.equal(out[15].total, 0, 'day 16 stays zero');
  });

  console.log('\n[tests] weekdayInitialsForMonth\n');

  await test('august 2026 starts on Saturday: S D L M M J V …', () => {
    const initials = weekdayInitialsForMonth('2026-08');
    assert.equal(initials.length, 31);
    assert.deepEqual(initials.slice(0, 8), ['S', 'D', 'L', 'M', 'M', 'J', 'V', 'S']);
    assert.equal(initials[9], 'L', 'day 10 is Monday');
    assert.equal(initials[12], 'J', 'day 13 is Thursday');
    assert.equal(initials[14], 'S', 'day 15 is Saturday');
    assert.equal(initials[15], 'D', 'day 16 is Sunday');
  });

  await test('february 2024 (leap) starts on Thursday and has 29 entries', () => {
    const initials = weekdayInitialsForMonth('2024-02');
    assert.equal(initials.length, 29);
    assert.deepEqual(initials.slice(0, 5), ['J', 'V', 'S', 'D', 'L']);
  });

  await test('january 2026 starts on Thursday', () => {
    const initials = weekdayInitialsForMonth('2026-01');
    assert.equal(initials.length, 31);
    assert.equal(initials[0], 'J');
  });

  await test('malformed month key returns empty array', () => {
    assert.deepEqual(weekdayInitialsForMonth('garbage'), []);
    assert.deepEqual(weekdayInitialsForMonth('2026-13'), []);
  });

  console.log('\n[tests] buildDailyInsight\n');

  // Real August 2026 fixture (same shape as the hero curve tests): day 3
  // is the $20,289.51 spike, Monday. Sum = 41,205.36 → avg ≈ $1,329.21 →
  // 20,289.51 / 1,329.21 ≈ 15.26 → rounds to 15.
  const AUGUST_2026 = [
    572.27, 762.77, 20289.51, 4820.72, 3367.32, 1973.37, 1276.71,
    0, 0, 560.45, 526.42, 381.58, 5862, 812.24,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ].map((total, index) => ({ day: index + 1, total }));

  await test('real august fixture: day 3 → Lunes, $20,289.51, ≈15x', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08');
    assert.equal(insight.day, 3);
    assert.equal(insight.weekday, 'Lunes');
    assert.equal(insight.amount, 20289.51);
    assert.equal(insight.multiple, 15);
  });

  await test('first max wins on ties (and weekday is monthKey-derived)', () => {
    const insight = buildDailyInsight(
      [
        { day: 1, total: 0 },
        { day: 2, total: 100 },
        { day: 3, total: 100 },
      ],
      '2026-08',
    );
    assert.equal(insight.day, 2, 'first of the two max days wins');
    assert.equal(insight.weekday, 'Domingo', 'Aug 2, 2026 is a Sunday');
    assert.equal(insight.amount, 100);
  });

  await test('single spend day → multiple equals days in month', () => {
    const dailyData = Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 310 : 0, // only day 5 has spend
    }));
    const insight = buildDailyInsight(dailyData, '2026-08');
    assert.equal(insight.day, 5);
    assert.equal(insight.amount, 310);
    // 310 / (310 / 31) = 31 — a single-spend month is "31x your average".
    assert.equal(insight.multiple, 31);
  });

  await test('single spend day in February 2026 (28 days) → multiple 28', () => {
    const dailyData = Array.from({ length: 28 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 280 : 0, // only day 5 has spend
    }));
    const insight = buildDailyInsight(dailyData, '2026-02');
    assert.equal(insight.day, 5);
    assert.equal(insight.amount, 280);
    // 280 / (280 / 28) = 28 — a single-spend February is "28x your average".
    assert.equal(insight.multiple, 28);
  });

  await test('single spend day in leap February 2024 (29 days) → multiple 29', () => {
    const dailyData = Array.from({ length: 29 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 290 : 0, // only day 5 has spend
    }));
    const insight = buildDailyInsight(dailyData, '2024-02');
    assert.equal(insight.day, 5);
    assert.equal(insight.amount, 290);
    // 290 / (290 / 29) = 29 — a single-spend leap February is "29x".
    assert.equal(insight.multiple, 29);
  });

  await test('round + clamp: rounds to nearest integer, never emits 0 or negative (Math.max(1, ·))', () => {
    const insight = buildDailyInsight(
      [
        { day: 1, total: 100 },
        { day: 2, total: 99 },
      ],
      '2026-08',
    );
    // 100 / 99.5 ≈ 1.005 → rounds to 1; the clamp keeps it at 1, not 0.
    assert.equal(insight.multiple, 1);
    assert.ok(insight.multiple >= 1, 'never below 1');
    assert.ok(Number.isFinite(insight.multiple), 'never NaN');
    assert.ok(Number.isFinite(insight.amount), 'amount is a finite number');
  });

  await test('malformed month keys → null (strict YYYY-MM guard)', () => {
    // A spend-bearing series proves the monthKey guard (not the all-zero
    // path) is what rejects these: month out of range, unpadded month,
    // non-numeric garbage, and a full ISO date (not a month key).
    const dailyData = Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 310 : 0, // only day 5 has spend
    }));
    assert.equal(buildDailyInsight(dailyData, '2026-13'), null, 'month 13 out of range');
    assert.equal(buildDailyInsight(dailyData, '2026-8'), null, 'unpadded month');
    assert.equal(buildDailyInsight(dailyData, 'garbage'), null, 'non-numeric key');
    assert.equal(buildDailyInsight(dailyData, '2026-08-15'), null, 'full ISO date is not a month key');
  });

  await test('all-zero month → null (insight hidden)', () => {
    const allZero = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, total: 0 }));
    assert.equal(buildDailyInsight(allZero, '2026-08'), null);
  });

  await test('empty daily data → null', () => {
    assert.equal(buildDailyInsight([], '2026-08'), null);
  });

  console.log('\n[tests] categoryDetailHref\n');

  await test('current month → bare route, no month param', () => {
    assert.equal(
      categoryDetailHref('compras', '2026-08', '2026-08'),
      '/categories/compras',
    );
  });

  await test('other month → route scoped with ?month=YYYY-MM', () => {
    assert.equal(
      categoryDetailHref('compras', '2026-07', '2026-08'),
      '/categories/compras?month=2026-07',
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
}
