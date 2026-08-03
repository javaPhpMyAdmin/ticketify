#!/usr/bin/env node
/**
 * Node harness for the demo-mode slice (Phase 3).
 *
 * Compiles the pure demo-mode modules — the mode-switch decision logic, the
 * shared fixtures module, and the tickets write guard — with tsc into a temp
 * directory, then asserts the demo-mode spec boundaries:
 *
 *   - mode switch: signed out → sign-in flow, signed in → promote (spec
 *     scenarios "Switch to authenticated while signed out" / "Switch to demo
 *     while authenticated"),
 *   - mode-switch wiring: the profile handler (`handleAuthenticatedPress`)
 *     delegates to the decision function and fires exactly the side effect
 *     the branch calls for,
 *   - fixtures consistency: the screens render the same numbers everywhere
 *     (the fixtures module's own docstring contract),
 *   - demo read boundary: feature reads are still stubbed and return fixtures
 *     in every mode — the documented interim state until Phase 4 wires
 *     mode-aware reads behind the `isDemoFixturesOnly()` seam,
 *   - demo write boundary: `saveReceipt` stays a local no-op, so a write
 *     attempt in demo mode is refused with no backend mutation (ADR-8).
 *
 * The modules under test are TS-only but dependency-free at runtime
 * (`@/…` type imports are erased; `tickets/api.ts` only needs `@/lib/format`),
 * so the compiled CommonJS output runs in plain node with a tiny require hook.
 *
 * Usage: pnpm test:demo
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
const harnessConfig = join(__dirname, 'tsconfig.demo-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'demo-test-'));
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
 * tsc type-checks against the remapped `@/…` paths but emits the ORIGINAL
 * specifier, so plain node cannot resolve `@/lib/format` in the compiled
 * CommonJS output. Rewrites it to the compiled location; everything else
 * passes through untouched.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function compile() {
  execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

async function run() {
  console.log('\n[tests] compiling demo-mode modules…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const switchMod = await load('src/lib/auth/mode-switch.js');
  const fixturesMod = await load('src/lib/fixtures/demo.js');
  const ticketsMod = await load('src/features/tickets/api.js');
  const profileMod = await load('src/features/profile/api.js');
  const budgetMod = await load('src/features/budget/api.js');
  const analyticsMod = await load('src/features/analytics/api.js');

  console.log('\n[tests] mode switch decision (demo-mode spec)\n');

  await test('signed out: switching to authenticated presents the sign-in flow', () => {
    assert.equal(switchMod.authenticatedSwitchAction(false), 'sign-in');
  });

  await test('signed in: switching to authenticated promotes the mode', () => {
    assert.equal(switchMod.authenticatedSwitchAction(true), 'promote');
  });

  console.log('\n[tests] profile mode-switch wiring (real handler)\n');

  // `handleAuthenticatedPress` is the handler the profile screen actually
  // delegates its onPress to (it calls `authenticatedSwitchAction` and
  // dispatches to the injected side effects), so these tests exercise the
  // shipped wiring — sign-in push vs mode promote — without a React renderer.

  await test('handler wiring: signed out → sign-in pushed, mode never promoted', () => {
    let promoted = 0;
    let navigated = 0;
    switchMod.handleAuthenticatedPress({
      hasSession: false,
      promote: () => {
        promoted += 1;
      },
      navigateToSignIn: () => {
        navigated += 1;
      },
    });
    assert.equal(navigated, 1, 'sign-in flow must be opened');
    assert.equal(promoted, 0, 'mode must stay demo when signed out');
  });

  await test('handler wiring: signed in → mode promoted, no sign-in navigation', () => {
    let promoted = 0;
    let navigated = 0;
    switchMod.handleAuthenticatedPress({
      hasSession: true,
      promote: () => {
        promoted += 1;
      },
      navigateToSignIn: () => {
        navigated += 1;
      },
    });
    assert.equal(promoted, 1, 'mode must promote when a session exists');
    assert.equal(navigated, 0, 'no sign-in push when already signed in');
  });

  console.log('\n[tests] demo fixtures consistency\n');

  await test('wantsSnacksTotal matches the Snacks category total', () => {
    const snacks = fixturesMod.categoryBreakdownRows.find(
      (row) => row.category_slug === 'snacks',
    );
    assert.ok(snacks, 'analytics fixtures must include a Snacks row');
    assert.equal(fixturesMod.wantsSnacksTotal, snacks.total);
  });

  await test('home category amounts mirror the analytics breakdown rows', () => {
    for (const card of fixturesMod.homeCategories) {
      const row = fixturesMod.categoryBreakdownRows.find(
        (r) => r.category_name === card.name,
      );
      assert.ok(row, `no analytics breakdown row for ${card.name}`);
      assert.equal(card.amount, row.total, `${card.name} amount`);
    }
  });

  await test('recent receipts match history entries (merchant + amount)', () => {
    for (const receipt of fixturesMod.recentReceipts) {
      const entry = fixturesMod.historyEntries.find(
        (e) => e.merchant === receipt.name,
      );
      assert.ok(entry, `no history entry for ${receipt.name}`);
      assert.equal(entry.needs + entry.wants, receipt.amount, receipt.name);
    }
  });

  await test('history entries and recent receipts have unique ids', () => {
    const entryIds = fixturesMod.historyEntries.map((e) => e.id);
    assert.equal(new Set(entryIds).size, entryIds.length);
    const receiptIds = fixturesMod.recentReceipts.map((r) => r.id);
    assert.equal(new Set(receiptIds).size, receiptIds.length);
  });

  await test('demo budget and currency agree across fixtures and settings defaults', () => {
    assert.equal(
      fixturesMod.monthlyBudget.amount,
      fixturesMod.settingsDefaults.monthly_budget,
    );
    assert.equal(
      fixturesMod.monthlyBudget.currency,
      fixturesMod.settingsDefaults.currency,
    );
    assert.equal(fixturesMod.demoUser.monthly_budget, fixturesMod.monthlyBudget.amount);
    assert.equal(fixturesMod.demoUser.currency, fixturesMod.monthlyBudget.currency);
  });

  await test('demo scan usage is limited to the current year-month shape', () => {
    assert.match(fixturesMod.demoScanUsage.year_month, /^\d{4}-\d{2}$/);
    assert.ok(fixturesMod.demoScanUsage.scans_used <= fixturesMod.demoScanUsage.scans_limit);
  });

  console.log('\n[tests] demo read boundary (interim state)\n');

  await test('read-boundary seam documents the fixtures-only interim state', () => {
    // Phase 3: reads are stubbed, so fixtures reach every mode. Phase 4 MUST
    // flip this seam to be mode-aware (see the seam's docstring) before
    // authenticated mode can be trusted to render real data.
    assert.equal(fixturesMod.isDemoFixturesOnly(), true);
  });

  await test('profile read is still stubbed: fetchProfile returns the demo user', async () => {
    const user = await profileMod.fetchProfile('any-user-id');
    assert.equal(user?.id, fixturesMod.demoUser.id);
  });

  await test('budget read is still stubbed: fetchMonthlyBudget returns the demo budget', async () => {
    const budget = await budgetMod.fetchMonthlyBudget('any-user-id');
    assert.equal(budget.amount, fixturesMod.monthlyBudget.amount);
    assert.equal(budget.currency, fixturesMod.monthlyBudget.currency);
  });

  await test('analytics reads are still stubbed: breakdown returns the fixture rows', async () => {
    const rows = await analyticsMod.fetchCategoryBreakdown('any-user-id', '2026-08');
    assert.equal(rows, fixturesMod.categoryBreakdownRows);
  });

  console.log('\n[tests] demo write boundary (tickets guard)\n');

  await test('saveReceipt is a local no-op: returns an id, never touches a backend', async () => {
    const result = await ticketsMod.saveReceipt('demo', {
      store_name: 'Whole Foods Market',
      purchase_date: '2026-08-02',
      total: 42.18,
      payment_method: 'card',
      image_url: 'file:///tmp/receipt.jpg',
      items: [],
    });
    assert.ok(result && typeof result.id === 'string' && result.id.length > 0);
  });

  await test('uploadToStorage stays stubbed: echoes the local uri, no storage call', async () => {
    const { url } = await ticketsMod.uploadToStorage('demo', 'file:///tmp/x.jpg');
    assert.equal(url, 'file:///tmp/x.jpg');
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
