#!/usr/bin/env node
/**
 * Node harness for the manual-receipt pipeline (PR2 of manual-purchase-entry):
 *
 *   - Pure builders  (src/features/tickets/manual-receipt.ts)
 *       buildManualDraft, validateManualForm, buildItemRows
 *   - Shared save seam (src/features/tickets/api.ts)
 *       buildSaveReceiptArgs, saveManualReceipt (+ saveReceipt parity)
 *
 * The pure module has zero RN/Supabase imports; api.ts is compiled with
 * stubbed deps (same pattern as test-scan-contract.mjs). resolveStoreId and
 * fetchCategoryIdsBySlug are module-private and NOT injectable by design
 * (T-202), so their behavior is stubbed at the supabase client level: the
 * from-builder returns a store row for `stores` and category rows for
 * `categories`, and the save_receipt RPC result is injected via
 * globalThis.__rpcResult.
 *
 * Usage: pnpm test:manual-receipt
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'manual-receipt-test-'));
const srcDir = join(workdir, 'src');
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
// Compilation — self-contained workdir (mirrors test-scan-contract.mjs)
// ---------------------------------------------------------------------------

/** Applies the @/ import rewrites a module needs to resolve to lib-stubs. */
function patchImports(source, rewrites) {
  let out = source;
  for (const [pattern, replacement] of rewrites) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const API_REWRITES = [
  [/from ['"]@\/lib\/supabase['"]/g, "from '../lib-stubs/supabase'"],
  [/from ['"]@\/lib\/format['"]/g, "from '../lib-stubs/format'"],
  [/from ['"]@\/lib\/query-client['"]/g, "from '../lib-stubs/query-client'"],
  [/from ['"]@\/lib\/query-keys['"]/g, "from '../lib-stubs/query-keys'"],
  [/from ['"]@\/lib\/supabase\/receipt-photo['"]/g, "from '../lib-stubs/receipt-photo'"],
  [/from ['"]@\/types['"]/g, "from '../lib-stubs/types'"],
  [/from ['"]@\/stores\/use-household-store['"]/g, "from '../lib-stubs/use-household-store'"],
  // readLocalImage dynamic-imports expo-file-system at runtime; point it at a
  // lib stub so a LOCAL photo draft can exercise the upload seam (needed for
  // the save-failure orphan-cleanup contract, section E).
  [/await import\('expo-file-system'\)/g, "await import('../lib-stubs/expo-file-system')"],
];

const MANUAL_REWRITES = [
  [/from ['"]@\/lib\/format['"]/g, "from '../lib-stubs/format'"],
  [/from ['"]@\/types['"]/g, "from '../lib-stubs/types'"],
];

function compile() {
  mkdirSync(srcDir, { recursive: true });

  // --- api.ts — patch heavy @/ imports to local stubs ---
  const apiSource = patchImports(
    readFileSync(join(root, 'src/features/tickets/api.ts'), 'utf8'),
    API_REWRITES,
  );
  writeFileSync(join(srcDir, 'api.ts'), apiSource);

  // --- manual-receipt.ts — pure module, same @/ rewrites ---
  const manualSource = patchImports(
    readFileSync(join(root, 'src/features/tickets/manual-receipt.ts'), 'utf8'),
    MANUAL_REWRITES,
  );
  writeFileSync(join(srcDir, 'manual-receipt.ts'), manualSource);

  // --- Stub modules (only the surface api.ts/manual-receipt.ts touch) ---
  mkdirSync(join(workdir, 'lib-stubs'), { recursive: true });

  writeFileSync(
    join(workdir, 'lib-stubs/supabase.ts'),
    `
    // Supabase client stub. Two distinct chain paths:
    //   - RPC path (.rpc(...)[.single()]) → resolves to the test-injected
    //     globalThis.__rpcResult (default { data: null, error: null }).
    //   - From path (.from(table).select()...) → resolves per-table fixtures:
    //     'stores' → a resolvable store row (override with globalThis.__storeResult),
    //     'categories' → the slug map fixtures ('otros', 'lacteos').
    //     resolveStoreId / fetchCategoryIdsBySlug are module-private (T-202),
    //     so this is where their behavior is stubbed.
    const globalObj: any = globalThis;

    const fromResults: Record<string, unknown> = {
      stores: { data: { id: 'store-111' }, error: null },
      categories: {
        data: [
          { id: 'cat-otros', slug: 'otros' },
          { id: 'cat-lacteos', slug: 'lacteos' },
        ],
        error: null,
      },
    };

    function tableResult(table: string) {
      if (table === 'stores' && globalObj.__storeResult !== undefined) {
        return globalObj.__storeResult;
      }
      return fromResults[table] ?? { data: null, error: null };
    }

    function makeFromBuilder(table: string): any {
      const builder: any = function () { return builder; };
      return new Proxy(builder, {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: any, _reject?: any) =>
              Promise.resolve(tableResult(table)).then(resolve);
          }
          if (prop === Symbol.toPrimitive) {
            return function () { return '[FromBuilder:' + table + ']'; };
          }
          return function () { return makeFromBuilder(table); };
        },
        apply() { return makeFromBuilder(table); },
      });
    }

    function rpcResult() {
      return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null });
    }

    const supabaseProxy = new Proxy(function () { return makeChain(); }, {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive) return function () { return '[SupabaseStub]'; };
        if (prop === 'rpc') {
          // Records every .rpc(name, args) call (globalThis.__rpcCalls) so
          // tests can assert the EXACT payload that reached the RPC — e.g.
          // p_is_manual on the manual save (migration 0029 origin).
          return function (fnName: string, rpcArgs?: unknown) {
            if (!Array.isArray(globalObj.__rpcCalls)) globalObj.__rpcCalls = [];
            globalObj.__rpcCalls.push({ fn: fnName, args: rpcArgs });
            return new Proxy(function () { return rpcResult(); }, {
              get(_t2, prop2) {
                if (prop2 === Symbol.toPrimitive) return function () { return '[RpcBuilder]'; };
                if (typeof prop2 === 'string' && ['single', 'maybeSingle', 'then'].includes(prop2)) {
                  return prop2 === 'then'
                    ? function (resolve?: any, _reject?: any) { return rpcResult().then(resolve); }
                    : function () { return rpcResult(); };
                }
                return function () { return rpcResult(); };
              },
              apply() { return rpcResult(); },
            });
          };
        }
        if (prop === 'from') {
          return function (table: string) { return makeFromBuilder(table); };
        }
        if (prop === 'storage') {
          // Storage stub: uploads succeed and record their path; removes
          // record their paths. Lets the save-failure orphan-cleanup contract
          // be asserted (removeUploadedObject with the exact uploadedPath).
          return {
            from(bucket: string) {
              const builder: any = function () { return builder; };
              return new Proxy(builder, {
                get(_t2, prop2) {
                  if (prop2 === 'upload') {
                    return (path: string) => {
                      if (!Array.isArray(globalObj.__storageUploads)) globalObj.__storageUploads = [];
                      globalObj.__storageUploads.push({ bucket, path });
                      return Promise.resolve({ data: null, error: null });
                    };
                  }
                  if (prop2 === 'remove') {
                    return (paths: string[]) => {
                      if (!Array.isArray(globalObj.__storageRemovals)) globalObj.__storageRemovals = [];
                      globalObj.__storageRemovals.push({ bucket, paths });
                      return Promise.resolve({ data: null, error: null });
                    };
                  }
                  if (prop2 === Symbol.toPrimitive) return function () { return '[StorageFrom:' + bucket + ']'; };
                  return function () { return builder; };
                },
                apply() { return builder; },
              });
            },
          };
        }
        return function () { return Promise.resolve({ data: null, error: null }); };
      },
      apply() { return makeChain(); },
    });
    function makeChain(): any { return supabaseProxy; }
    export const supabase: any = supabaseProxy;
    export function __resetResults() {
      globalObj.__rpcResult = undefined;
      globalObj.__storeResult = undefined;
      globalObj.__invalidateCalls = [];
      globalObj.__storageUploads = [];
      globalObj.__storageRemovals = [];
      globalObj.__rpcCalls = [];
    }
    export const isSupabaseConfigured = true;
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/format.ts'),
    `
    let _c = 0;
    export const tempId = () => 'test-' + (++_c);
    export const todayLocalISO = () => '2026-09-07';
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/query-client.ts'),
    `
    // Records every invalidateQueries call (first element of the key) so the
    // "invalidates feeds + scan usage exactly like saveReceipt" contract can
    // be asserted at runtime (REQ-008).
    const globalObj: any = globalThis;
    if (!Array.isArray(globalObj.__invalidateCalls)) globalObj.__invalidateCalls = [];
    export const queryClient = {
      invalidateQueries: async (opts: { queryKey: unknown }) => {
        globalObj.__invalidateCalls.push(opts.queryKey);
      },
    };
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/query-keys.ts'),
    `
    export function utcYearMonth(d: Date = new Date()): string {
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }
    function p(u: string) {
      return (...a: unknown[]) => [u, ...a];
    }
    export const queryKeys = {
      scanUsage: p('scan-usage'),
      homeFeed: p('home-feed'),
      budget: p('budget'),
      monthlyTotalsPrefix: p('monthly-totals'),
      monthlyPurchasesTotalPrefix: p('monthly-purchases-total'),
      householdMonthlyPurchasesTotal: p('hh-monthly-purchases-total'),
      householdMonthlyPurchasesTotalPrefix: p('hh-monthly-purchases-total'),
      monthlyImpulseTotalPrefix: p('monthly-impulse-total'),
      monthlyImpulseItemsPrefix: p('monthly-impulse-items'),
      monthlyCachePrefix: p('monthly-cache'),
      itemSearchPrefix: p('item-search'),
      monthReceiptsPrefix: p('month-receipts'),
      monthKeys: p('month-keys'),
      receiptDetail: p('receipt-detail'),
    };
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/receipt-photo.ts'),
    `
    export function resolveReceiptPhotoPath(imageUrl: string) {
      return { kind: 'path' as const, value: imageUrl };
    }
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/expo-file-system.ts'),
    `
    // expo-file-system stub: lets readLocalImage pass in the node harness so
    // a LOCAL-photo draft can exercise the upload seam end-to-end (the
    // save-failure orphan-cleanup tests in section E need a real
    // uploadedPath).
    export class File {
      readonly exists: boolean = true;
      readonly size: number = 100;
      readonly type: string = 'image/jpeg';
      constructor(private readonly _uri: string) {}
      async base64(): Promise<string> {
        return 'AAAA'; // 3 zero bytes — enough for the storage-upload stub
      }
    }
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/use-household-store.ts'),
    `
    // Minimal Zustand-shaped stub: api.ts only reads getState().household?.id
    // via invalidateHouseholdNetTotal (no-op when not in a household).
    type Household = { id: string } | null;
    export const useHouseholdStore = {
      getState: (): { household: Household } => ({ household: null }),
    };
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/types.ts'),
    `
    export type PaymentMethod = 'cash' | 'card' | 'apple_pay' | 'google_pay' | 'transfer' | 'other';
    export type CardType = 'debit' | 'credit';
    export type PurchaseStatus = 'pending' | 'parsed' | 'confirmed' | 'failed';
    export interface Category { id: string; slug: string; name: string; kind: string; icon: string; color: string; sort_order: number; }
    export interface ReceiptDraft { store_name: string; purchase_date: string; total: number; payment_method: PaymentMethod; is_manual?: boolean; image_url: string; card_brand?: string | null; card_type?: CardType | null; items: ReviewItem[]; }
    export interface ReviewItem { temp_id: string; name: string; quantity: number; unit_price: number; total_price: number; category_id: string | null; is_impulse: boolean; ai_suggested_category_id: string | null; }
  `,
  );

  // --- tsconfig (self-contained, no root paths needed) ---
  const tsconfig = {
    compilerOptions: {
      module: 'commonjs',
      target: 'es2020',
      lib: ['es2020', 'dom'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      rootDir: '.',
      outDir: './out',
    },
    include: ['./src/*.ts', './lib-stubs/*.ts'],
  };
  writeFileSync(
    join(workdir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2),
  );

  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], {
    cwd: workdir,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(overrides = {}) {
  return {
    temp_id: 't1',
    name: 'Café',
    quantity: 2,
    unit_price: 250,
    total_price: 500,
    category_id: null,
    is_impulse: false,
    ai_suggested_category_id: null,
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    store_name: 'Coto Hipermercado',
    purchase_date: '2026-09-01',
    total: 500,
    payment_method: 'cash',
    image_url: '',
    items: [item()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n[tests] compiling manual-receipt modules…');
  compile();
  console.log('[tests] loading compiled modules…\n');

  const manualMod = await load('src/manual-receipt.js');
  const { buildManualDraft, validateManualForm, buildItemRows, MANUAL_FORM_ERROR } = manualMod;

  let apiMod = null;
  try {
    apiMod = await load('src/api.js');
  } catch (err) {
    // A failed api.ts import MUST fail the suite: sections D/E hold the
    // save-pipeline parity/regression assertions, and a green CI that never
    // ran them is worse than a red one that did. (Anti-pattern fixed after
    // review-reliability: before, this printed a warning and exited 0.)
    failed += 1;
    console.error(
      '\n[tests] FATAL: api tests could not run because api.ts failed to import (exit 1):',
      err instanceof Error ? err.message : err,
    );
  }

  // ------------------------------------------------------------------
  // A. buildManualDraft — fresh draft shape (REQ-002)
  // ------------------------------------------------------------------

  console.log('\n[tests] A. buildManualDraft — draft shape\n');

  await test('builds a draft with image_url "" and the passed values', () => {
    const d = buildManualDraft('Coto', '2026-09-01', [item()], 500, 'cash');
    assert.equal(d.image_url, '');
    assert.equal(d.store_name, 'Coto');
    assert.equal(d.purchase_date, '2026-09-01');
    assert.equal(d.total, 500);
    assert.equal(d.payment_method, 'cash');
    // Origin (migration 0029): the manual draft body always carries
    // is_manual=true — the shared seam emits p_is_manual from it.
    assert.equal(d.is_manual, true);
    assert.deepEqual(d.items, [item()]);
  });

  await test('defaults purchase_date to today when none is provided', () => {
    const d = buildManualDraft('Coto', '', [], 0, 'other');
    assert.equal(d.purchase_date, '2026-09-07');
  });

  await test('card_type is null when omitted, kept when provided', () => {
    const noCard = buildManualDraft('Coto', '2026-09-01', [], 0, 'card');
    assert.equal(noCard.card_type, null);
    const debit = buildManualDraft('Coto', '2026-09-01', [], 0, 'card', 'debit');
    assert.equal(debit.card_type, 'debit');
  });

  // ------------------------------------------------------------------
  // B. validateManualForm — stable error codes (REQ-006)
  // ------------------------------------------------------------------

  console.log('\n[tests] B. validateManualForm — error codes\n');

  await test('valid form returns no errors', () => {
    assert.deepEqual(validateManualForm(draft()), []);
  });

  await test('blank/whitespace store name → store_required', () => {
    assert.deepEqual(validateManualForm(draft({ store_name: '   ' })), [
      MANUAL_FORM_ERROR.STORE_REQUIRED,
    ]);
  });

  await test('missing/invalid purchase_date → date_required', () => {
    assert.deepEqual(validateManualForm(draft({ purchase_date: '' })), [
      MANUAL_FORM_ERROR.DATE_REQUIRED,
    ]);
    assert.deepEqual(validateManualForm(draft({ purchase_date: '2026-02-30' })), [
      MANUAL_FORM_ERROR.DATE_REQUIRED,
    ]);
    assert.deepEqual(validateManualForm(draft({ purchase_date: '01-09-2026' })), [
      MANUAL_FORM_ERROR.DATE_REQUIRED,
    ]);
  });

  await test('zero items → items_required', () => {
    assert.deepEqual(validateManualForm(draft({ items: [] })), [
      MANUAL_FORM_ERROR.ITEMS_REQUIRED,
    ]);
  });

  await test('item quantity 0 / negative / non-integer → quantity_invalid', () => {
    assert.deepEqual(validateManualForm(draft({ items: [item({ quantity: 0 })] })), [
      MANUAL_FORM_ERROR.QUANTITY_INVALID,
    ]);
    assert.deepEqual(validateManualForm(draft({ items: [item({ quantity: -2 })] })), [
      MANUAL_FORM_ERROR.QUANTITY_INVALID,
    ]);
    assert.deepEqual(validateManualForm(draft({ items: [item({ quantity: 1.5 })] })), [
      MANUAL_FORM_ERROR.QUANTITY_INVALID,
    ]);
  });

  await test('item unit_price negative → price_invalid', () => {
    assert.deepEqual(validateManualForm(draft({ items: [item({ unit_price: -1 })] })), [
      MANUAL_FORM_ERROR.PRICE_INVALID,
    ]);
  });

  await test('negative total → total_invalid', () => {
    assert.deepEqual(validateManualForm(draft({ total: -5 })), [
      MANUAL_FORM_ERROR.TOTAL_INVALID,
    ]);
  });

  await test('multiple failures return canonical ordered codes', () => {
    assert.deepEqual(
      validateManualForm(draft({ store_name: '', items: [], total: -1 })),
      [
        MANUAL_FORM_ERROR.STORE_REQUIRED,
        MANUAL_FORM_ERROR.ITEMS_REQUIRED,
        MANUAL_FORM_ERROR.TOTAL_INVALID,
      ],
    );
  });

  // ------------------------------------------------------------------
  // C. buildItemRows — RPC p_items shape (REQ-011)
  // ------------------------------------------------------------------

  console.log('\n[tests] C. buildItemRows — p_items payload\n');

  await test('forces total_price = quantity * unit_price (defense in depth)', () => {
    const rows = buildItemRows([item({ quantity: 2, unit_price: 250, total_price: 999 })]);
    assert.equal(rows[0].total_price, 500);
  });

  await test('sort_order follows the input sequence', () => {
    const rows = buildItemRows([item({ temp_id: 'a' }), item({ temp_id: 'b' }), item({ temp_id: 'c' })]);
    assert.deepEqual(
      rows.map((r) => r.sort_order),
      [0, 1, 2],
    );
  });

  await test('category fallback "otros" when no user pick and no AI suggestion', () => {
    const rows = buildItemRows([item()]);
    assert.equal(rows[0].category_id, 'otros');
  });

  await test('user-picked category slug preferred over AI suggestion', () => {
    const rows = buildItemRows([
      item({ category_id: 'lacteos', ai_suggested_category_id: 'snacks' }),
    ]);
    assert.equal(rows[0].category_id, 'lacteos');
  });

  await test('AI suggestion used when no user pick', () => {
    const rows = buildItemRows([item({ ai_suggested_category_id: 'snacks' })]);
    assert.equal(rows[0].category_id, 'snacks');
  });

  await test('category_id stays at SLUG level — never a uuid FK ready for the RPC', () => {
    // buildItemRows output is NOT valid RPC input on its own: category_id is
    // the app slug (e.g. 'lacteos'), not the DB uuid FK the RPC expects.
    // The seam (buildSaveReceiptArgs → fetchCategoryIdsBySlug) maps slugs to
    // uuids at save time (section D asserts 'cat-otros' reaching p_items).
    const rows = buildItemRows([
      item({ category_id: 'lacteos' }),
      item({ ai_suggested_category_id: 'snacks' }),
      item(),
    ]);
    assert.deepEqual(
      rows.map((r) => r.category_id),
      ['lacteos', 'snacks', 'otros'],
      'rows carry the app-level slugs',
    );
    for (const row of rows) {
      assert.ok(
        typeof row.category_id === 'string' &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.category_id),
        'slug output must not already be a uuid-shaped FK value',
      );
    }
  });

  await test('rows carry NO card fields (card_type/card_brand absent)', () => {
    const rows = buildItemRows([item()]);
    assert.ok(!('card_type' in rows[0]), 'no card_type key');
    assert.ok(!('card_brand' in rows[0]), 'no card_brand key');
  });

  // ------------------------------------------------------------------
  // D. buildSaveReceiptArgs — shared seam payload (T-202)
  // ------------------------------------------------------------------

  if (apiMod) {
    console.log('\n[tests] D. buildSaveReceiptArgs — RPC args assembly\n');

    const { buildSaveReceiptArgs, saveManualReceipt, saveReceipt, QuotaExceededError } = apiMod;

    await test('resolves store + categories and assembles the full payload', async () => {
      const res = await buildSaveReceiptArgs('user-1', draft());
      assert.equal(res.uploadedPath, null, 'no photo → no upload path');
      assert.equal(res.args.p_store_id, 'store-111');
      assert.equal(res.args.p_purchase_date, '2026-09-01');
      assert.equal(res.args.p_total, 500);
      assert.equal(res.args.p_payment_method, 'cash');
      assert.equal(res.args.p_image_url, null, 'empty image_url persists null');
      // Origin (migration 0029): a draft that never sets the flag is a scan →
      // false. Only buildManualDraft (is_manual: true) flips the seam arg.
      assert.equal(res.args.p_is_manual, false);
      assert.equal(res.args.p_items.length, 1);
      assert.deepEqual(res.args.p_items[0], {
        name: 'Café',
        quantity: 2,
        unit_price: 250,
        total_price: 500,
        category_id: 'cat-otros', // slug 'otros' resolved to a uuid FK
        is_impulse: false,
        sort_order: 0,
      });
      assert.ok(!('purchase_id' in res.args.p_items[0]), 'purchase_id placeholder stripped');
    });

    await test('blank store name → p_store_id null (list-mode parity, no throw)', async () => {
      const res = await buildSaveReceiptArgs('user-1', draft({ store_name: '' }));
      assert.equal(res.args.p_store_id, null);
    });

    await test('non-empty store that fails to resolve → generic save error', async () => {
      globalThis.__storeResult = { data: null, error: null };
      let threw = false;
      try {
        await buildSaveReceiptArgs('user-1', draft());
      } catch (err) {
        threw = true;
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'No se pudo guardar el ticket. Inténtalo de nuevo.');
      }
      assert.ok(threw, 'must throw when a non-empty store fails to resolve');
      // Reset the override so later tests see the default resolvable store.
      globalThis.__storeResult = undefined;
    });

    await test('card fields never reach the RPC args (decision #1137)', async () => {
      const res = await buildSaveReceiptArgs(
        'user-1',
        draft({ payment_method: 'card', card_brand: 'VISA', card_type: 'debit' }),
      );
      assert.ok(!('card_brand' in res.args), 'no card_brand in args');
      assert.ok(!('card_type' in res.args), 'no card_type in args');
      assert.ok(
        !('card_brand' in res.args.p_items[0]) && !('card_type' in res.args.p_items[0]),
        'no card fields in item rows',
      );
      assert.equal(res.args.p_payment_method, 'card');
    });

    await test('origin true when the draft is flagged manual (seam D4)', async () => {
      const res = await buildSaveReceiptArgs('user-1', draft({ is_manual: true }));
      assert.equal(res.args.p_is_manual, true);
    });

    // ------------------------------------------------------------------
    // E. saveManualReceipt — runtime save behavior (REQ-008..010)
    // ------------------------------------------------------------------

    console.log('\n[tests] E. saveManualReceipt — save runtime\n');

    await test('ok=false → throws QuotaExceededError (REQ-010)', async () => {
      globalThis.__rpcResult = {
        data: { ok: false, purchase_id: null, scans_used: 15, scans_limit: 15 },
        error: null,
      };
      let threw = false;
      try {
        await saveManualReceipt('user-1', draft());
      } catch (err) {
        threw = true;
        assert.ok(err instanceof QuotaExceededError);
      }
      assert.ok(threw, 'must throw QuotaExceededError when ok=false');
    });

    await test('ok=true → returns { id } and invalidates usage + feeds (REQ-008)', async () => {
      globalThis.__rpcResult = {
        data: { ok: true, purchase_id: 'purchase-123', scans_used: 1, scans_limit: 15 },
        error: null,
      };
      globalThis.__invalidateCalls = [];
      const res = await saveManualReceipt('user-1', draft());
      assert.deepEqual(res, { id: 'purchase-123' });
      const prefixes = globalThis.__invalidateCalls.map((key) => key[0]);
      assert.ok(prefixes.includes('scan-usage'), 'scan usage cache invalidated');
      assert.ok(prefixes.includes('home-feed'), 'home feed cache invalidated');
      assert.ok(prefixes.includes('budget'), 'budget cache invalidated');
    });

    await test('parity: refactored saveReceipt returns the same { id } shape', async () => {
      globalThis.__rpcResult = {
        data: { ok: true, purchase_id: 'purchase-456', scans_used: 1, scans_limit: 15 },
        error: null,
      };
      const res = await saveReceipt('user-1', draft());
      assert.deepEqual(res, { id: 'purchase-456' });
    });

    await test('manual save reaches the RPC with p_is_manual=true (migration 0029)', async () => {
      globalThis.__rpcResult = {
        data: { ok: true, purchase_id: 'purchase-789', scans_used: 1, scans_limit: 15 },
        error: null,
      };
      globalThis.__rpcCalls = [];
      await saveManualReceipt('user-1', draft({ is_manual: true }));
      const saveCalls = globalThis.__rpcCalls.filter((c) => c.fn === 'save_receipt');
      assert.equal(
        saveCalls.length,
        1,
        'manual save performs exactly one save_receipt RPC call',
      );
      assert.equal(
        saveCalls[0].args.p_is_manual,
        true,
        'RPC payload carries the manual origin (is_manual=true)',
      );
    });

    await test('parity: saveReceipt ok=false still throws QuotaExceededError', async () => {
      globalThis.__rpcResult = {
        data: { ok: false, purchase_id: null, scans_used: 15, scans_limit: 15 },
        error: null,
      };
      let threw = false;
      try {
        await saveReceipt('user-1', draft());
      } catch (err) {
        threw = true;
        assert.ok(err instanceof QuotaExceededError);
      }
      assert.ok(threw);
    });

    await test('rpc error → generic save error + orphan upload removed (docstring branch)', async () => {
      // Forces the `error || data === null` branch with a transport error.
      // A LOCAL photo forces the upload seam, so uploadedPath is a real
      // storage path that removeUploadedObject must clean up on failure.
      globalThis.__rpcResult = { data: null, error: { message: 'boom: connection reset' } };
      globalThis.__storageUploads = [];
      globalThis.__storageRemovals = [];
      let threw = false;
      try {
        await saveManualReceipt('user-1', draft({ image_url: 'file:///tmp/photo.jpg' }));
      } catch (err) {
        threw = true;
        assert.ok(err instanceof Error, 'generic Error instance');
        assert.equal(err.message, 'No se pudo guardar el ticket. Inténtalo de nuevo.');
      }
      assert.ok(threw, 'must throw the generic save error on RPC error');
      assert.equal(globalThis.__storageUploads.length, 1, 'photo uploaded before the save');
      const uploadedPath = globalThis.__storageUploads[0].path;
      assert.equal(globalThis.__storageRemovals.length, 1, 'orphaned object removed');
      assert.deepEqual(
        globalThis.__storageRemovals[0].paths,
        [uploadedPath],
        'removeUploadedObject called with the exact uploadedPath',
      );

      // Parity: saveReceipt goes through the same persistReceipt tail, so the
      // same failing RPC throws the same user-safe error (docstring contract
      // "same shape as saveReceipt").
      globalThis.__storageUploads = [];
      globalThis.__storageRemovals = [];
      let parityThrew = false;
      try {
        await saveReceipt('user-1', draft({ image_url: 'file:///tmp/photo.jpg' }));
      } catch (err) {
        parityThrew = true;
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'No se pudo guardar el ticket. Inténtalo de nuevo.');
      }
      assert.ok(parityThrew, 'saveReceipt parity: must throw the same generic error');
      assert.equal(globalThis.__storageRemovals.length, 1, 'orphaned object removed on saveReceipt too');
    });

    await test('rpc returns no data → same generic error + orphan cleanup (docstring branch)', async () => {
      // The other half of `error || data === null`: a null-data success
      // response is NOT a quota answer either — same generic error, same
      // orphan cleanup.
      globalThis.__rpcResult = { data: null, error: null };
      globalThis.__storageRemovals = [];
      let threw = false;
      try {
        await saveManualReceipt('user-1', draft({ image_url: 'file:///tmp/photo.jpg' }));
      } catch (err) {
        threw = true;
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'No se pudo guardar el ticket. Inténtalo de nuevo.');
      }
      assert.ok(threw, 'must throw when the RPC returns no data');
      assert.equal(globalThis.__storageRemovals.length, 1, 'orphaned object removed');
    });
  } else {
    console.log(
      '\n[tests] D-E SKIPPED: api.ts failed to import (see FATAL warning above)',
    );
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------

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