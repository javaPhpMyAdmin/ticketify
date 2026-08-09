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
 *   - budget spent: the pure `sumCategoryTotals` helper (fixture sum, empty
 *     month → 0, malformed rows skipped) plus the `readCategoryTotals` seam
 *     the budget hook's queryFn calls — RPC year-month argument via
 *     `__lastRpcCall` and the PGRST202 fails-safe path. (The hook itself is
 *     out of scope here: it imports react, so the harness cannot compile it;
 *     its cache-collision behavior is proven by a standalone TanStack probe.)
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

  await test('readCategoryTotals (the budget spent seam) reaches the RPC with p_year_month only and sums via sumCategoryTotals', async () => {
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

  await test('readCategoryTotals (the budget spent seam) fails safe on a not-deployed RPC', async () => {
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
    assert.deepEqual(keysMod.queryKeys.historyEntries('u1'), [
      'history',
      'entries',
      'u1',
    ]);
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
}
