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
 * those specifiers (and the native-bound `expo-file-system` module used by
 * the tickets api) to their compiled locations and passes everything else
 * (zustand, …) through untouched.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === 'expo-file-system') {
      request = join(outDir, 'scripts', 'test-stubs', 'expo-file-system.js');
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

/** Resets the double (rows, RPCs, invoke results, file sources, call log). */
function resetAll() {
  stubMod.__resetSupabaseBehavior();
  stubMod.__setSupabaseConfigured(true);
  expoFsMod.__resetFileSources();
}

let seamMod;
let stubMod;
let expoFsMod;
let profileMod;
let budgetMod;
let analyticsMod;
let ticketsMod;
let keysMod;
let pictureSizeMod;
let adaptersMod;

async function run() {
  console.log('\n[tests] compiling data-access modules…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  seamMod = await load('src/lib/supabase/feature-access.js');
  stubMod = await load('scripts/test-stubs/supabase.js');
  expoFsMod = await load('scripts/test-stubs/expo-file-system.js');
  profileMod = await load('src/features/profile/api.js');
  budgetMod = await load('src/features/budget/api.js');
  analyticsMod = await load('src/features/analytics/api.js');
  ticketsMod = await load('src/features/tickets/api.js');
  keysMod = await load('src/lib/query-keys.js');
  adaptersMod = await load('src/lib/supabase/query-adapters.js');
  pictureSizeMod = await load('src/features/tickets/lib/picture-size.js');

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
    stubMod.__setSupabaseConfigured(false);
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
