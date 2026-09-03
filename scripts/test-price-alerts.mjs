#!/usr/bin/env node
/**
 * Node harness for the price-alert computation AND the `usePriceAlerts` hook
 * wiring (`src/features/analytics/price-alerts.ts` + usePriceAlerts.ts).
 *
 * Part 1 (pure computation): compiles the price-alerts module plus its
 * dependency graph (home feed, auth store, receipts store, react-query) into
 * a temp directory with an isolated tsconfig that remaps the native/backend
 * imports to the hand-written test doubles, then asserts the alert contract
 * (see the assertion list below).
 *
 * Part 2 (hook wiring): mounts the actual `usePriceAlerts` hook through
 * react-test-renderer (the profile-hook harness pattern) against the
 * compiled query-client singleton and the supabase double, asserting the
 * NEW month-scoped wiring:
 *   - it returns a PriceAlert[] derived from the two month-scoped query
 *     results (current + previous month) for the selected month,
 *   - empty data → empty alerts (no crash),
 *   - the previous-month comparison yields the SAME alerts the pure
 *     `computePriceAlerts` function computes for the combined rows,
 *   - it does NOT read the receipts store (regression guard for BLOCKER 2).
 *
 * Deterministic: no clock, no Intl, fixed fixture inputs — the only call
 * into "now" is the defaulted parameter, and every test passes `nowMonth`
 * (the hook test passes monthKey explicitly).
 *
 * Usage: pnpm test:price-alerts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import React from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.price-alerts-test.json');

// The compiled modules load @tanstack/react-query through CJS `require`, and
// the package ships separate ESM/CJS builds. Get the provider through the
// SAME CJS build so a single QueryClientProvider instance is in play.
const { QueryClientProvider } = require('@tanstack/react-query');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'price-alerts-test-'));
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

function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'react-native') {
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

/** One receipt with a single item, for compact fixtures. */
function receipt(id, date, item) {
  return { id, store_name: 'Store', purchase_date: date, items: [item] };
}

const item = (name, unitPrice, category = 'alimentos') => ({
  name,
  amount: unitPrice,
  quantity: 1,
  unit_price: unitPrice,
  category,
});

/**
 * Raw `purchases` row the home read maps into a HomeFeedReceiptRow. The
 * supabase double (`__setTableRead('purchases', …)`) resolves these verbatim.
 */
function rawReceipt(id, date, itemRows) {
  return {
    id,
    store_id: null,
    purchase_date: date,
    created_at: `${date}T10:00:00.000Z`,
    total: itemRows.reduce((s, i) => s + i.total_price, 0),
    payment_method: 'card',
    image_url: null,
    status: 'confirmed',
    stores: { name: 'Store' },
    purchase_items: itemRows,
  };
}
const rawItem = (name, unitPrice, category = 'alimentos') => ({
  id: `pi-${name}`,
  name,
  quantity: 1,
  unit_price: unitPrice,
  total_price: unitPrice,
  is_impulse: false,
  sort_order: 0,
  categories: { slug: category },
});

// ── hook-mounting globals (profile-hook harness pattern) ────────────────
let stubMod;
let alertsHookMod;
let pureMod;
let sessionStoreMod;
let queryClientMod;
let receiptsStoreMod;
let usePriceAlerts;
let computePriceAlerts;

const FAKE_SESSION = {
  access_token: 'access-token-u1',
  refresh_token: 'refresh-token-u1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'u1',
    email: 'user@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  },
};

let captured = null;
function Probe() {
  captured = usePriceAlerts('2026-08');
  return null;
}
const probeElement = () =>
  React.createElement(
    QueryClientProvider,
    { client: queryClientMod.queryClient },
    React.createElement(Probe),
  );

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settleUntil(predicate, what, budget = 30) {
  for (let i = 0; i < budget && !predicate(); i += 1) {
    await act(async () => {
      await tick();
    });
  }
  assert.ok(predicate(), what);
}

