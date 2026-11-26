#!/usr/bin/env node
/**
 * Node harness for the Pro charts' pure aggregations
 * (`src/features/charts/aggregate.ts` → `aggregateSpendTrend`,
 * `aggregateStoresByMonth`, `aggregateMonthlyDelta`, `aggregateWeeklySpend`,
 * `aggregateDailyAverage`, `aggregateDailySpend`, `aggregateYearlySpend`,
 * `aggregateDayItems`, `aggregateDayTotal`, `buildVisibleDailySeries`,
 *   `weekdayInitialsForMonth`, `buildDailyInsight`, and the
 *   `aggregateCategoriesByMonth` re-export parity check; plus
 *   `src/features/charts/categoryHref.ts` → `categoryDetailHref`, and the
 *   `src/features/charts/householdSeries.ts` pure adapters +
 *   `computeHouseholdChangePct` badge delta).
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
 *   `yearlyPointsFromCache`:
 *     - cache rows → first-of-month `ReceiptSpendRecord`s (total preserved),
 *     - empty rows → empty array.
 *
 *   `availableYearsFromCache`:
 *     - row years unioned with currentYear, sorted ascending, deduped,
 *     - currentYear included even with no row for it (prev-nav stays enabled),
 *     - empty rows → only currentYear.
 *
 *   Yearly cache → `aggregateYearlySpend` regression:
 *     - a cache covering the current year yields a non-zero current-year
 *       bucket ("year view must not be $0 when cache covers the current
 *       year" contract), with the two previous years intact.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/**
 * Resolve one namespace the way i18next actually resolves it: the requested
 * locale first, then its per-language fallback chain, then `en`. Mirrors
 * `FALLBACK_CHAIN` in `src/i18n/detector.ts` — `es-AR` and `es-ES` inherit
 * the NEUTRAL SPANISH BASE (`es-419`) before English, so a key the region
 * legitimately omits still reads as neutral Spanish rather than English.
 *
 * Later files in the chain win for a given leaf, so the lookup walks the
 * chain in order and keeps the first locale that actually has the key —
 * that is the same precedence i18next applies.
 */
const ANALYTICS_FALLBACK_CHAIN = {
  en: ['en'],
  'es-419': ['en'],
  'es-AR': ['es-419', 'en'],
  'es-ES': ['es-419', 'en'],
  'pt-BR': ['en'],
};

