#!/usr/bin/env node
/**
 * Node harness for the pure home-feed helpers
 * (`src/features/home/hooks/useHomeFeed.ts`).
 *
 * Compiles the home-feed module plus its dependency graph (auth store,
 * receipts store, react-query) into a temp directory with an
 * isolated tsconfig that remaps the native/backend imports to the
 * hand-written test doubles (react-native, supabase, storage-adapter,
 * components), then asserts the item-matching contract:
 *
 *   - normalizeItemName folds diacritics (menú==menu, día==dia,
 *     español==espanol) — only the NFD-decompose → strip → NFC-recompose
 *     order actually strips precomposed accents,
 *   - the yerba contract: 'Yerba 1kg' + 'Yerba 500g' collapse into one
 *     'yerba' row worth 2400,
 *   - compareReceiptsByScan is a total order: equal keys → 0 and
 *     cmp(a, b) === -cmp(b, a) for unequal pairs (anti-symmetric).
 *   - aggregateCategoryItemCounts counts one per item ROW per month
 *     (NOT per quantity), scoped to the month, empty-safe, deterministic.
 *
 * Deterministic: no clock, no Intl, fixed fixture inputs.
 *
 * Usage: pnpm test:home
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
const harnessConfig = join(__dirname, 'tsconfig.home-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'home-test-'));
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

let homeMod;

async function run() {
  console.log('\n[tests] compiling home-feed modules…');
  await compile();
  // The app reads React Native's `__DEV__` global for dev-only behavior
  // (e.g. the home-feed dev error log); plain node has none. Declared for
  // tsc via test-stubs/globals.d.ts; defined here so the compiled modules
  // behave like a Release build.
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  homeMod = await load('src/features/home/hooks/useHomeFeed.js');

  console.log('\n[tests] normalizeItemName diacritic folding\n');

  await test("normalizeItemName('Menú') folds to 'menu'", () => {
    assert.equal(homeMod.normalizeItemName('Menú'), 'menu');
    assert.equal(
      homeMod.normalizeItemName('Menú'),
      homeMod.normalizeItemName('menu'),
    );
  });

  await test("normalizeItemName('Día') folds to 'dia'", () => {
    assert.equal(homeMod.normalizeItemName('Día'), 'dia');
    assert.equal(
      homeMod.normalizeItemName('Día'),
      homeMod.normalizeItemName('dia'),
    );
  });

  await test("normalizeItemName('Español') folds to 'espanol'", () => {
    assert.equal(homeMod.normalizeItemName('Español'), 'espanol');
    assert.equal(
      homeMod.normalizeItemName('Español'),
      homeMod.normalizeItemName('espanol'),
    );
  });

  await test("'Comida del día' is matched by the query 'dia'", () => {
    const name = homeMod.normalizeItemName('Comida del día');
    assert.equal(name, 'comida del dia');
    assert.ok(name.includes(homeMod.normalizeItemName('dia')));
  });

  await test("normalizeItemName merges package sizes: 'Yerba 1kg' == 'Yerba 500g'", () => {
    assert.equal(homeMod.normalizeItemName('Yerba 1kg'), 'yerba');
    assert.equal(homeMod.normalizeItemName('Yerba 500g'), 'yerba');
  });

  await test('yerba contract: Yerba 1kg + Yerba 500g collapse into one 2400 row', () => {
    const rows = homeMod.aggregateItemsByMonth(
      [
        {
          id: 'r1',
          store_name: 'Coto Hipermercado',
          purchase_date: '2026-08-05',
          items: [{ name: 'Yerba 1kg', amount: 1100, category: 'alimentos' }],
        },
        {
          id: 'r2',
          store_name: 'Almacén Barrio Norte',
          purchase_date: '2026-08-06',
          items: [{ name: 'Yerba 500g', amount: 1300, category: 'alimentos' }],
        },
      ],
      '2026-08',
    );
    assert.deepEqual(rows, [{ name: 'yerba', amount: 2400 }]);
  });

  console.log('\n[tests] compareReceiptsByScan total order\n');

  await test('equal keys return 0', () => {
    const a = { scanned_at: '2026-08-10', purchase_date: '2026-08-01' };
    const b = { scanned_at: '2026-08-10', purchase_date: '2026-08-01' };
    assert.equal(homeMod.compareReceiptsByScan(a, b), 0);
    assert.equal(homeMod.compareReceiptsByScan(b, a), 0);
  });

  await test('unequal keys: cmp(a, b) === -cmp(b, a) (anti-symmetric)', () => {
    const a = { scanned_at: '2026-08-10', purchase_date: '2026-08-05' };
    const b = { scanned_at: '2026-08-02', purchase_date: '2026-08-01' };
    assert.equal(
      homeMod.compareReceiptsByScan(a, b),
      -homeMod.compareReceiptsByScan(b, a),
    );
  });

  await test('orders by scanned_at (newer first); ties break by purchase_date', () => {
    const list = [
      { id: 'old-scan', scanned_at: '2026-08-01', purchase_date: '2026-08-10' },
      { id: 'new-scan', scanned_at: '2026-08-10', purchase_date: '2026-08-01' },
    ];
    assert.deepEqual(
      [...list].sort(homeMod.compareReceiptsByScan).map((r) => r.id),
      ['new-scan', 'old-scan'],
    );
    // Same scanned_at: the purchase_date tie-break decides (newer first).
    const tie = [
      { id: 'p-older', scanned_at: '2026-08-05', purchase_date: '2026-08-01' },
      { id: 'p-newer', scanned_at: '2026-08-05', purchase_date: '2026-08-10' },
    ];
    assert.deepEqual(
      [...tie].sort(homeMod.compareReceiptsByScan).map((r) => r.id),
      ['p-newer', 'p-older'],
    );
  });

  await test('falls back to purchase_date when scanned_at is missing (still anti-symmetric)', () => {
    const a = { purchase_date: '2026-08-01' };
    const b = { purchase_date: '2026-08-10' };
    assert.equal(homeMod.compareReceiptsByScan(a, b), 1);
    assert.equal(homeMod.compareReceiptsByScan(b, a), -1);
  });

  console.log('\n[tests] aggregateCategoryItemCounts\n');

  await test('counts one per item ROW, not per quantity (matches RPC count(*))', () => {
    const out = homeMod.aggregateCategoryItemCounts(
      [
        {
          id: 'r1',
          purchase_date: '2026-08-05',
          items: [
            { name: 'leche', amount: 50, category: 'lacteos', quantity: 3 },
            { name: 'pan', amount: 20, category: 'panaderia', quantity: 2 },
          ],
        },
        {
          id: 'r2',
          purchase_date: '2026-08-06',
          items: [{ name: 'yogur', amount: 30, category: 'lacteos', quantity: 6 }],
        },
      ],
      '2026-08',
    );
    // 3 units of leche still count once; lacteos = 2 rows total.
    assert.deepEqual(out, { lacteos: 2, panaderia: 1 });
  });

  await test('receipts from other months are excluded', () => {
    const out = homeMod.aggregateCategoryItemCounts(
      [
        {
          id: 'r1',
          purchase_date: '2026-07-05',
          items: [{ name: 'Luz', amount: 300, category: 'servicios' }],
        },
        {
          id: 'r2',
          purchase_date: '2026-08-05',
          items: [{ name: 'leche', amount: 50, category: 'lacteos' }],
        },
      ],
      '2026-08',
    );
    assert.deepEqual(out, { lacteos: 1 });
  });

  await test('receipts with no items contribute 0 (category absent from result)', () => {
    const out = homeMod.aggregateCategoryItemCounts(
      [
        { id: 'r1', purchase_date: '2026-08-05', items: [] },
        {
          id: 'r2',
          purchase_date: '2026-08-06',
          items: [{ name: 'pan', amount: 20, category: 'panaderia' }],
        },
      ],
      '2026-08',
    );
    assert.deepEqual(out, { panaderia: 1 });
  });

  await test('empty list → empty map', () => {
    assert.deepEqual(homeMod.aggregateCategoryItemCounts([], '2026-08'), {});
  });

  await test('deterministic: same input always yields the same output', () => {
    const list = [
      {
        id: 'r1',
        purchase_date: '2026-08-05',
        items: [
          { name: 'leche', amount: 50, category: 'lacteos' },
          { name: 'pan', amount: 20, category: 'panaderia' },
        ],
      },
      {
        id: 'r2',
        purchase_date: '2026-08-06',
        items: [
          { name: 'yogur', amount: 30, category: 'lacteos' },
          { name: 'Luz', amount: 300, category: 'servicios' },
        ],
      },
    ];
    const first = homeMod.aggregateCategoryItemCounts(list, '2026-08');
    const second = homeMod.aggregateCategoryItemCounts(list, '2026-08');
    assert.deepEqual(first, second);
    assert.deepEqual(first, { lacteos: 2, panaderia: 1, servicios: 1 });
  });

  console.log('\n[tests] resolveMonthNavigation (forward navigation)\n');

    await test(
    'current month absent from monthKeys is synthesized at the front (return-to-current fix)',
    () => {
      const current = homeMod.currentMonthKey();
      const prev = homeMod.previousMonthKey(current);
      const older = homeMod.previousMonthKey(prev);
      // Bug case: the current month has NO receipts, so it is absent from
      // the monthKeys list — the user could go older but never return.
      // monthKeys is newest-first: [prev, older].
      const nav = homeMod.resolveMonthNavigation([prev, older], prev);
      assert.ok(
        nav.months.includes(current),
        'current month must be synthesized',
      );
      assert.equal(nav.months[0], current, 'current month is newest (front)');
      assert.equal(nav.currentIndex, 1, 'selected (prev) month at index 1');
      assert.equal(nav.canGoNewer, true, 'can navigate newer toward current');
      assert.equal(nav.newerKey, current, 'goNewer returns to current month');
      assert.equal(nav.canGoOlder, true);
      assert.equal(nav.olderKey, older);
    },
  );

  await test(
    'current month already in monthKeys is left in place (newest, canGoNewer=false)',
    () => {
      const current = homeMod.currentMonthKey();
      const prev = homeMod.previousMonthKey(current);
      const nav = homeMod.resolveMonthNavigation([current, prev], current);
      assert.deepEqual(
        nav.months,
        [current, prev],
        'list unchanged — current already present',
      );
      assert.equal(nav.currentIndex, 0);
      assert.equal(nav.canGoNewer, false, 'nothing newer than current');
      assert.equal(nav.newerKey, null);
      assert.equal(nav.canGoOlder, true);
      assert.equal(nav.olderKey, prev);
    },
  );

  await test(
    'on a past month, goNewer walks toward newer including the current (empty) month',
    () => {
      const current = homeMod.currentMonthKey();
      const older = homeMod.previousMonthKey(
        homeMod.previousMonthKey(current),
      );
      // Only one past month has receipts; current is empty/absent.
      const nav = homeMod.resolveMonthNavigation([older], older);
      assert.deepEqual(nav.months, [current, older]);
      assert.equal(nav.currentIndex, 1);
      assert.equal(nav.canGoNewer, true, 'can step forward to current');
      assert.equal(nav.newerKey, current);
      assert.equal(nav.canGoOlder, false, 'nothing older in the list');
      assert.equal(nav.olderKey, null);
    },
  );

  await test('unknown out-of-list month degrades to newest (older-only, no crash)', () => {
    const nav = homeMod.resolveMonthNavigation(
      ['2020-01', '2020-02'],
      '1999-12',
    );
    assert.equal(nav.currentIndex, 0, 'falls back to the newest position');
    assert.equal(nav.canGoNewer, false);
    assert.equal(nav.canGoOlder, true);
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