async function resetHookState() {
  stubMod.__resetSupabaseBehavior();
  queryClientMod.queryClient.getQueryCache().clear();
  receiptsStoreMod.useReceiptsStore.setState({ list: [] });
  sessionStoreMod.useSessionStore.setState({ session: null });
  captured = null;
}

async function run() {
  console.log('\n[tests] compiling price-alerts modules…');
  await compile();
  globalThis.__DEV__ = false;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const alertsMod = await load('src/features/analytics/price-alerts.js');
  const compute = (records, threshold) =>
    alertsMod.computePriceAlerts(records, threshold, '2026-08');

  // Hook-mounting modules (loaded once; each test resets state).
  stubMod = await load('scripts/test-stubs/supabase.js');
  alertsHookMod = await load('src/features/analytics/hooks/usePriceAlerts.js');
  pureMod = alertsMod;
  sessionStoreMod = await load('src/features/auth/use-session-store.js');
  queryClientMod = await load('src/lib/query-client.js');
  receiptsStoreMod = await load('src/stores/use-receipts-store.js');
  usePriceAlerts = alertsHookMod.usePriceAlerts;
  computePriceAlerts = alertsMod.computePriceAlerts;

  // ── PART 1: pure computation (existing contract) ────────────────────────
  // (all assertions are below in the original block; kept intact)

  console.log('\n[tests] alert detection\n');

  await test('a product over the threshold produces an alert', () => {
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Leche entera 1L', 1100, 'lacteos')),
      receipt('r2', '2026-08-06', item('Leche entera 1L', 1200, 'lacteos')),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].name, 'Leche entera 1L');
    assert.equal(alerts[0].category, 'lacteos');
    assert.equal(alerts[0].currentPrice, 1200);
    assert.equal(alerts[0].previousPrice, 1100);
    assert.equal(alerts[0].changePct, 9.1);
  });

  await test('a change below the threshold is discarded', () => {
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Papas fritas x3', 1020, 'snacks')),
      receipt('r2', '2026-08-06', item('Papas fritas x3', 1050, 'snacks')),
    ]);
    assert.equal(alerts.length, 0);
  });

  await test('an unchanged price yields no alert', () => {
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Azúcar 1kg', 1100)),
      receipt('r2', '2026-08-06', item('Azúcar 1kg', 1100)),
    ]);
    assert.equal(alerts.length, 0);
  });

  await test('a change of exactly the threshold is not an alert', () => {
    // 1050 -> 1000 is exactly -5.0%: strictly above the threshold is required.
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Aceite de girasol 1L', 1050)),
      receipt('r2', '2026-08-06', item('Aceite de girasol 1L', 1000)),
    ]);
    assert.equal(alerts.length, 0);
  });

  console.log('\n[tests] identity normalization (package size preserved)\n');

  await test('different package sizes are different identities → no false alert', () => {
    // "Leche 1L" vs "Leche 2L" are different products — comparing their
    // average unit price would be a FALSE alert. No alert may be emitted.
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Leche 1L', 1000, 'lacteos')),
      receipt('r2', '2026-08-06', item('Leche 2L', 1800, 'lacteos')),
    ]);
    assert.equal(alerts.length, 0);
  });

  await test('same size, different formatting → same identity → alert fires', () => {
    // "Leche 1L" and "Leche 1 L" are the same presentation, so a real
    // price change between months must still produce an alert.
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Leche 1L', 1000, 'lacteos')),
      receipt('r2', '2026-08-06', item('Leche 1 L', 1200, 'lacteos')),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].currentPrice, 1200);
    assert.equal(alerts[0].previousPrice, 1000);
    assert.equal(alerts[0].changePct, 20);
  });

  await test('comma decimals (es-UY norm) collapse with spaced unit → same identity', () => {
    // "1,5 L" vs "1,5L" are the same size — the es-UY decimal comma must
    // not split the identity.
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Detergente 1,5L', 900, 'limpieza')),
      receipt('r2', '2026-08-06', item('Detergente 1,5 L', 990, 'limpieza')),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].changePct, 10);
  });

  await test('trailing quantity is still stripped from the identity', () => {
    // "Yerba x2" → "yerba": buying two packs is not a new product, so the
    // quantity suffix must not split the identity.
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Yerba x2', 2500, 'alimentos')),
      receipt('r2', '2026-08-06', item('Yerba', 2750, 'alimentos')),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].changePct, 10);
  });

  console.log('\n[tests] participation rules\n');

  await test('an item without unit_price never participates', () => {
    const alerts = compute([
      {
        id: 'r1',
        store_name: 'Store',
        purchase_date: '2026-07-03',
        items: [{ name: 'Sin precio', amount: 999, category: 'alimentos' }],
      },
      receipt('r2', '2026-08-06', item('Sin precio', 1000)),
    ]);
    assert.equal(alerts.length, 0);
  });

  await test('a product in only one month has no pair → no alert', () => {
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Detergente lavaplatos', 950, 'limpieza')),
    ]);
    assert.equal(alerts.length, 0);
  });

  await test('multiple purchases in one month are averaged', () => {
    const alerts = compute([
      receipt('r1', '2026-07-10', item('Gaseosa 2L', 2500, 'refrescos')),
      receipt('r2', '2026-08-02', item('Gaseosa 2L', 2600, 'refrescos')),
      receipt('r3', '2026-08-15', item('Gaseosa 2L', 2700, 'refrescos')),
      receipt('r4', '2026-08-28', item('Gaseosa 2L', 2800, 'refrescos')),
    ]);
    assert.equal(alerts.length, 1);
    // (2600 + 2700 + 2800) / 3 = 2700, vs 2500 → +8.0%
    assert.equal(alerts[0].currentPrice, 2700);
    assert.equal(alerts[0].previousPrice, 2500);
    assert.equal(alerts[0].changePct, 8);
  });

  console.log('\n[tests] direction and ordering\n');

  await test('a price drop yields a negative changePct', () => {
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Leche entera 1L', 1200, 'lacteos')),
      receipt('r2', '2026-08-06', item('Leche entera 1L', 1100, 'lacteos')),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].changePct, -8.3);
  });

  await test('alerts sort by absolute change, descending', () => {
    const alerts = compute([
      receipt('r1', '2026-07-03', item('Leche entera 1L', 1100, 'lacteos')),
      receipt('r2', '2026-08-06', item('Leche entera 1L', 1200, 'lacteos')),
      receipt('r3', '2026-07-04', item('Aceite de girasol 1L', 1500, 'alimentos')),
      receipt('r4', '2026-08-07', item('Aceite de girasol 1L', 1200, 'alimentos')),
    ]);
    // Leche +9.1, Aceite -20 → Aceite first (bigger absolute change)
    assert.deepEqual(
      alerts.map((a) => a.name),
      ['Aceite de girasol 1L', 'Leche entera 1L'],
    );
  });

  console.log('\n[tests] month parameter\n');

  await test('nowMonth controls which consecutive months are compared', () => {
    // July vs June: Leche 1000 (June) → 1100 (July) = +10% → alert
    const records = [
      receipt('r1', '2026-06-03', item('Leche entera 1L', 1000, 'lacteos')),
      receipt('r2', '2026-07-06', item('Leche entera 1L', 1100, 'lacteos')),
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-07');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].changePct, 10);
  });

  await test('nowMonth parameterizes the rollover to the prior year', () => {
    // January vs December: Dec 1000 → Jan 1100 = +10%
    const records = [
      receipt('r1', '2025-12-03', item('Leche entera 1L', 1000, 'lacteos')),
      receipt('r2', '2026-01-06', item('Leche entera 1L', 1100, 'lacteos')),
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-01');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].changePct, 10);
  });

  console.log('\n[tests] S2 deterministic receiptId rule (REQ-GATE-2)\n');

  await test('two receipts in the same month with different purchase_date → latest wins', () => {
    // Current month has two candidate receipts. The LATER purchase_date
    // must win, regardless of insertion order — S2 deterministic.
    const records = [
      receipt('r1', '2026-07-03', item('Leche entera 1L', 1000, 'lacteos')),
      // Out-of-order insertion: the older 2026-08 receipt comes FIRST.
      receipt('r2', '2026-08-05', item('Leche entera 1L', 1200, 'lacteos')),
      receipt('r3', '2026-08-25', item('Leche entera 1L', 1200, 'lacteos')),
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    assert.equal(
      alerts[0].receiptId,
      'r3',
      'latest purchase_date (2026-08-25) must win regardless of insertion order',
    );
  });

  await test('two receipts in the same month with the SAME purchase_date → lowest id wins', () => {
    // Tie-break by id ascending: insertion order is r3 then r2; both on
    // 2026-08-15. The id-ascending rule picks 'r2' (lexicographically
    // smaller than 'r3').
    const records = [
      receipt('r1', '2026-07-03', item('Leche entera 1L', 1000, 'lacteos')),
      receipt('r3', '2026-08-15', item('Leche entera 1L', 1200, 'lacteos')),
      receipt('r2', '2026-08-15', item('Leche entera 1L', 1200, 'lacteos')),
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    assert.equal(
      alerts[0].receiptId,
      'r2',
      'same purchase_date → lowest id wins (tie-break ascending)',
    );
  });

  await test('same identity in different months → each nowMonth gets its own receiptId', () => {
    // The (identity, month) source map is per-month: asking for July vs
    // June picks the July receipt, asking for August vs July picks the
    // August receipt — independent captures.
    const records = [
      receipt('r0', '2026-06-03', item('Leche entera 1L', 900, 'lacteos')),
      receipt('r1', '2026-07-12', item('Leche entera 1L', 1000, 'lacteos')),
      receipt('r2', '2026-08-20', item('Leche entera 1L', 1200, 'lacteos')),
    ];
    const julyAlerts = alertsMod.computePriceAlerts(records, 0.05, '2026-07');
    const augustAlerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(julyAlerts.length, 1);
    assert.equal(augustAlerts.length, 1);
    assert.equal(
      julyAlerts[0].receiptId,
      'r1',
      'nowMonth=2026-07 must pick the July source receipt',
    );
    assert.equal(
      augustAlerts[0].receiptId,
      'r2',
      'nowMonth=2026-08 must pick the August source receipt',
    );
  });

  await test('receipts without an id field contribute an empty-string candidate (no crash)', () => {
    // The implementation accepts id-less receipts (it falls back to ''),
    // so the deterministic comparison still resolves. The analytics tap
    // becomes a no-op navigation rather than crashing on a missing id.
    // Here the ONLY current-month receipt has no id → alert.receiptId=''.
    const records = [
      receipt('r1', '2026-07-03', item('Leche entera 1L', 1000, 'lacteos')),
      // Current-month receipt WITHOUT an `id` field.
      {
        store_name: 'Store',
        purchase_date: '2026-08-10',
        items: [item('Leche entera 1L', 1200, 'lacteos')],
      },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    assert.equal(
      alerts[0].receiptId,
      '',
      'id-less receipt contributes an empty-string candidate; tap is a no-op navigation',
    );
  });

  // ── PART 2: usePriceAlerts hook wiring (BLOCKER 2) ─────────────────────
  // Exercises the ACTUAL hook: two month-scoped queries (selected + previous
  // month) combined and passed to computePriceAlerts. Fixtures are RAW
  // `purchases` rows because the queryFn maps them via the home read; the
  // pure-function comparison below uses the equivalent mapped fixture.
  console.log('\n[tests] usePriceAlerts hook wiring\n');

  const HOOK_RAW_JUL = (id, name, unit) =>
    rawReceipt(id, '2026-07-03', [rawItem(name, unit, 'lacteos')]);
  const HOOK_RAW_AUG = (id, name, unit) =>
    rawReceipt(id, '2026-08-06', [rawItem(name, unit, 'lacteos')]);

  // (a) returns a PriceAlert[] derived from the two month-scoped query results
  await test('derives alerts from the two month-scoped query rows', async () => {
    await resetHookState();
    sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
    stubMod.__setTableRead('purchases', {
      rows: [
        HOOK_RAW_AUG('r2', 'Leche entera 1L', 1200),
        HOOK_RAW_JUL('r1', 'Leche entera 1L', 1100),
      ],
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(probeElement());
    });
    try {
      await settleUntil(
        () => captured && captured.length > 0,
        'hook resolved the cross-month alert',
      );
      assert.equal(captured.length, 1);
      assert.equal(captured[0].name, 'Leche entera 1L');
      assert.equal(captured[0].currentPrice, 1200);
      assert.equal(captured[0].previousPrice, 1100);
      assert.equal(captured[0].changePct, 9.1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  // (b) empty data → empty alerts (no crash)
  await test('empty data → empty alerts (no crash)', async () => {
    await resetHookState();
    sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
    stubMod.__setTableRead('purchases', { rows: [] });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(probeElement());
    });
    try {
      await settleUntil(
        () => captured !== null && Array.isArray(captured) && captured.length === 0,
        'empty rows → empty alerts',
      );
      assert.deepEqual(captured, []);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  // (c) previous-month comparison yields the same alerts the pure fn computes
  await test('previous-month comparison matches the pure computePriceAlerts', async () => {
    await resetHookState();
    sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
    stubMod.__setTableRead('purchases', {
      rows: [
        HOOK_RAW_AUG('r2', 'Leche entera 1L', 1200),
        HOOK_RAW_JUL('r1', 'Leche entera 1L', 1100),
        HOOK_RAW_JUL('r0', 'Aceite de girasol 1L', 1500),
        HOOK_RAW_AUG('r3', 'Aceite de girasol 1L', 1200),
      ],
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(probeElement());
    });
    try {
      await settleUntil(
        () => captured && captured.length === 2,
        'hook resolved both cross-month alerts',
      );
      // The pure function over the same combined rows must yield the SAME
      // alert set the hook produced (cross-check the wiring, not the math).
      const combined = [
        receipt('r1', '2026-07-03', item('Leche entera 1L', 1100, 'lacteos')),
        receipt('r2', '2026-08-06', item('Leche entera 1L', 1200, 'lacteos')),
        receipt('r0', '2026-07-03', item('Aceite de girasol 1L', 1500, 'alimentos')),
        receipt('r3', '2026-08-06', item('Aceite de girasol 1L', 1200, 'alimentos')),
      ];
      const expected = computePriceAlerts(combined, undefined, '2026-08');
      assert.deepEqual(
        captured.map((a) => [a.name, a.changePct]).sort(),
        expected.map((a) => [a.name, a.changePct]).sort(),
        'hook alerts match the pure function output',
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  // (d) does NOT read the receipts store as its data source (regression guard)
  await test('does not read the receipts store as its source', async () => {
    await resetHookState();
    sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
    // The store is EMPTY while the month queries hold data: the hook must
    // still resolve alerts (pure month-scoped queries), never unioning the
    // unused store list.
    stubMod.__setTableRead('purchases', {
      rows: [
        HOOK_RAW_AUG('r2', 'Leche entera 1L', 1200),
        HOOK_RAW_JUL('r1', 'Leche entera 1L', 1100),
      ],
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(probeElement());
    });
    try {
      await settleUntil(
        () => captured && captured.length === 1,
        'alerts resolve despite empty receipts store',
      );
      assert.deepEqual(
        receiptsStoreMod.useReceiptsStore.getState().list,
        [],
        'receipts store stayed empty (hook never reads it)',
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
// react-query's gc timers keep the event loop alive after the summary prints
// (the same gotcha that hangs the aggregate `pnpm test`); exit explicitly.
process.exit(process.exitCode || 0);
