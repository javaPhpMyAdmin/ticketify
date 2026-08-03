#!/usr/bin/env node
/**
 * Node harness for the Phase 4 dual-mode feature reads (data-access slice).
 *
 * Compiles the data-access seam (`src/lib/supabase/feature-access.ts`), the
 * settings store, and the feature APIs (profile, budget, analytics, tickets)
 * into a temp directory with an isolated tsconfig that remaps `@/lib/supabase`
 * to the hand-written test double (scripts/test-stubs/supabase.ts), then
 * asserts the data-access / demo-mode spec boundaries:
 *
 *   - the mode-aware seam follows the LIVE settings-store mode (demo /
 *     authenticated) and never derives it from a session,
 *   - demo mode: feature reads report `{ status: 'demo' }` and make ZERO
 *     Supabase calls (call log stays empty),
 *   - authenticated profile / budget reads hit `profiles` (ok, missing-profile,
 *     unconfigured, error → user-safe message),
 *   - authenticated scan usage reads hit `scan_usage` (missing month row is a
 *     normal ok/null),
 *   - analytics reads call `rpc('monthly_category_totals', { p_year_month })`
 *     and a not-deployed RPC fails safe,
 *   - `saveReceipt` refuses writes in demo mode and stays a documented no-op
 *     when authenticated (ADR-8).
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

/** Resets the double (rows, RPCs, call log) and the store mode to demo. */
function resetAll() {
  stubMod.__resetSupabaseBehavior();
  stubMod.__setSupabaseConfigured(true);
  settingsMod.useSettingsStore.setState({ mode: 'demo' });
}

function setMode(mode) {
  settingsMod.useSettingsStore.getState().setMode(mode);
}

let seamMod;
let settingsMod;
let stubMod;
let profileMod;
let budgetMod;
let analyticsMod;
let ticketsMod;

async function run() {
  console.log('\n[tests] compiling data-access modules…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  seamMod = await load('src/lib/supabase/feature-access.js');
  settingsMod = await load('src/stores/use-settings-store.js');
  stubMod = await load('scripts/test-stubs/supabase.js');
  profileMod = await load('src/features/profile/api.js');
  budgetMod = await load('src/features/budget/api.js');
  analyticsMod = await load('src/features/analytics/api.js');
  ticketsMod = await load('src/features/tickets/api.js');

  console.log('\n[tests] mode-aware read seam (ADR-4)\n');

  await test('seam follows the live settings-store mode, never a session', () => {
    resetAll();
    assert.equal(seamMod.isDemoFixturesOnly(), true, 'default store mode is demo');
    setMode('authenticated');
    assert.equal(seamMod.isDemoFixturesOnly(), false, 'flips with the store');
    setMode('demo');
    assert.equal(seamMod.isDemoFixturesOnly(), true, 'flips back');
  });

  console.log('\n[tests] demo read boundary (zero network)\n');

  await test('demo mode: every feature read reports demo and performs zero Supabase calls', async () => {
    resetAll();
    const profile = await profileMod.fetchProfile('u1');
    assert.deepEqual(profile, { status: 'demo' });
    const budget = await budgetMod.fetchMonthlyBudget('u1');
    assert.deepEqual(budget, { status: 'demo' });
    const totals = await analyticsMod.fetchMonthlyTotals('2026-08');
    assert.deepEqual(totals, { status: 'demo' });
    const breakdown = await analyticsMod.fetchCategoryBreakdown('2026-08');
    assert.deepEqual(breakdown, { status: 'demo' });
    assert.equal(
      stubMod.__getCallLog().length,
      0,
      'demo reads must never touch the backend',
    );
  });

  console.log('\n[tests] authenticated profile reads\n');

  await test('fetchProfile returns the profiles row for the signed-in user', async () => {
    resetAll();
    setMode('authenticated');
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
    setMode('authenticated');
    stubMod.__setTableRead('profiles', { rows: [] });
    const result = await profileMod.fetchProfile('u1');
    assert.equal(result.status, 'missing-profile');
  });

  await test('PostgREST error maps to a user-safe message, never raw text', async () => {
    resetAll();
    setMode('authenticated');
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
    setMode('authenticated');
    stubMod.__setSupabaseConfigured(false);
    const result = await profileMod.fetchProfile('u1');
    assert.equal(result.status, 'unconfigured');
    assert.equal(stubMod.__getCallLog().length, 0, 'no network when unconfigured');
  });

  await test('fetchScanUsage returns the user-month row', async () => {
    resetAll();
    setMode('authenticated');
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
    setMode('authenticated');
    stubMod.__setTableRead('scan_usage', { rows: [] });
    const result = await profileMod.fetchScanUsage('u1', '2026-09');
    assert.equal(result.status, 'ok');
    assert.equal(result.data, null);
  });

  console.log('\n[tests] authenticated budget reads\n');

  await test('fetchMonthlyBudget reads profiles.monthly_budget and currency', async () => {
    resetAll();
    setMode('authenticated');
    stubMod.__setTableRead('profiles', {
      rows: [{ monthly_budget: 900, currency: 'EUR' }],
    });
    const result = await budgetMod.fetchMonthlyBudget('u1');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { amount: 900, currency: 'EUR' });
  });

  await test('missing profile row reports missing-profile for budget', async () => {
    resetAll();
    setMode('authenticated');
    stubMod.__setTableRead('profiles', { rows: [] });
    const result = await budgetMod.fetchMonthlyBudget('u1');
    assert.equal(result.status, 'missing-profile');
  });

  console.log('\n[tests] authenticated analytics reads (ADR-7 RPC)\n');

  await test('category totals call the RPC with p_year_month only (no user id)', async () => {
    resetAll();
    setMode('authenticated');
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
    setMode('authenticated');
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

  console.log('\n[tests] purchase write boundary (ADR-8)\n');

  await test('saveReceipt in demo mode refuses the write: local id, no mutation', async () => {
    resetAll();
    const result = await ticketsMod.saveReceipt('u1', DRAFT);
    assert.ok(result && typeof result.id === 'string' && result.id.length > 0);
    const log = stubMod.__getCallLog();
    assert.ok(!log.some((e) => e.kind === 'upsert'), 'no write in demo mode');
  });

  await test('saveReceipt authenticated stays a documented no-op (writes out of scope)', async () => {
    resetAll();
    setMode('authenticated');
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
