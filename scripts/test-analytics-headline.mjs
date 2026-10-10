#!/usr/bin/env node
/**
 * Node harness for the pure analytics headline decision
 * (`src/features/analytics/analytics-headline.ts`).
 *
 * Compiles the single dependency-free module into a temp directory with an
 * isolated tsconfig, then asserts the headline contract (since 0044 the
 * totals are GROUPED per unit, decision 9):
 *
 *   - personal mode → the caller's own per-unit totals + personal change
 *     badge (regression guard for the original behavior),
 *   - household mode with resolved data → the real household per-unit
 *     totals + NO personal change badge (scope mix would mislead),
 *   - household mode WITHOUT resolved data (loading/error) → a placeholder
 *     (null totals), NEVER a false "$0.00" from an unresolved RPC,
 *   - zero/empty household totals stay groups with numeric 0 (never NaN),
 *   - a NaN aggregate is coerced to 0 per group (never prints NaN).
 *
 * Also pins the Analytics "Top Artículos" single-series binding (money
 * integrity, decision 9): the item pipeline that feeds the top-items list and
 * its `topItemsTotal` denominator must reduce ONLY viewer-unit rows — the
 * exact `aggregateItemsByMonth(bindViewerRows(rows, viewer), …)` composition
 * the screen runs after the query. Mixed USD/CLP/legacy fixtures prove a
 * cross-unit sum never reaches the single viewer-currency figure.
 *
 * Deterministic: the headline function takes primitives only, no clock, no
 * hooks; the item pipeline is pure over fixed fixtures.
 *
 * Usage: pnpm test:analytics-headline
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.analytics-headline-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'analytics-headline-test-'));
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
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `@/…` (or the native-bound modules) in the compiled CommonJS
 * output. Same hook as the charts/home harnesses.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'expo-localization') {
      request = join(outDir, 'scripts', 'test-stubs', 'expo-localization.js');
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

async function run() {
  console.log('\n[tests] compiling analytics-headline modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const mod = await load('src/features/analytics/analytics-headline.js');
  const build = (viewMode, opts) => mod.buildOverviewHeadline(viewMode, opts);
  // The Analytics "Top Artículos" pipeline: `bindViewerRows` (charts) feeds
  // `aggregateItemsByMonth` (home feed) — same two functions the screen composes.
  const chartsMod = await load('src/features/charts/aggregate.js');
  const homeFeedMod = await load('src/features/home/hooks/useHomeFeed.js');
  const { bindViewerRows } = chartsMod;
  const { aggregateItemsByMonth } = homeFeedMod;

  console.log('\n[tests] personal mode\n');

  await test(
    'personal mode returns overviewTotals + personal changePct (regression guard)',
    () => {
      const result = build('personal', {
        householdTotals: [{ total: 999999, currency: 'CLP' }],
        overviewTotals: [
          { total: 12345, currency: 'UYU' },
          { total: 678, currency: 'CLP' },
        ],
        personalChangePct: 12.5,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, {
        headlineTotals: [
          { total: 12345, currency: 'UYU' },
          { total: 678, currency: 'CLP' },
        ],
        headlineChangePct: 12.5,
      });
    },
  );

  await test('personal mode keeps a null personal changePct (no badge)', () => {
    const result = build('personal', {
      householdTotals: [],
      overviewTotals: [{ total: 0, currency: 'UYU' }],
      personalChangePct: null,
      hasHouseholdData: false,
    });
    assert.deepEqual(result, {
      headlineTotals: [{ total: 0, currency: 'UYU' }],
      headlineChangePct: null,
    });
  });

  console.log('\n[tests] household mode\n');

  await test(
    'household mode returns householdTotals per unit + changePct null (no scope mix)',
    () => {
      const result = build('household', {
        householdTotals: [
          { total: 54321, currency: 'UYU' },
          { total: 900, currency: 'CLP' },
        ],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [
          { total: 54321, currency: 'UYU' },
          { total: 900, currency: 'CLP' },
        ],
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: a unit-less group keeps its null unit (row fallback is caller-side)',
    () => {
      const result = build('household', {
        householdTotals: [{ total: 42, currency: undefined }],
        overviewTotals: [],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [{ total: 42, currency: undefined }],
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: empty household totals stay a numeric 0 group (never NaN, never placeholder)',
    () => {
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [{ total: 0 }],
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: a NaN aggregate is coerced to 0 per group, never prints NaN',
    () => {
      const result = build('household', {
        householdTotals: [
          { total: NaN, currency: 'UYU' },
          { total: 50, currency: 'UYU' },
        ],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [
          { total: 0, currency: 'UYU' },
          { total: 50, currency: 'UYU' },
        ],
        headlineChangePct: null,
      });
    },
  );

  console.log('\n[tests] household mode without resolved data\n');

  await test(
    'household mode WITHOUT data returns placeholder (null totals), never $0',
    () => {
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, {
        headlineTotals: null,
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode while loading (data not yet resolved) → placeholder',
    () => {
      // During the RPC flight the totals are already [] (derived from an
      // empty `data ?? []`); hasHouseholdData false must gate it to null.
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 777, currency: 'UYU' }],
        personalChangePct: -5,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, { headlineTotals: null, headlineChangePct: null });
    },
  );

  await test(
    'household mode while errored (hasData false) → placeholder',
    () => {
      // On RPC error the data never resolves: same gate, no $0.00.
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 777, currency: 'UYU' }],
        personalChangePct: null,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, { headlineTotals: null, headlineChangePct: null });
    },
  );

  console.log('\n[tests] top-items single-series binding (decision 9)\n');

  // Mirrors the Analytics screen's composition
  // `aggregateItemsByMonth(bindViewerRows(fullMonthList, currency), monthKey,
  // ['servicios'])`: the top-items list and its `topItemsTotal` denominator
  // render under ONE viewer-currency label, so only viewer-unit rows may flow
  // in. Unit-less legacy rows count as the viewer (REQ-8 s4); utility bills
  // (servicios) stay excluded regardless of unit.
  const item = (name, amount, category = 'almacen') => ({
    id: `${name}-${amount}`,
    name,
    amount,
    category,
  });
  const monthRow = (id, currency, items) => ({
    id,
    store_name: 'Mercado',
    purchase_date: '2026-08-05',
    total: items.reduce((sum, i) => sum + i.amount, 0),
    category_totals: {},
    items,
    ...(currency === undefined ? {} : { currency }),
  });
  const mixedItems = [
    monthRow('r-usd-1', 'USD', [item('Leche 1kg', 4)]),
    monthRow('r-usd-2', 'USD', [item('Leche 500g', 6)]),
    monthRow('r-legacy', undefined, [item('Arroz', 2)]),
    monthRow('r-clp', 'CLP', [item('Pan', 500)]),
    monthRow('r-usd-serv', 'USD', [item('Luz', 900, 'servicios')]),
  ];
  const pipeline = (rows, viewer) =>
    aggregateItemsByMonth(bindViewerRows(rows, viewer), '2026-08', ['servicios']);

  await test('a USD viewer reduces ONLY USD rows (+ legacy), never the CLP row', () => {
    const items = pipeline(mixedItems, 'USD');
    assert.deepEqual(
      items,
      [
        { name: 'leche', amount: 10 },
        { name: 'arroz', amount: 2 },
      ],
      'the two USD rows merge (unit-stripped names), the legacy row counts, the CLP row is bound out',
    );
    assert.equal(
      items.reduce((sum, i) => sum + i.amount, 0),
      12,
      'the CLP row (500) and the servicios row (900) never reach the USD total',
    );
  });

  await test('a CLP viewer reduces ONLY CLP rows (+ legacy), never the USD rows', () => {
    const items = pipeline(mixedItems, 'CLP');
    assert.deepEqual(items, [
      { name: 'pan', amount: 500 },
      { name: 'arroz', amount: 2 },
    ]);
    assert.equal(
      items.reduce((sum, i) => sum + i.amount, 0),
      502,
      'the USD rows and the servicios row never reach the CLP total',
    );
  });

  await test('a mixed month under-reports instead of re-denominating (no cross-unit sum)', () => {
    // The single figure must never be the raw all-rows sum (4 + 6 + 2 + 500
    // + 900 = 1412) — that cross-unit number would render under the USD label.
    const usdTotal = pipeline(mixedItems, 'USD').reduce(
      (sum, i) => sum + i.amount,
      0,
    );
    assert.notEqual(usdTotal, 1412, 'the viewer figure is never the cross-unit sum');
    assert.equal(usdTotal, 12);
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});