#!/usr/bin/env node
/**
 * Node harness for the real home-feed reads (`src/features/home/api.ts`) —
 * `readPurchaseList` and `searchPurchaseItems`, the sole data source for
 * Home / History / Analytics and the item search.
 *
 * The other harnesses only exercise the pure helpers and the draft-write
 * path; this one compiles `home/api.ts` plus its dependency graph (the
 * feature-access seam, the supabase double) with an isolated tsconfig that
 * remaps `@/lib/supabase` to the hand-written test double
 * (scripts/test-stubs/supabase.ts), arms DB-shaped fixture rows per table,
 * and asserts the mapped output and the query the app builds server-side:
 *
 *   - readPurchaseList maps `scanned_at` from `created_at`, aggregates
 *     `category_totals` by slug, sums `wants_snacks_total` over impulse
 *     items, orders line items by `sort_order`, falls back to
 *     Desconocido/otros for missing store/category, and only surfaces
 *     `status='confirmed'` (the query filters it server-side),
 *   - readPurchaseList error → user-safe READ_ERROR_MESSAGE, never raw
 *     text; unconfigured → the unconfigured shape with no network,
 *   - searchPurchaseItems bounds the month (gte/lt on the purchase date,
 *     including the December→January wrap), ilikes `name_search` with the
 *     normalized query, applies `.limit(200)`, and maps each match to a
 *     single-receipt row (`{ name, amount }` shape) the pure month
 *     aggregators can re-use,
 *   - searchPurchaseItems error / unconfigured paths match the read
 *     contract (user-safe message, no crash).
 *
 * The supabase double records every filter/order/limit applied to a chain
 * (`__getQueryCalls`), so server-side behavior the mapper cannot show (the
 * `status='confirmed'` filter, the `created_at` desc ordering, the month
 * bounds) is asserted against the query the app builds.
 *
 * Deterministic: no clock, no Intl, fixed fixture inputs.
 *
 * Usage: pnpm test:home-api
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
const harnessConfig = join(__dirname, 'tsconfig.home-api-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'home-api-test-'));
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
 * resolve `@/…` in the compiled CommonJS output. The hook rewrites the
 * `@/lib/supabase` seam to the test double and passes everything else
 * (`@/…` source files) through to their compiled locations.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
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

/** Raw PostgREST rows, shaped like the joined select in `readPurchaseList`. */
const P1 = {
  id: 'p1',
  store_id: 's1',
  purchase_date: '2026-08-05',
  created_at: '2026-08-05T14:30:00.000Z',
  total: 120,
  payment_method: 'card',
  image_url: null,
  status: 'confirmed',
  stores: { name: 'Coto Hipermercado' },
  purchase_items: [
    // Out of sort_order on purpose: the mapper must order them.
    {
      id: 'i1',
      name: 'Leche Entera',
      quantity: 2,
      unit_price: 3.5,
      total_price: 7,
      is_impulse: false,
      sort_order: 1,
      categories: { slug: 'lacteos' },
    },
    {
      id: 'i2',
      name: 'Papas Fritas',
      quantity: 1,
      unit_price: 4,
      total_price: 4,
      is_impulse: true,
      sort_order: 0,
      categories: { slug: 'snacks' },
    },
  ],
};

/** To-one relations delivered as one-element arrays (PostgREST ambiguity). */
const P2 = {
  id: 'p2',
  store_id: null,
  purchase_date: '2026-07-20',
  created_at: '2026-07-20T10:00:00.000Z',
  total: 55.5,
  payment_method: 'cash',
  image_url: null,
  status: 'confirmed',
  stores: [{ name: 'Almacén Barrio Norte' }],
  purchase_items: [
    {
      id: 'i3',
      name: 'Detergente',
      quantity: 1,
      unit_price: 55.5,
      total_price: 55.5,
      is_impulse: false,
      sort_order: 0,
      categories: [{ slug: 'limpieza' }],
    },
  ],
};

