#!/usr/bin/env node
/**
 * Node harness for the household category drill-down helpers.
 *
 * Compiles the REAL production modules (feature-access.ts for
 * `readHouseholdCategoryItems`, and useHomeFeed.ts for the pure
 * `aggregateHouseholdCategoryItems`) plus their dependency graph into a
 * temp directory with an isolated tsconfig that remaps the native/backend
 * imports to the hand-written test doubles (react-native, supabase,
 * storage-adapter, components), then asserts the contract:
 *
 *   - `aggregateHouseholdCategoryItems` groups raw RPC rows by normalized
 *     name (accents fold: "Menú" + "menu" collapse; case + trim), sums
 *     amounts AND quantities, sorts by amount desc, and treats a missing
 *     quantity as 1 per row (the `quantity ?? 1` fallback),
 *   - empty rows → `[]`,
 *   - `readHouseholdCategoryItems` calls
 *     `rpc('get_household_category_items', { p_household_id, p_year_month,
 *     p_category_slug })` and maps rows to `HouseholdCategoryItem` (ok
 *     data, empty month → ok [], error → user-safe message), following the
 *     `__setRpcResult` seam from test-features.mjs.
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

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.household-category-items-test.json');

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

async function run() {
  console.log('\n[tests] compiling household-category-items modules…');
  await compile();
  // The app reads React Native's `__DEV__` global for dev-only behavior
  // (e.g. the home-feed dev error log); plain node has none. Declared for
  // tsc via test-stubs/globals.d.ts; defined here so the compiled modules
  // behave like a Release build.
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const homeMod = await load('src/features/home/hooks/useHomeFeed.js');
  const featureMod = await load('src/lib/supabase/feature-access.js');
  const stubMod = await load('scripts/test-stubs/supabase.js');

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

  console.log('\n[tests] readHouseholdCategoryItems\n');

  await test('calls get_household_category_items RPC and maps rows', async () => {
    stubMod.__resetSupabaseBehavior();
    stubMod.__setRpcResult('get_household_category_items', {
      rows: [
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
      ],
    });
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
    assert.equal(res.message, 'No se pudieron cargar los datos. Inténtalo de nuevo.');
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

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
