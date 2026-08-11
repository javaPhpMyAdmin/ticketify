#!/usr/bin/env node
/**
 * Node harness for the authenticated-only feature reads (data-access slice).
 *
 * Compiles the data-access seam (`src/lib/supabase/feature-access.ts`) and
 * the feature APIs (profile, budget, analytics, tickets) into a temp
 * directory with an isolated tsconfig that remaps `@/lib/supabase` to the
 * hand-written test double (scripts/test-stubs/supabase.ts), then asserts the
 * data-access spec boundaries. (The home-feed hooks module is compiled in a
 * second pass with `tsconfig.home-test.json` so `currentMonthKey` — the LOCAL
 * current month the budget spent query shares with analytics as its cache
 * key — can be asserted directly, its local counterpart to `utcYearMonth`.)
 *
 *   - authenticated profile / budget reads hit `profiles` (ok, missing-profile,
 *     unconfigured, error → user-safe message),
 *   - authenticated scan usage reads hit `scan_usage` (missing month row is a
 *     normal ok/null),
 *   - analytics reads call `rpc('monthly_category_totals', { p_year_month })`
 *     and a not-deployed RPC fails safe,
 *   - budget spent: the `monthly_purchases_total` RPC seam
 *     (`readMonthlyPurchasesTotal`) — the SUM of `purchases.total`
 *     (post-discount, what the user was actually charged), asserted via
 *     `__lastRpcCall` and the PGRST202 fails-safe path, plus the pure
 *     `sumCategoryTotals` helper (fixture sum, empty month → 0, malformed
 *     rows skipped) that still aggregates the category-rows shape the
 *     analytics breakdown reads. (The hook itself is out of scope here: it
 *     imports react, so the harness cannot compile it; its cache-collision
 *     behavior is proven by a standalone TanStack probe.)
 *   - `saveReceipt` persists real `purchases` + `purchase_items` rows for
 *     the authenticated user: store resolution (reuse by name or create as
 *     the user's own row), category slug→id mapping, impulse flag
 *     persistence, and the compensating rollback on a failed item write.
 *     The failure branches are exercised through the double's insert seam:
 *     empty store name and store/purchase insert errors surface the
 *     user-safe message with no partial writes; a failed item write fires
 *     the compensating delete on `purchases`. The inserted payloads are
 *     asserted via `__getInserted` (slug→uuid, purchase_id linkage,
 *     user_id, is_impulse, sort_order). A successful save invalidates the
 *     shared monthlyTotals cache by USER PREFIX: the behavioral proof seeds
 *     the real TanStack client (the singleton the compiled api requires)
 *     with the current-UTC-month key and a different-month key, then asserts
 *     BOTH turn isInvalidated after the save while another user's entry
 *     stays untouched — the pinned-UTC-month invalidation this replaces
 *     could only ever hit one of them (the UTC/local month-boundary miss).
 *   - pure query layer: `utcYearMonth` + key factories (userId-scoped, shared
 *     year-month), `currentMonthKey` (the LOCAL current month — local
 *     counterpart of `utcYearMonth`, and the month the budget spent query's
 *     shared key is built on), and the throwing adapters (`toQueryData`
 *     ok/throw branches, `shouldRetry` definitive-vs-transient gating,
 *     `toQueryErrorMessage` copy mapping).
 *
 * The double is type-checked against the compiled production code, so a
 * signature drift between the app and its tests fails the typecheck here.
 *
 * Usage: pnpm test:features
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
const harnessConfig = join(__dirname, 'tsconfig.feature-test.json');
// Second compile pass (see `compile`): the home-feed hooks module holds the
// LOCAL current-month key the budget spent query shares with analytics.
const homeHarnessConfig = join(__dirname, 'tsconfig.home-test.json');

// Same module instance as the compiled `api.js` (which requires
// '@supabase/supabase-js'), so `instanceof FunctionsHttpError` works in the
// error-mapping tests below.
const supabaseJs = require('@supabase/supabase-js');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'feature-test-'));
const outDir = join(workdir, 'out');

const DRAFT = {
  store_name: 'Whole Foods Market',
  purchase_date: '2026-08-02',
  total: 42.18,
  payment_method: 'card',
  image_url: 'https://picsum.photos/seed/ticketify-test/800/1200',
  items: [],
};

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

/** Asserts `fn` throws a `FeatureQueryError` with the given kind. */
async function throwsFeatureQueryError(fn, kind) {
  try {
    await fn();
  } catch (err) {
    assert.ok(
      err instanceof adaptersMod.FeatureQueryError,
      `expected FeatureQueryError, got ${err && err.name}`,
    );
    assert.equal(err.kind, kind);
    return err;
  }
  assert.fail('expected a FeatureQueryError to be thrown');
}

/**
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `@/…` in the compiled CommonJS output. The hook rewrites exactly
 * those specifiers (and the native-bound `expo-file-system` module used by
 * the tickets api) to their compiled locations and passes everything else
 * (zustand, …) through untouched.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      // Only the home-feed pass (tsconfig.home-test) emits this stub; the
      // auth graph pulled in by `useHomeFeed.js` needs it in plain node.
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'expo-file-system') {
      request = join(outDir, 'scripts', 'test-stubs', 'expo-file-system.js');
    } else if (request === 'react-native') {
      // Mirrors the auth harness: the real package cannot load in plain node
      // (flow syntax); `query-client.ts` only touches AppState + Platform.OS.
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
  // Second pass into the SAME output tree: the features tsconfig cannot
  // compile `useHomeFeed.ts` (react graph, no jsx), but the home-feed
  // harness config compiles it and its dependencies with the matching
  // stubs. The emitted modules are additive; files both configs compile
  // (e.g. query-keys, format, the supabase stub) emit identically.
  execFileSync(
    process.execPath,
    [tscBin, '-p', homeHarnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/**
 * Real-looking URL + anon key: the double's `isSupabaseConfigured` derives
 * `true` from these, so reads reach the network seam.
 */
const CONFIGURED_URL = 'https://real-project.supabase.co';
const CONFIGURED_ANON_KEY = 'real-anon-key';

/** The `app.json` fallback values: the real derivation must reject them. */
const PLACEHOLDER_URL = 'https://YOUR-PROJECT.supabase.co';
const PLACEHOLDER_ANON_KEY = 'YOUR-ANON-KEY';

/** Resets the double (rows, RPCs, invoke results, file sources, call log). */
function resetAll() {
  stubMod.__resetSupabaseBehavior();
  stubMod.__setSupabaseConfigInputs(CONFIGURED_URL, CONFIGURED_ANON_KEY);
  expoFsMod.__resetFileSources();
}

let seamMod;
let stubMod;
let expoFsMod;
let profileMod;
let budgetMod;
let analyticsMod;
let ticketsMod;
let photoMod;
let keysMod;
let homeHooksMod;
let pictureSizeMod;
let cardMod;
let adaptersMod;
let configStatusMod;
let queryClientMod;

