#!/usr/bin/env node
/**
 * Node harness for the receipts store (`src/stores/use-receipts-store.ts`),
 * the zustand store backing the scan flow (draft + scan state) and Home's
 * receipt list. This covers the "component-level" logic the API harnesses
 * cannot: the store actions the review screen and the detail screen call.
 *
 * The store is exercised WITHOUT React: zustand v5's root export runs as a
 * plain vanilla store in node (`create` / `createStore` work without any
 * React runtime — verified against the installed version), and the module
 * is a singleton, so the harness drives it through `getState()` like the
 * app's screens do (`useReceiptsStore.getState().seedEdit(...)`). The
 * module is compiled with an isolated tsconfig (type-checking included);
 * the require hook remaps the runtime `@/lib/format` import to the
 * compiled formatter.
 *
 * Covered actions:
 *   - `seedEdit` seeds the review draft for an existing purchase
 *     (editingId = purchase uuid, scanState 'reviewing', scanError null),
 *   - `startDraft` seeds the empty capture draft (today's local date) and
 *     resets a prior edit session (editingId null),
 *   - `updateDraft` merges partial patches; no-op when draft is null,
 *   - `upsertItem` / `removeItem` add / update / remove items by `temp_id`,
 *   - `clearDraft` wipes the draft + scan state but keeps the list,
 *   - `upsertReceiptRow` REPLACES an existing row in place or PREPENDS a
 *     new one (edit flows never show stale rows before the feed refetch),
 *   - `removeReceiptRow` removes by id; missing ids are a no-op,
 *   - `resetAll` wipes every receipt field (SIGNED_OUT).
 *
 * Deterministic: fixed fixture inputs; the only clock read is
 * `startDraft`'s `todayLocalISO()` seed, asserted against the same
 * function called just before the action.
 *
 * Usage: pnpm test:receipts-store
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.receipts-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'receipts-store-test-'));
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
 * The store's only runtime import is `@/lib/format` (the rest are
 * type-only): tsc emits the original specifier, so the hook points it at
 * the compiled formatter. Other `@/…` imports pass through to their
 * compiled locations.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/format') {
      request = join(outDir, 'src', 'lib', 'format.js');
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

/** A `HomeFeedReceiptRow`-shaped row for the list under test. */
function row(id, overrides = {}) {
  return {
    id,
    store_name: 'Coto Hipermercado',
    purchase_date: '2026-08-05',
    scanned_at: '2026-08-05T14:30:00.000Z',
    total: 120,
    image_url: null,
    status: 'confirmed',
    wants_snacks_total: 0,
    category_totals: {},
    items: [],
    ...overrides,
  };
}

/** A `ReviewItem`-shaped line item for the draft under test. */
function item(tempId, overrides = {}) {
  return {
    temp_id: tempId,
    name: 'Leche Entera',
    quantity: 2,
    unit_price: 3.5,
    total_price: 7,
    category_id: 'lacteos',
    is_impulse: false,
    ai_suggested_category_id: null,
    ...overrides,
  };
}

/** A `ReceiptDraft`-shaped draft. */
function draft(items = [], overrides = {}) {
  return {
    store_name: 'Coto Hipermercado',
    purchase_date: '2026-08-05',
    total: 120,
    payment_method: 'card',
    image_url: 'file:///receipts/scan.jpg',
    items,
    ...overrides,
  };
}

let useReceiptsStore;
let todayLocalISO;