/** Missing store/category relations — the mapper's neutral fallbacks. */
const P3 = {
  id: 'p3',
  store_id: null,
  purchase_date: '2026-06-15',
  created_at: '2026-06-15T09:00:00.000Z',
  total: 12,
  payment_method: 'cash',
  image_url: null,
  status: 'confirmed',
  stores: null,
  purchase_items: [
    {
      id: 'i4',
      name: 'Producto suelto',
      quantity: 1,
      unit_price: 12,
      total_price: 12,
      is_impulse: false,
      sort_order: 0,
      categories: null,
    },
  ],
};

/** One matched `purchase_items` row with its owning purchase (search). */
const SEARCH_ROW = {
  id: 'i1',
  name: 'Leche Entera',
  quantity: 1,
  unit_price: 3.5,
  total_price: 3.5,
  is_impulse: false,
  sort_order: 0,
  categories: { slug: 'lacteos' },
  purchases: {
    id: 'p1',
    purchase_date: '2026-08-05',
    created_at: '2026-08-05T14:30:00.000Z',
    total: 42.18,
    payment_method: 'card',
    image_url: null,
    status: 'confirmed',
    stores: { name: 'Coto Hipermercado' },
  },
};

let seamMod;
let stubMod;
let homeApiMod;

/** Resets the double (rows, RPCs, call log, insert seams) and re-arms the
 *  configured flag — mirrors the features harness `resetAll`. */
function resetAll() {
  stubMod.__resetSupabaseBehavior();
  stubMod.__setSupabaseConfigured(true);
}

