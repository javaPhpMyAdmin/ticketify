#!/usr/bin/env node
/**
 * Node harness for issue #214 — the Home "Monthly Budget" card claiming a
 * confident `0` after a currency switch.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 * `useBudget` binds `spent` to the VIEWER-currency group only (the strict
 * "never sum across units" rule). When the profile currency has no receipts
 * for the selected month but OTHER units do, the old `select` collapsed to
 * `?? 0`, and `BudgetCard` recomputed `percent = spent / limit` from that
 * false `0` — rendering "0 / 0% used" under the viewer symbol while the
 * limit line kept the original number. There is NO FX code in this repo and
 * none is added: showing one unit's own total under its OWN symbol is the
 * honest fix.
 *
 * ── What this harness pins ───────────────────────────────────────────────
 *   A. `useBudget` (REAL hook, jsdom + react-dom/client + act, real TanStack
 *      Query):
 *      A1 mismatch — viewer GTQ, rows [{UYU, 12345}] → spent 0 BUT the
 *         snapshot MUST surface `currencyMismatch: true`, `percent: null`
 *         and the UYU unit total (never a silent `0`).
 *      A2 match — viewer UYU, rows [{UYU, 12345}] → unchanged: spent 12345,
 *         percent 12345/limit, no mismatch.
 *      A3 empty — rows [] → spent 0, percent 0 (a GENUINE zero is honest).
 *      A4 multiple foreign units — every foreign unit is surfaced.
 *   B. `BudgetCard` (react-test-renderer, hand-written leaf doubles):
 *      B1 mismatch → the real total under its OWN symbol, the clarification
 *         present, and NO percent text and NO progress bar.
 *      B2 match → identical to today (percent + bar rendered).
 *      B3 genuine zero → 0 + 0% + bar still render.
 *
 * Usage: pnpm test:budget-currency-mismatch
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require_.resolve('typescript/bin/tsc');
const harnessConfig = join(
  __dirname,
  'tsconfig.budget-currency-mismatch-test.json',
);

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'budget-currency-mismatch-test-'));
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

// ---------------------------------------------------------------------------
// Require-hook: redirect aliased modules to stubs / the controllable mock.
// @tanstack/react-query is NOT redirected — the real package is used.
// ---------------------------------------------------------------------------
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/features/auth') {
      request = join(outDir, 'scripts', 'test-stubs', 'auth.js');
    } else if (request === '@/features/home/hooks/useHomeFeed') {
      request = join(outDir, 'scripts', 'test-stubs', 'useHomeFeed.js');
    } else if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/feature-access') {
      request = join(__dirname, 'test-mocks', 'feature-access.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request === 'react-i18next') {
      request = join(outDir, 'scripts', 'test-stubs', 'budget-card-i18next.js');
    } else if (request === '@/components/atoms') {
      request = join(outDir, 'scripts', 'test-stubs', 'budget-card-atoms.js');
    } else if (request === '@/components/molecules/AmountDisplay') {
      request = join(
        outDir,
        'scripts',
        'test-stubs',
        'budget-card-amount-display.js',
      );
    } else if (request === '@/components/molecules/Card') {
      request = join(outDir, 'scripts', 'test-stubs', 'budget-card-card.js');
    } else if (request === '@/components/molecules/ProgressBar') {
      request = join(
        outDir,
        'scripts',
        'test-stubs',
        'budget-card-progress-bar.js',
      );
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/** Every string leaf of a react-test-renderer JSON tree, flattened. */
function flattenStrings(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(flattenStrings);
  if (node && typeof node === 'object') return flattenStrings(node.children);
  return [];
}

