#!/usr/bin/env node
/**
 * Node harness for the pure month-to-date run-rate aggregation
 * (`src/features/home/lib/runRate.ts`, spec `monthly-run-rate`).
 *
 * Compiles the run-rate module plus its dependency graph (home feed,
 * auth, stores, react-query) into a temp directory with an isolated
 * tsconfig that remaps the native/backend imports to the hand-written
 * test doubles, then asserts the 15-case contract from design.md:
 *
 *  1. MoM happy path — day-vs-day window + linear projection
 *  2. MoM delta negative — signed negative percent
 *  3. Future-day clamp — days after `referenceDate` excluded from MTD
 *     AND from the spend-day count
 *  4. Stray month keys — foreign `YYYY-MM-DD` keys inside a row ignored
 *  5. Fallback prorating (AD-1) — mean of ≤3 prior months × day/daysInMonth
 *  6. Fallback, 1 available month — single-month mean
 *  7. Fallback, none available / current row missing → null
 *  8. MoM window empty → fallback path (REQ-2 scenario 2)
 *  8b. MoM window negative → fallback path (baseline > 0 contract)
 *  9. Day 1-2 gate — < 3 spend days hides; 3rd day reveals
 * 10. Empty month — `{}` daily_totals hides (MTD 0 is valid, REQ-5b gates)
 * 11. Feb vs 31-day — projection denominator = current month; prev window
 *     capped day-vs-day
 * 12. Year rollover — January compares against December (previousMonthKey)
 * 13. Rounding + −0 — near-zero delta → `0` (not `-0`); 12.34 → 12.3
 * 14. Zero-ish baseline — zero mean / zero window → null (no div-by-zero)
 *
 * Deterministic: no clock, fixed `YYYY-MM-DD` referenceDate fixtures.
 *
 * Usage: pnpm test:run-rate
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
const harnessConfig = join(__dirname, 'tsconfig.run-rate-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'run-rate-test-'));
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

async function run() {
  console.log('\n[tests] compiling run-rate modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const runRateMod = await load('src/features/home/lib/runRate.js');
  const aggregate = (rows, referenceDate) =>
    runRateMod.aggregateRunRate(rows, referenceDate);

  // ── design case 1: MoM happy path ────────────────────────────────────────
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

  console.log('\n[tests] MoM baseline\n');

  await test(
    '1. MoM happy path: same-days window, signed delta, linear projection',
    () => {
      const result = aggregate([sep7200, aug6000], '2026-09-08');
      assert.deepEqual(result, {
        mtd: 7200,
        baseline: 6000,
        deltaPct: 20,
        projection: 27000,
        source: 'mom',
      });
    },
  );

  await test('2. MoM delta negative: MTD below baseline → signed minus', () => {
    const sep5000 = makeCacheRow({
      year_month: '2026-09',
      total: 5000,
      daily_totals: {
        '2026-09-01': 600,
        '2026-09-02': 700,
        '2026-09-03': 500,
        '2026-09-04': 600,
        '2026-09-05': 700,
        '2026-09-06': 600,
        '2026-09-07': 700,
        '2026-09-08': 600,
      },
    });
    const result = aggregate([sep5000, aug6000], '2026-09-08');
    assert.equal(result.mtd, 5000);
    assert.equal(result.baseline, 6000);
    assert.equal(result.deltaPct, -16.7);
    assert.equal(result.source, 'mom');
  });

  await test('3. Future-day clamp: day 12 excluded from MTD and spend count', () => {
    const sepWithFuture = makeCacheRow({
      year_month: '2026-09',
      total: 12200,
      daily_totals: {
        ...sep7200.daily_totals,
        '2026-09-12': 5000,
      },
    });
    const result = aggregate([sepWithFuture, aug6000], '2026-09-08');
    assert.deepEqual(result, {
      mtd: 7200,
      baseline: 6000,
      deltaPct: 20,
      projection: 27000,
      source: 'mom',
    });
  });

  await test('4. Stray month keys: foreign dates inside the row are ignored', () => {
    const sepWithStrays = makeCacheRow({
      year_month: '2026-09',
      total: 8754,
      daily_totals: {
        ...sep7200.daily_totals,
        '2026-08-05': 999,
        '2026-10-01': 555,
      },
    });
    const result = aggregate([sepWithStrays, aug6000], '2026-09-08');
    assert.deepEqual(result, {
      mtd: 7200,
      baseline: 6000,
      deltaPct: 20,
      projection: 27000,
      source: 'mom',
    });
  });

  console.log('\n[tests] historical fallback\n');

  await test('5. Fallback prorating (AD-1): May+Jun+Jul ÷ 3 × 8/30', () => {
    const jul27000 = makeCacheRow({ year_month: '2026-07', total: 27000 });
    const jun24000 = makeCacheRow({ year_month: '2026-06', total: 24000 });
    const may21000 = makeCacheRow({ year_month: '2026-05', total: 21000 });
    // Rows passed out of order: fallback sorts by year_month desc itself.
    const result = aggregate([sep7200, jun24000, may21000, jul27000], '2026-09-08');
    assert.deepEqual(result, {
      mtd: 7200,
      baseline: 6400,
      deltaPct: 12.5,
      projection: 27000,
      source: 'fallback',
    });
  });

  await test('6. Fallback, 1 available month: single-month mean prorated', () => {
    const sep6000 = makeCacheRow({
      year_month: '2026-09',
      total: 6000,
      daily_totals: {
        '2026-09-01': 800,
        '2026-09-02': 700,
        '2026-09-03': 600,
        '2026-09-04': 900,
        '2026-09-05': 700,
        '2026-09-06': 800,
        '2026-09-07': 900,
        '2026-09-08': 600,
      },
    });
    const jul27000 = makeCacheRow({ year_month: '2026-07', total: 27000 });
    const result = aggregate([sep6000, jul27000], '2026-09-08');
    assert.equal(result.mtd, 6000);
    assert.equal(result.baseline, 7200); // 27000 × 8/30
    assert.equal(result.deltaPct, -16.7);
    assert.equal(result.source, 'fallback');
  });

  await test('7. Fallback, none available → null; missing current row → null', () => {
    assert.equal(aggregate([sep7200], '2026-09-08'), null);
    // Gate 1: no current-month row at all (REQ-6) — never fabricate.
    assert.equal(aggregate([aug6000], '2026-09-08'), null);
  });

  await test('8. MoM window empty → fallback path (REQ-2 scenario 2)', () => {
    const augDay20Only = makeCacheRow({
      year_month: '2026-08',
      total: 18000,
      daily_totals: { '2026-08-20': 18000 },
    });
    const jul27000 = makeCacheRow({ year_month: '2026-07', total: 27000 });
    const result = aggregate([sep7200, augDay20Only, jul27000], '2026-09-08');
    assert.equal(result.mtd, 7200);
    // Aug window (days 1..8) is 0 → fallback over Aug+Jul: (18000+27000)/2 × 8/30
    assert.equal(result.baseline, 6000);
    assert.equal(result.deltaPct, 20);
    assert.equal(result.source, 'fallback');
  });

  await test('8b. MoM window NEGATIVE → fallback path (> 0 branch)', () => {
    // A negative window is not producible by real spend data (cache sums
    // confirmed purchases), but the contract requires baseline > 0: the
    // `momWindow > 0` check must drop to fallback instead of emitting a
    // meaningless signed delta. A refactor back to `=== 0` would fail here.
    const augNegativeWindow = makeCacheRow({
      year_month: '2026-08',
      total: 18000,
      daily_totals: {
        '2026-08-01': -1000,
        '2026-08-02': -1000,
        '2026-08-03': -1000,
        '2026-08-04': -1000,
        '2026-08-05': -1000,
        '2026-08-06': -1000,
        '2026-08-07': -1000,
        '2026-08-08': -1000,
        '2026-08-20': 26000, // outside days 1..8 window; keeps row.total positive
      },
    });
    const jul27000 = makeCacheRow({ year_month: '2026-07', total: 27000 });
    const result = aggregate([sep7200, augNegativeWindow, jul27000], '2026-09-08');
    assert.equal(result.mtd, 7200);
    // Negative Aug window ignored → fallback over Aug+Jul: (18000+27000)/2 × 8/30
    assert.equal(result.baseline, 6000);
    assert.equal(result.deltaPct, 20);
    assert.equal(result.source, 'fallback');
  });

  console.log('\n[tests] visibility gates and calendar edges\n');

  await test('9. Day 1-2 gate: < 3 spend days hides; 3rd day reveals', () => {
    const sepTwoDays = makeCacheRow({
      year_month: '2026-09',
      total: 1900,
      daily_totals: { '2026-09-01': 1000, '2026-09-02': 900 },
    });
    assert.equal(aggregate([sepTwoDays, aug6000], '2026-09-02'), null);

    const sepThreeDays = makeCacheRow({
      year_month: '2026-09',
      total: 2700,
      daily_totals: { '2026-09-01': 1000, '2026-09-02': 900, '2026-09-03': 800 },
    });
    const augThreeDays = makeCacheRow({
      year_month: '2026-08',
      total: 1500,
      daily_totals: { '2026-08-01': 600, '2026-08-02': 500, '2026-08-03': 400 },
    });
    assert.deepEqual(aggregate([sepThreeDays, augThreeDays], '2026-09-03'), {
      mtd: 2700,
      baseline: 1500,
      deltaPct: 80,
      projection: 27000,
      source: 'mom',
    });
  });

  await test('10. Empty month: {} daily_totals hides (MTD 0 is valid)', () => {
    const sepEmpty = makeCacheRow({ year_month: '2026-09', total: 0, daily_totals: {} });
    assert.equal(aggregate([sepEmpty, aug6000], '2026-09-08'), null);
  });

  await test('11. Feb vs 31-day: current-month denominator, day-vs-day window', () => {
    const feb5000 = makeCacheRow({
      year_month: '2026-02',
      total: 5000,
      daily_totals: dailyRange('2026-02', 10, 500),
    });
    const jan4000 = makeCacheRow({
      year_month: '2026-01',
      total: 4000,
      daily_totals: dailyRange('2026-01', 10, 400),
    });
    // Projection denominator is Feb's 28 days, NOT January's 31.
    assert.deepEqual(aggregate([feb5000, jan4000], '2026-02-10'), {
      mtd: 5000,
      baseline: 4000,
      deltaPct: 25,
      projection: 14000, // 5000/10 × 28
      source: 'mom',
    });

    // 31-day previous month: the window is capped at day 10 — the day-15
    // entry in Jan 2027 must NOT leak into the baseline.
    const feb2027 = makeCacheRow({
      year_month: '2027-02',
      total: 5000,
      daily_totals: dailyRange('2027-02', 10, 500),
    });
    const jan2027 = makeCacheRow({
      year_month: '2027-01',
      total: 8000,
      daily_totals: { ...dailyRange('2027-01', 10, 300), '2027-01-15': 5000 },
    });
    const rollover = aggregate([feb2027, jan2027], '2027-02-10');
    assert.equal(rollover.mtd, 5000);
    assert.equal(rollover.baseline, 3000); // days 1..10 only, day 15 excluded
    assert.equal(rollover.source, 'mom');
  });

  await test('12. Year rollover: January vs previous December', () => {
    const jan5500 = makeCacheRow({
      year_month: '2026-01',
      total: 5500,
      daily_totals: dailyRange('2026-01', 5, 1100),
    });
    const dec5000 = makeCacheRow({
      year_month: '2025-12',
      total: 5000,
      daily_totals: dailyRange('2025-12', 5, 1000),
    });
    // January has 31 days → projection denominator 31.
    assert.deepEqual(aggregate([jan5500, dec5000], '2026-01-05'), {
      mtd: 5500,
      baseline: 5000,
      deltaPct: 10,
      projection: 34100, // 5500/5 × 31
      source: 'mom',
    });
  });

  console.log('\n[tests] rounding and zero baselines\n');

  await test('13. Rounding + −0: near-zero delta normalizes to +0; 12.34 → 12.3', () => {
    const sepNearFlat = makeCacheRow({
      year_month: '2026-09',
      total: 1000400,
      daily_totals: dailyRange('2026-09', 8, 125050),
    });
    const augFlat = makeCacheRow({
      year_month: '2026-08',
      total: 1000000,
      daily_totals: dailyRange('2026-08', 8, 125000),
    });
    const flat = aggregate([sepNearFlat, augFlat], '2026-09-08');
    // (1000400−1000000)/1000000×1000 = 0.4 → rounds to +0.
    assert.equal(flat.deltaPct, 0);
    assert.equal(1 / flat.deltaPct, Infinity); // +0, not -0 (AD-7)

    // Below-baseline mirror: Math.round(-0.4) is −0 per spec → must normalize.
    const sepBelowFlat = makeCacheRow({
      year_month: '2026-09',
      total: 999600,
      daily_totals: dailyRange('2026-09', 8, 124950),
    });
    const below = aggregate([sepBelowFlat, augFlat], '2026-09-08');
    assert.equal(below.deltaPct, 0);
    assert.equal(Object.is(below.deltaPct, -0), false);
    assert.equal(1 / below.deltaPct, Infinity);

    const sep1234 = makeCacheRow({
      year_month: '2026-09',
      total: 112340,
      daily_totals: {
        '2026-09-01': 10000,
        '2026-09-02': 15000,
        '2026-09-03': 12000,
        '2026-09-04': 11000,
        '2026-09-05': 19000,
        '2026-09-06': 13100,
        '2026-09-07': 16240,
        '2026-09-08': 16000,
      },
    });
    const aug100000 = makeCacheRow({
      year_month: '2026-08',
      total: 100000,
      daily_totals: dailyRange('2026-08', 8, 12500),
    });
    assert.equal(aggregate([sep1234, aug100000], '2026-09-08').deltaPct, 12.3);
  });

  await test('14. Zero-ish baseline: zero window/mean → null (no div-by-zero)', () => {
    const zeroAug = makeCacheRow({ year_month: '2026-08', total: 0, daily_totals: {} });
    const zeroJul = makeCacheRow({ year_month: '2026-07', total: 0 });
    const zeroJun = makeCacheRow({ year_month: '2026-06', total: 0 });
    // MoM window 0 → fallback; fallback mean 0 → baseline 0 → null.
    assert.equal(aggregate([sep7200, zeroAug, zeroJul, zeroJun], '2026-09-08'), null);
    // No Aug row at all; every preceding month totals 0 → mean 0 → null.
    const zeroMay = makeCacheRow({ year_month: '2026-05', total: 0 });
    assert.equal(aggregate([sep7200, zeroJul, zeroJun, zeroMay], '2026-09-08'), null);
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});