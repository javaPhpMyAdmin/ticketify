#!/usr/bin/env node
/**
 * Node harness for the authenticated-only feature reads (data-access slice).
 *
 * Compiles the data-access seam (`src/lib/supabase/feature-access.ts`) and
 * the feature APIs (profile, budget, analytics, tickets) into a temp
 * directory with an isolated tsconfig that remaps `@/lib/supabase` to the
 * hand-written test double (scripts/test-stubs/supabase.ts), then asserts the
 * data-access spec boundaries:
 *
 *   - authenticated profile / budget reads hit `profiles` (ok, missing-profile,
 *     unconfigured, error → user-safe message),
 *   - authenticated scan usage reads hit `scan_usage` (missing month row is a
 *     normal ok/null),
 *   - analytics reads call `rpc('monthly_category_totals', { p_year_month })`
 *     and a not-deployed RPC fails safe,
 *   - `saveReceipt` stays a documented no-op (writes are out of scope).
 *   - pure query layer: `utcYearMonth` + key factories (userId-scoped, shared
 *     year-month) and the throwing adapters (`toQueryData` ok/throw branches,
 *     `shouldRetry` definitive-vs-transient gating, `toQueryErrorMessage`
 *     copy mapping).
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

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'feature-test-'));
const outDir = join(workdir, 'out');

const DRAFT = {
  store_name: 'Whole Foods Market',
  purchase_date: '2026-08-02',
  total: 42.18,
  payment_method: 'card',
  image_url: 'file:///tmp/receipt.jpg',
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
 * those specifiers to their compiled locations and passes everything else
 * (zustand, …) through untouched.
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

/** Resets the double (rows, RPCs, call log) to its initial state. */
function resetAll() {
  stubMod.__resetSupabaseBehavior();
  stubMod.__setSupabaseConfigured(true);
}

let seamMod;
let stubMod;
let profileMod;
let budgetMod;
let analyticsMod;
let ticketsMod;
let keysMod;
let adaptersMod;

async function run() {
  console.log('\n[tests] compiling data-access modules…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  seamMod = await load('src/lib/supabase/feature-access.js');
  stubMod = await load('scripts/test-stubs/supabase.js');
  profileMod = await load('src/features/profile/api.js');
  budgetMod = await load('src/features/budget/api.js');
  analyticsMod = await load('src/features/analytics/api.js');
  ticketsMod = await load('src/features/tickets/api.js');
  keysMod = await load('src/lib/query-keys.js');
  adaptersMod = await load('src/lib/supabase/query-adapters.js');

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
    stubMod.__setSupabaseConfigured(false);
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

  console.log('\n[tests] pure query layer (keys + throwing adapters)\n');

  await test('utcYearMonth derives the shared UTC year-month with zero padding', async () => {
    assert.equal(keysMod.utcYearMonth(new Date(Date.UTC(2026, 7, 15))), '2026-08');
    assert.equal(keysMod.utcYearMonth(new Date(Date.UTC(2026, 0, 1))), '2026-01');
    assert.equal(keysMod.utcYearMonth(new Date(Date.UTC(2026, 11, 31))), '2026-12');
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

  console.log('\n[tests] purchase write boundary\n');

  await test('saveReceipt stays a documented no-op (writes out of scope)', async () => {
    resetAll();
    const result = await ticketsMod.saveReceipt('u1', DRAFT);
    assert.ok(result && typeof result.id === 'string' && result.id.length > 0);
    assert.equal(stubMod.__getCallLog().length, 0, 'no backend interaction');
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