async function run() {
  console.log('\n[tests] compiling data-access modules…');
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
  expoFsMod = await load('scripts/test-stubs/expo-file-system.js');
  profileMod = await load('src/features/profile/api.js');
  budgetMod = await load('src/features/budget/api.js');
  analyticsMod = await load('src/features/analytics/api.js');
  ticketsMod = await load('src/features/tickets/api.js');
  photoMod = await load('src/lib/supabase/receipt-photo.js');
  keysMod = await load('src/lib/query-keys.js');
  // From the home-feed pass: the LOCAL current-month key derivation the
  // budget spent query's shared cache key is built on.
  homeHooksMod = await load('src/features/home/hooks/useHomeFeed.js');
  adaptersMod = await load('src/lib/supabase/query-adapters.js');
  // The real pure derivation (no native deps): the double derives its
  // `isSupabaseConfigured` from this same function.
  configStatusMod = await load('src/lib/supabase/config-status.js');
  pictureSizeMod = await load('src/features/tickets/lib/picture-size.js');
  cardMod = await load('supabase/functions/parse-ticket/lib/card.js');
  // The REAL TanStack singleton the compiled tickets api requires — seeding
  // its cache and reading `isInvalidated` after a save proves the
  // invalidation behavior on the actual library, not a stub.
  queryClientMod = await load('src/lib/query-client.js');

  console.log('\n[tests] authenticated profile reads\n');

  await test('fetchProfile returns the profiles row for the signed-in user', async () => {
    resetAll();
    stubMod.__setTableRead('profiles', {
      rows: [
        {
          id: 'u1',
          full_name: 'Ana',
          avatar_url: null,
          monthly_budget: 900,
          currency: 'EUR',
          tier: 'free',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const result = await profileMod.fetchProfile('u1');
    assert.equal(result.status, 'ok');
    assert.equal(result.data.id, 'u1');
    assert.equal(result.data.monthly_budget, 900);
  });

  await test('missing profiles row reports missing-profile (no crash)', async () => {
    resetAll();
    stubMod.__setTableRead('profiles', { rows: [] });
    const result = await profileMod.fetchProfile('u1');
    assert.equal(result.status, 'missing-profile');
  });

  await test('PostgREST error maps to a user-safe message, never raw text', async () => {
    resetAll();
    stubMod.__setTableRead('profiles', {
      error: { message: 'relation "profiles" does not exist', code: '42P01' },
    });
    const result = await profileMod.fetchProfile('u1');
    assert.equal(result.status, 'error');
    assert.equal(result.message, seamMod.READ_ERROR_MESSAGE);
    assert.notEqual(result.message, 'relation "profiles" does not exist');
  });

  await test('unconfigured client reports unconfigured and skips the network', async () => {
    resetAll();
    // The double derives the flag through the real pure derivation: the
    // app.json placeholder URL disqualifies the configuration (same contract
    // the app runs at module load).
    stubMod.__setSupabaseConfigInputs(PLACEHOLDER_URL, CONFIGURED_ANON_KEY);
    const result = await profileMod.fetchProfile('u1');
    assert.equal(result.status, 'unconfigured');
    assert.equal(stubMod.__getCallLog().length, 0, 'no network when unconfigured');
  });

  await test('fetchScanUsage returns the user-month row', async () => {
    resetAll();
    stubMod.__setTableRead('scan_usage', {
      rows: [{ user_id: 'u1', year_month: '2026-08', scans_used: 3, scans_limit: 10 }],
    });
    const result = await profileMod.fetchScanUsage('u1', '2026-08');
    assert.equal(result.status, 'ok');
    assert.equal(result.data.scans_used, 3);
    assert.equal(result.data.scans_limit, 10);
  });

  await test('no scan_usage row for the month resolves to ok/null (normal)', async () => {
    resetAll();
    stubMod.__setTableRead('scan_usage', { rows: [] });
    const result = await profileMod.fetchScanUsage('u1', '2026-09');
    assert.equal(result.status, 'ok');
    assert.equal(result.data, null);
  });

  console.log('\n[tests] profile currency write\n');

  await test('setProfileCurrency writes profiles.currency for the signed-in user row', async () => {
    resetAll();
    const result = await profileMod.setProfileCurrency('u1', 'USD');
    assert.equal(result.status, 'ok');
    // Payload seam: the exact columns written (not just "an update happened").
    assert.deepEqual(stubMod.__getUpdated('profiles'), { currency: 'USD' });
    // Target seam: the update chain filters on the user's own row id — a
    // bare table update would hit every profile row.
    const ops = stubMod.__getQueryCalls('profiles');
    assert.ok(
      ops.some((o) => o.op === 'eq' && o.column === 'id' && o.value === 'u1'),
      'update targets the user row via eq(id, userId)',
    );
    assert.ok(
      stubMod.__getCallLog().some((e) => e.kind === 'update' && e.table === 'profiles'),
      'update call logged on profiles',
    );
  });

  await test('setProfileCurrency surfaces a user-safe error on DB failure, never raw text', async () => {
    resetAll();
    stubMod.__failNextUpdate('profiles', {
      message: 'permission denied for table profiles',
      code: '42501',
    });
    const result = await profileMod.setProfileCurrency('u1', 'USD');
    assert.equal(result.status, 'error');
    assert.equal(result.message, profileMod.WRITE_ERROR_MESSAGE);
    assert.equal(result.message, 'No se pudo guardar el cambio. Inténtalo de nuevo.');
    assert.notEqual(result.message, 'permission denied for table profiles');
  });

  await test('setProfileCurrency reports unconfigured without touching the network', async () => {
    resetAll();
    // The double derives the flag through the real pure derivation: the
    // app.json placeholder URL disqualifies the configuration (same contract
    // the app runs at module load).
    stubMod.__setSupabaseConfigInputs(PLACEHOLDER_URL, CONFIGURED_ANON_KEY);
    const result = await profileMod.setProfileCurrency('u1', 'USD');
    assert.equal(result.status, 'error');
    assert.equal(result.message, profileMod.WRITE_ERROR_MESSAGE);
    assert.equal(
      stubMod.__getCallLog().length,
      0,
      'no network when unconfigured',
    );
  });

  console.log('\n[tests] authenticated budget reads\n');

  await test('fetchMonthlyBudget reads profiles.monthly_budget and currency', async () => {
    resetAll();
    stubMod.__setTableRead('profiles', {
      rows: [{ monthly_budget: 900, currency: 'EUR' }],
    });
    const result = await budgetMod.fetchMonthlyBudget('u1');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { amount: 900, currency: 'EUR' });
  });

  await test('missing profile row reports missing-profile for budget', async () => {
    resetAll();
    stubMod.__setTableRead('profiles', { rows: [] });
    const result = await budgetMod.fetchMonthlyBudget('u1');
    assert.equal(result.status, 'missing-profile');
  });

  await test('sumCategoryTotals sums the category rows into the spent amount', async () => {
    assert.equal(
      budgetMod.sumCategoryTotals([
        {
          category_id: '1',
          category_name: 'Groceries',
          category_slug: 'groceries',
          total: 1200,
          item_count: 20,
          percent_of_total: 0.22,
        },
        {
          category_id: '2',
          category_name: 'Snacks',
          category_slug: 'snacks',
          total: 3500,
          item_count: 40,
          percent_of_total: 0.64,
        },
        {
          category_id: '3',
          category_name: 'Transport',
          category_slug: 'transport',
          total: 800,
          item_count: 10,
          percent_of_total: 0.14,
        },
      ]),
      5500,
    );
  });

  await test('sumCategoryTotals of an empty month is 0', async () => {
    assert.equal(budgetMod.sumCategoryTotals([]), 0);
  });

  console.log('\n[tests] authenticated analytics reads (ADR-7 RPC)\n');

  await test('category totals call the RPC with p_year_month only (no user id)', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_category_totals', {
      rows: [
        {
          category_id: '1',
          category_name: 'Groceries',
          category_slug: 'groceries',
          total: 450,
          item_count: 24,
          percent_of_total: 0.5,
        },
      ],
    });
    const result = await analyticsMod.fetchCategoryBreakdown('2026-08');
    assert.equal(result.status, 'ok');
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].category_name, 'Groceries');
    assert.deepEqual(stubMod.__lastRpcCall(), {
      fn: 'monthly_category_totals',
      params: { p_year_month: '2026-08' },
    });
  });

  await test('not-deployed RPC fails safe with a user-safe error (no crash)', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_category_totals', {
      error: {
        message: 'function monthly_category_totals(text) does not exist',
        code: 'PGRST202',
      },
    });
    const result = await analyticsMod.fetchMonthlyTotals('2026-08');
    assert.equal(result.status, 'error');
    assert.equal(result.message, seamMod.READ_ERROR_MESSAGE);
  });

  await test('readCategoryTotals reaches the RPC with p_year_month only and aggregates via sumCategoryTotals', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_category_totals', {
      rows: [
        {
          category_id: '1',
          category_name: 'Groceries',
          category_slug: 'groceries',
          total: 450,
          item_count: 24,
          percent_of_total: 0.79,
        },
        {
          category_id: '2',
          category_name: 'Snacks',
          category_slug: 'snacks',
          total: 120,
          item_count: 6,
          percent_of_total: 0.21,
        },
      ],
    });
    const result = await seamMod.readCategoryTotals('2026-08');
    assert.equal(result.status, 'ok');
    assert.deepEqual(stubMod.__lastRpcCall(), {
      fn: 'monthly_category_totals',
      params: { p_year_month: '2026-08' },
    });
    assert.equal(budgetMod.sumCategoryTotals(result.data), 570);
  });

  await test('sumCategoryTotals includes the NULL-category money: total covers every item and lands in the otros bucket (0009 regression)', async () => {
    resetAll();
    // Regression pin for the NULL category_id fix (0009): the hardened RPC
    // LEFT JOINs categories and COALESCEs `category_id IS NULL` items onto
    // the 'otros' row, so a month mixing N categorized items and M
    // NULL-category items returns an explicit 'otros' row holding the M
    // money. The budget spent must count EVERYTHING (N+M) — the pre-fix RPC
    // (INNER JOIN on categories) dropped the M items from the breakdown
    // entirely, understating spend. The stub arms exactly the rows the RPC
    // contract now returns for such a month.
    const normalItems = [
      {
        category_id: 'cat-lacteos',
        category_name: 'Lácteos',
        category_slug: 'lacteos',
        total: 3500,
        item_count: 20,
        percent_of_total: 0.64,
      },
      {
        category_id: 'cat-snacks',
        category_name: 'Snacks / Galletas',
        category_slug: 'snacks',
        total: 1200,
        item_count: 8,
        percent_of_total: 0.22,
      },
    ];
    // M = the NULL-category items' money, aggregated under 'otros' by the
    // RPC's COALESCE (category_id NULL → the fallback_otros row).
    const nullMoneyBucket = {
      category_id: 'cat-otros',
      category_name: 'Otros',
      category_slug: 'otros',
      total: 800,
      item_count: 3,
      percent_of_total: 0.14,
    };
    stubMod.__setRpcResult('monthly_category_totals', {
      rows: [...normalItems, nullMoneyBucket],
    });
    const result = await seamMod.readCategoryTotals('2026-08');
    assert.equal(result.status, 'ok');
    // 3500 + 1200 + 800: N + M — the 'otros' money is never dropped.
    assert.equal(budgetMod.sumCategoryTotals(result.data), 5500);
    const otros = result.data.find((row) => row.category_slug === 'otros');
    assert.ok(otros, 'NULL-category items land under the otros bucket');
    assert.equal(otros.total, 800, 'the M NULL items money sits in otros');
    assert.equal(otros.item_count, 3, 'every NULL-category item is counted');
  });

  await test('readCategoryTotals fails safe on a not-deployed RPC', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_category_totals', {
      error: {
        message: 'function monthly_category_totals(text) does not exist',
        code: 'PGRST202',
      },
    });
    const result = await seamMod.readCategoryTotals('2026-08');
    assert.equal(result.status, 'error');
    assert.equal(result.message, seamMod.READ_ERROR_MESSAGE);
  });

  await test('readMonthlyPurchasesTotal (budget spent seam) calls monthly_purchases_total with the month only', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_purchases_total', {
      rows: [{ total: 301.45 }],
    });
    const result = await seamMod.readMonthlyPurchasesTotal('2026-08');
    assert.equal(result.status, 'ok');
    assert.deepEqual(stubMod.__lastRpcCall(), {
      fn: 'monthly_purchases_total',
      params: { p_year_month: '2026-08' },
    });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].total, 301.45);
  });

  await test('readMonthlyPurchasesTotal of an empty month is ok with an empty array (no fabricated zero)', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_purchases_total', { rows: [] });
    const result = await seamMod.readMonthlyPurchasesTotal('2026-08');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, []);
  });

  await test('readMonthlyPurchasesTotal fails safe on a not-deployed RPC (user-safe message)', async () => {
    resetAll();
    stubMod.__setRpcResult('monthly_purchases_total', {
      error: {
        message: 'function monthly_purchases_total(text) does not exist',
        code: 'PGRST202',
      },
    });
    const result = await seamMod.readMonthlyPurchasesTotal('2026-08');
    assert.equal(result.status, 'error');
    assert.equal(result.message, seamMod.READ_ERROR_MESSAGE);
  });

  await test('sumCategoryTotals skips malformed rows (missing/null total) and sums the valid ones only', async () => {
    assert.equal(
      budgetMod.sumCategoryTotals([
        {
          category_id: '1',
          category_name: 'Groceries',
          category_slug: 'groceries',
          total: 1200,
          item_count: 24,
          percent_of_total: 0.26,
        },
        {
          category_id: '2',
          category_name: 'Snacks',
          category_slug: 'snacks',
          total: null,
          item_count: 6,
          percent_of_total: 0.12,
        },
        {
          // The `total` key itself is missing entirely — also skipped.
          category_id: '3',
          category_name: 'Otros',
          category_slug: 'otros',
          item_count: 1,
        },
        {
          category_id: '4',
          category_name: 'Lácteos',
          category_slug: 'lacteos',
          total: 3500,
          item_count: 12,
          percent_of_total: 0.75,
        },
      ]),
      4700,
      // 1200 + 3500: a null total is NOT coerced into a fake 0, so the
      // malformed rows can never fabricate spend.
    );
  });

  console.log('\n[tests] pure query layer (keys + throwing adapters + config-status)\n');

  await test('utcYearMonth derives the shared UTC year-month with zero padding', async () => {
    assert.equal(keysMod.utcYearMonth(new Date(Date.UTC(2026, 7, 15))), '2026-08');
    assert.equal(keysMod.utcYearMonth(new Date(Date.UTC(2026, 0, 1))), '2026-01');
    assert.equal(keysMod.utcYearMonth(new Date(Date.UTC(2026, 11, 31))), '2026-12');
  });

  await test('currentMonthKey returns the LOCAL current month as YYYY-MM (the budget spent key source — a UTC slice would drift a month in UTC-x zones)', () => {
    // Local counterpart of the `utcYearMonth` test above: the derivation
    // reads the clock internally, so the expected value is computed from the
    // LOCAL parts of `new Date()` — never `getUTCMonth`, which is exactly
    // the drift the function exists to avoid (useBudget's spent query builds
    // its shared cache key on this LOCAL month).
    const local = new Date();
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`;
    assert.equal(homeHooksMod.currentMonthKey(), expected);
    assert.match(homeHooksMod.currentMonthKey(), /^\d{4}-\d{2}$/);
  });

  await test('query key factories are userId-scoped with the designed shapes', async () => {
    assert.deepEqual(keysMod.queryKeys.profile('u1'), ['profile', 'u1']);
    assert.deepEqual(keysMod.queryKeys.scanUsage('u1', '2026-08'), [
      'scan-usage',
      'u1',
      '2026-08',
    ]);
    assert.deepEqual(keysMod.queryKeys.budget('u1'), ['budget', 'u1']);
    assert.deepEqual(keysMod.queryKeys.monthlyTotals('u1', '2026-08'), [
      'analytics',
      'monthly-totals',
      'u1',
      '2026-08',
    ]);
    assert.deepEqual(keysMod.queryKeys.homeFeed('u1'), ['home', 'feed', 'u1']);
  });

  await test('two users never share a key (cross-user isolation)', async () => {
    assert.notDeepEqual(keysMod.queryKeys.profile('uA'), keysMod.queryKeys.profile('uB'));
    assert.notDeepEqual(keysMod.queryKeys.budget('uA'), keysMod.queryKeys.budget('uB'));
    assert.notDeepEqual(
      keysMod.queryKeys.monthlyTotals('uA', '2026-08'),
      keysMod.queryKeys.monthlyTotals('uB', '2026-08'),
    );
  });

  await test('scan-usage and analytics keys embed the same shared year-month', async () => {
    const ym = keysMod.utcYearMonth(new Date(Date.UTC(2026, 7, 15)));
    assert.equal(keysMod.queryKeys.scanUsage('u1', ym)[2], '2026-08');
    assert.equal(keysMod.queryKeys.monthlyTotals('u1', ym)[3], '2026-08');
    assert.equal(
      keysMod.queryKeys.scanUsage('u1', ym)[2],
      keysMod.queryKeys.monthlyTotals('u1', ym)[3],
    );
  });

  await test('toQueryData resolves ok data and treats ok-null as success', async () => {
    const data = { id: 'u1', monthly_budget: 900 };
    assert.equal(adaptersMod.toQueryData({ status: 'ok', data }), data);
    assert.equal(adaptersMod.toQueryData({ status: 'ok', data: null }), null);
  });

  await test('toQueryData throws missing-profile with the generic copy', async () => {
    const err = await throwsFeatureQueryError(
      () => adaptersMod.toQueryData({ status: 'missing-profile' }),
      'missing-profile',
    );
    assert.equal(err.message, seamMod.READ_ERROR_MESSAGE);
  });

  await test('toQueryData throws unconfigured with the generic copy', async () => {
    const err = await throwsFeatureQueryError(
      () => adaptersMod.toQueryData({ status: 'unconfigured' }),
      'unconfigured',
    );
    assert.equal(err.message, seamMod.READ_ERROR_MESSAGE);
  });

  await test('toQueryData throws error kind carrying the seam message', async () => {
    const err = await throwsFeatureQueryError(
      () => adaptersMod.toQueryData({ status: 'error', message: 'boom' }),
      'error',
    );
    assert.equal(err.message, 'boom');
  });

  await test('shouldRetry never retries definitive kinds', async () => {
    assert.equal(
      adaptersMod.shouldRetry(0, new adaptersMod.FeatureQueryError('missing-profile', 'x')),
      false,
    );
    assert.equal(
      adaptersMod.shouldRetry(3, new adaptersMod.FeatureQueryError('unconfigured', 'x')),
      false,
    );
  });

  await test('shouldRetry retries transient errors up to 2 failures', async () => {
    const err = new adaptersMod.FeatureQueryError('error', 'x');
    assert.equal(adaptersMod.shouldRetry(0, err), true);
    assert.equal(adaptersMod.shouldRetry(1, err), true);
    assert.equal(adaptersMod.shouldRetry(2, err), false);
  });

  await test('shouldRetry bounds unknown errors through the same gate', async () => {
    assert.equal(adaptersMod.shouldRetry(0, new Error('network down')), true);
    assert.equal(adaptersMod.shouldRetry(2, new Error('network down')), false);
  });

  await test('toQueryErrorMessage maps missing-profile to the dedicated copy', async () => {
    const msg = adaptersMod.toQueryErrorMessage(
      new adaptersMod.FeatureQueryError('missing-profile', 'x'),
    );
    assert.equal(msg, adaptersMod.MISSING_PROFILE_MESSAGE);
    assert.equal(
      msg,
      'Tu perfil aún no está configurado. Inténtalo de nuevo.',
    );
  });

  await test('toQueryErrorMessage carries the seam message for error kind', async () => {
    const msg = adaptersMod.toQueryErrorMessage(
      new adaptersMod.FeatureQueryError('error', seamMod.READ_ERROR_MESSAGE),
    );
    assert.equal(msg, seamMod.READ_ERROR_MESSAGE);
  });

  await test('toQueryErrorMessage maps non-adapter errors to the generic copy', async () => {
    assert.equal(adaptersMod.toQueryErrorMessage(new Error('raw text')), seamMod.READ_ERROR_MESSAGE);
    assert.equal(adaptersMod.toQueryErrorMessage('not an error'), seamMod.READ_ERROR_MESSAGE);
  });

  await test('config-status: a missing URL disqualifies the configuration', async () => {
    assert.equal(
      configStatusMod.isSupabaseConfigured(undefined, CONFIGURED_ANON_KEY),
      false,
    );
  });

  await test('config-status: a missing anon key disqualifies the configuration', async () => {
    assert.equal(
      configStatusMod.isSupabaseConfigured(CONFIGURED_URL, undefined),
      false,
    );
  });

  await test('config-status: empty strings (the real module-load unconfigured state) disqualify', async () => {
    // The module falls back to `''` when env + app.json are both absent —
    // that is the most common unconfigured path at load time.
    assert.equal(configStatusMod.isSupabaseConfigured('', CONFIGURED_ANON_KEY), false);
    assert.equal(configStatusMod.isSupabaseConfigured(CONFIGURED_URL, ''), false);
    assert.equal(configStatusMod.isSupabaseConfigured('', ''), false);
  });

  await test('config-status: the app.json placeholder URL is rejected', async () => {
    assert.equal(
      configStatusMod.isSupabaseConfigured(PLACEHOLDER_URL, CONFIGURED_ANON_KEY),
      false,
    );
  });

  await test('config-status: the app.json placeholder anon key is rejected', async () => {
    assert.equal(
      configStatusMod.isSupabaseConfigured(CONFIGURED_URL, PLACEHOLDER_ANON_KEY),
      false,
    );
  });

  await test('config-status: the defensive placeholder marker is rejected', async () => {
    // The marker list also guards `'placeholder'` (e.g. the fallback client
    // domain `https://placeholder.supabase.co` and `placeholder-anon-key`).
    assert.equal(
      configStatusMod.isSupabaseConfigured('https://placeholder.supabase.co', CONFIGURED_ANON_KEY),
      false,
    );
    assert.equal(
      configStatusMod.isSupabaseConfigured(CONFIGURED_URL, 'placeholder-anon-key'),
      false,
    );
  });

  await test('config-status: real URL + anon key derive configured', async () => {
    assert.equal(
      configStatusMod.isSupabaseConfigured(CONFIGURED_URL, CONFIGURED_ANON_KEY),
      true,
    );
  });

  console.log('\n[tests] purchase write boundary\n');

  await test('saveReceipt persists purchase + items (real mode)', async () => {
    resetAll();
    // No matching store row yet → the save creates the store as the user's
    // own row; categories arm the slug→id map; purchases insert returns the
    // new id via `.select('id').single()`.
    stubMod.__setTableRead('stores', { rows: [] });
    stubMod.__setTableRead('categories', {
      rows: [
        { id: 'cat-lacteos', slug: 'lacteos' },
        { id: 'cat-snacks', slug: 'snacks' },
      ],
    });
    const result = await ticketsMod.saveReceipt('u1', {
      ...DRAFT,
      items: [
        {
          temp_id: 't1',
          name: 'Leche',
          quantity: 1,
          unit_price: 3.5,
          total_price: 3.5,
          category_id: 'lacteos',
          is_impulse: false,
          ai_suggested_category_id: null,
        },
        {
          temp_id: 't2',
          name: 'Papas fritas',
          quantity: 2,
          unit_price: 2,
          total_price: 4,
          category_id: null,
          is_impulse: true,
          ai_suggested_category_id: 'snacks',
        },
      ],
    });
    assert.ok(
      result && typeof result.id === 'string' && result.id.length > 0,
      'returns the new purchase id',
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      log.some((e) => e.kind === 'from' && e.table === 'stores'),
      'resolves/creates the store',
    );
    assert.ok(
      log.some((e) => e.kind === 'from' && e.table === 'purchases'),
      'writes the purchase row',
    );
    assert.ok(
      log.some((e) => e.kind === 'from' && e.table === 'purchase_items'),
      'writes the line items',
    );
    assert.ok(log.some((e) => e.kind === 'insert'), 'inserted rows');
    assert.ok(
      !log.some((e) => e.kind === 'delete'),
      'no rollback on success',
    );
    // Payload seam: assert the exact writes the review said were unasserted —
    // slug→id category resolution, parent linkage, user scoping, impulse
    // flag and sort order.
    const insertedStores = stubMod.__getInserted('stores');
    assert.equal(insertedStores.length, 1, 'store created as the user own row');
    assert.equal(insertedStores[0].user_id, 'u1');
    assert.equal(insertedStores[0].name, 'Whole Foods Market');
    const storeId = insertedStores[0].id;
    const [insertedPurchase] = stubMod.__getInserted('purchases');
    assert.equal(insertedPurchase.user_id, 'u1');
    assert.equal(insertedPurchase.store_id, storeId, 'purchase links to the created store');
    assert.equal(insertedPurchase.purchase_date, '2026-08-02');
    assert.equal(insertedPurchase.total, 42.18);
    assert.equal(insertedPurchase.payment_method, 'card');
    assert.equal(insertedPurchase.image_url, 'https://picsum.photos/seed/ticketify-test/800/1200');
    assert.equal(insertedPurchase.status, 'confirmed');
    const itemPayloads = stubMod.__getInserted('purchase_items').map((item) => {
      const { id, ...payload } = item; // synthetic stub id, not app data
      void id;
      return payload;
    });
    assert.deepEqual(itemPayloads, [
      {
        purchase_id: insertedPurchase.id,
        name: 'Leche',
        quantity: 1,
        unit_price: 3.5,
        total_price: 3.5,
        category_id: 'cat-lacteos',
        is_impulse: false,
        sort_order: 0,
      },
      {
        purchase_id: insertedPurchase.id,
        name: 'Papas fritas',
        quantity: 2,
        unit_price: 2,
        total_price: 4,
        category_id: 'cat-snacks',
        is_impulse: true,
        sort_order: 1,
      },
    ]);
  });

  await test('saveReceipt falls back to the otros category when user pick AND AI suggestion are both absent', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [] });
    // The stub map carries the seeded 'otros' row (0001_initial_schema.sql
    // L226 seeds slug 'otros', kind 'need') — without it, the
    // `?? categoryIds['otros'] ?? null` fallback is never exercised. The
    // row shape matches the app's `select('id, slug')`, exactly like the
    // other stub categories.
    stubMod.__setTableRead('categories', {
      rows: [
        { id: 'cat-lacteos', slug: 'lacteos' },
        { id: 'cat-snacks', slug: 'snacks' },
        { id: 'cat-otros', slug: 'otros' },
      ],
    });
    const result = await ticketsMod.saveReceipt('u1', {
      ...DRAFT,
      items: [
        {
          temp_id: 't1',
          name: 'Leche',
          quantity: 1,
          unit_price: 3.5,
          total_price: 3.5,
          category_id: 'lacteos',
          is_impulse: false,
          ai_suggested_category_id: null,
        },
        {
          temp_id: 't2',
          name: 'Chicle',
          quantity: 1,
          unit_price: 1,
          total_price: 1,
          // The regression seam: NO user pick AND NO AI suggestion — the
          // slug-resolution chain ends at `categoryIds['otros'] ?? null`.
          category_id: null,
          is_impulse: false,
          ai_suggested_category_id: null,
        },
      ],
    });
    assert.ok(result.id.length > 0, 'save succeeded');
    const itemPayloads = stubMod.__getInserted('purchase_items').map((item) => {
      const { id, ...payload } = item; // synthetic stub id, not app data
      void id;
      return payload;
    });
    assert.equal(itemPayloads[0].category_id, 'cat-lacteos');
    assert.equal(
      itemPayloads[1].category_id,
      'cat-otros',
      'an unresolved slug (no user pick, no AI suggestion) persists the otros id — never NULL',
    );
    // Deterministic category map (review fix): the fetch is ordered by slug,
    // so the 200-row cap truncates by a stable key and cannot exclude
    // 'otros' through arbitrary physical row order.
    assert.deepEqual(stubMod.__getQueryCalls('categories'), [
      { op: 'order', column: 'slug', opts: undefined },
      { op: 'limit', count: 200 },
    ]);
  });

  await test('saveReceipt invalidates monthly totals by user prefix: every month variant, own user only', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    // Seed the shared monthlyTotals cache on the REAL TanStack client the
    // compiled api uses: the current UTC month (what the old pinned-UTC
    // invalidation hit) plus a DIFFERENT month (the local-month variant the
    // budget spent / analytics readers hold at the UTC/local boundary), and
    // another user's entry to prove the prefix stays user-scoped. A
    // pinned-month invalidation can only ever hit one of the two u1 keys;
    // the user-prefix invalidation must hit both and leave u2 alone.
    const qc = queryClientMod.queryClient;
    qc.getQueryCache().clear();
    const utcNow = new Date();
    const prevMonth = new Date(
      Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth() - 1, 1),
    );
    const currentYm = keysMod.utcYearMonth(utcNow);
    const otherYm = keysMod.utcYearMonth(prevMonth);
    assert.notEqual(currentYm, otherYm, 'the two seeded months must differ');
    const keyCurrent = keysMod.queryKeys.monthlyTotals('u1', currentYm);
    const keyOther = keysMod.queryKeys.monthlyTotals('u1', otherYm);
    const keyOtherUser = keysMod.queryKeys.monthlyTotals('u2', currentYm);
    qc.setQueryData(keyCurrent, [{ category_id: '1', total: 10 }]);
    qc.setQueryData(keyOther, [{ category_id: '1', total: 20 }]);
    qc.setQueryData(keyOtherUser, [{ category_id: '1', total: 30 }]);

    const result = await ticketsMod.saveReceipt('u1', DRAFT);
    assert.ok(result.id.length > 0, 'save succeeded');

    const find = (key) => qc.getQueryCache().find({ queryKey: key });
    assert.equal(
      find(keyCurrent).state.isInvalidated,
      true,
      'current-month variant invalidated',
    );
    assert.equal(
      find(keyOther).state.isInvalidated,
      true,
      'different-month (local boundary) variant invalidated',
    );
    assert.equal(
      find(keyOtherUser).state.isInvalidated,
      false,
      'another user untouched — the prefix keeps the userId',
    );
  });

  await test('saveReceipt reuses an existing store by name', async () => {
    resetAll();
    stubMod.__setTableRead('stores', {
      rows: [{ id: 'store-global-1' }],
    });
    stubMod.__setTableRead('categories', { rows: [] });
    const result = await ticketsMod.saveReceipt('u1', DRAFT);
    assert.ok(result.id.length > 0);
    const log = stubMod.__getCallLog();
    const storeInserts = log.filter(
      (e) => e.kind === 'insert' && e.table === 'stores',
    );
    assert.equal(storeInserts.length, 0, 'store already exists — no insert');
  });

  await test('saveReceipt rejects an empty store name with the user-safe message, no writes', async () => {
    resetAll();
    await assert.rejects(
      () => ticketsMod.saveReceipt('u1', { ...DRAFT, store_name: '   ' }),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    assert.equal(
      stubMod.__getCallLog().length,
      0,
      'no backend interaction for an empty store name',
    );
  });

  await test('saveReceipt store insert failure surfaces the user-safe message, no purchase', async () => {
    resetAll();
    // No matching store row and the create fails: resolveStoreId yields null
    // and the save must stop before touching purchases.
    stubMod.__setTableRead('stores', { rows: [] });
    stubMod.__failNextInsert('stores');
    await assert.rejects(
      () => ticketsMod.saveReceipt('u1', DRAFT),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'from' && e.table === 'purchases'),
      'purchase never written',
    );
  });

  await test('saveReceipt purchase insert failure: user-safe message, no item writes', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__failNextInsert('purchases');
    await assert.rejects(
      () => ticketsMod.saveReceipt('u1', DRAFT),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'from' && e.table === 'purchase_items'),
      'no item writes attempted',
    );
    assert.ok(!log.some((e) => e.kind === 'delete'), 'no rollback needed — the purchase never persisted');
    assert.equal(stubMod.__getInserted('purchase_items'), null, 'items never inserted');
  });

  await test('saveReceipt item write failure rolls back the purchase and surfaces the user-safe message', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', {
      rows: [{ id: 'cat-lacteos', slug: 'lacteos' }],
    });
    stubMod.__failNextInsert('purchase_items');
    const draft = {
      ...DRAFT,
      items: [
        {
          temp_id: 't1',
          name: 'Leche',
          quantity: 1,
          unit_price: 3.5,
          total_price: 3.5,
          category_id: 'lacteos',
          is_impulse: false,
          ai_suggested_category_id: null,
        },
      ],
    };
    await assert.rejects(
      () => ticketsMod.saveReceipt('u1', draft),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    const rollbackDeletes = log.filter(
      (e) => e.kind === 'delete' && e.table === 'purchases',
    );
    assert.equal(
      rollbackDeletes.length,
      1,
      'compensating delete fired on purchases',
    );
    // The contract is `delete().eq('id', purchaseId)` (see tickets/api.ts):
    // a bare delete would remove every purchase of the user, and the call
    // log above cannot tell them apart — only the chain ops can. The
    // delete chain is the most recent `purchases` chain, so the query-call
    // seam returns exactly its filters.
    const purchaseId = stubMod.__getInserted('purchases')[0].id;
    const deleteOps = stubMod.__getQueryCalls('purchases');
    assert.ok(
      deleteOps.some(
        (o) => o.op === 'eq' && o.column === 'id' && o.value === purchaseId,
      ),
      'compensating delete targets the persisted purchase id (eq filter, not a bare table delete)',
    );
    assert.equal(stubMod.__getInserted('purchase_items'), null, 'items never persisted');
    assert.ok(
      stubMod.__getInserted('purchases'),
      'the purchase row existed before the rollback (that is what the delete compensates)',
    );
  });

  await test('saveReceipt cleans up the uploaded photo object when a later write fails', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [{ id: 'cat-a', slug: 'a' }] });
    expoFsMod.__setFileSource('file:///scan.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    stubMod.__failNextInsert('purchase_items', { message: 'items boom' });
    const draft = { ...DRAFT, image_url: 'file:///scan.jpg' };
    await assert.rejects(() => ticketsMod.saveReceipt('u1', draft), 'error');
    const log = stubMod.__getCallLog();
    const uploadCall = log.find((e) => e.kind === 'storage-upload');
    assert.ok(uploadCall, 'photo was uploaded before the failing write');
    const removeCall = log.find((e) => e.kind === 'storage-remove');
    assert.ok(removeCall, 'cleanup attempted after the failed write');
    assert.equal(removeCall.bucket, 'receipts');
    assert.deepEqual(
      removeCall.paths,
      [uploadCall.path],
      'cleanup targets exactly the object uploaded by this save',
    );
  });

  await test('saveReceipt cleans up the uploaded photo when the purchase insert itself fails', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [{ id: 'cat-a', slug: 'a' }] });
    expoFsMod.__setFileSource('file:///scan.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    stubMod.__failNextInsert('purchases', { message: 'purchase boom' });
    const draft = { ...DRAFT, image_url: 'file:///scan.jpg' };
    await assert.rejects(() => ticketsMod.saveReceipt('u1', draft), 'error');
    const log = stubMod.__getCallLog();
    const uploadCall = log.find((e) => e.kind === 'storage-upload');
    assert.ok(uploadCall, 'photo was uploaded before the failing purchase insert');
    const removeCall = log.find((e) => e.kind === 'storage-remove');
    assert.ok(removeCall, 'cleanup attempted after the purchase insert failure');
    assert.deepEqual(
      removeCall.paths,
      [uploadCall.path],
      'cleanup targets exactly the uploaded object',
    );
    assert.equal(
      stubMod.__getInserted('purchase_items'),
      null,
      'no item writes when the purchase never persisted',
    );
  });

  await test('saveReceipt still surfaces the user-safe error when cleanup fails', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [{ id: 'cat-a', slug: 'a' }] });
    expoFsMod.__setFileSource('file:///scan.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    stubMod.__failNextInsert('purchase_items', { message: 'items boom' });
    stubMod.__setStorageBehavior('receipts', {
      removeError: { message: 'cleanup denied', code: '403' },
    });
    const draft = { ...DRAFT, image_url: 'file:///scan.jpg' };
    await assert.rejects(
      () => ticketsMod.saveReceipt('u1', draft),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
          'cleanup failure must not mask the original save error',
        );
        return true;
      },
    );
  });

  console.log('\n[tests] edit/delete receipt flow\n');

  // Real user ids are uuids (auth.users.id): the storage photo ownership
  // guard (`isOwnedReceiptPath`) only passes uuid-shaped `userId/<object>`
  // paths, so the fixtures below use a uuid-shaped id, NOT the 'u1' shorthands
  // the rest of the harness uses for query-key/user-scope assertions.
  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

  // Pre-edit state armed for every updateReceipt test: updateReceipt now
  // captures the row + items via fetchPurchaseDetail BEFORE any write, so a
  // failed write can restore them (it never deletes the pre-existing receipt).
  const PRE_EDIT_PURCHASE = {
    id: 'p-1',
    store_id: 'store-1',
    total: 42.18,
    purchase_date: '2026-08-02',
    payment_method: 'card',
    image_url: `${USER_ID}/p-1.jpg`,
    status: 'confirmed',
    stores: { name: 'Whole Foods Market' },
    purchase_items: [
      {
        id: 'item-old-1',
        name: 'Pan',
        quantity: 1,
        unit_price: 2.5,
        total_price: 2.5,
        category_id: 'cat-pan',
        is_impulse: false,
        sort_order: 0,
        categories: {
          id: 'cat-pan',
          slug: 'panaderia',
          name: 'Panadería',
          kind: 'grocery',
          icon: 'cart',
          color: '#ffffff',
          sort_order: 2,
        },
      },
    ],
  };

  await test('fetchPurchaseDetail loads the full row: store name + item categories', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', {
      rows: [
        {
          id: 'p-1',
          store_id: 'store-1',
          total: 42.18,
          purchase_date: '2026-08-02',
          payment_method: 'card',
          image_url: 'u1/p-1.jpg',
          status: 'confirmed',
          // PostgREST returns to-one embeds (single FK: purchases.store_id,
          // purchase_items.category_id) as JSON OBJECTS — not arrays.
          stores: { name: 'Whole Foods Market' },
          purchase_items: [
            {
              id: 'item-1',
              name: 'Leche',
              quantity: 1,
              unit_price: 3.5,
              total_price: 3.5,
              category_id: 'cat-lacteos',
              is_impulse: false,
              sort_order: 0,
              categories: {
                id: 'cat-lacteos',
                slug: 'lacteos',
                name: 'Lácteos',
                kind: 'grocery',
                icon: 'cart',
                color: '#ffffff',
                sort_order: 1,
              },
            },
            {
              id: 'item-2',
              name: 'Galletas',
              quantity: 2,
              unit_price: 1.25,
              total_price: 2.5,
              category_id: null,
              is_impulse: true,
              sort_order: 1,
              categories: null,
            },
          ],
        },
      ],
    });
    const purchase = await ticketsMod.fetchPurchaseDetail('u1', 'p-1');
    assert.equal(purchase.id, 'p-1');
    assert.equal(purchase.store_name, 'Whole Foods Market');
    assert.equal(purchase.items.length, 2);
    assert.equal(purchase.items[0].category?.slug, 'lacteos');
    assert.equal(purchase.items[1].category, null);
    assert.equal(purchase.status, 'confirmed');
    assert.equal(purchase.image_url, 'u1/p-1.jpg');
    assert.equal(purchase.items[0].sort_order, 0);
    assert.equal(purchase.items[1].sort_order, 1);
    // The detail read is scoped to the edited purchase AND the session user
    // (defense in depth — RLS already scopes) and ordered by sort_order.
    const ops = stubMod.__getQueryCalls('purchases');
    assert.ok(
      ops.some((o) => o.op === 'eq' && o.column === 'id' && o.value === 'p-1'),
      'fetch is scoped with eq(id)',
    );
    assert.ok(
      ops.some((o) => o.op === 'eq' && o.column === 'user_id' && o.value === 'u1'),
      'fetch is scoped to the session user',
    );
    const orderOp = ops.find((o) => o.op === 'order');
    assert.ok(
      orderOp && orderOp.column === 'sort_order',
      'items are fetched in sort_order (edit round trips keep line order)',
    );
  });

  await test('fetchPurchaseDetail also handles array-shaped to-one embeds', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', {
      rows: [
        {
          id: 'p-2',
          store_id: 'store-2',
          total: 7,
          purchase_date: '2026-08-04',
          payment_method: 'cash',
          image_url: null,
          status: 'confirmed',
          // Some selects deliver the to-one embed as a ONE-ELEMENT ARRAY —
          // both shapes must map to the same object (firstOrSelf).
          stores: [{ name: 'Feria Vecinal' }],
          purchase_items: [
            {
              id: 'item-3',
              name: 'Tomates',
              quantity: 1,
              unit_price: 7,
              total_price: 7,
              category_id: 'cat-verduras',
              is_impulse: false,
              sort_order: 0,
              categories: [
                {
                  id: 'cat-verduras',
                  slug: 'verduras',
                  name: 'Verduras',
                  kind: 'grocery',
                  icon: 'cart',
                  color: '#ffffff',
                  sort_order: 3,
                },
              ],
            },
          ],
        },
      ],
    });
    const purchase = await ticketsMod.fetchPurchaseDetail('u1', 'p-2');
    assert.equal(purchase.store_name, 'Feria Vecinal');
    assert.equal(purchase.items[0].category?.slug, 'verduras');
  });

  await test('purchaseToDraft preserves the purchase fields and maps category uuids to slugs', async () => {
    resetAll();
    const purchase = {
      id: 'p-1',
      store_id: 'store-1',
      store_name: 'Whole Foods Market',
      purchase_date: '2026-08-02',
      total: 42.18,
      payment_method: 'card',
      image_url: 'u1/p-1.jpg',
      status: 'confirmed',
      items: [
        {
          id: 'item-1',
          name: 'Leche',
          quantity: 1,
          unit_price: 3.5,
          total_price: 3.5,
          category_id: 'cat-lacteos',
          category: {
            id: 'cat-lacteos',
            slug: 'lacteos',
            name: 'Lácteos',
            kind: 'grocery',
            icon: 'cart',
            color: '#ffffff',
            sort_order: 1,
          },
          is_impulse: false,
          sort_order: 0,
        },
        {
          id: 'item-2',
          name: 'Galletas',
          quantity: 2,
          unit_price: 1.25,
          total_price: 2.5,
          category_id: null,
          category: null,
          is_impulse: true,
          sort_order: 1,
        },
      ],
    };
    const draft = ticketsMod.purchaseToDraft(purchase);
    assert.equal(draft.store_name, 'Whole Foods Market');
    assert.equal(draft.purchase_date, '2026-08-02');
    assert.equal(draft.total, 42.18);
    assert.equal(draft.payment_method, 'card');
    assert.equal(draft.image_url, 'u1/p-1.jpg');
    assert.equal(draft.items.length, 2);
    assert.equal(draft.items[0].category_id, 'lacteos', 'category uuid maps to its slug');
    assert.equal(draft.items[0].ai_suggested_category_id, null);
    assert.equal(draft.items[0].is_impulse, false);
    assert.equal(draft.items[1].category_id, null);
    assert.equal(draft.items[1].is_impulse, true);
    assert.equal(draft.items[0].name, 'Leche', 'line order is preserved');
    assert.equal(draft.items[1].name, 'Galletas', 'line order is preserved');
    assert.ok(draft.items[0].temp_id && draft.items[1].temp_id, 'fresh temp ids for the review list keys');
  });

  await test('fetchPurchaseDetail surfaces the user-safe load message when the row is missing', async () => {
    resetAll();
    await assert.rejects(
      () => ticketsMod.fetchPurchaseDetail('u1', 'missing'),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo cargar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
  });

  await test('updateReceipt updates the purchase in place and replaces its items', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1' }]);
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] });
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', {
      rows: [{ id: 'cat-lacteos', slug: 'lacteos' }],
    });
    const draft = {
      store_name: 'Whole Foods Market',
      purchase_date: '2026-08-03',
      total: 9.5,
      payment_method: 'cash',
      image_url: `${USER_ID}/p-1.jpg`,
      items: [
        {
          temp_id: 't1',
          name: 'Leche',
          quantity: 1,
          unit_price: 3.5,
          total_price: 3.5,
          category_id: 'lacteos',
          is_impulse: false,
          ai_suggested_category_id: null,
        },
        {
          temp_id: 't2',
          name: 'Galletas',
          quantity: 2,
          unit_price: 3,
          total_price: 6,
          category_id: null,
          is_impulse: true,
          ai_suggested_category_id: null,
        },
      ],
    };
    const result = await ticketsMod.updateReceipt(USER_ID, 'p-1', draft);
    assert.equal(result.id, 'p-1');

    const updated = stubMod.__getUpdated('purchases');
    assert.equal(updated.store_id, 'store-global-1');
    assert.equal(updated.purchase_date, '2026-08-03');
    assert.equal(updated.total, 9.5);
    assert.equal(updated.payment_method, 'cash');
    assert.equal(updated.status, 'confirmed');
    assert.equal(
      updated.image_url,
      `${USER_ID}/p-1.jpg`,
      'an already-persisted storage path passes through — no re-upload',
    );

    const log = stubMod.__getCallLog();
    const itemDeletes = log.filter(
      (e) => e.kind === 'delete' && e.table === 'purchase_items',
    );
    assert.equal(
      itemDeletes.length,
      1,
      'items are replaced wholesale: delete first, then re-insert',
    );
    assert.ok(
      !log.some((e) => e.kind === 'storage-upload'),
      'storage paths are never re-uploaded',
    );

    const itemPayloads = stubMod.__getInserted('purchase_items');
    assert.equal(itemPayloads.length, 2);
    assert.equal(itemPayloads[0].category_id, 'cat-lacteos');
    assert.equal(itemPayloads[1].category_id, null);
    assert.equal(itemPayloads[0].sort_order, 0);
    assert.equal(itemPayloads[1].sort_order, 1);
    assert.equal(itemPayloads[1].is_impulse, true);
    assert.ok(
      itemPayloads.every((i) => i.purchase_id === 'p-1'),
      'item rows link back to the edited purchase',
    );
    const updateOps = stubMod.__getQueryCalls('purchases');
    assert.ok(
      updateOps.some(
        (o) => o.op === 'eq' && o.column === 'user_id' && o.value === USER_ID,
      ),
      'the row update is scoped to the session user',
    );
  });

  await test('updateReceipt uploads a device-local photo and persists the storage path', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1' }]);
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] });
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    expoFsMod.__setFileSource('file:///edit.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    const draft = { ...DRAFT, image_url: 'file:///edit.jpg' };
    const result = await ticketsMod.updateReceipt(USER_ID, 'p-1', draft);
    assert.equal(result.id, 'p-1');
    const log = stubMod.__getCallLog();
    assert.ok(
      log.some((e) => e.kind === 'storage-upload'),
      'device-local photo is uploaded before the update',
    );
    const updated = stubMod.__getUpdated('purchases');
    assert.match(
      updated.image_url,
      new RegExp(`^${USER_ID}/.+\\.jpg$`),
      'persists the storage path under the user folder',
    );
  });

  await test('updateReceipt best-effort removes the previous photo when image_url changed', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1' }]);
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] }); // image_url `${USER_ID}/p-1.jpg`
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    expoFsMod.__setFileSource('file:///new-photo.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    const draft = { ...DRAFT, image_url: 'file:///new-photo.jpg' };
    await ticketsMod.updateReceipt(USER_ID, 'p-1', draft);
    const log = stubMod.__getCallLog();
    const removeCall = log.find((e) => e.kind === 'storage-remove');
    assert.ok(removeCall, 'previous photo object is removed after the edit succeeds');
    assert.deepEqual(removeCall.paths, [`${USER_ID}/p-1.jpg`]);
    // The cleanup runs only AFTER the item write succeeded — a failed edit
    // restores the old photo reference instead.
    const insertIndex = log.findIndex(
      (e) => e.kind === 'insert' && e.table === 'purchase_items',
    );
    const removeIndex = log.findIndex((e) => e.kind === 'storage-remove');
    assert.ok(insertIndex < removeIndex, 'photo cleanup runs only after a successful update');
  });

  await test('updateReceipt item write failure RESTORES the original row + items (never deletes the receipt)', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1' }]);
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] });
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    stubMod.__failNextInsert('purchase_items');
    const draft = {
      ...DRAFT,
      items: [
        {
          temp_id: 't1',
          name: 'Leche',
          quantity: 1,
          unit_price: 3.5,
          total_price: 3.5,
          category_id: 'lacteos',
          is_impulse: false,
          ai_suggested_category_id: null,
        },
      ],
    };
    await assert.rejects(
      () => ticketsMod.updateReceipt(USER_ID, 'p-1', draft),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'delete' && e.table === 'purchases'),
      'the pre-existing purchase is NEVER deleted on an edit failure',
    );
    // The restore update re-applies the ORIGINAL row fields (the draft
    // update had already applied before the item insert failed).
    const restored = stubMod.__getUpdated('purchases');
    assert.equal(restored.store_id, 'store-1');
    assert.equal(restored.purchase_date, '2026-08-02');
    assert.equal(restored.total, 42.18);
    assert.equal(restored.payment_method, 'card');
    assert.equal(restored.image_url, `${USER_ID}/p-1.jpg`);
    assert.equal(restored.status, 'confirmed');
    // The original items are re-inserted with their ORIGINAL values (the
    // wholesale delete had already removed them).
    const restoredItems = stubMod.__getInserted('purchase_items');
    assert.equal(restoredItems.length, 1);
    assert.equal(restoredItems[0].name, 'Pan');
    assert.equal(restoredItems[0].category_id, 'cat-pan');
    assert.equal(restoredItems[0].sort_order, 0);
    assert.equal(restoredItems[0].is_impulse, false);
    assert.equal(restoredItems[0].purchase_id, 'p-1');
  });

  await test('updateReceipt surfaces the user-safe message when the purchase update fails', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] });
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    stubMod.__failNextUpdate('purchases');
    await assert.rejects(
      () => ticketsMod.updateReceipt(USER_ID, 'p-1', DRAFT),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    assert.equal(
      stubMod.__getInserted('purchase_items'),
      null,
      'no item writes when the update never persisted',
    );
  });

  await test('updateReceipt fails with the save message when the update matches no rows', async () => {
    resetAll();
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] });
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    // No delete-read armed: `update().select('id')` resolves a 0-row result
    // (an RLS miss or a row deleted mid-edit) — the edit must fail closed
    // like deleteReceipt does, and the pre-edit items must stay untouched.
    await assert.rejects(
      () => ticketsMod.updateReceipt(USER_ID, 'p-1', DRAFT),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'delete' && e.table === 'purchase_items'),
      'item rows are untouched when the update matches no rows',
    );
    assert.equal(
      stubMod.__getInserted('purchase_items'),
      null,
      'no item writes on a 0-row update',
    );
  });

  await test('updateReceipt fails with the load message when the purchase is missing', async () => {
    resetAll();
    // No purchases read armed: the pre-edit fetch resolves null (a miss) —
    // the edit must not proceed (and must not write anything).
    await assert.rejects(
      () => ticketsMod.updateReceipt(USER_ID, 'missing', DRAFT),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo cargar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(!log.some((e) => e.kind === 'update'), 'no row update when the purchase does not exist');
    assert.ok(!log.some((e) => e.kind === 'insert'), 'no item writes when the purchase does not exist');
  });

  await test('updateReceipt invalidates the cached receipt feeds (monthly totals prefix, own user only)', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1' }]);
    stubMod.__setTableRead('purchases', { rows: [PRE_EDIT_PURCHASE] });
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [] });
    // Same shared-cache probe saveReceipt uses: BOTH month variants of the
    // monthlyTotals key must turn invalidated, another user's untouched.
    const qc = queryClientMod.queryClient;
    qc.getQueryCache().clear();
    const utcNow = new Date();
    const prevMonth = new Date(
      Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth() - 1, 1),
    );
    const currentYm = keysMod.utcYearMonth(utcNow);
    const otherYm = keysMod.utcYearMonth(prevMonth);
    const keyCurrent = keysMod.queryKeys.monthlyTotals(USER_ID, currentYm);
    const keyOther = keysMod.queryKeys.monthlyTotals(USER_ID, otherYm);
    const keyOtherUser = keysMod.queryKeys.monthlyTotals('u2', currentYm);
    qc.setQueryData(keyCurrent, [{ category_id: '1', total: 10 }]);
    qc.setQueryData(keyOther, [{ category_id: '1', total: 20 }]);
    qc.setQueryData(keyOtherUser, [{ category_id: '1', total: 30 }]);
    // The home feed + budget spent keys must be invalidated too, and scan
    // usage must NOT (only a SAVE consumes a scan).
    const keyFeed = keysMod.queryKeys.homeFeed(USER_ID);
    const keyBudget = keysMod.queryKeys.budget(USER_ID);
    const keyScan = keysMod.queryKeys.scanUsage(USER_ID, currentYm);
    qc.setQueryData(keyFeed, []);
    qc.setQueryData(keyBudget, { budget: 100 });
    qc.setQueryData(keyScan, { scans_used: 1, scans_limit: 10 });
    // Item search reads the same rows: EVERY month/query variant must
    // refetch (an edit can rename or remove items).
    const keySearch = keysMod.queryKeys.itemSearch(USER_ID, currentYm, 'leche');
    const keySearchOtherMonth = keysMod.queryKeys.itemSearch(USER_ID, otherYm, 'pan');
    qc.setQueryData(keySearch, []);
    qc.setQueryData(keySearchOtherMonth, []);

    await ticketsMod.updateReceipt(USER_ID, 'p-1', DRAFT);

    const find = (key) => qc.getQueryCache().find({ queryKey: key });
    assert.equal(find(keyCurrent).state.isInvalidated, true);
    assert.equal(find(keyOther).state.isInvalidated, true);
    assert.equal(find(keyOtherUser).state.isInvalidated, false);
    assert.equal(find(keyFeed).state.isInvalidated, true, 'home feed refetches');
    assert.equal(find(keyBudget).state.isInvalidated, true, 'budget spent refetches');
    assert.equal(find(keySearch).state.isInvalidated, true, 'item search refetches (any query)');
    assert.equal(
      find(keySearchOtherMonth).state.isInvalidated,
      true,
      'item search refetches for every month variant',
    );
    assert.equal(
      find(keyScan).state.isInvalidated,
      false,
      'scan usage untouched — an edit consumes no scan',
    );
  });

  await test('deleteReceipt removes the row first (fail-closed), then the storage photo', async () => {
    resetAll();
    // `delete().select('id, image_url')` returns the DELETED rows — the
    // stub mirrors that via the delete-read seam (unarmed = 0 rows).
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1', image_url: `${USER_ID}/p-1.jpg` }]);
    await ticketsMod.deleteReceipt(USER_ID, 'p-1');
    const log = stubMod.__getCallLog();
    const deleteIndex = log.findIndex(
      (e) => e.kind === 'delete' && e.table === 'purchases',
    );
    const removeCall = log.find((e) => e.kind === 'storage-remove');
    assert.ok(removeCall, 'storage photo removal attempted');
    assert.equal(removeCall.bucket, 'receipts');
    assert.deepEqual(removeCall.paths, [`${USER_ID}/p-1.jpg`]);
    const removeIndex = log.findIndex((e) => e.kind === 'storage-remove');
    assert.ok(
      deleteIndex < removeIndex,
      'the ROW is deleted before the photo is removed',
    );
    const deleteOps = stubMod.__getQueryCalls('purchases');
    assert.ok(
      deleteOps.some(
        (o) => o.op === 'eq' && o.column === 'id' && o.value === 'p-1',
      ),
      'row delete is scoped to the purchase id (eq filter)',
    );
    assert.ok(
      deleteOps.some(
        (o) => o.op === 'eq' && o.column === 'user_id' && o.value === USER_ID,
      ),
      'row delete is scoped to the session user',
    );
  });

  await test('deleteReceipt still deletes when the storage remove THROWS (rejected promise)', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1', image_url: `${USER_ID}/p-1.jpg` }]);
    // storage-js re-throws non-StorageError exceptions from handleOperation:
    // a network failure REJECTS the remove instead of returning {error}. The
    // delete must survive — the row is already gone, a retry would hit the
    // fail-closed 0-row check, and a skipped invalidation would leave a
    // ghost receipt in the store + feed caches.
    stubMod.__setStorageBehavior('receipts', { removeThrows: true });
    const qc = queryClientMod.queryClient;
    qc.getQueryCache().clear();
    const keyFeed = keysMod.queryKeys.homeFeed(USER_ID);
    qc.setQueryData(keyFeed, []);
    await ticketsMod.deleteReceipt(USER_ID, 'p-1');
    const log = stubMod.__getCallLog();
    assert.ok(log.some((e) => e.kind === 'storage-remove'), 'photo remove attempted');
    assert.ok(
      qc.getQueryCache().find({ queryKey: keyFeed }).state.isInvalidated,
      'feed still invalidated after a rejected remove',
    );
  });

  await test('deleteReceipt skips the storage remove for a remote photo', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [
      {
        id: 'p-1',
        image_url: 'https://picsum.photos/seed/ticketify-test/800/1200',
      },
    ]);
    await ticketsMod.deleteReceipt(USER_ID, 'p-1');
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'storage-remove'),
      'remote urls are not storage objects — no remove',
    );
    assert.ok(
      log.some((e) => e.kind === 'delete' && e.table === 'purchases'),
      'row is still deleted',
    );
  });

  await test('deleteReceipt never removes a storage object owned by another user', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [
      { id: 'p-1', image_url: `${OTHER_USER_ID}/p-1.jpg` },
    ]);
    await ticketsMod.deleteReceipt(USER_ID, 'p-1');
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'storage-remove'),
      'foreign object paths are never passed to storage.remove',
    );
    assert.ok(
      log.some((e) => e.kind === 'delete' && e.table === 'purchases'),
      'row is still deleted',
    );
  });

  await test('deleteReceipt fails closed when the delete matches no rows', async () => {
    resetAll();
    // No delete-read armed: the delete resolves a 0-row result (RLS miss or
    // already gone) — that must NOT be treated as success.
    await assert.rejects(
      () => ticketsMod.deleteReceipt(USER_ID, 'missing'),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo eliminar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'storage-remove'),
      'no photo remove on a 0-row delete',
    );
  });

  await test('deleteReceipt surfaces the user-safe message when the row delete fails', async () => {
    resetAll();
    stubMod.__failNextDelete('purchases', { message: 'permission denied', code: '42501' });
    await assert.rejects(
      () => ticketsMod.deleteReceipt(USER_ID, 'p-1'),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo eliminar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    const log = stubMod.__getCallLog();
    assert.ok(
      !log.some((e) => e.kind === 'storage-remove'),
      'no photo remove when the row delete failed',
    );
  });

  await test('deleteReceipt invalidates the cached receipt feeds', async () => {
    resetAll();
    stubMod.__setDeleteRead('purchases', [{ id: 'p-1', image_url: null }]);
    const qc = queryClientMod.queryClient;
    qc.getQueryCache().clear();
    const keyFeed = keysMod.queryKeys.homeFeed(USER_ID);
    const keyBudget = keysMod.queryKeys.budget(USER_ID);
    const keySearch = keysMod.queryKeys.itemSearch(USER_ID, '2026-08', 'leche');
    qc.setQueryData(keyFeed, []);
    qc.setQueryData(keyBudget, { budget: 100 });
    qc.setQueryData(keySearch, []);
    await ticketsMod.deleteReceipt(USER_ID, 'p-1');
    const find = (key) => qc.getQueryCache().find({ queryKey: key });
    assert.equal(find(keyFeed).state.isInvalidated, true, 'home feed refetches');
    assert.equal(find(keyBudget).state.isInvalidated, true, 'budget spent refetches');
    assert.equal(
      find(keySearch).state.isInvalidated,
      true,
      'item search refetches — a delete removes items from results',
    );
  });

  console.log('\n[tests] receipt photo storage\n');

  await test('uploadToStorage uploads the local image and returns the object path', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///scan.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    const result = await ticketsMod.uploadToStorage('u1', 'file:///scan.jpg');
    assert.match(result.path, /^u1\/.+\.jpg$/, 'path is scoped under the user');
    const uploadCall = stubMod.__getCallLog().find(
      (e) => e.kind === 'storage-upload',
    );
    assert.ok(uploadCall, 'storage upload was attempted');
    assert.equal(uploadCall.bucket, 'receipts');
    assert.equal(uploadCall.path, result.path);
    assert.equal(uploadCall.contentType, 'image/jpeg');
  });

  await test('uploadToStorage failure surfaces the user-safe message, no partial path', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///scan.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    stubMod.__setStorageBehavior('receipts', {
      uploadError: { message: 'storage denied', code: '403' },
    });
    await assert.rejects(
      () => ticketsMod.uploadToStorage('u1', 'file:///scan.jpg'),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
  });

  await test('uploadToStorage is gated on configured supabase', async () => {
    resetAll();
    stubMod.__setSupabaseConfigInputs(PLACEHOLDER_URL, CONFIGURED_ANON_KEY);
    await assert.rejects(
      () => ticketsMod.uploadToStorage('u1', 'file:///scan.jpg'),
      (err) => {
        assert.equal(
          err.message,
          'No se pudo guardar el recibo. Inténtalo de nuevo.',
        );
        return true;
      },
    );
    assert.equal(
      stubMod.__getCallLog().filter((e) => e.kind === 'storage-upload').length,
      0,
      'no upload attempt when unconfigured',
    );
  });

  await test('saveReceipt uploads a local draft image and persists the storage path', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [{ id: 'cat-a', slug: 'a' }] });
    expoFsMod.__setFileSource('file:///scan.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    const draft = {
      ...DRAFT,
      image_url: 'file:///scan.jpg',
    };
    const saved = await ticketsMod.saveReceipt('u1', draft);
    assert.ok(saved && saved.id, 'purchase persisted');
    const insertedPurchase = stubMod.__getInserted('purchases')[0];
    assert.match(
      insertedPurchase.image_url,
      /^u1\/.+\.jpg$/,
      'image_url stores the storage object path, not the local uri',
    );
    assert.ok(
      stubMod.__getCallLog().some((e) => e.kind === 'storage-upload'),
      'upload fired during save',
    );
  });

  await test('saveReceipt keeps a remote image_url untouched (no upload)', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [{ id: 'cat-a', slug: 'a' }] });
    const saved = await ticketsMod.saveReceipt('u1', DRAFT);
    assert.ok(saved && saved.id, 'purchase persisted');
    const insertedPurchase = stubMod.__getInserted('purchases')[0];
    assert.equal(
      insertedPurchase.image_url,
      DRAFT.image_url,
      'remote urls pass through unchanged',
    );
    assert.equal(
      stubMod.__getCallLog().filter((e) => e.kind === 'storage-upload').length,
      0,
      'no upload for remote urls',
    );
  });

  await test('saveReceipt passes an already-persisted storage path through (no re-upload)', async () => {
    resetAll();
    stubMod.__setTableRead('stores', { rows: [{ id: 'store-global-1' }] });
    stubMod.__setTableRead('categories', { rows: [{ id: 'cat-a', slug: 'a' }] });
    const draft = {
      ...DRAFT,
      image_url: 'u1/abc.jpg',
    };
    const saved = await ticketsMod.saveReceipt('u1', draft);
    assert.ok(saved && saved.id, 'purchase persisted');
    const insertedPurchase = stubMod.__getInserted('purchases')[0];
    assert.equal(
      insertedPurchase.image_url,
      'u1/abc.jpg',
      'storage paths pass through unchanged',
    );
    assert.equal(
      stubMod.__getCallLog().filter((e) => e.kind === 'storage-upload').length,
      0,
      'no upload for already-persisted storage paths',
    );
  });

  await test('resolveReceiptPhotoPath classifies urls vs storage paths vs null', () => {
    assert.deepEqual(photoMod.resolveReceiptPhotoPath('https://picsum.photos/x'), {
      kind: 'url',
      value: 'https://picsum.photos/x',
    });
    assert.deepEqual(photoMod.resolveReceiptPhotoPath('http://example.com/x.jpg'), {
      kind: 'url',
      value: 'http://example.com/x.jpg',
    });
    assert.deepEqual(photoMod.resolveReceiptPhotoPath('u1/abc.jpg'), {
      kind: 'path',
      value: 'u1/abc.jpg',
    });
    assert.equal(photoMod.resolveReceiptPhotoPath(null), null);
    assert.equal(photoMod.resolveReceiptPhotoPath(''), null);
  });

  await test('getSignedReceiptPhotoUrl resolves a storage path to a signed url', async () => {
    resetAll();
    stubMod.__setStorageBehavior('receipts', {
      signedUrl: 'https://signed.example/u1/abc.jpg?token=xyz',
    });
    const url = await photoMod.getSignedReceiptPhotoUrl('u1/abc.jpg');
    assert.equal(url, 'https://signed.example/u1/abc.jpg?token=xyz');
    const signedCall = stubMod.__getCallLog().find(
      (e) => e.kind === 'storage-signed',
    );
    assert.ok(signedCall, 'signed-url request was made');
    assert.equal(signedCall.bucket, 'receipts');
    assert.equal(signedCall.path, 'u1/abc.jpg');
  });

  await test('getSignedReceiptPhotoUrl returns null on failure (never throws)', async () => {
    resetAll();
    stubMod.__setStorageBehavior('receipts', {
      signedUrlError: { message: 'forbidden', code: '403' },
    });
    const url = await photoMod.getSignedReceiptPhotoUrl('u1/abc.jpg');
    assert.equal(url, null);
  });

  console.log('\n[tests] parseTicket edge-function wiring\n');

  await test('parseTicket maps a valid edge payload including payment_method', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///receipt.jpg', {
      size: 2048,
      type: 'image/jpeg',
      base64: 'c2FtcGxl',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'Whole Foods Market',
        purchase_date: '2026-08-02',
        total: 42.18,
        payment_method: 'apple_pay',
        items: [
          { name: 'Leche', quantity: 1, unit_price: 3.5, total_price: 3.5, suggested_category_slug: 'lacteos' },
          { name: 'Snacks', quantity: 2, unit_price: 2.0, total_price: 4.0, suggested_category_slug: 'snacks' },
        ],
      },
    });
    const parsed = await ticketsMod.parseTicket('file:///receipt.jpg');
    assert.equal(parsed.store, 'Whole Foods Market');
    assert.equal(parsed.date, '2026-08-02');
    assert.equal(parsed.total, 42.18);
    assert.equal(parsed.payment_method, 'apple_pay');
    assert.equal(parsed.items.length, 2);
    assert.equal(parsed.items[0].ai_suggested_category_id, 'lacteos');
    assert.ok(parsed.items[0].temp_id && parsed.items[0].temp_id.length > 0);
  });

  await test('parseTicket maps card_brand and card_type from the edge payload', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///card.jpg', {
      size: 1024,
      type: 'image/jpeg',
      base64: 'aGk=',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 12.5,
        payment_method: 'card',
        card_brand: 'Visa',
        card_type: 'debit',
        items: [
          { name: 'A', quantity: 1, unit_price: 12.5, total_price: 12.5, suggested_category_slug: null },
        ],
      },
    });
    const parsed = await ticketsMod.parseTicket('file:///card.jpg');
    assert.equal(parsed.card_brand, 'Visa');
    assert.equal(parsed.card_type, 'debit');
    assert.equal(parsed.payment_method, 'card');
  });

  await test('parseTicket trims card fields and compares card_type case-insensitively', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///norm.jpg', {
      size: 1024,
      type: 'image/jpeg',
      base64: 'aGk=',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 8,
        payment_method: 'card',
        card_brand: '  oca  ',
        card_type: 'DEBIT',
        items: [
          { name: 'A', quantity: 1, unit_price: 8, total_price: 8, suggested_category_slug: null },
        ],
      },
    });
    const parsed = await ticketsMod.parseTicket('file:///norm.jpg');
    // Trimmed; brand casing preserved as detected.
    assert.equal(parsed.card_brand, 'oca');
    // Compared lowercase and normalized.
    assert.equal(parsed.card_type, 'debit');

    resetAll();
    expoFsMod.__setFileSource('file:///norm2.jpg', {
      size: 1024,
      type: 'image/jpeg',
      base64: 'aGk=',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 8,
        payment_method: 'card',
        card_brand: 'Mastercard',
        card_type: 'Credit',
        items: [
          { name: 'A', quantity: 1, unit_price: 8, total_price: 8, suggested_category_slug: null },
        ],
      },
    });
    const creditParsed = await ticketsMod.parseTicket('file:///norm2.jpg');
    assert.equal(creditParsed.card_brand, 'Mastercard');
    assert.equal(creditParsed.card_type, 'credit');
  });

  await test('parseTicket maps absent or unrecognized card fields to null', async () => {
    resetAll();
    // Cash receipt: no card fields on the wire at all (old payload shape).
    expoFsMod.__setFileSource('file:///cash.jpg', {
      size: 1024,
      type: 'image/jpeg',
      base64: 'aGk=',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 4,
        payment_method: 'cash',
        items: [
          { name: 'A', quantity: 1, unit_price: 4, total_price: 4, suggested_category_slug: null },
        ],
      },
    });
    const cashParsed = await ticketsMod.parseTicket('file:///cash.jpg');
    assert.equal(cashParsed.card_brand, null);
    assert.equal(cashParsed.card_type, null);

    // Junk values degrade to null, never to a wrong brand/type.
    expoFsMod.__setFileSource('file:///junk.jpg', {
      size: 1024,
      type: 'image/jpeg',
      base64: 'aGk=',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 4,
        payment_method: 'card',
        card_brand: 42,
        card_type: 'prepaid',
        items: [
          { name: 'A', quantity: 1, unit_price: 4, total_price: 4, suggested_category_slug: null },
        ],
      },
    });
    const junkParsed = await ticketsMod.parseTicket('file:///junk.jpg');
    assert.equal(junkParsed.card_brand, null);
    assert.equal(junkParsed.card_type, null);
  });

  await test('parseTicket sends the file MIME type and a non-zero timeout', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///scan.png', {
      size: 4096,
      type: 'image/png',
      base64: 'aGk=',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 1,
        payment_method: 'card',
        items: [{ name: 'A', quantity: 1, unit_price: 1, total_price: 1, suggested_category_slug: null }],
      },
    });
    await ticketsMod.parseTicket('file:///scan.png');
    const invoke = stubMod.__getCallLog().find((e) => e.kind === 'invoke');
    assert.ok(invoke, 'parse-ticket was invoked');
    assert.equal(invoke.opts.body.mime_type, 'image/png');
    assert.equal(typeof invoke.opts.timeout, 'number');
    assert.ok(invoke.opts.timeout > 0, 'timeout must be set');
  });

  await test('parseTicket rejects oversized images before invoking', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///big.jpg', {
      size: 20 * 1024 * 1024,
      type: 'image/jpeg',
      base64: 'Ymln',
    });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 1,
        payment_method: 'card',
        items: [{ name: 'A', quantity: 1, unit_price: 1, total_price: 1, suggested_category_slug: null }],
      },
    });
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///big.jpg'),
      (err) => {
        assert.match(err.message, /demasiado grande/);
        return true;
      },
    );
    const invokes = stubMod.__getCallLog().filter((e) => e.kind === 'invoke');
    assert.equal(invokes.length, 0, 'oversized image must not reach the edge function');
  });

  await test('parseTicket reports a missing image file with the read copy', async () => {
    resetAll();
    // No file source armed → the file does not exist.
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///missing.jpg'),
      /No se pudo leer la imagen/,
    );
  });

  await test('parseTicket maps edge HTTP errors to user-safe Spanish copy', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///r.jpg', { size: 1024, type: 'image/jpeg', base64: 'aGVsbG8=' });
    stubMod.__setFunctionInvoke('parse-ticket', {
      error: new supabaseJs.FunctionsHttpError(
        new Response(
          JSON.stringify({
            error: 'Monthly scan quota exceeded',
            code: 'quota_exceeded',
            limit: 10,
            used: 10,
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    });
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///r.jpg'),
      (err) => {
        assert.match(err.message, /límite mensual de escaneos/);
        return true;
      },
    );
  });

  await test('parseTicket maps parse_failed to the retry copy', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///r2.jpg', { size: 1024, type: 'image/jpeg', base64: 'aGk=' });
    stubMod.__setFunctionInvoke('parse-ticket', {
      error: new supabaseJs.FunctionsHttpError(
        new Response(JSON.stringify({ error: 'x', code: 'parse_failed' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///r2.jpg'),
      /No se pudo leer el recibo en la imagen/,
    );
  });

  await test('parseTicket maps an AbortError timeout to the timeout copy', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///r3.jpg', { size: 1024, type: 'image/jpeg', base64: 'aGk=' });
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    stubMod.__setFunctionInvoke('parse-ticket', {
      error: new supabaseJs.FunctionsFetchError(abortError),
    });
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///r3.jpg'),
      /tardó demasiado/,
    );
  });

  await test('parseTicket degrades an unknown payment_method to other', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///p.jpg', { size: 1024, type: 'image/jpeg', base64: 'aGk=' });
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 5,
        payment_method: 'crypto',
        items: [{ name: 'A', quantity: 1, unit_price: 5, total_price: 5, suggested_category_slug: null }],
      },
    });
    const parsed = await ticketsMod.parseTicket('file:///p.jpg');
    assert.equal(parsed.payment_method, 'other');
  });

  await test('parseTicket rejects an empty items payload from the wire', async () => {
    resetAll();
    expoFsMod.__setFileSource('file:///empty.jpg', { size: 1024, type: 'image/jpeg', base64: 'aGk=' });
    // A drift between the edge function and the client would otherwise let an
    // empty receipt reach the review screen as a confirmation.
    stubMod.__setFunctionInvoke('parse-ticket', {
      data: {
        store_name: 'X',
        purchase_date: '2026-08-02',
        total: 0,
        payment_method: 'card',
        items: [],
      },
    });
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///empty.jpg'),
      /No se pudo procesar el recibo/,
    );
  });

  await test('parseTicket reports unconfigured before invoking', async () => {
    resetAll();
    // The anon-key placeholder side of the derivation (`YOUR-ANON-KEY` is
    // the app.json fallback); the profile test above covered the URL side.
    stubMod.__setSupabaseConfigInputs(CONFIGURED_URL, PLACEHOLDER_ANON_KEY);
    expoFsMod.__setFileSource('file:///u.jpg', { size: 1024, type: 'image/jpeg', base64: 'aGk=' });
    await assert.rejects(
      () => ticketsMod.parseTicket('file:///u.jpg'),
      /no está disponible/,
    );
    const invokes = stubMod.__getCallLog().filter((e) => e.kind === 'invoke');
    assert.equal(invokes.length, 0, 'no invoke when unconfigured');
  });

  await test('pickBestPictureSize prefers the largest size at or below the cap', async () => {
    assert.equal(
      pictureSizeMod.pickBestPictureSize(['3840x2160', '1920x1080', '1280x720']),
      '1280x720',
    );
  });

  await test('pickBestPictureSize returns the smallest when every size exceeds the cap', async () => {
    assert.equal(
      pictureSizeMod.pickBestPictureSize(['4000x3000', '3840x2160', '3264x2448']),
      '3264x2448',
    );
  });

  await test('pickBestPictureSize handles mixed-case and malformed entries', async () => {
    assert.equal(pictureSizeMod.pickBestPictureSize(['3840X2160', 'junk', '']), '3840X2160');
  });

  await test('pickBestPictureSize returns undefined for an empty list', async () => {
    assert.equal(pictureSizeMod.pickBestPictureSize([]), undefined);
  });

  await test('card normalizers keep a valid brand and both card kinds', async () => {
    assert.equal(cardMod.normalizeCardBrand('  Visa  '), 'Visa');
    assert.equal(cardMod.normalizeCardType('DEBIT'), 'debit');
    assert.equal(cardMod.normalizeCardType('Credit'), 'credit');
  });

  await test('card normalizers degrade blank, junk and non-string values to null', async () => {
    assert.equal(cardMod.normalizeCardBrand('   '), null);
    assert.equal(cardMod.normalizeCardBrand(null), null);
    assert.equal(cardMod.normalizeCardBrand(42), null);
    assert.equal(cardMod.normalizeCardType('prepaid'), null);
    assert.equal(cardMod.normalizeCardType(undefined), null);
    assert.equal(cardMod.normalizeCardType(123), null);
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
  // The compiled `query-client.js` (real TanStack singleton) keeps a handle
  // alive after the last assertion, so the event loop never drains and the
  // process appears hung in foreground even though every test already ran.
  // Exit explicitly after the cleanup instead of waiting for the loop.
  process.exit(process.exitCode ?? 0);
}