function resolveAnalyticsThroughChain(locale) {
  const chain = ANALYTICS_FALLBACK_CHAIN[locale] ?? ['en'];
  const namespaces = [locale, ...chain];
  const merged = {};
  // Walk the chain from the LAST entry backwards so the requested locale's
  // own leaves overwrite the base's — i.e. assign base first, region last.
  for (const entry of [...namespaces].reverse()) {
    const file = join(root, 'src', 'i18n', 'locales', entry, 'analytics.json');
    Object.assign(merged, JSON.parse(readFileSync(file, 'utf8')));
  }
  return merged;
}

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
    } else if (request === 'expo-localization') {
      // The sign-in graph reaches the device-currency adapter, the sole
      // getLocales() reader on the currency path (precedent:
      // test-i18n-init.mjs). Without this branch node tries to load the
      // real native module.
      request = join(outDir, 'scripts', 'test-stubs', 'expo-localization.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request === 'react-i18next') {
      // The hero render pin needs `t()` without booting the real i18next.
      request = join(outDir, 'scripts', 'test-stubs', 'react-i18next.js');
    } else if (request === 'victory-native') {
      // Real victory-native imports RN Skia; the hero guard keeps the chart
      // subtree inert and only mounts its header.
      request = join(outDir, 'scripts', 'test-stubs', 'charts-victory-native.js');
    } else if (request === '@/i18n/stores/useLocaleStore') {
      request = join(outDir, 'scripts', 'test-stubs', 'charts-locale-store.js');
    } else if (request === '@/components') {
      // The render pins load CapsuleBarChart and InsightHeroCard, whose
      // `Text`/`Icon` come from the same compiled stub used for host trees.
      request = join(outDir, 'scripts', 'test-stubs', 'components.js');
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

/** Flatten an RN style array (last entry wins) the way the runtime does. */
function flattenStyle(style) {
  const entries = Array.isArray(style) ? style.flat(Infinity) : [style];
  const out = {};
  for (const entry of entries) {
    if (entry && typeof entry === 'object') Object.assign(out, entry);
  }
  return out;
}

async function run() {
  console.log('\n[tests] compiling charts aggregator + dependency graph…');
  await compile();
  globalThis.__DEV__ = false;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installRequireHook();
  console.log('[tests] loading compiled modules…');
  const chartsMod = await import(
    pathToFileURL(join(outDir, 'src/features/charts/aggregate.js')).href
  );
  const homeFeedMod = await import(
    pathToFileURL(join(outDir, 'src/features/home/hooks/useHomeFeed.js')).href
  );
  const {
    bindViewerRows,
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
    yearlyPointsFromCache,
    availableYearsFromCache,
    pickMaxSpendIndex,
    buildVisibleDailySeries,
    weekdayInitialsForMonth,
    buildDailyInsight,
  } = chartsMod;
  const categoryHrefMod = await import(
    pathToFileURL(join(outDir, 'src/features/charts/categoryHref.js')).href
  );
  const { categoryDetailHref } = categoryHrefMod;
  const householdSeriesMod = await import(
    pathToFileURL(join(outDir, 'src/features/charts/householdSeries.js')).href
  );
  const {
    chartCacheRowForMonth,
    computeHouseholdChangePct,
    householdRowsToReceipts,
    toChartCacheRows,
  } = householdSeriesMod;
  const resolvedSourcesMod = await import(
    pathToFileURL(join(outDir, 'src/features/charts/resolvedSources.js')).href
  );
  const {
    annualTrendFromCacheRows,
    resolveChartFamilyState,
    yearlyPointsFromCacheRows,
  } = resolvedSourcesMod;
  const { aggregateCategoriesByMonth: directAggregate, monthKeyToMonthName } =
    homeFeedMod;
  // The charts tsconfig compiles `src/lib/format.ts` too; reuse its
  // currency formatter for the hero-template rendering tests below.
  const formatMod = await import(
    pathToFileURL(join(outDir, 'src/lib/format.js')).href
  );
  const { formatCurrency } = formatMod;
  const catsMod = await import(
    pathToFileURL(join(outDir, 'src/features/home/categories.js')).href
  );
  const capsuleMod = await import(
    pathToFileURL(
      join(outDir, 'src/features/charts/components/CapsuleBarChart.js'),
    ).href
  );
  const { CapsuleBarChart } = capsuleMod;
  const heroMod = await import(
    pathToFileURL(
      join(outDir, 'src/features/charts/components/InsightHeroCard.js'),
    ).href
  );
  const { InsightHeroCard } = heroMod;
  const insightBannerMod = await import(
    pathToFileURL(
      join(outDir, 'src/features/analytics/components/InsightBanner.js'),
    ).href
  );
  const { InsightBanner } = insightBannerMod;
  const themeMod = await import(
    pathToFileURL(join(outDir, 'src/theme/index.js')).href
  );
  const { colors } = themeMod;

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

  console.log('\n[tests] bindViewerRows (single-series binding — decision 9)\n');

  await test('keeps the viewer-unit rows, drops the others (never sums across units)', () => {
    const out = bindViewerRows(
      [
        { total: 100, currency: 'USD' },
        { total: 5000, currency: 'CLP' },
        { total: 800, currency: 'USD' },
      ],
      'USD',
    );
    assert.deepEqual(out, [
      { total: 100, currency: 'USD' },
      { total: 800, currency: 'USD' },
    ]);
  });

  await test('a row with no recorded unit falls back to the viewer (REQ-8 s4)', () => {
    const out = bindViewerRows(
      [
        { total: 10, currency: null },
        { total: 20 }, // absent currency
        { total: 30, currency: 'CLP' },
      ],
      'USD',
    );
    assert.deepEqual(out, [{ total: 10, currency: null }, { total: 20 }]);
  });

  await test('viewer switched to the other unit binds those rows instead', () => {
    const rows = [
      { total: 100, currency: 'USD' },
      { total: 5000, currency: 'CLP' },
    ];
    assert.deepEqual(bindViewerRows(rows, 'CLP'), [{ total: 5000, currency: 'CLP' }]);
  });

  await test('mixed month never hides when the viewer row exists (one figure)', () => {
    const out = bindViewerRows(
      [
        { total: 0, currency: 'USD' },
        { total: 5000, currency: 'CLP' },
      ],
      'USD',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].total, 0);
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

  console.log('\n[tests] yearlyPointsFromCache\n');

  await test('monthly cache rows → first-of-month ReceiptSpendRecords, total preserved', () => {
    const out = yearlyPointsFromCache([
      { year_month: '2026-01', total: 100 },
      { year_month: '2026-02', total: 250 },
    ]);
    assert.deepEqual(out, [
      { purchase_date: '2026-01-01', total: 100 },
      { purchase_date: '2026-02-01', total: 250 },
    ]);
  });

  await test('empty cache rows → empty points array', () => {
    assert.deepEqual(yearlyPointsFromCache([]), []);
  });

  console.log('\n[tests] availableYearsFromCache\n');

  await test('row years unioned with currentYear, sorted ascending, deduped', () => {
    const out = availableYearsFromCache(
      [
        { year_month: '2026-03' },
        { year_month: '2024-11' },
        { year_month: '2025-07' },
        { year_month: '2026-01' }, // duplicate year
      ],
      '2026',
    );
    assert.deepEqual(out, ['2024', '2025', '2026']);
  });

  await test('currentYear included even when no row has it (prev-nav stays enabled)', () => {
    const out = availableYearsFromCache(
      [{ year_month: '2024-05' }, { year_month: '2025-08' }],
      '2026',
    );
    assert.deepEqual(out, ['2024', '2025', '2026']);
  });

  await test('empty rows → only currentYear', () => {
    assert.deepEqual(availableYearsFromCache([], '2026'), ['2026']);
  });

  console.log('\n[tests] yearly cache → aggregateYearlySpend regression\n');

  await test('year view is not $0 when the cache covers the current year', () => {
    const current = new Date().getFullYear();
    const rows = [
      { year_month: `${current - 2}-01`, total: 0 },
      { year_month: `${current - 1}-06`, total: 0 },
      { year_month: `${current - 1}-12`, total: 500 },
      { year_month: `${current}-02`, total: 300 },
      { year_month: `${current}-08`, total: 700 },
    ];
    const out = aggregateYearlySpend(yearlyPointsFromCache(rows));
    const byYear = Object.fromEntries(out.map((p) => [p.year, p.total]));
    assert.equal(byYear[String(current)], 1000, 'current-year bucket sums all cache months of that year');
    assert.equal(byYear[String(current - 1)], 500, 'previous-year bucket untouched');
    assert.equal(byYear[String(current - 2)], 0);
  });

  console.log('\n[tests] aggregateDailyAverage\n');

  await test('daily average = month total / distinct spend days', () => {
    const out = aggregateDailyAverage(
      [
        receipt({ id: 'r1', total: 310, purchase_date: '2026-08-05' }),
        receipt({ id: 'r2', total: 90, purchase_date: '2026-08-12' }),
      ],
      '2026-08',
    );
    // total = 400 over 2 distinct spend days (5 and 12) → 400 / 2
    assert.equal(out, 400 / 2);
  });

  await test('multiple receipts on the SAME day count as ONE spend day', () => {
    const out = aggregateDailyAverage(
      [
        receipt({ id: 'r1', total: 310, purchase_date: '2026-08-05' }),
        receipt({ id: 'r2', total: 90, purchase_date: '2026-08-05' }),
      ],
      '2026-08',
    );
    // total = 400 but both receipts land on day 5 → 1 spend day → 400 / 1
    assert.equal(out, 400);
  });

  await test('receipts outside the requested month are ignored', () => {
    const out = aggregateDailyAverage(
      [
        receipt({ id: 'r1', total: 300, purchase_date: '2026-07-05' }),
        receipt({ id: 'r2', total: 100, purchase_date: '2026-08-12' }),
      ],
      '2026-08',
    );
    assert.equal(out, 100 / 1);
  });

  await test('empty month → daily average is 0', () => {
    const out = aggregateDailyAverage([], '2026-08');
    assert.equal(out, 0);
  });

  await test('February single spend day (not divided by 28 days)', () => {
    const out = aggregateDailyAverage(
      [receipt({ id: 'r1', total: 280, purchase_date: '2026-02-10' })],
      '2026-02',
    );
    assert.equal(out, 280 / 1);
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
    // (310 - 100) + 90 = 300 over 2 still-positive spend days (5 and 12).
    assert.equal(out, 300 / 2);
  });

  await test('a day whose spend is ALL excluded does not count as a spend day', () => {
    const out = aggregateDailyAverage(
      [
        // Day 5 is purely servicios (80): effective 0, must NOT count.
        receipt({
          id: 'r1',
          total: 80,
          purchase_date: '2026-08-05',
          category_totals: cats({ servicios: 80 }),
        }),
        receipt({
          id: 'r2',
          total: 90,
          purchase_date: '2026-08-12',
          category_totals: cats({ lacteos: 90 }),
        }),
      ],
      '2026-08',
      ['servicios'],
    );
    // numerator = 0 + 90 = 90; only day 12 counts → 90 / 1 = 90
    assert.equal(out, 90);
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
    // only day 5 is a spend day → 310 / 1
    assert.equal(out, 310);
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

  console.log('\n[tests] catalog-aware display parity (6.1/6.2, REQ-008)\n');

  const stubCatalog = {
    refrescos: {
      id: 'r1',
      slug: 'refrescos',
      name: 'Refrescos',
      kind: 'need',
      icon: 'cup.and.saucer.fill',
      color: '#10B981',
      sort_order: 0,
    },
    delivery: {
      id: 'c1',
      slug: 'delivery',
      name: 'Delivery',
      kind: 'want',
      icon: 'car.fill',
      color: '#EA580C',
      sort_order: 100,
    },
  };

  await test('re-export parity: catalog param honored on both paths', () => {
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-08-05',
        category_totals: cats({ delivery: 40, refrescos: 25 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08', stubCatalog);
    const viaHome = directAggregate(records, '2026-08', stubCatalog);
    assert.deepEqual(viaCharts, viaHome, 'same catalog → same output on both paths');
  });

  await test('charts path: custom slug renders own name+icon with catalog', () => {
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-08-05',
        category_totals: cats({ delivery: 40 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08', stubCatalog);
    assert.equal(viaCharts[0].name, 'Delivery');
    assert.equal(viaCharts[0].icon, 'car.fill');
  });

  await test('charts path: canonical slug stays byte-identical with catalog', () => {
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-08-05',
        category_totals: cats({ refrescos: 25 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08', stubCatalog);
    assert.equal(viaCharts[0].name, 'Refrescos');
    assert.equal(
      viaCharts[0].icon,
      'takeoutbag.and.cup.and.straw.fill',
      'static icon, not the DB row icon',
    );
  });

  await test('charts path: empty catalog keeps a custom slug as the top-category label', () => {
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-08-05',
        category_totals: cats({ lacteos: 10, 'cafe-deli': 40 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08', {});
    assert.equal(viaCharts[0].key, 'cafe-deli');
    assert.equal(viaCharts[0].name, 'cafe-deli');
    assert.notEqual(viaCharts[0].name, catsMod.resolveCategoryDisplay({}, 'cafe-deli').label);
    assert.equal(viaCharts[0].icon, catsMod.resolveCategoryDisplay({}, 'cafe-deli').icon);
  });

  await test('charts path: canonical slug still localizes once with an empty catalog', () => {
    let calls = 0;
    const translator = (key) => {
      calls += 1;
      return key === 'categories:lacteos' ? 'Dairy' : '';
    };
    const records = [
      receipt({
        id: 'r1',
        purchase_date: '2026-08-05',
        category_totals: cats({ lacteos: 25 }),
      }),
    ];
    const viaCharts = aggregateCategoriesByMonth(records, '2026-08', {}, translator);
    assert.equal(viaCharts[0].name, 'Dairy');
    assert.equal(calls, 1, 'the aggregator owns the single localization');
  });

  await test('resolveCategoryDisplay: custom/canonical/unknown contract (unit)', () => {
    const custom = catsMod.resolveCategoryDisplay(stubCatalog, 'delivery');
    assert.equal(custom.label, 'Delivery');
    assert.equal(custom.icon, 'car.fill');
    assert.equal(custom.background, '#EA580C');
    const canonical = catsMod.resolveCategoryDisplay(stubCatalog, 'lacteos');
    assert.equal(canonical.label, 'Lácteos');
    assert.equal(canonical.icon, 'drop.fill');
    const unknown = catsMod.resolveCategoryDisplay(stubCatalog, 'nope');
    assert.equal(unknown.label, 'Otros');
    assert.equal(unknown.icon, 'sparkles');
  });

  await test('resolveCategoryDisplay: prototype-key slug (constructor) → static otros, never garbage', () => {
    // Proto-key trap: 'constructor' is inherited on both the plain-object
    // registry and the stub catalog — the static-first branch must return
    // 'otros', never the Object constructor masquerading as a category.
    const out = catsMod.resolveCategoryDisplay(stubCatalog, 'constructor');
    assert.equal(out.key, 'otros');
    assert.equal(out.label, 'Otros');
    assert.equal(out.icon, 'sparkles');
    assert.equal(out.background, '#4B5563');
    assert.equal(out.foreground, '#FFFFFF');
  });

  await test('resolveCategoryDisplay: custom catalog row keyed constructor → its own visuals (own property)', () => {
    const withConstructor = {
      ...stubCatalog,
      constructor: {
        id: 'c2',
        slug: 'constructor',
        name: 'Constructor',
        kind: 'want',
        icon: 'hammer.fill',
        color: '#2563EB',
        sort_order: 100,
      },
    };
    const out = catsMod.resolveCategoryDisplay(withConstructor, 'constructor');
    assert.equal(out.key, 'constructor');
    assert.equal(out.label, 'Constructor');
    assert.equal(out.icon, 'hammer.fill');
    assert.equal(out.background, '#2563EB');
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

  console.log('\n[tests] weekdayInitialsForMonth — locale-aware variants\n');

  await test('en: august 2026 → S S M T W T F S …', () => {
    const initials = weekdayInitialsForMonth('2026-08', 'en');
    assert.equal(initials.length, 31);
    assert.deepEqual(initials.slice(0, 8), ['S', 'S', 'M', 'T', 'W', 'T', 'F', 'S']);
    assert.equal(initials[9], 'M', 'day 10 is Monday');
    assert.equal(initials[12], 'T', 'day 13 is Thursday');
    assert.equal(initials[14], 'S', 'day 15 is Saturday');
    assert.equal(initials[15], 'S', 'day 16 is Sunday');
  });

  await test('pt-BR: august 2026 → S D S T Q Q S S …', () => {
    const initials = weekdayInitialsForMonth('2026-08', 'pt-BR');
    assert.equal(initials.length, 31);
    assert.deepEqual(initials.slice(0, 8), ['S', 'D', 'S', 'T', 'Q', 'Q', 'S', 'S']);
    assert.equal(initials[9], 'S', 'day 10 (Monday) is Segunda');
    assert.equal(initials[14], 'S', 'day 15 is Sábado');
    assert.equal(initials[15], 'D', 'day 16 is Domingo');
  });

  await test('en weekly bars: Mon-first labels + initials', () => {
    const out = aggregateWeeklySpend([], '2026-08-10', [], 'en');
    assert.deepEqual(
      out.map((p) => ({ day: p.day, initial: p.initial })),
      [
        { day: 'Mon', initial: 'M' },
        { day: 'Tue', initial: 'T' },
        { day: 'Wed', initial: 'W' },
        { day: 'Thu', initial: 'T' },
        { day: 'Fri', initial: 'F' },
        { day: 'Sat', initial: 'S' },
        { day: 'Sun', initial: 'S' },
      ],
    );
  });

  await test('pt-BR weekly bars: Mon-first labels + initials', () => {
    const out = aggregateWeeklySpend([], '2026-08-10', [], 'pt-BR');
    assert.deepEqual(
      out.map((p) => ({ day: p.day, initial: p.initial })),
      [
        { day: 'Seg', initial: 'S' },
        { day: 'Ter', initial: 'T' },
        { day: 'Qua', initial: 'Q' },
        { day: 'Qui', initial: 'Q' },
        { day: 'Sex', initial: 'S' },
        { day: 'Sáb', initial: 'S' },
        { day: 'Dom', initial: 'D' },
      ],
    );
  });

  console.log('\n[tests] buildDailyInsight\n');

  // Real August 2026 fixture (same shape as the hero curve tests): day 3
  // is the $20,289.51 spike, Monday. Sum = 41,205.36 over 12 non-zero days
  // (days 1-7 and 10-14) → avg ≈ $3,433.78 → 20,289.51 / 3,433.78 ≈ 5.91
  // → rounds to 6.
  const AUGUST_2026 = [
    572.27, 762.77, 20289.51, 4820.72, 3367.32, 1973.37, 1276.71,
    0, 0, 560.45, 526.42, 381.58, 5862, 812.24,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ].map((total, index) => ({ day: index + 1, total }));

  await test('real august fixture: day 3 → Lunes, $20,289.51, ≈6x', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08');
    assert.equal(insight.day, 3);
    assert.equal(insight.weekday, 'Lunes');
    assert.equal(insight.amount, 20289.51);
    assert.equal(insight.multiple, 6);
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

  await test('single spend day → multiple equals 1 (average is that day)', () => {
    const dailyData = Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 310 : 0, // only day 5 has spend
    }));
    const insight = buildDailyInsight(dailyData, '2026-08');
    assert.equal(insight.day, 5);
    assert.equal(insight.amount, 310);
    // 1 spend day → average = 310 / 1 = 310 → 310/310 = 1 → clamped to 1.
    assert.equal(insight.multiple, 1);
  });

  await test('single spend day in February 2026 → multiple 1', () => {
    const dailyData = Array.from({ length: 28 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 280 : 0, // only day 5 has spend
    }));
    const insight = buildDailyInsight(dailyData, '2026-02');
    assert.equal(insight.day, 5);
    assert.equal(insight.amount, 280);
    // 1 spend day → average = 280 / 1 = 280 → multiple = 1.
    assert.equal(insight.multiple, 1);
  });

  await test('single spend day in leap February 2024 → multiple 1', () => {
    const dailyData = Array.from({ length: 29 }, (_, i) => ({
      day: i + 1,
      total: i === 4 ? 290 : 0, // only day 5 has spend
    }));
    const insight = buildDailyInsight(dailyData, '2024-02');
    assert.equal(insight.day, 5);
    assert.equal(insight.amount, 290);
    // 1 spend day → average = 290 / 1 = 290 → multiple = 1.
    assert.equal(insight.multiple, 1);
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

  console.log('\n[tests] buildDailyInsight — locale-aware variants\n');

  await test('real august fixture in en → weekday "Monday"', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08', 'en');
    assert.equal(insight.day, 3);
    assert.equal(insight.weekday, 'Monday');
    assert.equal(insight.amount, 20289.51);
    assert.equal(insight.multiple, 6);
  });

  await test('real august fixture in pt-BR → weekday "Segunda"', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08', 'pt-BR');
    assert.equal(insight.day, 3);
    assert.equal(insight.weekday, 'Segunda');
    assert.equal(insight.amount, 20289.51);
    assert.equal(insight.multiple, 6);
  });

  console.log('\n[tests] monthKeyToMonthName\n');

  await test('es-AR → capitalized full names incl. array edges', () => {
    assert.equal(monthKeyToMonthName('es-AR', '2026-01'), 'Enero');
    assert.equal(monthKeyToMonthName('es-AR', '2026-08'), 'Agosto');
    assert.equal(monthKeyToMonthName('es-AR', '2026-12'), 'Diciembre');
  });

  await test('en → capitalized full names incl. array edges', () => {
    assert.equal(monthKeyToMonthName('en', '2026-01'), 'January');
    assert.equal(monthKeyToMonthName('en', '2026-08'), 'August');
    assert.equal(monthKeyToMonthName('en', '2026-12'), 'December');
  });

  await test('pt-BR → capitalized full names incl. array edges', () => {
    assert.equal(monthKeyToMonthName('pt-BR', '2026-01'), 'Janeiro');
    assert.equal(monthKeyToMonthName('pt-BR', '2026-08'), 'Agosto');
    assert.equal(monthKeyToMonthName('pt-BR', '2026-12'), 'Dezembro');
  });

  await test('capitalizes the lowercase array entry ("agosto" → "Agosto")', () => {
    // MONTHS_FULL_* store lowercase (es/pt-BR convention); the helper
    // capitalizes the first letter, mirroring the catalog's display form.
    assert.equal(monthKeyToMonthName('en', '2026-03'), 'March');
    assert.equal(monthKeyToMonthName('es-AR', '2026-08'), 'Agosto');
  });

  await test('malformed month keys → empty string', () => {
    assert.equal(monthKeyToMonthName('es-AR', 'garbage'), '');
    assert.equal(monthKeyToMonthName('es-AR', '2026-13'), '');
    assert.equal(monthKeyToMonthName('es-AR', '2026'), '');
    assert.equal(monthKeyToMonthName('pt-BR', 'garbage'), '');
  });

  console.log('\n[tests] heroMostExpensiveDay template (Fix 1 CRITICAL)\n');

  // Reads the REAL catalog from disk and interpolates the insight the way
  // `InsightHeroCard` does (`t('analytics:heroMostExpensiveDay', {...})`),
  // so a missing/mis-typed key or an unhandled interpolation var fails
  // here instead of rendering the raw key in production.

  await test('es-AR template renders the real august insight line', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08', 'es-AR');
    // Resolved THROUGH THE CHAIN, not read raw out of `es-AR/analytics.json`.
    //
    // `es-AR` is a sparse voseo override; `heroMostExpensiveDay` carries no
    // regionalism and lives only in the `es-419` base. Reading the raw
    // regional file is exactly the assumption the catalog hierarchy
    // forbids — and it failed loudly here the moment the thinning landed
    // (`catalog.heroMostExpensiveDay` was `undefined`). The exporter
    // screens resolve through i18next, so the harness must too, or it is
    // testing a resolution order production does not use.
    const catalog = resolveAnalyticsThroughChain('es-AR');
    const line = catalog.heroMostExpensiveDay
      .replace(/\{\{weekday\}\}/g, insight.weekday)
      .replace(/\{\{day\}\}/g, String(insight.day))
      .replace(/\{\{amount\}\}/g, formatCurrency(insight.amount, 'USD'))
      .replace(/\{\{multiple\}\}/g, String(insight.multiple));
    assert.equal(
      line,
      'Tu día más caro fue el Lunes 3 (US$ 20,289.51 · 6x tu promedio)',
    );
  });

  await test('en template renders the real august insight line', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08', 'en');
    const catalog = JSON.parse(
      readFileSync(
        join(root, 'src', 'i18n', 'locales', 'en', 'analytics.json'),
        'utf8',
      ),
    );
    const line = catalog.heroMostExpensiveDay
      .replace(/\{\{weekday\}\}/g, insight.weekday)
      .replace(/\{\{day\}\}/g, String(insight.day))
      .replace(/\{\{amount\}\}/g, formatCurrency(insight.amount, 'USD'))
      .replace(/\{\{multiple\}\}/g, String(insight.multiple));
    assert.equal(
      line,
      'Your most expensive day was Monday 3 (US$ 20,289.51 · 6x your average)',
    );
  });

  await test('pt-BR template renders the real august insight line', () => {
    const insight = buildDailyInsight(AUGUST_2026, '2026-08', 'pt-BR');
    const catalog = JSON.parse(
      readFileSync(
        join(root, 'src', 'i18n', 'locales', 'pt-BR', 'analytics.json'),
        'utf8',
      ),
    );
    const line = catalog.heroMostExpensiveDay
      .replace(/\{\{weekday\}\}/g, insight.weekday)
      .replace(/\{\{day\}\}/g, String(insight.day))
      .replace(/\{\{amount\}\}/g, formatCurrency(insight.amount, 'USD'))
      .replace(/\{\{multiple\}\}/g, String(insight.multiple));
    assert.equal(
      line,
      // pt-BR native-speaker pass (B3): "{{weekday}}, dia {{day}}" — the
      // comma + "dia" disambiguate the weekday from the day number.
      'Seu dia mais caro foi Segunda, dia 3 (US$ 20,289.51 · 6x sua média)',
    );
  });

  console.log('\n[tests] resolved chart sources (personal byte-identical gates)\n');

  const months2026 = Array.from({ length: 12 }, (_, i) =>
    `2026-${String(i + 1).padStart(2, '0')}`,
  );
  const fallbackReceipts = [
    { id: 'personal-1', purchase_date: '2026-08-15', total: 100, currency: 'USD' },
  ];

  await test('a RESOLVED empty personal cache keeps zero-filled annual bars', () => {
    const points = annualTrendFromCacheRows({
      rows: [],
      fallbackRows: fallbackReceipts,
      monthKeys: months2026,
      currency: 'USD',
    });
    assert.equal(points.length, 12);
    assert.equal(points.find((p) => p.month === '2026-08').total, 0);
  });

  await test('an UNRESOLVED personal cache still falls back to the receipt list', () => {
    const points = annualTrendFromCacheRows({
      rows: undefined,
      fallbackRows: fallbackReceipts,
      monthKeys: months2026,
      currency: 'USD',
    });
    assert.equal(points.find((p) => p.month === '2026-08').total, 100);
  });

  await test('household annual rows bind the viewer unit without a cross-unit sum', () => {
    const points = annualTrendFromCacheRows({
      rows: [
        { year_month: '2026-08', currency: 'UYU', total: 100 },
        { year_month: '2026-08', currency: 'CLP', total: 50 },
      ],
      fallbackRows: fallbackReceipts,
      monthKeys: months2026,
      currency: 'UYU',
    });
    assert.equal(points.find((p) => p.month === '2026-08').total, 100);
  });

  await test('a resolved empty personal year cache does NOT resurrect list points', () => {
    const points = yearlyPointsFromCacheRows({
      rows: [],
      fallbackRows: fallbackReceipts,
      currency: 'USD',
    });
    assert.equal(points.length, 0);
  });

  await test('an unresolved personal year cache keeps the list fallback', () => {
    const points = yearlyPointsFromCacheRows({
      rows: undefined,
      fallbackRows: fallbackReceipts,
      currency: 'USD',
    });
    assert.equal(points.length, 1);
    assert.equal(points[0].total, 100);
  });

  await test('chart family state: personal is never blocked by household gates', () => {
    assert.equal(
      resolveChartFamilyState({
        isHouseholdView: false,
        failed: true,
        hasData: false,
        hasViewerData: false,
      }),
      'ready',
    );
  });

  await test('chart family state: household error > pending > no-data > ready', () => {
    assert.equal(
      resolveChartFamilyState({
        isHouseholdView: true,
        failed: true,
        hasData: false,
        hasViewerData: false,
      }),
      'error',
    );
    assert.equal(
      resolveChartFamilyState({
        isHouseholdView: true,
        failed: false,
        hasData: false,
        hasViewerData: false,
      }),
      'pending',
    );
    assert.equal(
      resolveChartFamilyState({
        isHouseholdView: true,
        failed: false,
        hasData: true,
        hasViewerData: false,
      }),
      'no-data',
    );
    assert.equal(
      resolveChartFamilyState({
        isHouseholdView: true,
        failed: false,
        hasData: true,
        hasViewerData: true,
      }),
      'ready',
    );
  });

  console.log('\n[tests] household chart series adapter\n');

  const householdRpcRows = [
    {
      year_month: '2026-08',
      currency: 'UYU',
      total: 150,
      daily_totals: { '2026-08-05': 100, '2026-08-07': 50 },
      store_totals: {
        'Agg Store': { total: 150, count: 3 },
      },
      category_totals: {
        lacteos: { total: 120, count: 2, name: 'Lácteos' },
        servicios: { total: 30, count: 1, name: 'Servicios' },
      },
      daily_category_totals: {
        '2026-08-05': { lacteos: 80, servicios: 30 },
        '2026-08-07': { lacteos: 40 },
      },
    },
    {
      year_month: '2026-08',
      currency: 'CLP',
      total: 270,
      daily_totals: { '2026-08-06': 200, '2026-08-08': 70 },
      store_totals: {
        'Agg Store': { total: 270, count: 2 },
      },
      category_totals: {
        lacteos: { total: 270, count: 2, name: 'Lácteos' },
      },
      daily_category_totals: {
        '2026-08-06': { lacteos: 200 },
        '2026-08-08': { lacteos: 70 },
      },
    },
    {
      year_month: '2026-09',
      currency: 'CLP',
      total: 500,
      daily_totals: { '2026-09-01': 500 },
      store_totals: {
        'Agg Store': { total: 500, count: 1 },
      },
      category_totals: {
        lacteos: { total: 500, count: 1, name: 'Lácteos' },
      },
      daily_category_totals: {
        '2026-09-01': { lacteos: 500 },
      },
    },
  ];

  await test('toChartCacheRows keeps one row per (month, unit), never a cross-unit sum', () => {
    const rows = toChartCacheRows(householdRpcRows);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => `${r.year_month}:${r.currency}:${r.total}`),
      [
        '2026-08:CLP:270',
        '2026-08:UYU:150',
        '2026-09:CLP:500',
      ],
    );
    assert.equal(rows[1].daily_totals['2026-08-05'], 100);
    assert.equal(rows[1].category_totals.servicios.total, 30);
  });

  await test('chartCacheRowForMonth binds the viewer unit only', () => {
    const uyu = chartCacheRowForMonth(householdRpcRows, '2026-08', 'UYU');
    assert.equal(uyu?.currency, 'UYU');
    assert.equal(uyu?.total, 150);
    const eur = chartCacheRowForMonth(householdRpcRows, '2026-08', 'EUR');
    assert.equal(eur, null);
  });

  console.log('\n[tests] computeHouseholdChangePct (pure household badge delta)\n');

  const changeRow = (year_month, total, currency = 'UYU') => ({
    year_month,
    currency,
    total,
    daily_totals: {},
    store_totals: {},
    category_totals: {},
    daily_category_totals: {},
  });
  const changePct = (rows, overrides = {}) =>
    computeHouseholdChangePct({
      rows,
      monthKey: '2026-08',
      previousMonthKey: '2026-07',
      currency: 'UYU',
      hasData: true,
      failed: false,
      ...overrides,
    });
  const upDownRows = [
    changeRow('2026-08', 120),
    changeRow('2026-07', 100),
  ];

  await test('up: current 120 vs previous 100 → 20', () => {
    assert.equal(changePct(upDownRows), 20);
  });

  await test('down: current 80 vs previous 100 → -20', () => {
    assert.equal(
      changePct([changeRow('2026-08', 80), changeRow('2026-07', 100)]),
      -20,
    );
  });

  await test('previous viewer-unit row missing → null (no fabricated zero)', () => {
    assert.equal(changePct([changeRow('2026-08', 120)]), null);
  });

  await test('previous total zero → null (never divide by zero)', () => {
    assert.equal(
      changePct([changeRow('2026-08', 120), changeRow('2026-07', 0)]),
      null,
    );
  });

  await test('unresolved (hasData false) and failed (true) → null', () => {
    assert.equal(changePct(upDownRows, { hasData: false }), null);
    assert.equal(changePct(upDownRows, { failed: true }), null);
  });

  await test('multi-currency rows use ONLY the viewer-unit month totals', () => {
    const rows = [
      changeRow('2026-08', 120, 'UYU'),
      changeRow('2026-08', 9_999_999, 'CLP'),
      changeRow('2026-07', 100, 'UYU'),
      changeRow('2026-07', 5_000_000, 'CLP'),
    ];
    assert.equal(
      changePct(rows),
      20,
      'the huge CLP totals never reach the UYU badge',
    );
    assert.equal(
      changePct(rows, { currency: 'CLP' }),
      100,
      'switching viewer binds the other unit instead — still one series',
    );
  });

  await test('a foreign-only previous month → null, never a substituted personal/other-unit figure', () => {
    // The helper has no personal input at all; a month with only CLP spend
    // must read as "no viewer-month total", not borrow any other number.
    const rows = [
      changeRow('2026-08', 120, 'UYU'),
      changeRow('2026-07', 5_000, 'CLP'),
    ];
    assert.equal(changePct(rows), null);
  });

  await test('NaN current → null', () => {
    assert.equal(
      changePct([changeRow('2026-08', NaN), changeRow('2026-07', 100)]),
      null,
    );
  });

  await test('non-finite previous → null', () => {
    assert.equal(
      changePct([changeRow('2026-08', 120), changeRow('2026-07', NaN)]),
      null,
    );
  });

  await test('rounding: 101 vs 300 → -66.3 (1 decimal)', () => {
    // (101 - 300) / 300 * 100 = -66.333… → Math.round(-663.33…) / 10 = -66.3
    assert.equal(
      changePct([changeRow('2026-08', 101), changeRow('2026-07', 300)]),
      -66.3,
    );
  });

  await test('rounding up: 1 vs 3 → -66.7 (1 decimal)', () => {
    // (1 - 3) / 3 * 100 = -66.666… → Math.round(-666.66…) / 10 = -66.7
    assert.equal(
      changePct([changeRow('2026-08', 1), changeRow('2026-07', 3)]),
      -66.7,
    );
  });

  await test('source pin: the screen delegates the delta to the pure helper', () => {
    const chartsSource = readFileSync(
      join(root, 'src', 'app', 'pro', 'charts.tsx'),
      'utf8',
    );
    assert.match(chartsSource, /computeHouseholdChangePct\(\{/);
    assert.doesNotMatch(
      chartsSource,
      /const currentTotal = currentRow\?\.total/,
      'the untested inline delta math must stay out of the screen',
    );
  });

  await test('householdRowsToReceipts allocates categories per day without summing units', () => {
    const receipts = householdRowsToReceipts(householdRpcRows, '2026-08', 'UYU');
    assert.equal(receipts.length, 2);
    assert.deepEqual(
      receipts.map((r) => r.purchase_date),
      ['2026-08-05', '2026-08-07'],
    );
    assert.equal(receipts[0].total, 100);
    assert.equal(receipts[0].category_totals.servicios, 30);
    assert.equal(receipts[0].category_totals.lacteos, 80);
    assert.equal(receipts[1].category_totals.lacteos, 40);
    assert.equal(receipts[1].category_totals.servicios ?? 0, 0);
    // The other unit's days never leak into the viewer-unit series.
    assert.ok(!receipts.some((r) => r.purchase_date === '2026-08-06'));
  });

  await test('household receipts keep servicios in hero, exclude it from weekly/average', () => {
    const receipts = householdRowsToReceipts(householdRpcRows, '2026-08', 'UYU');
    const hero = aggregateDailySpend(receipts, '2026-08');
    assert.equal(
      hero.reduce((sum, p) => sum + p.total, 0),
      150,
    );
    const week = aggregateWeeklySpend(
      receipts,
      '2026-08-03',
      ['servicios'],
      'en',
    );
    assert.equal(
      week.reduce((sum, p) => sum + p.amount, 0),
      120,
    );
    assert.equal(aggregateDailyAverage(receipts, '2026-08', ['servicios']), 60);
    const dayItems = aggregateDayItems(receipts, '2026-08-05', ['servicios']);
    assert.ok(dayItems.length > 0);
    assert.ok(!dayItems.some((item) => item.name === 'servicios'));
  });

  await test('household servicios exclusion is per-day, not a month-wide allocation', () => {
    const rows = [
      {
        year_month: '2026-08',
        currency: 'UYU',
        total: 200,
        daily_totals: { '2026-08-05': 100, '2026-08-06': 100 },
        store_totals: {},
        category_totals: {
          servicios: { total: 200, count: 1, name: 'Servicios' },
          lacteos: { total: 100, count: 1, name: 'Lácteos' },
        },
        daily_category_totals: {
          '2026-08-05': { servicios: 200 },
          '2026-08-06': { lacteos: 100 },
        },
      },
    ];
    const receipts = householdRowsToReceipts(rows, '2026-08', 'UYU');
    assert.equal(receipts.length, 2);
    const week = aggregateWeeklySpend(receipts, '2026-08-03', ['servicios'], 'en');
    assert.equal(week.reduce((sum, p) => sum + p.amount, 0), 100);
  });

  await test('household source pins: charts screen reads the new RPC only in household mode', () => {
    const chartsSource = readFileSync(
      join(root, 'src', 'app', 'pro', 'charts.tsx'),
      'utf8',
    );
    assert.match(chartsSource, /readHouseholdChartSeries/);
    assert.match(chartsSource, /queryKeys\.householdChartSeries/);
    assert.match(chartsSource, /useHouseholdChartSeries/);
    assert.match(chartsSource, /householdRowsToReceipts/);
    // Personal is derived as the exact complement of household, and every
    // personal-only query/thread must be gated by that one flag. These pins
    // fail if someone reintroduces an unconditional personal read.
    assert.match(chartsSource, /const isHouseholdView = viewMode === 'household'/);
    assert.match(chartsSource, /const isPersonalView = !isHouseholdView/);
    assert.match(chartsSource, /enabled: !!userId && isPersonalView/);
    assert.match(chartsSource, /useMonthlyOverview\(monthKey, isPersonalView\)/);
    // Console is the canonical reporter in this app (no Sentry dependency).
    // The RPC failure must still produce one explicit, searchable warning.
    const featureAccessSource = readFileSync(
      join(root, 'src', 'lib', 'supabase', 'feature-access.ts'),
      'utf8',
    );
    assert.doesNotMatch(featureAccessSource, /captureException/);
    assert.doesNotMatch(featureAccessSource, /globalThis\.Sentry/);
    assert.match(
      featureAccessSource,
      /console\.warn\('\[feature-access\] household_chart_series failed', error\)/,
    );
    assert.match(
      featureAccessSource,
      /console is the canonical reporter[\s\S]{0,200}console\.warn\('\[feature-access\] household_chart_series failed', error\)/,
    );
  });

  await test('household source pins: month-scoped surfaces are gated by trendFamily, not capsuleFamily', () => {
    const chartsSource = readFileSync(
      join(root, 'src', 'app', 'pro', 'charts.tsx'),
      'utf8',
    );
    assert.match(
      chartsSource,
      /const capsuleFamily = period === 'year' \? yearlyFamily : trendFamily/,
    );
    assert.match(chartsSource, /<ChartFamilyNotice\s+state=\{trendFamily\}/);
    assert.match(
      chartsSource,
      /\{trendFamily === 'ready' \? \([\s\S]{0,320}<InsightHeroCard/,
    );
    assert.match(
      chartsSource,
      /\{trendFamily === 'ready' \? \([\s\S]{0,520}<MetricSummaryCard/,
    );
    const capsuleGateIdx = chartsSource.indexOf("{capsuleFamily === 'ready' ? (");
    const capsuleChartIdx = chartsSource.indexOf('<CapsuleBarChart', capsuleGateIdx);
    const nextReadyGateIdx = chartsSource.indexOf(
      "=== 'ready' ? (",
      capsuleGateIdx + "{capsuleFamily === 'ready' ? (".length,
    );
    assert.ok(capsuleGateIdx > -1, 'the capsule card must keep its own gate');
    assert.ok(capsuleChartIdx > capsuleGateIdx, 'CapsuleBarChart stays gated');
    assert.ok(
      nextReadyGateIdx === -1 || capsuleChartIdx < nextReadyGateIdx,
      'CapsuleBarChart must belong to the capsuleFamily gate, not a later one',
    );
    assert.match(
      chartsSource,
      /\{trendFamily === 'ready' \? \([\s\S]{0,520}<StoreBars/,
    );
  });

  await test('household source pins: the year selector survives a non-ready annual family', () => {
    const chartsSource = readFileSync(
      join(root, 'src', 'app', 'pro', 'charts.tsx'),
      'utf8',
    );
    const selectorIdx = chartsSource.indexOf('<View style={styles.yearSelector}>');
    const annualGateIdx = chartsSource.indexOf("{annualFamily === 'ready' ? (");
    assert.ok(selectorIdx > -1, 'the year selector must be rendered');
    assert.ok(annualGateIdx > -1, 'the annual bars still have a ready gate');
    assert.ok(
      selectorIdx < annualGateIdx,
      'the selector must live outside the annualFamily ready gate',
    );
  });

  await test('chart cleanups source pins: named handler, comments and capsule indentation', () => {
    const chartsSource = readFileSync(
      join(root, 'src', 'app', 'pro', 'charts.tsx'),
      'utf8',
    );
    assert.match(chartsSource, /const handleStorePress = \(store: StoreBar\) => \{/);
    assert.match(chartsSource, /if \(isHouseholdView\) return;/);
    assert.match(chartsSource, /onRowPress=\{handleStorePress\}/);
    assert.match(
      chartsSource,
      /no raw viewer-unit receipt for this month in `activeViewerList`/,
    );
    assert.match(
      chartsSource,
      /\{capsuleFamily === 'ready' \? \(\n\s{8}<Card>\n\s{10}<View style=\{styles\.chartHeader\}>/,
    );
  });

  console.log('\n[tests] CapsuleBarChart annual layout (executed render)\n');

  // Reproduces the PRO "Tus tendencias" year card: one 12-cell row per axis,
  // amount strings of very different lengths. With the old `width: '60%'`
  // rule the longest amount widened its flex cell and its bar too, while the
  // label row stayed equal — "Ene" drifted right of its "$U 0" bar.
  const capsuleItems = [
    { label: 'Ene', value: 0 },
    { label: 'Feb', value: 12 },
    { label: 'Mar', value: 12345, highlight: true },
    { label: 'Abr', value: 345 },
  ];

  let capsuleRenderer;
  await act(async () => {
    capsuleRenderer = TestRenderer.create(
      React.createElement(CapsuleBarChart, {
        items: capsuleItems,
        currency: 'UYU',
      }),
    );
  });

  const capsuleViews = capsuleRenderer.root.findAllByType('View');
  const capsuleTexts = capsuleRenderer.root.findAllByType('Text');
  const styleOf = (node) => flattenStyle(node.props.style);
  const bars = capsuleViews.filter((node) => {
    const s = styleOf(node);
    return 'borderRadius' in s && typeof s.backgroundColor === 'string';
  });
  const cells = capsuleViews.filter((node) => styleOf(node).flex === 1);
  const amountTexts = capsuleTexts.filter(
    (node) => node.props.numberOfLines !== undefined,
  );
  const labelTexts = capsuleTexts.filter(
    (node) => node.props.numberOfLines === undefined,
  );

  await test('fixture really has different amount-string lengths', () => {
    const amounts = amountTexts.map((n) => String(n.props.children));
    assert.equal(amounts.length, capsuleItems.length);
    assert.ok(
      new Set(amounts.map((a) => a.length)).size > 1,
      `expected varied amount lengths, got ${JSON.stringify(amounts)}`,
    );
  });

  await test('all bars share one fixed numeric width (no % / maxWidth)', () => {
    assert.equal(bars.length, capsuleItems.length, 'one bar per item');
    const widths = bars.map((n) => styleOf(n).width);
    assert.ok(widths.every(Number.isFinite), `widths must be numbers: ${widths}`);
    assert.equal(new Set(widths).size, 1, `bars must match: ${widths}`);
    assert.equal(widths[0], 28, 'fixed bar width is 28px');
    assert.ok(
      bars.every((n) => styleOf(n).maxWidth === undefined),
      'maxWidth: 32 would let content width still influence the bar',
    );
  });

  await test('dynamic height/color and borderRadius stay intact', () => {
    assert.ok(
      bars.every((n) => typeof styleOf(n).borderRadius === 'number'),
      'borderRadius must survive the width change',
    );
    assert.equal(styleOf(bars[0]).height, 4, 'zero value keeps the minimal bar');
    assert.equal(styleOf(bars[2]).height, 96, 'max value keeps the full bar');
    const fills = bars.map((n) => styleOf(n).backgroundColor);
    assert.notEqual(fills[2], fills[0], 'highlight still uses the accent color');
    assert.equal(fills[0], fills[1], 'non-highlight bars still share the muted fill');
  });

  await test('both rows keep flex:1 cells carrying minWidth: 0', () => {
    assert.equal(cells.length, capsuleItems.length * 2, 'two rows of cells');
    assert.ok(cells.every((n) => styleOf(n).flex === 1), 'cells still fill equally');
    assert.ok(
      cells.every((n) => styleOf(n).minWidth === 0),
      'minWidth: 0 keeps long amounts from widening a flex cell',
    );
  });

  await test('amount Text wraps to 2 lines; labels/order unchanged', () => {
    assert.equal(amountTexts.length, capsuleItems.length);
    assert.ok(amountTexts.every((n) => n.props.numberOfLines === 2));
    assert.deepEqual(
      labelTexts.map((n) => String(n.props.children)),
      capsuleItems.map((i) => i.label),
      'label strings and ordering must not change',
    );
  });

  console.log('\n[tests] CapsuleBarChart fixed cellWidth (executed render)\n');

  const annualCapsuleItems = Array.from({ length: 12 }, (_, index) => ({
    label: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][index],
    value: index === 10 ? 12345 : index * 100,
    highlight: index === 10,
  }));

  let fixedCapsuleRenderer;
  await act(async () => {
    fixedCapsuleRenderer = TestRenderer.create(
      React.createElement(CapsuleBarChart, {
        items: annualCapsuleItems,
        currency: 'UYU',
        cellWidth: 44,
      }),
    );
  });

  const fixedViews = fixedCapsuleRenderer.root.findAllByType('View');
  const fixedTexts = fixedCapsuleRenderer.root.findAllByType('Text');
  const fixedCellWidth = 44;
  const fixedAmountTexts = fixedTexts.filter(
    (node) => node.props.numberOfLines !== undefined,
  );
  const fixedLabelTexts = fixedTexts.filter(
    (node) => node.props.numberOfLines === undefined,
  );
  const fixedContainer = fixedViews.find((node) => {
    const s = styleOf(node);
    return s.width === fixedCellWidth * annualCapsuleItems.length;
  });
  const fixedCells = fixedViews.filter((node) => {
    const s = styleOf(node);
    return s.width === fixedCellWidth && s.flex === 0;
  });

  await test('container width equals cellWidth * items.length', () => {
    assert.ok(fixedContainer, 'expected fixed-width root container');
    assert.equal(
      styleOf(fixedContainer).width,
      fixedCellWidth * annualCapsuleItems.length,
    );
  });

  await test('all 24 cells (12 bar + 12 label) have width 44 and flex 0', () => {
    assert.equal(
      fixedCells.length,
      annualCapsuleItems.length * 2,
      '12 bar cells + 12 label cells',
    );
    assert.ok(
      fixedCells.every((node) => {
        const s = styleOf(node);
        return s.width === fixedCellWidth && s.flex === 0;
      }),
      'every cell must be pinned to width 44 and flex 0',
    );
  });

  await test('fixed-width render keeps label strings and order unchanged', () => {
    assert.equal(fixedAmountTexts.length, annualCapsuleItems.length);
    assert.ok(fixedAmountTexts.every((n) => n.props.numberOfLines === 2));
    assert.deepEqual(
      fixedLabelTexts.map((n) => String(n.props.children)),
      annualCapsuleItems.map((i) => i.label),
      'label strings and ordering must not change',
    );
  });

  console.log('\n[tests] InsightHeroCard delta chip layout (executed render)\n');

  // Mount the REAL hero with a deliberately long comparison-month name.
  // With the old `row` / `space-between` header, the text block and the chip
  // were both unconstrained, so this copy pushed the chip past the card on
  // narrow widths. The chart subtree stays inert (stubbed victory-native):
  // the header is the surface under test.
  const LONG_PREVIOUS_MONTH =
    'Septiembre con un nombre deliberadamente extenso para exponer el desborde';
  const heroDailyData = Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    total: i === 4 ? 100 : 0,
  }));

  let heroRenderer;
  await act(async () => {
    heroRenderer = TestRenderer.create(
      React.createElement(InsightHeroCard, {
        monthLabel: 'Octubre 2026',
        monthKey: '2026-10',
        totals: [{ currency: 'UYU', total: 1234 }],
        deltaPct: -12,
        previousMonthName: LONG_PREVIOUS_MONTH,
        dailyData: heroDailyData,
      }),
    );
  });

  const heroHostNodes = heroRenderer.root.findAll(
    (node) => typeof node.type === 'string',
  );
  const heroViews = heroRenderer.root.findAllByType('View');
  const heroTexts = heroRenderer.root.findAllByType('Text');
  const hostText = (node) => {
    const children = Array.isArray(node.props.children)
      ? node.props.children
      : [node.props.children];
    return children
      .filter((child) => typeof child === 'string' || typeof child === 'number')
      .join('');
  };
  const chipRow = heroViews.find(
    (node) => styleOf(node).justifyContent === 'flex-end',
  );
  // findAllByType includes the root itself — skip chipRow to get the chip.
  const chip = chipRow?.findAllByType('View').find((node) => node !== chipRow);
  const chipText = chipRow?.findAllByType('Text')[0];
  const kicker = heroTexts.find((node) => hostText(node) === 'Gastado este mes');
  const month = heroTexts.find((node) => hostText(node) === 'Octubre 2026');
  const total = heroTexts.find(
    (node) => hostText(node) === formatCurrency(1234, 'UYU'),
  );
  const hostIndex = (node) => heroHostNodes.indexOf(node);

  await test('hero chip owns a flex-end row above kicker, month and total', () => {
    assert.ok(chipRow, 'expected a dedicated host row for the delta chip');
    assert.equal(styleOf(chipRow).justifyContent, 'flex-end');
    assert.ok(chipText, 'the chip Text must live inside that row');
    assert.ok(
      hostText(chipText).includes(LONG_PREVIOUS_MONTH),
      'the long previous-month copy must render inside the chip row',
    );
    assert.ok(kicker && month && total, 'kicker, month and total must all render');
    assert.ok(
      hostIndex(chipRow) < hostIndex(kicker),
      'chip row must precede the kicker in tree order',
    );
    assert.ok(hostIndex(kicker) < hostIndex(month), 'kicker before month');
    assert.ok(hostIndex(month) < hostIndex(total), 'month before total');
  });

  await test('hero chip constrains long locale copy (maxWidth 100%, flexShrink 1)', () => {
    assert.ok(chip, 'expected the chip host View inside the flex-end row');
    assert.equal(styleOf(chip).maxWidth, '100%');
    assert.equal(styleOf(chip).flexShrink, 1);
  });

  await act(async () => {
    heroRenderer.unmount();
  });

  console.log('\n[tests] InsightBanner direction-aware colors (executed render)\n');

  // Mounts the REAL banner through the same compiled module/stub graph as the
  // hero. Copy is compared against the catalog read from disk and resolved
  // through the es-419 chain, not a hand-written fixture, so a stub/catalog
  // drift cannot hide behind a passing color assertion.
  const insightCatalog = resolveAnalyticsThroughChain('es-419');
  const insightPreviousMonth = 'Julio';
  const insightCases = [
    {
      name: 'spent more (+12)',
      deltaPct: 12,
      catalogKey: 'insightMore',
      pct: '12',
      background: '#f9e9e9',
      accent: colors.danger,
    },
    {
      name: 'spent less (-12)',
      deltaPct: -12,
      catalogKey: 'insightLess',
      pct: '12',
      background: '#edf7f0',
      accent: colors.primary,
    },
    {
      name: 'no change (0)',
      deltaPct: 0,
      catalogKey: 'insightSame',
      pct: null,
      background: colors.chipBg,
      accent: colors.textSecondary,
    },
  ];

  for (const scenario of insightCases) {
    let bannerRenderer;
    await act(async () => {
      bannerRenderer = TestRenderer.create(
        React.createElement(InsightBanner, {
          deltaPct: scenario.deltaPct,
          previousMonthName: insightPreviousMonth,
        }),
      );
    });

    const bannerView = bannerRenderer.root.findByType('View');
    const bannerIcon = bannerRenderer.root.findByType('Icon');
    const bannerText = bannerRenderer.root.findByType('Text');
    const bannerStyle = styleOf(bannerView);
    const textStyle = styleOf(bannerText);
    const expectedCopy = insightCatalog[scenario.catalogKey]
      .replace(/\{\{pct\}\}/g, scenario.pct ?? '')
      .replace(/\{\{month\}\}/g, insightPreviousMonth);

    await test(`${scenario.name}: background resolves to ${scenario.background}`, () => {
      assert.equal(bannerStyle.backgroundColor, scenario.background);
    });

    await test(`${scenario.name}: icon and text share the ${scenario.accent} accent`, () => {
      assert.equal(bannerIcon.props.color, scenario.accent);
      assert.equal(textStyle.color, scenario.accent);
    });

    await test(`${scenario.name}: copy is the real catalog string`, () => {
      assert.equal(hostText(bannerText), expectedCopy);
    });

    await act(async () => {
      bannerRenderer.unmount();
    });
  }

  await test('null deltaPct keeps the null gate (renders nothing)', async () => {
    let nullRenderer;
    await act(async () => {
      nullRenderer = TestRenderer.create(
        React.createElement(InsightBanner, {
          deltaPct: null,
          previousMonthName: insightPreviousMonth,
        }),
      );
    });
    assert.equal(nullRenderer.toJSON(), null);
    await act(async () => {
      nullRenderer.unmount();
    });
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