async function run() {
  console.log('\n[tests] compiling home-api modules…');
  await compile();
  // The app reads React Native's `__DEV__` global for dev-only behavior
  // (e.g. the home-feed dev error log); plain node has none. Declared for
  // tsc via test-stubs/globals.d.ts; defined here so the compiled modules
  // behave like a Release build.
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  seamMod = await load('src/lib/supabase/feature-access.js');
  stubMod = await load('scripts/test-stubs/supabase.js');
  homeApiMod = await load('src/features/home/api.js');

  console.log('\n[tests] readPurchaseList row mapping\n');

  await test('readPurchaseList maps the joined rows (scanned_at from created_at, aggregates)', async () => {
    resetAll();
    // The stub returns rows as-armed; the DB sorts (asserted in the chain
    // test below). P2 is older but armed second — mapping must not depend
    // on arrival order.
    stubMod.__setTableRead('purchases', { rows: [P1, P2] });
    const result = await homeApiMod.readPurchaseList('u1');
    assert.equal(result.status, 'ok');
    assert.equal(result.data.length, 2);
    const [first, second] = result.data;
    assert.equal(first.id, 'p1');
    assert.equal(first.store_name, 'Coto Hipermercado');
    assert.equal(first.purchase_date, '2026-08-05');
    // scanned_at is not a column: it is derived from purchases.created_at.
    assert.equal(first.scanned_at, '2026-08-05T14:30:00.000Z');
    assert.equal(first.total, 120);
    assert.equal(first.status, 'confirmed');
    // Items ordered by sort_order ascending, not arrival order.
    assert.deepEqual(
      first.items.map((i) => i.name),
      ['Papas Fritas', 'Leche Entera'],
    );
    assert.deepEqual(first.items[0], {
      name: 'Papas Fritas',
      amount: 4,
      quantity: 1,
      unit_price: 4,
      category: 'snacks',
      is_impulse: true,
    });
    // category_totals aggregated by slug over the line totals.
    assert.deepEqual(first.category_totals, { snacks: 4, lacteos: 7 });
    // wants_snacks_total sums only the impulse items.
    assert.equal(first.wants_snacks_total, 4);
    assert.equal(second.id, 'p2');
    // To-one relations as one-element arrays normalize to the same shape.
    assert.equal(second.store_name, 'Almacén Barrio Norte');
    assert.equal(second.items[0].category, 'limpieza');
    assert.deepEqual(second.category_totals, { limpieza: 55.5 });
    assert.equal(second.wants_snacks_total, 0);
  });

  await test('readPurchaseList falls back to Desconocido/otros for missing store/category', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', { rows: [P3] });
    const result = await homeApiMod.readPurchaseList('u1');
    assert.equal(result.status, 'ok');
    const [row] = result.data;
    assert.equal(row.store_name, 'Desconocido');
    assert.equal(row.image_url, null);
    assert.equal(row.items[0].category, 'otros');
    assert.deepEqual(row.category_totals, { otros: 12 });
    assert.equal(row.wants_snacks_total, 0);
  });

  await test('readPurchaseList filters user + confirmed and orders created_at desc server-side', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', { rows: [] });
    await homeApiMod.readPurchaseList('u1');
    const ops = stubMod.__getQueryCalls('purchases');
    assert.ok(
      ops.some((o) => o.op === 'eq' && o.column === 'user_id' && o.value === 'u1'),
      'scopes to the signed-in user',
    );
    // Drafts never surface in the feed: the query excludes every status but
    // confirmed, so the mapper never sees them (the one place the mapping
    // cannot re-filter — the DB does).
    assert.ok(
      ops.some((o) => o.op === 'eq' && o.column === 'status' && o.value === 'confirmed'),
      'filters status=confirmed server-side',
    );
    assert.ok(
      ops.some(
        (o) =>
          o.op === 'order' &&
          o.column === 'created_at' &&
          o.opts !== undefined &&
          o.opts.ascending === false,
      ),
      'orders by created_at desc (newest capture first)',
    );
  });

  await test('readPurchaseList resolves an empty result to ok with an empty list', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', { rows: [] });
    const result = await homeApiMod.readPurchaseList('u1');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, []);
  });

  await test('readPurchaseList error resolves to the user-safe message, never throws', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', {
      error: { message: 'connection reset by peer', code: 'PGRST200' },
    });
    const result = await homeApiMod.readPurchaseList('u1');
    assert.equal(result.status, 'error');
    assert.equal(result.message, seamMod.READ_ERROR_MESSAGE);
    assert.notEqual(result.message, 'connection reset by peer');
  });

  await test('readPurchaseList reports unconfigured without touching the network', async () => {
    resetAll();
    stubMod.__setSupabaseConfigured(false);
    const result = await homeApiMod.readPurchaseList('u1');
    assert.equal(result.status, 'unconfigured');
    assert.equal(stubMod.__getCallLog().length, 0, 'no network when unconfigured');
  });

  console.log('\n[tests] searchPurchaseItems month-bounded item search\n');

  await test('searchPurchaseItems maps a match to a single-receipt row ({ name, amount })', async () => {
    resetAll();
    stubMod.__setTableRead('purchase_items', { rows: [SEARCH_ROW] });
    const result = await homeApiMod.searchPurchaseItems('u1', '2026-08', 'leche');
    assert.equal(result.status, 'ok');
    assert.equal(result.data.length, 1);
    const row = result.data[0];
    assert.equal(row.id, 'i1');
    assert.equal(row.store_name, 'Coto Hipermercado');
    assert.equal(row.purchase_date, '2026-08-05');
    assert.equal(row.scanned_at, '2026-08-05T14:30:00.000Z');
    assert.equal(row.status, 'confirmed');
    // One item per row so the pure month aggregators re-use the shape.
    assert.deepEqual(row.items, [
      {
        name: 'Leche Entera',
        amount: 3.5,
        quantity: 1,
        unit_price: 3.5,
        category: 'lacteos',
        is_impulse: false,
      },
    ]);
    assert.deepEqual(row.category_totals, { lacteos: 3.5 });
    assert.equal(row.wants_snacks_total, 0);
  });

  await test('searchPurchaseItems applies user, ilike, month bounds and limit', async () => {
    resetAll();
    stubMod.__setTableRead('purchase_items', { rows: [] });
    await homeApiMod.searchPurchaseItems('u1', '2026-08', 'leche');
    const ops = stubMod.__getQueryCalls('purchase_items');
    assert.ok(
      ops.some((o) => o.op === 'eq' && o.column === 'purchases.user_id' && o.value === 'u1'),
      'explicit user scoping besides RLS',
    );
    assert.ok(
      ops.some((o) => o.op === 'ilike' && o.column === 'name_search' && o.pattern === '%leche%'),
      'accent-insensitive ilike on name_search',
    );
    assert.ok(
      ops.some(
        (o) => o.op === 'gte' && o.column === 'purchases.purchase_date' && o.value === '2026-08-01',
      ),
      'month lower bound inclusive',
    );
    assert.ok(
      ops.some(
        (o) => o.op === 'lt' && o.column === 'purchases.purchase_date' && o.value === '2026-09',
      ),
      // nextMonthKey returns the bare YYYY-MM prefix; ISO dates sort
      // lexicographically, so `< '2026-09'` excludes every September date
      // (>= '2026-09-01') — a correct exclusive upper bound.
      'month upper bound exclusive (bare YYYY-MM prefix, string math)',
    );
    assert.ok(ops.some((o) => o.op === 'limit' && o.count === 200), 'caps results at 200');
  });


  await test('searchPurchaseItems orders deterministically by purchase date then name', async () => {
    resetAll();
    stubMod.__setTableRead('purchase_items', { rows: [] });
    await homeApiMod.searchPurchaseItems('u1', '2026-08', 'leche');
    const ops = stubMod.__getQueryCalls('purchase_items');
    const orders = ops.filter((o) => o.op === 'order');
    // `purchase_date` is not a column of purchase_items: the order must
    // target the to-one purchase (parens form), or PostgREST would 400.
    assert.equal(orders.length, 2, 'orders by purchase date then name');
    assert.deepEqual(orders[0], {
      op: 'order',
      column: 'purchases(purchase_date)',
      opts: { ascending: true },
    });
    assert.deepEqual(orders[1], {
      op: 'order',
      column: 'name',
      opts: undefined,
    });
  });

  await test('searchPurchaseItems wraps the year boundary (December → January)', async () => {
    resetAll();
    stubMod.__setTableRead('purchase_items', { rows: [] });
    await homeApiMod.searchPurchaseItems('u1', '2026-12', 'pan');
    const ops = stubMod.__getQueryCalls('purchase_items');
    assert.ok(
      ops.some((o) => o.op === 'gte' && o.value === '2026-12-01'),
      'December lower bound',
    );
    assert.ok(
      ops.some((o) => o.op === 'lt' && o.value === '2027-01'),
      'upper bound rolls into the next year (bare YYYY-MM prefix)',
    );
  });

  await test('searchPurchaseItems error resolves to the user-safe message, never throws', async () => {
    resetAll();
    stubMod.__setTableRead('purchase_items', {
      error: { message: 'relation "purchase_items" does not exist', code: '42P01' },
    });
    const result = await homeApiMod.searchPurchaseItems('u1', '2026-08', 'leche');
    assert.equal(result.status, 'error');
    assert.equal(result.message, seamMod.READ_ERROR_MESSAGE);
    assert.notEqual(result.message, 'relation "purchase_items" does not exist');
  });

  await test('searchPurchaseItems reports unconfigured without touching the network', async () => {
    resetAll();
    stubMod.__setSupabaseConfigured(false);
    const result = await homeApiMod.searchPurchaseItems('u1', '2026-08', 'leche');
    assert.equal(result.status, 'unconfigured');
    assert.equal(stubMod.__getCallLog().length, 0, 'no network when unconfigured');
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