async function run() {
  console.log('\n[tests] compiling receipts-store module…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const storeMod = await load('src/stores/use-receipts-store.js');
  // The compiled module is CommonJS; named-export detection covers the
  // direct `exports.useReceiptsStore =` assignment, but resolve defensively
  // in case the re-export emit style is opaque to the lexer.
  useReceiptsStore =
    storeMod.useReceiptsStore ?? storeMod.default.useReceiptsStore;
  assert.ok(useReceiptsStore, 'store module exports useReceiptsStore');

  const formatMod = await load('src/lib/format.js');
  todayLocalISO = formatMod.todayLocalISO ?? formatMod.default.todayLocalISO;

  const s = () => useReceiptsStore.getState();
  const fresh = () => s().resetAll();

  console.log('\n[tests] seedEdit / startDraft (draft lifecycle)\n');

  await test('seedEdit seeds the review draft for an existing purchase', () => {
    fresh();
    const editDraft = draft([item('t1')], { store_name: 'Tienda Don Pedro' });
    s().seedEdit(editDraft, 'p-edit-1');
    assert.equal(s().draft, editDraft, 'draft is the seeded object');
    assert.equal(s().editingId, 'p-edit-1');
    assert.equal(s().scanState, 'reviewing');
    assert.equal(s().scanError, null);
    assert.deepEqual(s().list, [], 'seeding an edit does not touch the list');
  });

  await test('startDraft seeds the empty capture draft with today\'s local date', () => {
    fresh();
    const expectedDate = todayLocalISO();
    s().startDraft('file:///receipts/capture.jpg');
    assert.deepEqual(s().draft, {
      store_name: '',
      purchase_date: expectedDate,
      total: 0,
      payment_method: 'card',
      image_url: 'file:///receipts/capture.jpg',
      items: [],
    });
    assert.equal(s().scanState, 'reviewing');
    assert.equal(s().scanError, null);
    assert.equal(s().editingId, null, 'capture flow never carries an edit id');
  });

  await test('startDraft resets a prior edit session', () => {
    fresh();
    s().seedEdit(draft([item('t1')]), 'p-edit-1');
    s().startDraft('file:///receipts/new.jpg');
    assert.equal(s().editingId, null, 'a new capture clears editingId');
    assert.deepEqual(s().draft.items, [], 'the new draft starts empty');
  });

  console.log('\n[tests] updateDraft\n');

  await test('updateDraft merges partial patches onto the existing draft', () => {
    fresh();
    s().startDraft('file:///receipts/scan.jpg');
    s().updateDraft({ store_name: 'Coto', total: 42.5 });
    s().updateDraft({ purchase_date: '2026-08-11' });
    assert.equal(s().draft.store_name, 'Coto');
    assert.equal(s().draft.total, 42.5);
    assert.equal(s().draft.purchase_date, '2026-08-11');
    assert.equal(s().draft.image_url, 'file:///receipts/scan.jpg', 'unpatched fields survive');
    assert.deepEqual(s().draft.items, [], 'items untouched by scalar patches');
  });

  await test('updateDraft is a no-op when the draft is null', () => {
    fresh();
    const before = s();
    s().updateDraft({ store_name: 'Coto' });
    assert.equal(s(), before, 'same state reference — nothing changed');
    assert.equal(s().draft, null);
  });

  console.log('\n[tests] upsertItem / removeItem\n');

  await test('upsertItem appends an item whose temp_id is new', () => {
    fresh();
    s().startDraft('file:///receipts/scan.jpg');
    s().upsertItem(item('t1', { name: 'Leche' }));
    s().upsertItem(item('t2', { name: 'Papas', category_id: 'snacks' }));
    assert.deepEqual(
      s().draft.items.map((i) => i.temp_id),
      ['t1', 't2'],
      'new items are appended in arrival order',
    );
  });

  await test('upsertItem replaces the item with the same temp_id in place', () => {
    fresh();
    s().startDraft('file:///receipts/scan.jpg');
    s().upsertItem(item('t1', { name: 'Leche' }));
    s().upsertItem(item('t2', { name: 'Papas' }));
    // The user picks a category: the sheet target is re-upserted with the
    // new category_id (the review screen's handleSelectCategory).
    s().upsertItem(item('t2', { name: 'Papas', category_id: 'snacks' }));
    assert.deepEqual(
      s().draft.items.map((i) => i.temp_id),
      ['t1', 't2'],
      'position preserved — the existing item is replaced, not re-appended',
    );
    assert.equal(s().draft.items[1].category_id, 'snacks');
    assert.equal(s().draft.items.length, 2, 'no duplicate rows');
  });

  await test('removeItem removes the item by temp_id', () => {
    fresh();
    s().startDraft('file:///receipts/scan.jpg');
    s().upsertItem(item('t1'));
    s().upsertItem(item('t2'));
    s().removeItem('t1');
    assert.deepEqual(
      s().draft.items.map((i) => i.temp_id),
      ['t2'],
    );
    s().removeItem('missing');
    assert.deepEqual(
      s().draft.items.map((i) => i.temp_id),
      ['t2'],
      'removing an unknown temp_id is a no-op',
    );
  });

  await test('upsertItem / removeItem are no-ops when the draft is null', () => {
    fresh();
    const before = s();
    s().upsertItem(item('t1'));
    s().removeItem('t1');
    assert.equal(s(), before, 'same state reference — nothing changed');
    assert.equal(s().draft, null);
  });

  console.log('\n[tests] clearDraft / resetAll\n');

  await test('clearDraft wipes the draft and scan state but keeps the list', () => {
    fresh();
    s().setList([row('p1')]);
    s().seedEdit(draft([item('t1')]), 'p-edit-1');
    s().clearDraft();
    assert.equal(s().draft, null);
    assert.equal(s().editingId, null);
    assert.equal(s().scanState, 'idle');
    assert.equal(s().scanError, null);
    assert.deepEqual(
      s().list.map((r) => r.id),
      ['p1'],
      'the hydrated feed list survives clearDraft',
    );
  });

  await test('resetAll wipes every receipt field', () => {
    fresh();
    s().setList([row('p1'), row('p2')]);
    s().seedEdit(draft([item('t1')]), 'p-edit-1');
    s().setScanError('boom');
    s().resetAll();
    assert.deepEqual(s().list, []);
    assert.equal(s().draft, null);
    assert.equal(s().scanState, 'idle');
    assert.equal(s().scanError, null);
    assert.equal(s().editingId, null);
  });

  console.log('\n[tests] upsertReceiptRow / removeReceiptRow (list)\n');

  await test('upsertReceiptRow replaces an existing row in place', () => {
    fresh();
    s().setList([row('p1'), row('p2', { store_name: 'Almacén' })]);
    s().upsertReceiptRow(row('p1', { store_name: 'Coto Renovado', total: 130 }));
    assert.deepEqual(
      s().list.map((r) => r.id),
      ['p1', 'p2'],
      'the edited row keeps its position',
    );
    assert.equal(s().list[0].store_name, 'Coto Renovado');
    assert.equal(s().list[0].total, 130);
    assert.equal(s().list.length, 2, 'no duplicate rows');
  });

  await test('upsertReceiptRow prepends a row whose id is new', () => {
    fresh();
    s().setList([row('p1')]);
    s().upsertReceiptRow(row('p3', { store_name: 'Nuevo' }));
    assert.deepEqual(
      s().list.map((r) => r.id),
      ['p3', 'p1'],
      'new rows land at the front (newest capture first)',
    );
  });

  await test('removeReceiptRow removes the row by id', () => {
    fresh();
    s().setList([row('p1'), row('p2'), row('p3')]);
    s().removeReceiptRow('p2');
    assert.deepEqual(
      s().list.map((r) => r.id),
      ['p1', 'p3'],
    );
  });

  await test('removeReceiptRow is a no-op for a missing id', () => {
    fresh();
    s().setList([row('p1')]);
    s().removeReceiptRow('ghost');
    assert.deepEqual(
      s().list.map((r) => r.id),
      ['p1'],
    );
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
