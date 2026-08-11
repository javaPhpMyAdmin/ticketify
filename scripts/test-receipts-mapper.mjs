#!/usr/bin/env node
/**
 * Node harness for the shared feed-row builder (`src/features/home/feed-row.ts`),
 * the single pure source of the derived aggregates that the home reads
 * (`mapPurchaseRow` / `mapSearchItemRow` in `features/home/api`) and the
 * edit-review flow (`app/ticket/review/[id]`'s `handleConfirm`) share.
 *
 * The module is pure — it only imports types — so this harness compiles it
 * with an isolated tsconfig (type-checking included, mirroring the other
 * harnesses) and asserts the derived output directly:
 *
 *   - `buildFeedRow` groups `category_totals` by slug and sums the line
 *     amounts, keeping the caller-supplied meta and the normalized items
 *     untouched (the review screen's row is exactly meta + items + these
 *     two aggregates),
 *   - `wants_snacks_total` sums only the impulse items,
 *   - the review-side resolution `reviewItemCategorySlug` prefers the
 *     user's pick (`category_id`) over the AI suggestion
 *     (`ai_suggested_category_id`), falling back to `otros`,
 *   - `reviewItemsToFeedItems` maps every `ReviewItem` field onto the
 *     shared item shape, and the two helpers together reproduce the exact
 *     optimistic row the review screen builds after an edit.
 *
 * Deterministic: fixed fixture inputs, no clock, no Intl.
 *
 * Usage: pnpm test:receipts-mapper
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.receipts-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'receipts-mapper-test-'));
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

/** A `ReviewItem`-shaped line item, shaped like the parse/draft output. */
function reviewItem(overrides = {}) {
  return {
    temp_id: 't1',
    name: 'Leche Entera',
    quantity: 2,
    unit_price: 3.5,
    total_price: 7,
    category_id: null,
    is_impulse: false,
    ai_suggested_category_id: null,
    ...overrides,
  };
}

let feedRowMod;