async function run() {
  console.log('\n[tests] compiling budget hook + BudgetCard graph…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const { useBudget } = await load('src/features/budget/hooks/useBudget.js');
  const { BudgetCard } = await load('src/components/organisms/BudgetCard/BudgetCard.js');

  // Same module instances the compiled code resolves through the hook.
  const authStub = require_(join(outDir, 'scripts', 'test-stubs', 'auth.js'));
  if (typeof authStub.__setUserId === 'function') authStub.__setUserId('test-user-id');
  const faMock = require_(join(__dirname, 'test-mocks', 'feature-access.js'));

  // Real React + react-query + react-dom for mounting hooks; react-test-renderer
  // for the component-shaped BudgetCard render.
  const React = require_('react');
  const { act } = React;
  const { createRoot } = require_('react-dom/client');
  const { QueryClient, QueryClientProvider } = require_('@tanstack/react-query');
  const TestRenderer = require_('react-test-renderer');

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom for a minimal DOM (react-dom/client needs a container element).
  const { JSDOM } = require_('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  function makeQueryClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  }

  /** Mount `useBudget` inside a real QueryClientProvider; return the latest
   *  snapshot via a polling `waitFor`. */
  function mountBudget(monthKey = '2026-08') {
    let snapshot;
    function TestComp() {
      snapshot = useBudget(monthKey);
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const reactRoot = createRoot(container);
    act(() => {
      reactRoot.render(
        React.createElement(
          QueryClientProvider,
          { client: makeQueryClient() },
          React.createElement(TestComp),
        ),
      );
    });
    const waitFor = async (predicate, { timeout = 2000 } = {}) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        for (let i = 0; i < 3; i += 1) {
          await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
          });
        }
        if (predicate(snapshot)) return snapshot;
        if (Date.now() > deadline) {
          throw new Error(
            `waitFor timed out after ${timeout}ms; last snapshot: ` +
              JSON.stringify(snapshot),
          );
        }
      }
    };
    return {
      waitFor,
      unmount: () => act(() => reactRoot.unmount()),
    };
  }

  async function renderCard(props) {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BudgetCard, props));
    });
    return renderer;
  }

  function setBudget(amount, currency) {
    faMock.__setReadMonthlyBudgetRow(async () => ({
      status: 'ok',
      data: { monthly_budget: amount, currency },
    }));
  }
  function setRows(rows) {
    faMock.__setReadMonthlyPurchasesTotal(async () => ({
      status: 'ok',
      data: rows,
    }));
  }

  // -----------------------------------------------------------------------
  // A. useBudget — the snapshot must carry the truth, not a silent 0
  // -----------------------------------------------------------------------
  console.log('\n[tests] A — useBudget snapshot (real hook)\n');

  await test('A1 mismatch: viewer GTQ has no receipts, UYU does → no silent 0 (currencyMismatch, percent null, UYU surfaced)', async () => {
    faMock.__reset();
    setBudget(100000, 'GTQ');
    setRows([{ currency: 'UYU', total: 12345 }]);
    const mount = mountBudget('2026-08');
    try {
      const s = await mount.waitFor(
        (snap) => snap.hasData && !snap.isLoading && Array.isArray(snap.unitTotals),
      );
      assert.equal(
        s.spent,
        0,
        'spent stays the viewer-currency total (0) — it is the foreign figure that must be surfaced',
      );
      assert.equal(
        s.currencyMismatch,
        true,
        'the mismatch state MUST be observable (viewer currency has no receipts, others do)',
      );
      assert.equal(
        s.percent,
        null,
        'percent must be ABSENT (null) — a cross-unit ratio must never be computed',
      );
      assert.deepEqual(
        s.unitTotals,
        [{ currency: 'UYU', total: 12345 }],
        'the real UYU total must be surfaced under its own unit',
      );
    } finally {
      mount.unmount();
    }
  });

  await test('A2 match: viewer UYU has receipts → unchanged (spent, percent, no mismatch)', async () => {
    faMock.__reset();
    setBudget(100000, 'UYU');
    setRows([{ currency: 'UYU', total: 12345 }]);
    const mount = mountBudget('2026-08');
    try {
      const s = await mount.waitFor(
        (snap) => snap.hasData && !snap.isLoading && Array.isArray(snap.unitTotals),
      );
      assert.equal(s.spent, 12345, 'viewer total unchanged');
      assert.equal(s.currencyMismatch, false, 'a matching viewer unit is not a mismatch');
      assert.ok(
        Math.abs(s.percent - 12345 / 100000) < 1e-9,
        `percent must be spent/limit (got ${s.percent})`,
      );
      assert.deepEqual(s.unitTotals, [{ currency: 'UYU', total: 12345 }]);
    } finally {
      mount.unmount();
    }
  });

  await test('A3 empty month: genuine zero stays 0 with percent 0 (not null)', async () => {
    faMock.__reset();
    setBudget(100000, 'UYU');
    setRows([]);
    const mount = mountBudget('2026-08');
    try {
      const s = await mount.waitFor(
        (snap) => snap.hasData && !snap.isLoading && Array.isArray(snap.unitTotals),
      );
      assert.equal(s.spent, 0, 'a genuine zero month is still 0');
      assert.equal(s.currencyMismatch, false, 'no receipts at all is not a mismatch');
      assert.equal(s.percent, 0, 'a genuine zero keeps the 0% path (never suppressed)');
      assert.deepEqual(s.unitTotals, [], 'no units recorded this month');
    } finally {
      mount.unmount();
    }
  });

  await test('A4 mismatch with multiple foreign units: every unit total is surfaced', async () => {
    faMock.__reset();
    setBudget(100000, 'GTQ');
    setRows([
      { currency: 'UYU', total: 12345 },
      { currency: 'ARS', total: 5000 },
    ]);
    const mount = mountBudget('2026-08');
    try {
      const s = await mount.waitFor(
        (snap) => snap.hasData && !snap.isLoading && Array.isArray(snap.unitTotals),
      );
      assert.equal(s.currencyMismatch, true);
      assert.equal(s.percent, null);
      assert.deepEqual(
        s.unitTotals,
        [
          { currency: 'UYU', total: 12345 },
          { currency: 'ARS', total: 5000 },
        ],
        'unit totals are sorted highest-first and never summed across units',
      );
    } finally {
      mount.unmount();
    }
  });

  // -----------------------------------------------------------------------
  // B. BudgetCard — the render contract for the mismatch state
  // -----------------------------------------------------------------------
  console.log('\n[tests] B — BudgetCard render (react-test-renderer)\n');

  await test('B1 mismatch render: real total under its own symbol, clarification shown, NO percent text and NO bar', async () => {
    const renderer = await renderCard({
      spent: 0,
      limit: 100000,
      currency: 'GTQ',
      percent: null,
      foreignUnitTotals: [{ currency: 'UYU', total: 12345 }],
    });
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      const amounts = renderer.root.findAllByType('AmountDisplay');
      assert.equal(amounts.length, 1, 'exactly one big number in the mismatch state');
      assert.equal(
        amounts[0].props.value,
        12345,
        'the big number must be the REAL total, not a false 0',
      );
      assert.equal(
        amounts[0].props.currency,
        'UYU',
        'the real total must render under its OWN symbol',
      );
      assert.ok(
        text.includes('No spending in GTQ this month'),
        `the clarification copy must be visible (got: ${JSON.stringify(text)})`,
      );
      assert.equal(
        renderer.root.findAllByType('ProgressBar').length,
        0,
        'the progress bar must NOT render in the mismatch state',
      );
      assert.ok(
        !/\d+% used/.test(text),
        'the percent text must NOT render in the mismatch state',
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  await test('B2 match render: unchanged — viewer total, percent text and bar render', async () => {
    const renderer = await renderCard({
      spent: 12345,
      limit: 100000,
      currency: 'UYU',
      percent: 12345 / 100000,
    });
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      const amounts = renderer.root.findAllByType('AmountDisplay');
      assert.equal(amounts.length, 1);
      assert.equal(amounts[0].props.value, 12345);
      assert.equal(amounts[0].props.currency, 'UYU');
      assert.ok(text.includes('12% used'), `percent text must render (got: ${JSON.stringify(text)})`);
      assert.equal(
        renderer.root.findAllByType('ProgressBar').length,
        1,
        'the progress bar must render when a real percent exists',
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  await test('B3 genuine zero render: 0 + 0% + bar still render (never suppressed)', async () => {
    const renderer = await renderCard({
      spent: 0,
      limit: 100000,
      currency: 'UYU',
      percent: 0,
    });
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      const amounts = renderer.root.findAllByType('AmountDisplay');
      assert.equal(amounts[0].props.value, 0);
      assert.equal(amounts[0].props.currency, 'UYU');
      assert.ok(text.includes('0% used'), `a genuine zero keeps 0% (got: ${JSON.stringify(text)})`);
      assert.equal(
        renderer.root.findAllByType('ProgressBar').length,
        1,
        'a genuine zero keeps the (empty) bar',
      );
      assert.ok(
        !text.includes('No spending in'),
        'the genuine-zero state must NOT show the mismatch clarification',
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
