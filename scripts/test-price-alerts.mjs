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

/**
 * Resolve an RN style value the way the runtime does: a Pressable's callback
 * style is invoked at rest, arrays are flattened, false/null entries skipped,
 * and the last object wins.
 */
function flattenStyle(style) {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  const entries = Array.isArray(resolved) ? resolved.flat(Infinity) : [resolved];
  const out = {};
  for (const entry of entries) {
    if (entry && typeof entry === 'object') Object.assign(out, entry);
  }
  return out;
}

/** Collect every string leaf from a react-test-renderer tree (host or JSON). */
function flattenStrings(node, acc = []) {
  if (node == null) return acc;
  if (typeof node === 'string') {
    acc.push(node);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) flattenStrings(child, acc);
    return acc;
  }
  if (node.children) flattenStrings(node.children, acc);
  return acc;
}

function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'expo-localization') {
      // The sign-in graph reaches the device-currency adapter, the sole
      // getLocales() reader on the currency path (precedent:
      // test-i18n-init.mjs). Without this branch node tries to load the
      // real native module.
      request = join(outDir, 'scripts', 'test-stubs', 'expo-localization.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request === 'react-i18next') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-i18next.js');
    } else if (request === 'expo-router') {
      request = join(outDir, 'scripts', 'test-stubs', 'expo-router.js');
    } else if (request === '@/components') {
      request = join(outDir, 'scripts', 'test-stubs', 'components.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

/**
 * Route a few imports of the compiled PriceAlertDetailSection to test doubles
 * while that module is loaded. `Module._load` sees the ORIGINAL request (before
 * the `@/` resolve hook rewrites it) AND the requesting module, so pinning on
 * the parent filename leaves every other consumer on the real implementation.
 * The compiled section caches its imports at load time, so the doubles must be
 * installed for its FIRST load.
 */
function withSectionDoubles(doubles, fn) {
  const originalLoad = Module._load;
  const fixed = new Map([
    ['@tanstack/react-query', { useQuery: doubles.useQuery }],
    [
      '@/features/pro/hooks/useProEntitlement',
      { useProEntitlement: doubles.useProEntitlement },
    ],
    ['@/features/tickets/api', { fetchPurchaseDetail: doubles.fetchPurchaseDetail }],
  ]);
  Module._load = function sectionDoubleLoad(request, parent, isMain) {
    if (
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.endsWith('PriceAlertDetailSection.js')
    ) {
      if (/(?:^|\/)hooks\/usePriceAlerts$/.test(request)) {
        return { usePriceAlerts: doubles.usePriceAlerts };
      }
      const fake = fixed.get(request);
      if (fake) return fake;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Module._load = originalLoad;
    });
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
  const colorsMod = await load('src/theme/colors.js');

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
    // becomes a no-op (do nothing) when receiptId is empty.
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
      "id-less receipt contributes an empty-string candidate; tap is a no-op (Pro with empty receiptId does nothing)",
    );
  });
  await test('#192 regression: same identity, different currencies in same month -> no alert (buckets isolated)', () => {
    const records = [
      { id: 'r-usd', store_name: 'Store', purchase_date: '2026-08-01', items: [item('Leche entera 1L', 1000, 'lacteos')], currency: 'USD' },
      { id: 'r-uyu', store_name: 'Store', purchase_date: '2026-08-15', items: [item('Leche entera 1L', 400, 'lacteos')], currency: 'UYU' },
      { id: 'r-prev', store_name: 'Store', purchase_date: '2026-07-10', items: [item('Leche entera 1L', 1000, 'lacteos')], currency: 'USD' },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 0, 'different currencies must not cross-average');
  });

  await test('viewer fallback: null currency merges into the viewer bucket; isolated without a viewer', () => {
    // All four rows are the same identity. With viewer 'USD' the null rows
    // share the USD bucket: July avg (1000+2000)/2 = 1500 → Aug (1100+2200)/2
    // = 1650 (+10%). Without a viewer the null rows are their own bucket:
    // 1000 → 1100, so the alert carries the null bucket's prices, not the
    // merged ones — that is what proves isolation.
    const records = [
      { store_name: 'S', purchase_date: '2026-07-10', items: [item('Leche entera 1L', 1000, 'lacteos')], currency: null },
      { store_name: 'S', purchase_date: '2026-07-11', items: [item('Leche entera 1L', 2000, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-08-10', items: [item('Leche entera 1L', 1100, 'lacteos')], currency: null },
      { store_name: 'S', purchase_date: '2026-08-11', items: [item('Leche entera 1L', 2200, 'lacteos')], currency: 'USD' },
    ];
    const withViewer = alertsMod.computePriceAlerts(records, 0.05, '2026-08', 'USD');
    assert.equal(withViewer.length, 1, 'null rows merge into the viewer bucket');
    assert.equal(withViewer[0].previousPrice, 1500, 'null + USD averaged together');
    assert.equal(withViewer[0].currentPrice, 1650);
    assert.equal(withViewer[0].changePct, 10);

    const noViewer = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(noViewer.length, 1, 'the null-only bucket alerts on its own');
    assert.equal(noViewer[0].previousPrice, 1000, 'no viewer → null rows stay isolated');
    assert.equal(noViewer[0].currentPrice, 1100);
  });

  await test('#192 no-regression: same-currency still alerts identically', () => {
    const records = [
      receipt('r1', '2026-07-10', item('Leche entera 1L', 1000, 'lacteos')),
      receipt('r2', '2026-08-10', item('Leche entera 1L', 1060, 'lacteos')),
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    assert.equal(Math.round(alerts[0].changePct * 10) / 10, 6.0);
  });

  await test('collapses to ONE alert per identity when a product alerts in two currencies', () => {
    // Both units exceed the threshold, but the banner keys by `alert.name`,
    // so emitting two would duplicate React keys. USD +20% beats UYU +8%.
    const records = [
      { store_name: 'S', purchase_date: '2026-07-10', items: [item('Leche entera 1L', 100, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-08-10', items: [item('Leche entera 1L', 120, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-07-18', items: [item('Leche entera 1L', 1000, 'lacteos')], currency: 'UYU' },
      { store_name: 'S', purchase_date: '2026-08-18', items: [item('Leche entera 1L', 1080, 'lacteos')], currency: 'UYU' },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1, 'at most one alert per product identity');
    assert.equal(alerts[0].name, 'Leche entera 1L');
    assert.equal(alerts[0].changePct, 20, 'the larger absolute change wins');
    assert.equal(alerts[0].currentPrice, 120, 'the winner is the USD bucket');
  });

  await test('collapse tie-break: equal |changePct| keeps the lexicographically smaller unit', () => {
    // The larger unit (UYU) is inserted FIRST on purpose: a "keep the first
    // seen" collapse would also keep UYU, so only a real lexicographic
    // tie-break can pass this.
    const records = [
      { store_name: 'S', purchase_date: '2026-07-18', items: [item('Leche entera 1L', 1000, 'lacteos')], currency: 'UYU' },
      { store_name: 'S', purchase_date: '2026-08-18', items: [item('Leche entera 1L', 1100, 'lacteos')], currency: 'UYU' },
      { store_name: 'S', purchase_date: '2026-07-10', items: [item('Leche entera 1L', 100, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-08-10', items: [item('Leche entera 1L', 110, 'lacteos')], currency: 'USD' },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].changePct, 10);
    assert.equal(alerts[0].currentPrice, 110, 'USD < UYU wins the tie');
  });

  await test('a "::" inside a product name never merges two distinct products', () => {
    // "Leche" and "Leche::Promo" normalize to "leche" and "leche::promo". Under
    // a key that is split back with `split('::')` both truncate to "leche" and
    // collapse into one alert — silently dropping a real price increase.
    const records = [
      { store_name: 'S', purchase_date: '2026-07-10', items: [item('Leche', 100, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-08-10', items: [item('Leche', 120, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-07-11', items: [item('Leche::Promo', 100, 'lacteos')], currency: 'USD' },
      { store_name: 'S', purchase_date: '2026-08-11', items: [item('Leche::Promo', 120, 'lacteos')], currency: 'USD' },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    const names = alerts.map((a) => a.name).sort();
    assert.equal(alerts.length, 2, 'two distinct products must produce two alerts');
    assert.deepEqual(names, ['Leche', 'Leche::Promo']);
  });

  console.log('\n[tests] shared price-direction predicate\n');

  await test('isPriceIncrease preserves the >= 0 direction contract', () => {
    assert.equal(alertsMod.isPriceIncrease(9.1), true, 'positive change is UP');
    assert.equal(alertsMod.isPriceIncrease(-8.3), false, 'negative change is DOWN');
    assert.equal(alertsMod.isPriceIncrease(0), true, 'zero stays on the UP branch');
  });

  console.log(
    '\n[tests] inline comparison metadata: two tickets from one (identity, unit) bucket\n',
  );

  await test('both tickets come from the winning source of their OWN month in the same bucket', () => {
    // Two candidates per month with different stores. The latest
    // purchase_date wins IN EACH MONTH; the average still uses every receipt.
    const records = [
      {
        id: 'jul-early',
        store_name: 'Julio Early',
        purchase_date: '2026-07-02',
        items: [item('Leche entera 1L', 1000, 'lacteos')],
        currency: 'UYU',
      },
      {
        id: 'jul-late',
        store_name: 'Julio Tarde',
        purchase_date: '2026-07-25',
        items: [item('Leche entera 1L', 1100, 'lacteos')],
        currency: 'UYU',
      },
      {
        id: 'aug-early',
        store_name: 'Agosto Early',
        purchase_date: '2026-08-03',
        items: [item('Leche entera 1L', 1300, 'lacteos')],
        currency: 'UYU',
      },
      {
        id: 'aug-late',
        store_name: 'Agosto Tarde',
        purchase_date: '2026-08-27',
        items: [item('Leche entera 1L', 1400, 'lacteos')],
        currency: 'UYU',
      },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.equal(alert.receiptId, 'aug-late');
    assert.equal(
      alert.previousReceiptId,
      'jul-late',
      'previous source is the latest receipt in the previous month',
    );
    assert.equal(alert.currentPurchaseDate, '2026-08-27');
    assert.equal(alert.previousPurchaseDate, '2026-07-25');
    assert.equal(alert.currentStoreName, 'Agosto Tarde');
    assert.equal(alert.previousStoreName, 'Julio Tarde');
    assert.equal(alert.unit, 'UYU', 'the bucket unit travels with the alert');
    // CRITICAL: the compared prices are MONTHLY AVERAGES, not the winning
    // source receipt's own unit price (1100 / 1400).
    assert.equal(alert.previousPrice, 1050);
    assert.equal(alert.currentPrice, 1350);
  });

  await test('a same-date tie keeps the lowest id and THAT receipt metadata', () => {
    const records = [
      {
        id: 'jul',
        store_name: 'Tienda Jul',
        purchase_date: '2026-07-10',
        items: [item('Yerba 1kg', 1000, 'alimentos')],
        currency: 'USD',
      },
      {
        id: 'z-aug',
        store_name: 'Z Tienda',
        purchase_date: '2026-08-15',
        items: [item('Yerba 1kg', 1200, 'alimentos')],
        currency: 'USD',
      },
      {
        id: 'a-aug',
        store_name: 'A Tienda',
        purchase_date: '2026-08-15',
        items: [item('Yerba 1kg', 1200, 'alimentos')],
        currency: 'USD',
      },
    ];
    const [alert] = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alert.receiptId, 'a-aug', 'id-ascending tie-break');
    assert.equal(alert.currentPurchaseDate, '2026-08-15');
    assert.equal(alert.currentStoreName, 'A Tienda', 'store follows the winning source');
    assert.equal(alert.previousReceiptId, 'jul');
    assert.equal(alert.previousPurchaseDate, '2026-07-10');
    assert.equal(alert.previousStoreName, 'Tienda Jul');
  });

  await test('collapse by largest |changePct| keeps the winner dates, stores and unit', () => {
    const records = [
      {
        id: 'usd-jul',
        store_name: 'USD Jul Store',
        purchase_date: '2026-07-05',
        items: [item('Café 1kg', 100, 'alimentos')],
        currency: 'USD',
      },
      {
        id: 'usd-aug',
        store_name: 'USD Aug Store',
        purchase_date: '2026-08-06',
        items: [item('Café 1kg', 120, 'alimentos')],
        currency: 'USD',
      },
      {
        id: 'uyu-jul',
        store_name: 'UYU Jul Store',
        purchase_date: '2026-07-07',
        items: [item('Café 1kg', 1000, 'alimentos')],
        currency: 'UYU',
      },
      {
        id: 'uyu-aug',
        store_name: 'UYU Aug Store',
        purchase_date: '2026-08-08',
        items: [item('Café 1kg', 1080, 'alimentos')],
        currency: 'UYU',
      },
    ];
    const alerts = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.equal(alert.changePct, 20, 'USD +20% beats UYU +8%');
    assert.equal(alert.unit, 'USD', 'the winning bucket unit survives the collapse');
    assert.equal(alert.receiptId, 'usd-aug');
    assert.equal(alert.previousReceiptId, 'usd-jul');
    assert.equal(alert.currentPurchaseDate, '2026-08-06');
    assert.equal(alert.previousPurchaseDate, '2026-07-05');
    assert.equal(alert.currentStoreName, 'USD Aug Store');
    assert.equal(alert.previousStoreName, 'USD Jul Store');
  });

  await test('collapse tie-break keeps the smaller unit and THAT bucket metadata', () => {
    const records = [
      // UYU is inserted FIRST on purpose: keep-the-first would fail.
      {
        id: 'uyu-jul',
        store_name: 'UYU Jul Store',
        purchase_date: '2026-07-18',
        items: [item('Café 1kg', 1000, 'alimentos')],
        currency: 'UYU',
      },
      {
        id: 'uyu-aug',
        store_name: 'UYU Aug Store',
        purchase_date: '2026-08-18',
        items: [item('Café 1kg', 1100, 'alimentos')],
        currency: 'UYU',
      },
      {
        id: 'usd-jul',
        store_name: 'USD Jul Store',
        purchase_date: '2026-07-10',
        items: [item('Café 1kg', 100, 'alimentos')],
        currency: 'USD',
      },
      {
        id: 'usd-aug',
        store_name: 'USD Aug Store',
        purchase_date: '2026-08-10',
        items: [item('Café 1kg', 110, 'alimentos')],
        currency: 'USD',
      },
    ];
    const [alert] = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alert.changePct, 10);
    assert.equal(alert.unit, 'USD', 'USD < UYU wins the tie');
    assert.equal(alert.receiptId, 'usd-aug');
    assert.equal(alert.previousReceiptId, 'usd-jul');
    assert.equal(alert.currentPurchaseDate, '2026-08-10');
    assert.equal(alert.previousPurchaseDate, '2026-07-10');
    assert.equal(alert.currentStoreName, 'USD Aug Store');
    assert.equal(alert.previousStoreName, 'USD Jul Store');
  });

  await test('missing source metadata defaults to empty strings (no crash)', () => {
    const records = [
      {
        // No id, no store_name, no currency: those three fall back to ''.
        // purchase_date IS present (it drives the month bucket), so the two
        // dates are carried as-is, not blanked.
        purchase_date: '2026-07-03',
        items: [item('Leche entera 1L', 1000, 'lacteos')],
      },
      {
        purchase_date: '2026-08-06',
        items: [item('Leche entera 1L', 1200, 'lacteos')],
      },
    ];
    const [alert] = alertsMod.computePriceAlerts(records, 0.05, '2026-08');
    assert.equal(alert.receiptId, '');
    assert.equal(alert.previousReceiptId, '');
    assert.equal(alert.currentStoreName, '');
    assert.equal(alert.previousStoreName, '');
    assert.equal(alert.unit, '');
    assert.equal(alert.currentPurchaseDate, '2026-08-06');
    assert.equal(alert.previousPurchaseDate, '2026-07-03');
  });

  console.log('\n[tests] item price deltas vs the previous month\n');

  await test('item delta: same identity + unit across months', () => {
    const prev = [
      { ...receipt('p1', '2026-07-03', item('Leche entera 1L', 100, 'lacteos')), currency: 'USD' },
      { ...receipt('p2', '2026-07-10', item('Leche entera 1L', 120, 'lacteos')), currency: 'USD' },
    ];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 132 }],
      prev,
      'USD',
    );
    assert.equal(deltas.size, 1);
    assert.equal(deltas.get('leche entera 1l'), 20);
  });

  await test('item delta: DOWN is negative', () => {
    const prev = [
      { ...receipt('p1', '2026-07-03', item('Leche entera 1L', 110, 'lacteos')), currency: 'USD' },
    ];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 100 }],
      prev,
      'USD',
    );
    assert.equal(deltas.size, 1);
    assert.equal(deltas.get('leche entera 1l'), -9.1);
  });

  await test('item delta: exactly 5% is NOT a delta', () => {
    const prev = [
      { ...receipt('p1', '2026-07-03', item('Leche entera 1L', 100, 'lacteos')), currency: 'USD' },
    ];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 105 }],
      prev,
      'USD',
    );
    assert.equal(deltas.size, 0);
  });

  await test('item delta: a different currency in the previous month is ignored', () => {
    const prev = [
      { ...receipt('p1', '2026-07-03', item('Leche entera 1L', 1000, 'lacteos')), currency: 'UYU' },
    ];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 132 }],
      prev,
      'USD',
    );
    assert.equal(deltas.size, 0);
  });

  await test('item delta: a prev row WITHOUT currency is attributed to the compared unit', () => {
    const prev = [receipt('p1', '2026-07-03', item('Leche entera 1L', 100, 'lacteos'))];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 132 }],
      prev,
      'USD',
    );
    assert.equal(deltas.size, 1);
    assert.equal(deltas.get('leche entera 1l'), 32);
  });

  await test('item delta: identity normalization collapses equivalent spellings', () => {
    const prev = [
      receipt('p1', '2026-07-03', item('Leche 1 L', 100, 'lacteos')),
      receipt('p2', '2026-07-10', item('Leche 2L', 200, 'lacteos')),
    ];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche 1L', unit_price: 120 }],
      prev,
      'USD',
    );
    assert.equal(deltas.size, 1);
    assert.equal(deltas.get('leche 1l'), 20, 'spaced size collapses onto the compact one');
    assert.equal(deltas.get('leche 2l'), undefined, 'a different package size must NOT match');
  });

  await test('item delta: no previous data → no entry', () => {
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 132 }],
      [],
      'USD',
    );
    assert.equal(deltas.size, 0);
  });

  await test('item delta: threshold semantics match alerts exactly', () => {
    const prev = [receipt('p1', '2026-07-03', item('Leche entera 1L', 94, 'lacteos'))];
    const deltas = alertsMod.computeItemPriceDeltas(
      [{ name: 'Leche entera 1L', unit_price: 100 }],
      prev,
      'USD',
    );
    assert.equal(deltas.get('leche entera 1l'), 6.4);
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

  await test('usePriceAlerts threads the hydrated viewer currency into computePriceAlerts (source pin)', async () => {
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const root = pathMod.join(process.cwd(), 'src', 'features', 'analytics', 'hooks', 'usePriceAlerts.ts');
    const src = await fs.readFile(root, 'utf8');
    assert.ok(src.includes('useSettingsStore'), 'must read viewer currency from settings store');
    assert.ok(
      /currencyHydrated\s*\?\s*currency\s*:\s*''/.test(src),
      "must gate the viewer on hydration (currencyHydrated ? currency : '')",
    );
    assert.ok(
      /computePriceAlerts\([\s\S]*?\bcurrencyHydrated\s*\?\s*currency\s*:\s*''\s*,?\s*\)/.test(src),
      'must pass the hydrated currency as the 4th argument',
    );
    // Dropping either selector from the deps would freeze the first memoized
    // result forever, and no behavior test would notice.
    assert.ok(
      /\[[^\]]*\bcurrency\b[^\]]*\bcurrencyHydrated\b[^\]]*\]/.test(src),
      'currency and currencyHydrated must both be in the useMemo deps',
    );
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

  await test('PriceAlertBanner routes all three tap cases with receipt context (source pin)', async () => {
    const fs = await import('node:fs/promises');
    const srcPath = join(
      root,
      'src',
      'features',
      'analytics',
      'components',
      'PriceAlertBanner.tsx',
    );
    const src = await fs.readFile(srcPath, 'utf8');
    const m = src.match(/const handlePress\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)^\s*  \};/m);
    assert.ok(m, 'handlePress function must exist in PriceAlertBanner.tsx');
    const body = m[1];
    // Case 1: free users still go straight to the paywall, only inside the guard.
    assert.ok(
      /if\s*\(\s*!isPro\s*\)\s*\{\s*router\.push\(['"]\/pro['"]\)/.test(body),
      'must push /pro only inside `if (!isPro)`',
    );
    // Case 2: Pro + id opens the receipt with the four alert-context params.
    assert.ok(
      /if\s*\(\s*alert\.receiptId\s*\)/.test(body),
      'the receipt route must be guarded by `if (alert.receiptId)`',
    );
    assert.ok(
      /new\s+URLSearchParams\(/.test(body),
      'query params must be assembled with URLSearchParams',
    );
    for (const param of ['month', 'name', 'unit', 'previousReceiptId']) {
      assert.ok(
        new RegExp(`\\b${param}\\s*:`).test(body),
        `must carry the ${param} navigation-context param`,
      );
    }
    assert.ok(
      /encodeURIComponent\(/.test(body),
      'the typed route href must be URL-encoded',
    );
    assert.ok(
      /router\.push\([^;]*?\bas never\s*,?\s*\)/.test(body),
      'the typed route href must be cast `as never`',
    );
    assert.ok(
      /monthKey\s*\?\?\s*currentMonthKey\(\)/.test(src),
      'month param uses the monthKey prop with a currentMonthKey() fallback',
    );
    assert.ok(
      /monthKey\?: string/.test(src),
      'PriceAlertBannerProps must expose optional monthKey',
    );
    assert.ok(
      /import\s*\{[\s\S]*?currentMonthKey[\s\S]*?\}\s*from\s*['"]@\/features\/home\/hooks\/useHomeFeed['"]/.test(
        src,
      ),
      'currentMonthKey must come from the useHomeFeed hook barrel',
    );
    // Case 3: Pro without an id is a no-op. The #191 defect was an `else`
    // falling back to the paywall — forbid it.
    assert.ok(!/\belse\b/.test(body), 'handler must have no else branch (no paywall fallback)');
    // The no-op state must not advertise an action that never fires.
    assert.ok(
      /const canAct\s*=\s*!isPro\s*\|\|\s*!!alert\.receiptId/.test(src),
      'no-op state must be derived as canAct = !isPro || !!alert.receiptId',
    );
    assert.ok(
      /disabled=\{!canAct\}/.test(src),
      'the dead-action state must be disabled (no announced no-op)',
    );
    assert.ok(
      /accessibilityRole=\{canAct \? 'button' : undefined\}/.test(src),
      'the inert state must drop accessibilityRole (no announced dead action)',
    );
  });

  const renderBanner = async (changePct, monthKey) => {
    const bannerMod = await load(
      'src/features/analytics/components/PriceAlertBanner.js',
    );
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(bannerMod.PriceAlertBanner, {
          alert: {
            name: 'Leche entera 1L',
            receiptId: 'r1',
            changePct,
            currentPrice: 1200,
            previousPrice: 1100,
            category: 'lacteos',
            previousReceiptId: 'r0',
            currentPurchaseDate: '2026-08-06',
            previousPurchaseDate: '2026-07-03',
            currentStoreName: 'Store',
            previousStoreName: 'Store',
            unit: 'UYU',
          },
          isPro: true,
          monthKey,
        }),
      );
    });
    return { renderer, unmount: () => act(async () => renderer.unmount()) };
  };

  /**
   * The themed View injects `theme.background` ahead of caller styles, so the
   * three inner text wrappers must resolve to a transparent background or they
   * paint an opaque rectangle over the banner tint. `isPro: true` hides the
   * Pro pill, leaving exactly three Views in render order: wrapTextIcon,
   * alertTitleRow, then alertTextWrap.
   */
  const assertTransparentTextWrappers = (renderer) => {
    const views = renderer.root.findAllByType('View');
    assert.equal(views.length, 3, 'three inner text wrapper host Views must render');
    const [wrapTextIcon, alertTitleRow, alertTextWrap] = views;
    assert.equal(
      flattenStyle(wrapTextIcon.props.style).backgroundColor,
      'transparent',
      'wrapTextIcon must override the themed View background',
    );
    assert.equal(
      flattenStyle(alertTitleRow.props.style).backgroundColor,
      'transparent',
      'alertTitleRow must override the themed View background',
    );
    assert.equal(
      flattenStyle(alertTextWrap.props.style).backgroundColor,
      'transparent',
      'alertTextWrap must override the themed View background',
    );
  };

  await test('PriceAlertBanner renders the red UP variant for an increase', async () => {
    const { renderer, unmount } = await renderBanner(8);
    try {
      const bannerStyle = flattenStyle(
        renderer.root.findByType('Pressable').props.style,
      );
      assert.equal(bannerStyle.backgroundColor, '#f9e9e9', 'UP keeps the red-ish background');
      assert.equal(bannerStyle.borderColor, '#fbbbbb', 'UP keeps the red-ish border');

      const icon = renderer.root.findByType('Icon');
      assert.equal(icon.props.color, colorsMod.colors.danger, 'UP icon stays danger');

      const title = renderer.root.findAllByType('Text').find((node) =>
        flattenStrings(node).some((s) => s.includes('analytics:priceAlertTitle')),
      );
      assert.ok(title, 'title text must render');
      assert.equal(
        flattenStyle(title.props.style).color,
        colorsMod.colors.danger,
        'UP title stays danger',
      );

      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(text.includes('analytics:priceAlertUp'), 'UP label');
      assert.ok(!text.includes('analytics:priceAlertDown'), 'no DOWN label on an increase');

      assertTransparentTextWrappers(renderer);
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertBanner renders the green DOWN variant for a drop', async () => {
    const { renderer, unmount } = await renderBanner(-8);
    try {
      const bannerStyle = flattenStyle(
        renderer.root.findByType('Pressable').props.style,
      );
      assert.equal(
        bannerStyle.backgroundColor,
        '#edf7f0',
        'DOWN background is the softened pale green',
      );
      assert.equal(
        bannerStyle.borderColor,
        '#c8e6d2',
        'DOWN border is the softened pale green',
      );

      const icon = renderer.root.findByType('Icon');
      assert.equal(icon.props.color, colorsMod.colors.primaryDark, 'DOWN icon is dark green');

      const title = renderer.root.findAllByType('Text').find((node) =>
        flattenStrings(node).some((s) => s.includes('analytics:priceAlertTitle')),
      );
      assert.ok(title, 'title text must render');
      assert.equal(
        flattenStyle(title.props.style).color,
        colorsMod.colors.primaryDark,
        'DOWN title is dark green',
      );

      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(text.includes('analytics:priceAlertDown'), 'DOWN label');
      assert.ok(!text.includes('analytics:priceAlertUp'), 'no UP label on a drop');

      assertTransparentTextWrappers(renderer);
    } finally {
      await unmount();
    }
  });

  // ── PART 3: executed PriceAlertComparison (PRO inline comparison) ───────
  // No source-regex pins: render the real component through
  // react-test-renderer and assert what a user actually sees.
  console.log('\n[tests] PriceAlertComparison executed render\n');

  const formatMod = await load('src/lib/format.js');

  const comparisonAlert = (overrides = {}) => ({
    name: 'Leche entera 1L',
    category: 'lacteos',
    receiptId: 'aug-source',
    previousReceiptId: 'jul-source',
    currentPurchaseDate: '2025-08-06',
    previousPurchaseDate: '2025-07-03',
    currentStoreName: 'Supermercado Sur',
    previousStoreName: 'Tienda Norte',
    currentPrice: 1200,
    previousPrice: 1100,
    changePct: 9.1,
    unit: 'UYU',
    ...overrides,
  });

  const renderComparison = async (alert, locale = 'en') => {
    const comparisonMod = await load(
      'src/features/analytics/components/PriceAlertComparison.js',
    );
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(comparisonMod.PriceAlertComparison, {
          alert,
          locale,
        }),
      );
    });
    return { renderer, unmount: () => act(async () => renderer.unmount()) };
  };

  /** Find the host Text that shows the delta token and assert its color. */
  const assertDeltaColor = (renderer, token, expectedColor) => {
    const deltaText = renderer.root.findAllByType('Text').find((node) =>
      flattenStrings(node).some((s) => s.includes(token)),
    );
    assert.ok(deltaText, `delta text "${token}" must render`);
    assert.equal(
      flattenStyle(deltaText.props.style).color,
      expectedColor,
      'delta color follows the direction',
    );
  };

  await test('PriceAlertComparison shows both monthly averages and a red UP delta', async () => {
    const { renderer, unmount } = await renderComparison(comparisonAlert());
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(text.includes('analytics:priceAlertCompareTitle'), 'title');
      assert.ok(
        text.includes('MES ANTERIOR'),
        'PREVIOUS MONTH side label (prefixed i18n key resolves)',
      );
      assert.ok(
        text.includes('ESTE MES'),
        'THIS MONTH side label (prefixed i18n key resolves)',
      );
      assert.ok(
        text.includes(formatMod.formatDate('en', '2025-07-03')),
        'previous formatted date',
      );
      assert.ok(
        text.includes(formatMod.formatDate('en', '2025-08-06')),
        'current formatted date',
      );
      assert.ok(text.includes('Tienda Norte'), 'previous store name');
      assert.ok(text.includes('Supermercado Sur'), 'current store name');
      assert.ok(
        text.includes(formatMod.formatCurrency(1100, 'UYU')),
        'previous formatted monthly-average price',
      );
      assert.ok(
        text.includes(formatMod.formatCurrency(1200, 'UYU')),
        'current formatted monthly-average price',
      );
      assert.equal(
        text.split('analytics:priceAlertMonthlyAverage').length - 1,
        2,
        'BOTH sides are explicitly labeled as a monthly average',
      );
      assert.ok(
        text.includes('analytics:priceAlertComparedNote'),
        'the compared-note copy is shown',
      );
      assert.ok(text.includes('+9.1%'), 'signed UP delta');
      assertDeltaColor(renderer, '+9.1%', colorsMod.colors.danger);
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertComparison shows both monthly averages and a green DOWN delta', async () => {
    const alert = comparisonAlert({
      previousPrice: 1200,
      currentPrice: 1100,
      changePct: -8.3,
      previousPurchaseDate: '2025-07-11',
      currentPurchaseDate: '2025-08-19',
      previousStoreName: 'Tienda Vieja',
      currentStoreName: 'Mercado Nuevo',
      unit: 'USD',
    });
    const { renderer, unmount } = await renderComparison(alert, 'es-419');
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(
        text.includes(formatMod.formatDate('es-419', '2025-07-11')),
        'previous formatted date in the requested locale',
      );
      assert.ok(
        text.includes(formatMod.formatDate('es-419', '2025-08-19')),
        'current formatted date in the requested locale',
      );
      assert.ok(text.includes('Tienda Vieja'), 'previous store name');
      assert.ok(text.includes('Mercado Nuevo'), 'current store name');
      assert.ok(
        text.includes(formatMod.formatCurrency(1200, 'USD')),
        'previous formatted monthly-average price',
      );
      assert.ok(
        text.includes(formatMod.formatCurrency(1100, 'USD')),
        'current formatted monthly-average price',
      );
      assert.equal(
        text.split('analytics:priceAlertMonthlyAverage').length - 1,
        2,
        'BOTH sides are explicitly labeled as a monthly average',
      );
      assert.ok(text.includes('-8.3%'), 'signed DOWN delta');
      assertDeltaColor(renderer, '-8.3%', colorsMod.colors.primaryDark);
      assert.ok(
        !text.includes('+8.3%'),
        'a drop must not be presented as an increase',
      );
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertComparison uses placeholders for blank source metadata', async () => {
    const alert = comparisonAlert({
      unit: '',
      previousPurchaseDate: '',
      currentPurchaseDate: '',
      previousStoreName: '',
      currentStoreName: '',
    });
    const { renderer, unmount } = await renderComparison(alert);
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.equal(
        text.split('—').length - 1,
        6,
        'both dates, both stores and both prices show a placeholder',
      );
      assert.ok(
        !text.includes(formatMod.formatCurrency(1100, '')),
        'a symbol-less amount is never shown as a previous price',
      );
      assert.ok(
        !text.includes(formatMod.formatCurrency(1200, '')),
        'a symbol-less amount is never shown as a current price',
      );
      assert.ok(
        text.includes('analytics:priceAlertCompareTitle'),
        'the panel still renders with partial source identity',
      );
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertComparison keeps real prices when only date/store are blank', async () => {
    const alert = comparisonAlert({
      previousPurchaseDate: '',
      currentPurchaseDate: '',
      previousStoreName: '',
      currentStoreName: '',
      unit: 'UYU',
    });
    const { renderer, unmount } = await renderComparison(alert);
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.equal(
        text.split('—').length - 1,
        4,
        'only the four blank date/store fields need placeholders',
      );
      assert.ok(
        text.includes(formatMod.formatCurrency(1100, 'UYU')),
        'a known unit keeps the previous monthly-average price',
      );
      assert.ok(
        text.includes(formatMod.formatCurrency(1200, 'UYU')),
        'a known unit keeps the current monthly-average price',
      );
    } finally {
      await unmount();
    }
  });

  console.log('\n[tests] PriceAlertGroup executed render (banner-only composition)\n');

  const renderGroup = async (isPro) => {
    const groupMod = await load(
      'src/features/analytics/components/PriceAlertGroup.js',
    );
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(groupMod.PriceAlertGroup, {
          alert: comparisonAlert(),
          isPro,
          locale: 'en',
          monthKey: '2026-08',
        }),
      );
    });
    return { renderer, unmount: () => act(async () => renderer.unmount()) };
  };

  await test('PriceAlertGroup renders the banner alone for Pro (no inline comparison)', async () => {
    const { renderer, unmount } = await renderGroup(true);
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.equal(
        renderer.root.findAllByType('Pressable').length,
        1,
        'exactly one press surface (the banner) is rendered',
      );
      assert.ok(text.includes('analytics:priceAlertTitle'), 'the banner is present');
      assert.ok(
        !text.includes('analytics:priceAlertCompareTitle'),
        'the comparison must not render inline for Pro',
      );
      assert.ok(
        !text.includes('analytics:proPill'),
        'the upsell pill is not shown to a Pro user',
      );
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertGroup renders the locked banner alone for free users', async () => {
    const { renderer, unmount } = await renderGroup(false);
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.equal(
        renderer.root.findAllByType('Pressable').length,
        1,
        'only the banner press surface remains',
      );
      assert.ok(text.includes('analytics:priceAlertTitle'), 'the banner is still visible');
      assert.ok(text.includes('analytics:proPill'), 'the upsell pill is still visible');
      assert.ok(
        !text.includes('analytics:priceAlertCompareTitle'),
        'the comparison is NOT shown inline to a free user',
      );
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertGroup forwards monthKey and drops the comparison import (source pin)', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      join(
        root,
        'src',
        'features',
        'analytics',
        'components',
        'PriceAlertGroup.tsx',
      ),
      'utf8',
    );
    assert.ok(
      !/PriceAlertComparison/.test(src),
      'the group must not import or render PriceAlertComparison for any user',
    );
    assert.ok(/monthKey\?: string/.test(src), 'the group must accept optional monthKey');
    assert.ok(
      /monthKey=\{monthKey\}/.test(src),
      'the group must forward monthKey to the banner',
    );
  });

  console.log('\n[tests] PriceAlertReferenceCard executed render\n');

  const referenceMod = await load(
    'src/features/analytics/components/PriceAlertReferenceCard.js',
  );

  const referenceReceipt = (overrides = {}) => ({
    id: 'jul-source',
    store_name: 'Tienda Norte',
    purchase_date: '2025-07-03',
    total: 8450,
    currency: 'UYU',
    is_manual: false,
    ...overrides,
  });

  const renderReference = async (props = {}) => {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(referenceMod.PriceAlertReferenceCard, {
          label: 'analytics:priceAlertPreviousMonth',
          hasId: true,
          isLoading: false,
          currency: 'USD',
          receipt: referenceReceipt(),
          ...props,
        }),
      );
    });
    return { renderer, unmount: () => act(async () => renderer.unmount()) };
  };

  await test('PriceAlertReferenceCard omits manual receipts entirely', async () => {
    const { renderer, unmount } = await renderReference({
      receipt: referenceReceipt({ is_manual: true }),
    });
    try {
      assert.equal(renderer.toJSON(), null, 'a manual ticket must render no reference row');
      assert.equal(
        renderer.root.findAllByType('ReceiptRow').length,
        0,
        'no ReceiptRow may be mounted for a manual ticket',
      );
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertReferenceCard shows unavailable copy for a missing id, never a spinner', async () => {
    const { renderer, unmount } = await renderReference({
      hasId: false,
      receipt: undefined,
      // Even a pending query must not spin when there is no id to open.
      isLoading: true,
    });
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(text.includes('Ticket no disponible'), 'unavailable copy is visible');
      assert.equal(renderer.root.findAllByType('Spinner').length, 0, 'no spinner for a missing id');
      assert.equal(renderer.root.findAllByType('ReceiptRow').length, 0, 'no row for a missing id');
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertReferenceCard passes exact ReceiptRow props for a real previous receipt', async () => {
    const onPress = () => {};
    const { renderer, unmount } = await renderReference({ onPress });
    try {
      const row = renderer.root.findByType('ReceiptRow');
      assert.equal(row.props.name, 'Tienda Norte', 'store name from the receipt');
      assert.equal(row.props.date, '2025-07-03', 'purchase date from the receipt');
      assert.equal(row.props.amount, 8450, 'single receipt total, not a monthly average');
      assert.equal(row.props.currency, 'UYU', 'receipt currency wins');
      assert.equal(row.props.iconName, 'doc.text', 'document icon');
      assert.equal(row.props.imageUrl, undefined, 'no async photo URL is requested');
      assert.equal(row.props.onPress, onPress, 'the previous row navigates');
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(
        text.includes('analytics:priceAlertPreviousMonth'),
        'the row is labeled as the previous month',
      );
      assert.ok(
        !text.includes('analytics:priceAlertReferenceMissing'),
        'the missing copy is not shown for a ready receipt',
      );
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertReferenceCard falls back to the viewer unit and omits onPress on the current row', async () => {
    const { renderer, unmount } = await renderReference({
      receipt: referenceReceipt({ store_name: null, currency: null }),
    });
    try {
      const row = renderer.root.findByType('ReceiptRow');
      assert.equal(row.props.name, '—', 'a blank store name shows the placeholder');
      assert.equal(row.props.currency, 'USD', 'viewer-unit fallback for a legacy receipt');
      assert.equal(row.props.onPress, undefined, 'the current row is read-only');
    } finally {
      await unmount();
    }
  });

  await test('PriceAlertReferenceCard spins only while a real-id query is in flight', async () => {
    const { renderer, unmount } = await renderReference({
      receipt: undefined,
      isLoading: true,
    });
    try {
      assert.equal(renderer.root.findAllByType('Spinner').length, 1, 'compact spinner while loading');
      assert.equal(renderer.root.findAllByType('ReceiptRow').length, 0, 'no row before data arrives');
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(!text.includes('Ticket no disponible'), 'loading is not the missing state');
    } finally {
      await unmount();
    }
  });

  // ── PART 4: executed tap routing + PriceAlertDetailSection ────────────
  // The section is rendered with doubles for usePriceAlerts,
  // useProEntitlement and useQuery (the previous-receipt read), so the tests
  // exercise the REAL component tree instead of source regexes.
  console.log('\n[tests] executed banner tap + PriceAlertDetailSection\n');

  const componentsMod = await load('scripts/test-stubs/components.js');
  const routerStub = await load('scripts/test-stubs/expo-router.js');
  const settingsStoreMod = await load('src/stores/use-settings-store.js');
  const monthKeysMod = await load('src/features/home/month-keys.js');

  await test('PriceAlertBanner Pro tap routes to the receipt with decoded alert context', async () => {
    routerStub.__resetRouterStub();
    const { renderer, unmount } = await renderBanner(8, '2026-08');
    try {
      const pressable = renderer.root.findByType(componentsMod.Pressable);
      assert.equal(
        typeof pressable.props.onPress,
        'function',
        'the banner exposes a real onPress',
      );
      await act(async () => {
        pressable.props.onPress();
      });
      const nav = routerStub.__lastNav();
      assert.ok(
        nav && nav.startsWith('push:/receipts/'),
        `expected a receipt push, got ${nav}`,
      );
      const [href, query = ''] = nav.slice('push:'.length).split('?');
      assert.equal(
        decodeURIComponent(href.split('/').pop()),
        'r1',
        'the path segment is the alert receipt id',
      );
      const params = new URLSearchParams(query);
      assert.equal(params.get('month'), '2026-08', 'month context');
      assert.equal(params.get('name'), 'Leche entera 1L', 'name context');
      assert.equal(params.get('unit'), 'UYU', 'unit context');
      assert.equal(params.get('previousReceiptId'), 'r0', 'previous id context');
    } finally {
      await unmount();
    }
  });

  const sectionState = {
    alerts: [],
    isPro: true,
    proLoading: false,
    previousQuery: {
      isLoading: false,
      isError: false,
      data: undefined,
      refetch: () => {},
    },
    calls: { hooks: [], queries: [] },
  };

  // Stable doubles: the section caches its imports at module load, so the
  // state above changes between renders while the function identities stay put.
  const sectionMod = await withSectionDoubles(
    {
      usePriceAlerts: (...args) => {
        sectionState.calls.hooks.push(args);
        return sectionState.alerts;
      },
      useProEntitlement: () => ({
        isPro: sectionState.isPro,
        isLoading: sectionState.proLoading,
        refresh: async () => {},
        trialEndsAt: null,
        everPaid: false,
      }),
      useQuery: (options) => {
        sectionState.calls.queries.push(options);
        return sectionState.previousQuery;
      },
      fetchPurchaseDetail: async () => {
        throw new Error('queryFn must not run under a stubbed useQuery');
      },
    },
    () => load('src/features/analytics/components/PriceAlertDetailSection.js'),
  );

  const sectionAlert = (overrides = {}) => ({
    name: 'Leche entera 1L',
    category: 'lacteos',
    receiptId: 'aug-source',
    previousReceiptId: 'jul-source',
    currentPurchaseDate: '2025-08-06',
    previousPurchaseDate: '2025-07-03',
    currentStoreName: 'Supermercado Sur',
    previousStoreName: 'Tienda Norte',
    currentPrice: 1200,
    previousPrice: 1100,
    changePct: 9.1,
    unit: 'UYU',
    ...overrides,
  });

  const sectionProps = (overrides = {}) => ({
    month: '2026-08',
    name: 'Leche entera 1L',
    unit: 'UYU',
    previousReceiptId: 'jul-source',
    currentReceipt: {
      id: 'aug-source',
      store_name: 'Supermercado Sur',
      purchase_date: '2025-08-06',
      total: 1200,
      currency: 'UYU',
      is_manual: false,
    },
    locale: 'en',
    ...overrides,
  });

  const renderSection = async (overrides = {}) => {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          sectionMod.PriceAlertDetailSection,
          sectionProps(overrides),
        ),
      );
    });
    return { renderer, unmount: () => act(async () => renderer.unmount()) };
  };

  const resetSectionState = () => {
    sessionStoreMod.useSessionStore.setState({ session: FAKE_SESSION });
    settingsStoreMod.useSettingsStore.setState({ currency: 'USD' });
    routerStub.__resetRouterStub();
    sectionState.isPro = true;
    sectionState.proLoading = false;
    sectionState.alerts = [sectionAlert()];
    sectionState.previousQuery = {
      isLoading: false,
      isError: false,
      data: undefined,
      refetch: () => {},
    };
    sectionState.calls = { hooks: [], queries: [] };
  };

  await test('section re-selects the exact five-field alert and rejects same-name decoys', async () => {
    resetSectionState();
    sectionState.alerts = [
      sectionAlert({
        unit: 'USD',
        previousReceiptId: 'decoy-prev',
        currentPrice: 9999,
        previousPrice: 8888,
        changePct: 12.5,
      }),
      sectionAlert(),
      sectionAlert({
        receiptId: 'other-source',
        unit: 'EUR',
        previousReceiptId: 'other-prev',
        currentPrice: 7777,
        changePct: 15,
      }),
    ];
    const { renderer, unmount } = await renderSection();
    try {
      assert.deepEqual(
        sectionState.calls.hooks,
        [['2026-08', true]],
        'the validated month and resolved Pro flag gate usePriceAlerts',
      );
      assert.equal(sectionState.calls.queries.length, 1, 'one previous query');
      assert.equal(sectionState.calls.queries[0].enabled, true, 'Pro + valid id enables it');
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(
        text.includes(formatMod.formatCurrency(1200, 'UYU')),
        'the matching alert current price is shown',
      );
      assert.ok(
        text.includes(formatMod.formatCurrency(1100, 'UYU')),
        'the matching alert previous price is shown',
      );
      assert.ok(
        !text.includes(formatMod.formatCurrency(9999, 'USD')),
        'same name but different unit/prevId is rejected',
      );
      assert.ok(
        !text.includes(formatMod.formatCurrency(7777, 'EUR')),
        'same name but different receiptId is rejected',
      );
    } finally {
      await unmount();
    }
  });

  await test('section renders nothing for a free user and never replaces the route', async () => {
    resetSectionState();
    sectionState.isPro = false;
    const { renderer, unmount } = await renderSection();
    try {
      assert.equal(renderer.toJSON(), null, 'free users do not see the Pro block');
      assert.equal(routerStub.__lastNav(), null, 'no router.replace on a receipt deep link');
      assert.deepEqual(
        sectionState.calls.hooks,
        [['2026-08', false]],
        'the alerts hook is disabled for free users',
      );
      assert.equal(sectionState.calls.queries[0].enabled, false, 'no previous query');
    } finally {
      await unmount();
    }
  });

  await test('section enables the previous query only for Pro + valid month + previousReceiptId', async () => {
    resetSectionState();
    let view = await renderSection({ previousReceiptId: undefined });
    assert.equal(sectionState.calls.queries[0].enabled, false, 'no previous id');
    await view.unmount();

    sectionState.calls = { hooks: [], queries: [] };
    view = await renderSection({ month: 'not-a-month' });
    assert.deepEqual(
      sectionState.calls.hooks,
      [[monthKeysMod.currentMonthKey(), false]],
      'an invalid month falls back to a safe month and disables the hook',
    );
    assert.equal(sectionState.calls.queries[0].enabled, false, 'invalid month disables it');
    await view.unmount();

    sectionState.calls = { hooks: [], queries: [] };
    view = await renderSection();
    assert.equal(sectionState.calls.queries[0].enabled, true, 'all three gates allow it');
    await view.unmount();
  });

  await test('section omits manual rows and fills an empty bucket with viewer currency', async () => {
    resetSectionState();
    settingsStoreMod.useSettingsStore.setState({ currency: 'UYU' });
    sectionState.alerts = [sectionAlert({ unit: '' })];
    sectionState.previousQuery = {
      isLoading: false,
      isError: false,
      data: {
        id: 'jul-source',
        store_name: 'Tienda Norte',
        purchase_date: '2025-07-03',
        total: 1100,
        currency: null,
        is_manual: true,
      },
      refetch: () => {},
    };
    let view = await renderSection({ unit: '' });
    try {
      const rows = view.renderer.root.findAllByType('ReceiptRow');
      assert.equal(rows.length, 1, 'the manual previous receipt is omitted');
      assert.equal(rows[0].props.currency, 'UYU', 'viewer currency fills the empty bucket');
    } finally {
      await view.unmount();
    }

    sectionState.previousQuery = {
      ...sectionState.previousQuery,
      data: { ...sectionState.previousQuery.data, is_manual: false },
    };
    view = await renderSection({ unit: '' });
    try {
      const rows = view.renderer.root.findAllByType('ReceiptRow');
      assert.equal(rows.length, 2, 'both real rows render');
      assert.deepEqual(
        rows.map((row) => row.props.currency),
        ['UYU', 'UYU'],
        'the same viewer fallback reaches both rows',
      );
      const text = flattenStrings(view.renderer.toJSON()).join('\n');
      assert.equal(
        text.split('Total de un ticket').length - 1,
        2,
        'each ready row carries the single-total caption',
      );
    } finally {
      await view.unmount();
    }
  });

  await test('section shows unavailable copy and a working retry when the previous query errors', async () => {
    resetSectionState();
    let refetches = 0;
    sectionState.previousQuery = {
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: () => {
        refetches += 1;
      },
    };
    const { renderer, unmount } = await renderSection();
    try {
      const text = flattenStrings(renderer.toJSON()).join('\n');
      assert.ok(text.includes('Ticket no disponible'), 'unavailable copy is shown');
      assert.ok(text.includes('Reintentar'), 'the existing common:retry label is used');
      const retry = renderer.root
        .findAllByType(componentsMod.Pressable)
        .find((node) => flattenStrings(node).some((s) => s.includes('Reintentar')));
      assert.ok(retry, 'a retry button is mounted');
      await act(async () => {
        retry.props.onPress();
      });
      assert.equal(refetches, 1, 'retry refetches the previous receipt query');
    } finally {
      await unmount();
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