async function run() {
  console.log('\n[tests] compiling feed-row module…');
  await compile();
  console.log('[tests] loading compiled module…');
  feedRowMod = await load('src/features/home/feed-row.js');
  const { buildFeedRow, reviewItemCategorySlug, reviewItemsToFeedItems } =
    feedRowMod;

  console.log('\n[tests] buildFeedRow aggregation\n');

  await test('buildFeedRow groups category_totals by slug and sums the amounts', () => {
    const row = buildFeedRow(
      { id: 'p1', store_name: 'Coto', purchase_date: '2026-08-05', scanned_at: '2026-08-05T14:30:00.000Z', total: 20, image_url: null, status: 'confirmed' },
      [
        { name: 'Leche', amount: 7, quantity: 2, unit_price: 3.5, category: 'lacteos', is_impulse: false },
        { name: 'Queso', amount: 5, quantity: 1, unit_price: 5, category: 'lacteos', is_impulse: false },
        { name: 'Papas', amount: 4, quantity: 1, unit_price: 4, category: 'snacks', is_impulse: true },
        { name: 'Suelto', amount: 4, quantity: 1, unit_price: 4, category: 'otros', is_impulse: false },
      ],
    );
    assert.deepEqual(row.category_totals, {
      lacteos: 12,
      snacks: 4,
      otros: 4,
    });
  });

  await test('buildFeedRow sums wants_snacks_total over impulse items only', () => {
    const row = buildFeedRow(
      { id: 'p1', store_name: 'Coto', purchase_date: '2026-08-05', scanned_at: null, total: 20, image_url: null, status: 'confirmed' },
      [
        { name: 'Leche', amount: 7, category: 'lacteos', is_impulse: false },
        { name: 'Papas', amount: 4, category: 'snacks', is_impulse: true },
        { name: 'Chocolates', amount: 6, category: 'snacks', is_impulse: true },
      ],
    );
    assert.equal(row.wants_snacks_total, 10);
  });

  await test('buildFeedRow passes the meta through untouched', () => {
    const meta = {
      id: 'p9',
      store_name: 'Almacén Barrio Norte',
      purchase_date: '2026-07-20',
      scanned_at: '2026-07-20T10:00:00.000Z',
      total: 55.5,
      image_url: 'https://cdn/receipts/p9.jpg',
      status: 'confirmed',
    };
    const row = buildFeedRow(meta, []);
    assert.equal(row.id, meta.id);
    assert.equal(row.store_name, meta.store_name);
    assert.equal(row.purchase_date, meta.purchase_date);
    assert.equal(row.scanned_at, meta.scanned_at);
    assert.equal(row.total, meta.total);
    assert.equal(row.image_url, meta.image_url);
    assert.equal(row.status, meta.status);
  });

  await test('buildFeedRow keeps the normalized items untouched (order and fields)', () => {
    const items = [
      { name: 'A', amount: 1, quantity: 1, unit_price: 1, category: 'otros', is_impulse: false },
      { name: 'B', amount: 2, quantity: 1, unit_price: 2, category: 'otros', is_impulse: true },
    ];
    const row = buildFeedRow(
      { id: 'p1', store_name: 'Coto', purchase_date: '2026-08-05', scanned_at: null, total: 3, image_url: null, status: 'confirmed' },
      items,
    );
    assert.deepEqual(row.items, items);
    // Same objects, same order — callers keep identity for free.
    assert.equal(row.items[0], items[0]);
    assert.equal(row.items[1], items[1]);
  });

  await test('buildFeedRow with no items yields empty aggregates', () => {
    const row = buildFeedRow(
      { id: 'p1', store_name: 'Coto', purchase_date: '2026-08-05', scanned_at: null, total: 0, image_url: null, status: 'confirmed' },
      [],
    );
    assert.deepEqual(row.category_totals, {});
    assert.equal(row.wants_snacks_total, 0);
    assert.deepEqual(row.items, []);
  });

  console.log('\n[tests] review-side category resolution\n');

  await test('reviewItemCategorySlug prefers the user pick over the AI suggestion', () => {
    assert.equal(
      reviewItemCategorySlug({ category_id: 'lacteos', ai_suggested_category_id: 'bebidas' }),
      'lacteos',
    );
  });

  await test('reviewItemCategorySlug falls back to the AI suggestion', () => {
    assert.equal(
      reviewItemCategorySlug({ category_id: null, ai_suggested_category_id: 'snacks' }),
      'snacks',
    );
  });

  await test('reviewItemCategorySlug falls back to otros when nothing is set', () => {
    assert.equal(
      reviewItemCategorySlug({ category_id: null, ai_suggested_category_id: null }),
      'otros',
    );
  });

  await test('reviewItemsToFeedItems maps every field with the otros fallback', () => {
    const items = reviewItemsToFeedItems([
      reviewItem({
        temp_id: 't1',
        name: 'Detergente',
        quantity: 1,
        unit_price: 55.5,
        total_price: 55.5,
        category_id: null,
        ai_suggested_category_id: null,
        is_impulse: false,
      }),
    ]);
    assert.deepEqual(items, [
      {
        name: 'Detergente',
        amount: 55.5,
        quantity: 1,
        unit_price: 55.5,
        category: 'otros',
        is_impulse: false,
      },
    ]);
  });

  await test('reviewItemsToFeedItems resolves the user pick over the AI suggestion', () => {
    const items = reviewItemsToFeedItems([
      reviewItem({ category_id: 'limpieza', ai_suggested_category_id: 'otros' }),
      reviewItem({ temp_id: 't2', name: 'Coca', total_price: 3, category_id: null, ai_suggested_category_id: 'bebidas' }),
    ]);
    assert.deepEqual(
      items.map((i) => i.category),
      ['limpieza', 'bebidas'],
    );
  });

  console.log('\n[tests] review-flow integration (the handleConfirm row)\n');

  await test('buildFeedRow + reviewItemsToFeedItems reproduce the optimistic edit row', () => {
    // Mirrors what `app/ticket/review/[id]`'s handleConfirm builds after
    // `updateReceipt` succeeds: the draft's items normalized through the
    // shared helpers, the aggregates derived, the meta from the draft.
    const draft = {
      store_name: 'Tienda Don Pedro',
      purchase_date: '2026-08-11',
      total: 14,
      payment_method: 'card',
      image_url: 'file:///receipts/scan.jpg',
      items: [
        reviewItem({ temp_id: 'a', name: 'Leche', total_price: 7, category_id: null, ai_suggested_category_id: 'lacteos' }),
        reviewItem({ temp_id: 'b', name: 'Papas', total_price: 4, category_id: 'snacks', ai_suggested_category_id: 'otros', is_impulse: true }),
        reviewItem({ temp_id: 'c', name: 'Suelto', total_price: 3 }),
      ],
    };
    const row = buildFeedRow(
      {
        id: 'p-edit-1',
        store_name: draft.store_name,
        purchase_date: draft.purchase_date,
        scanned_at: '2026-08-05T14:30:00.000Z',
        total: draft.total,
        image_url: draft.image_url || null,
        status: 'confirmed',
      },
      reviewItemsToFeedItems(draft.items),
    );
    assert.deepEqual(row, {
      id: 'p-edit-1',
      store_name: 'Tienda Don Pedro',
      purchase_date: '2026-08-11',
      scanned_at: '2026-08-05T14:30:00.000Z',
      total: 14,
      image_url: 'file:///receipts/scan.jpg',
      status: 'confirmed',
      // The review flow does not supply the (optional) payment method, so
      // the built row carries it as undefined — the key is always present.
      payment_method: undefined,
      wants_snacks_total: 4,
      category_totals: { lacteos: 7, snacks: 4, otros: 3 },
      items: [
        { name: 'Leche', amount: 7, quantity: 2, unit_price: 3.5, category: 'lacteos', is_impulse: false },
        { name: 'Papas', amount: 4, quantity: 2, unit_price: 3.5, category: 'snacks', is_impulse: true },
        { name: 'Suelto', amount: 3, quantity: 2, unit_price: 3.5, category: 'otros', is_impulse: false },
      ],
    });
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
