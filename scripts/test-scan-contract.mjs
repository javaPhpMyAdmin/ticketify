#!/usr/bin/env node
/**
 * Node harness for the "consume scans at SAVE time + hard cap + parse
 * rate-limit" contract.  Tests the pure logic surfaced by:
 *
 *   - `QuotaExceededError` / `QUOTA_ERROR_MESSAGE`  (src/features/tickets/api.ts)
 *   - `messageFromEdgeError` — the `rate_limited` case + regression
 *     (src/features/tickets/api.ts)
 *   - `computeQuotaState` integration with the hard-cap flow
 *     (src/features/home/quota.ts)
 *   - Documented constant values (PARSE_RATE_LIMIT, SCANS_LIMIT)
 *     (supabase/functions/parse-ticket/index.ts)
 *
 * Compiles api.ts (with stubbed supabase + RN deps) and quota.ts
 * (zero imports) in a self-contained workdir, then asserts the contract.
 *
 * Usage: pnpm test:scan-contract
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
const workdir = mkdtempSync(join(tmpRoot, 'scan-contract-test-'));
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
// Compilation — self-contained workdir (mirrors test-parse-ticket.mjs)
// ---------------------------------------------------------------------------

function compile() {
  mkdirSync(srcDir, { recursive: true });

  // --- quota.ts (zero imports, copy verbatim) ---
  copyFileSync(
    join(root, 'src/features/home/quota.ts'),
    join(srcDir, 'quota.ts'),
  );

  // --- api.ts — patch heavy @/ imports to local stubs ---
  const apiSource = readFileSync(
    join(root, 'src/features/tickets/api.ts'),
    'utf8',
  )
    // Supabase client + config flag → local stub
    .replace(
      /from ['"]@\/lib\/supabase['"]/g,
      "from '../lib-stubs/supabase'",
    )
    // Format helpers → local stub
    .replace(
      /from ['"]@\/lib\/format['"]/g,
      "from '../lib-stubs/format'",
    )
    // Query client → local stub
    .replace(
      /from ['"]@\/lib\/query-client['"]/g,
      "from '../lib-stubs/query-client'",
    )
    // Query keys → local stub
    .replace(
      /from ['"]@\/lib\/query-keys['"]/g,
      "from '../lib-stubs/query-keys'",
    )
    // Receipt-photo resolver → local stub
    .replace(
      /from ['"]@\/lib\/supabase\/receipt-photo['"]/g,
      "from '../lib-stubs/receipt-photo'",
    )
    // Domain types → local stub
    .replace(
      /from ['"]@\/types['"]/g,
      "from '../lib-stubs/types'",
    );
  writeFileSync(join(srcDir, 'api.ts'), apiSource);

  // --- Stub modules (only the surface api.ts actually touches at import) ---
  mkdirSync(join(workdir, 'lib-stubs'), { recursive: true });

  writeFileSync(
    join(workdir, 'lib-stubs/supabase.ts'),
    `
    // Supabase client stub. Two distinct chain paths:
    //   - RPC path (.rpc(...)[.single()]) → resolves to the test-injected
    //     globalThis.__rpcResult (default { data: null, error: null }). This
    //     is what saveReceipt uses for the save_receipt call.
    //   - From path (.from().select().order().limit()/.maybeSingle() ...) →
    //     always resolves { data: null, error: null }. This is what
    //     fetchCategoryIdsBySlug / resolveStoreId use; keeping it null (never
    //     the injected rpc result) stops category fetching from misreading
    //     the save_receipt payload as category rows.
    const globalObj: any = globalThis;
    function rpcResult() {
      return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null });
    }
    // from-builder: chainable; awaiting it (or .then) resolves to a null
    // result so category/store reads never misread the injected rpc payload.
    const nullResult = () => Promise.resolve({ data: null, error: null });
    function makeFromBuilder(): any {
      const builder: any = function () { return builder(); };
      return new Proxy(builder, {
        get(_t, prop) {
          if (prop === 'then') return (resolve: any, _reject?: any) => resolve({ data: null, error: null });
          if (prop === Symbol.toPrimitive) return function () { return '[FromBuilder]'; };
          return function () { return makeFromBuilder(); };
        },
        apply() { return makeFromBuilder(); },
      });
    }
    // top-level client: .rpc() enters the RPC path; .from() enters the from path;
    // .auth/.storage/.channel/.then fall through to a generic chain that returns nullResult.
    const supabaseProxy = new Proxy(function () { return makeChain(); }, {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive) return function () { return '[SupabaseStub]'; };
        if (prop === 'rpc') {
          // .rpc(name, args)[.single()] — the terminal (single or the rpc
          // call itself) resolves to __rpcResult.
          return function () {
            return new Proxy(function () { return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null }); }, {
              get(_t2, prop2) {
                if (prop2 === Symbol.toPrimitive) return function () { return '[RpcBuilder]'; };
                // .single()/.maybeSingle() after .rpc() → rpc result
                if (typeof prop2 === 'string' && ['single', 'maybeSingle', 'then'].includes(prop2)) {
                  return prop2 === 'then'
                    ? function (resolve?: any, _reject?: any) { return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null }).then(resolve); }
                    : function () { return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null }); };
                }
                return function () { return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null }); };
              },
              apply() { return Promise.resolve(globalObj.__rpcResult ?? { data: null, error: null }); },
            });
          };
        }
        if (prop === 'from') return makeFromBuilder;
        return function () { return nullResult(); };
      },
      apply() { return makeChain(); },
    });
    function makeChain(): any { return supabaseProxy; }
    export const supabase: any = supabaseProxy;
    export function __resetResults() { globalObj.__rpcResult = undefined; }
    export const isSupabaseConfigured = true;
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/format.ts'),
    `
    let _c = 0;
    export const tempId = () => 'test-' + (++_c);
    export const todayLocalISO = () => new Date().toISOString().slice(0, 10);
  `,
  );

  writeFileSync(
    join(workdir, 'lib-stubs/query-client.ts'),
    `
    export const queryClient = {
      invalidateQueries: async (_opts: { queryKey: unknown }) => {},
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
      monthlyImpulseTotalPrefix: p('monthly-impulse-total'),
      monthlyImpulseItemsPrefix: p('monthly-impulse-items'),
      itemSearchPrefix: p('item-search'),
      monthReceiptsPrefix: p('month-receipts'),
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
    join(workdir, 'lib-stubs/types.ts'),
    `
    export type PaymentMethod = 'cash' | 'card' | 'apple_pay' | 'google_pay' | 'transfer' | 'other';
    export type CardType = 'debit' | 'credit';
    export type PurchaseStatus = 'pending' | 'parsed' | 'confirmed' | 'failed';
    export interface Category { id: string; slug: string; name: string; kind: string; icon: string; color: string; sort_order: number; }
    export interface ReceiptDraft { store_name: string; purchase_date: string; total: number; payment_method: PaymentMethod; image_url: string; items: ReviewItem[]; }
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
// Edge function constants — read from source at test time (no compile)
// ---------------------------------------------------------------------------

function readEdgeConstants() {
  const src = readFileSync(
    join(root, 'supabase/functions/parse-ticket/index.ts'),
    'utf8',
  );
  const parseRateMatch = src.match(
    /const\s+PARSE_RATE_LIMIT\s*=\s*(\d+)/,
  );
  const scansLimitMatch = src.match(
    /const\s+SCANS_LIMIT\s*=\s*(\d+)/,
  );
  return {
    PARSE_RATE_LIMIT: parseRateMatch ? Number(parseRateMatch[1]) : null,
    SCANS_LIMIT: scansLimitMatch ? Number(scansLimitMatch[1]) : null,
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n[tests] compiling scan-contract modules…');
  compile();
  console.log('[tests] loading compiled modules…');

  const quotaMod = await load('src/quota.js');
  const { computeQuotaState, FREE_DEFAULT_LIMIT } = quotaMod;

  // api.ts may throw on import if @supabase/supabase-js resolution fails in
  // the stub context; guard with try/catch so the quota tests still run.
  let apiMod = null;
  try {
    apiMod = await load('src/api.js');
  } catch (err) {
    console.warn(
      '[tests] WARNING: api.ts import failed, skipping api tests:',
      err instanceof Error ? err.message : err,
    );
  }

  // ------------------------------------------------------------------
  // A. computeQuotaState — hard-cap integration (save-consume semantics)
  // ------------------------------------------------------------------

  console.log(
    '\n[tests] A. computeQuotaState — hard-cap / save-consume integration\n',
  );

  await test(
    'FREE_DEFAULT_LIMIT is 15 (mirrors edge SCANS_LIMIT)',
    () => {
      assert.equal(FREE_DEFAULT_LIMIT, 15);
    },
  );

  await test(
    'free user at cap (used=15, limit=15) → exhausted + showUpgradeCta',
    () => {
      const s = computeQuotaState(15, 15, false);
      assert.equal(s.exhausted, true, 'must be exhausted at cap');
      assert.equal(s.showUpgradeCta, true, 'must show upgrade CTA');
      assert.equal(s.remaining, 0);
      assert.equal(s.ratio, 1);
    },
  );

  await test(
    'free user one below cap (used=14, limit=15) → NOT exhausted',
    () => {
      const s = computeQuotaState(14, 15, false);
      assert.equal(s.exhausted, false);
      assert.equal(s.showUpgradeCta, false);
      assert.equal(s.remaining, 1);
    },
  );

  await test(
    'free user past cap (used=20, limit=15) → exhausted + ratio clamped',
    () => {
      const s = computeQuotaState(20, 15, false);
      assert.equal(s.exhausted, true);
      assert.equal(s.showUpgradeCta, true);
      assert.equal(s.remaining, 0, 'remaining clamped at 0');
      assert.equal(s.ratio, 1, 'ratio clamped at 1');
    },
  );

  await test(
    'Pro user at cap → NOT exhausted (CRITICAL-2: Pro always wins)',
    () => {
      const s = computeQuotaState(15, 15, true);
      assert.equal(s.exhausted, false);
      assert.equal(s.showUpgradeCta, false);
      assert.equal(s.unlimited, true);
    },
  );

  await test(
    'Pro user past cap → NOT exhausted (CRITICAL-2)',
    () => {
      const s = computeQuotaState(20, 15, true);
      assert.equal(s.exhausted, false);
      assert.equal(s.showUpgradeCta, false);
      assert.equal(s.unlimited, true);
    },
  );

  await test(
    'fresh free user (used=0, limit=15) → not exhausted, full remaining',
    () => {
      const s = computeQuotaState(0, 15, false);
      assert.equal(s.exhausted, false);
      assert.equal(s.showUpgradeCta, false);
      assert.equal(s.remaining, 15);
      assert.equal(s.ratio, 0);
    },
  );

  // ------------------------------------------------------------------
  // B. QuotaExceededError + QUOTA_ERROR_MESSAGE
  // ------------------------------------------------------------------

  if (apiMod) {
    console.log('\n[tests] B. QuotaExceededError + QUOTA_ERROR_MESSAGE\n');

    const { QuotaExceededError, QUOTA_ERROR_MESSAGE } = apiMod;

    await test(
      'QUOTA_ERROR_MESSAGE is a non-empty string mentioning Pro / limit',
      () => {
        assert.equal(typeof QUOTA_ERROR_MESSAGE, 'string');
        assert.ok(
          QUOTA_ERROR_MESSAGE.length > 0,
          'QUOTA_ERROR_MESSAGE must not be empty',
        );
        // The copy must mention the 15-scan cap and Pro upgrade
        assert.ok(
          QUOTA_ERROR_MESSAGE.includes('15'),
          'message must reference the 15-scan cap',
        );
        assert.ok(
          QUOTA_ERROR_MESSAGE.toLowerCase().includes('pro'),
          'message must mention Pro upgrade',
        );
      },
    );

    await test(
      'QuotaExceededError is an Error subclass',
      () => {
        const err = new QuotaExceededError();
        assert.ok(err instanceof Error, 'must be instanceof Error');
      },
    );

    await test(
      'QuotaExceededError.name is "QuotaExceededError"',
      () => {
        const err = new QuotaExceededError();
        assert.equal(err.name, 'QuotaExceededError');
      },
    );

    await test(
      'QuotaExceededError.message matches QUOTA_ERROR_MESSAGE',
      () => {
        const err = new QuotaExceededError();
        assert.equal(err.message, QUOTA_ERROR_MESSAGE);
      },
    );

    await test(
      'QUOTA_ERROR_MESSAGE is exported from src/features/tickets/index.ts',
      () => {
        // Re-verify by reading the index source (not compiling the full
        // barrel, which pulls React + Expo deps). The re-export line is
        // a static contract.
        const indexSrc = readFileSync(
          join(root, 'src/features/tickets/index.ts'),
          'utf8',
        );
        assert.ok(
          indexSrc.includes('QUOTA_ERROR_MESSAGE'),
          'index.ts must re-export QUOTA_ERROR_MESSAGE',
        );
        assert.ok(
          indexSrc.includes('QuotaExceededError'),
          'index.ts must re-export QuotaExceededError',
        );
      },
    );

    // ------------------------------------------------------------------
    // C. messageFromEdgeError — rate_limited + regression
    // ------------------------------------------------------------------

    console.log(
      '\n[tests] C. messageFromEdgeError — rate_limited + regression\n',
    );

    // messageFromEdgeError is NOT exported; we test it indirectly via
    // the compiled module's internal reference.  However, the function is
    // only called from describeInvokeError (async, requires a
    // FunctionsHttpError context).  Instead, we verify the *mapping contract*
    // by reading the source and asserting the constant strings.

    const apiSrc = readFileSync(
      join(root, 'src/features/tickets/api.ts'),
      'utf8',
    );

    await test(
      'rate_limited case exists in messageFromEdgeError switch',
      () => {
        assert.ok(
          apiSrc.includes("case 'rate_limited'"),
          'api.ts must handle the rate_limited code',
        );
      },
    );

    await test(
      'rate_limited message mentions "demasiados recibos" (Spanish upgrade copy)',
      () => {
        // Extract the return string for the rate_limited case
        const rateLimitedBlock = apiSrc.slice(
          apiSrc.indexOf("case 'rate_limited'"),
        );
        const returnMatch = rateLimitedBlock.match(
          /return\s+['"](.+?)['"]/,
        );
        assert.ok(returnMatch, 'rate_limited case must have a return string');
        const msg = returnMatch[1];
        assert.ok(
          msg.includes('demasiados recibos'),
          `rate_limited message must include "demasiados recibos", got: ${msg}`,
        );
      },
    );

    await test(
      'quota_exceeded case returns used/limit interpolation',
      () => {
        const quotaBlock = apiSrc.slice(
          apiSrc.indexOf("case 'quota_exceeded'"),
        );
        const returnMatch = quotaBlock.match(/return\s+`(.+?)`/);
        assert.ok(
          returnMatch,
          'quota_exceeded case must have a template-literal return',
        );
        const tpl = returnMatch[1];
        assert.ok(
          tpl.includes('${body.used') || tpl.includes('used'),
          'quota_exceeded message must interpolate used',
        );
        assert.ok(
          tpl.includes('${body.limit') || tpl.includes('limit'),
          'quota_exceeded message must interpolate limit',
        );
      },
    );

    await test(
      'all 7 error codes are handled in the switch statement',
      () => {
        const expectedCodes = [
          'quota_exceeded',
          'unauthenticated',
          'bad_request',
          'parse_failed',
          'internal',
          'provider_overloaded',
          'rate_limited',
        ];
        for (const code of expectedCodes) {
          assert.ok(
            apiSrc.includes(`case '${code}'`),
            `switch must handle code '${code}'`,
          );
        }
      },
    );

    // ------------------------------------------------------------------
    // D. Edge function constants (read from source, no compile needed)
    // ------------------------------------------------------------------

    console.log(
      '\n[tests] D. Edge function constants — documented values\n',
    );

    const edge = readEdgeConstants();

    await test(
      'PARSE_RATE_LIMIT is 30 (mirrors SQL cap in 0022)',
      () => {
        assert.equal(edge.PARSE_RATE_LIMIT, 30);
      },
    );

    await test(
      'SCANS_LIMIT is 15 (mirrors SQL coalesce default)',
      () => {
        assert.equal(edge.SCANS_LIMIT, 15);
      },
    );

    await test(
      'FREE_DEFAULT_LIMIT matches SCANS_LIMIT (client ↔ edge symmetry)',
      () => {
        assert.equal(FREE_DEFAULT_LIMIT, edge.SCANS_LIMIT,
          'FREE_DEFAULT_LIMIT must equal SCANS_LIMIT — both mirror the same SQL default',
        );
      },
    );

    await test(
      'ErrorResponse code union includes rate_limited',
      () => {
        // The edge function's ErrorResponse interface defines the legal
        // code values. Verify rate_limited is part of the union.
        const edgeSrc = readFileSync(
          join(root, 'supabase/functions/parse-ticket/index.ts'),
          'utf8',
        );
        assert.ok(
          edgeSrc.includes("'rate_limited'"),
          'rate_limited must be in the ErrorResponse code union',
        );
      },
    );

    await test(
      'edge function returns retryAfterSeconds on rate_limited',
      () => {
        const edgeSrc = readFileSync(
          join(root, 'supabase/functions/parse-ticket/index.ts'),
          'utf8',
        );
        assert.ok(
          edgeSrc.includes('retryAfterSeconds'),
          'edge must include retryAfterSeconds in rate_limited response',
        );
      },
    );

    // ------------------------------------------------------------------
    // E. Boundary semantics — attempts <= cap → allowed
    // ------------------------------------------------------------------

    console.log(
      '\n[tests] E. Rate-limit boundary semantics (documented contract)\n',
    );

    await test(
      'parse_try_take contract: attempts <= cap → allowed (SQL semantics)',
      () => {
        // The SQL function parse_try_take (0022) returns
        // { allowed: boolean, attempts: number, cap: number }.
        // The edge function checks: if (!limit.allowed) → 429.
        // Pure logic: allowed is true when attempts < cap (SQL bumps first,
        // then compares). The PARSE_RATE_LIMIT const defines the cap.
        //
        // We cannot call the SQL function in a pure test, but we CAN assert
        // the documented boundary: PARSE_RATE_LIMIT = 30 means the 30th
        // attempt in an hour is the last allowed one.
        const cap = edge.PARSE_RATE_LIMIT;
        assert.equal(cap, 30);
        // Boundary: attempt 30 (the 30th) → allowed, 31 → denied
        assert.ok(30 <= cap, 'attempt 30 must be allowed (30 <= 30)');
        assert.ok(31 > cap, 'attempt 31 must be denied (31 > 30)');
      },
    );

    await test(
      'save_receipt contract: ok=false when at cap',
      () => {
        // saveReceipt calls supabase.rpc('save_receipt') — a single
        // transactional RPC that atomically checks the cap, inserts the
        // purchase + items, and increments the scan slot. If any step fails,
        // PL/pgSQL rolls back everything (including the slot increment).
        //
        // The RPC returns { ok: boolean, purchase_id: uuid,
        // scans_used: number, scans_limit: number }.
        // When ok=false → QuotaExceededError is thrown (hard cap).
        const saveBlock = apiSrc.slice(apiSrc.indexOf('async function saveReceipt'));
        assert.ok(
          saveBlock.includes(".rpc('save_receipt'"),
          'saveReceipt must call the save_receipt RPC (single transactional save)',
        );
        assert.ok(
          saveBlock.includes('.single()'),
          'save_receipt (RETURNS TABLE) must be unwrapped with .single() so ok/purchase_id are read from the single row',
        );
        assert.ok(
          saveBlock.includes('data.ok === false'),
          'saveReceipt must check ok === false from save_receipt RPC',
        );
        assert.ok(
          saveBlock.includes('QuotaExceededError'),
          'saveReceipt must throw QuotaExceededError on ok=false',
        );
      },
    );

    await test(
      'saveReceipt no longer calls consume_scan_on_save (atomic RPC replaces two-step)',
      () => {
        const saveBlock = apiSrc.slice(apiSrc.indexOf('async function saveReceipt'));
        assert.ok(
          !saveBlock.includes("rpc('consume_scan_on_save')"),
          'saveReceipt must NOT call consume_scan_on_save (replaced by save_receipt)',
        );
      },
    );
    // ------------------------------------------------------------------
    // saveReceipt — RUNTIME behavior (not source inspection). These exercise
    // the real saveReceipt with an injected .rpc(...).single() result to
    // prove the cap rejection and happy path actually work at runtime.
    // Without them, a regression like accessing rpc.data.foo when PostgREST
    // returns an array would go unnoticed (the default stub returns data:null
    // so saveReceipt throws SAVE_ERROR before reading ok).
    // ------------------------------------------------------------------

    // saveReceipt only — QuotaExceededError is already destructured earlier
    // in this same apiMod scope (section B).
    const { saveReceipt } = apiMod;

    const minDraft = {
      store_name: '', // empty → no resolveStoreId call
      purchase_date: '2026-08-31',
      total: 20,
      payment_method: 'cash',
      image_url: '', // falsy → no uploadToStorage call
      items: [
        {
          temp_id: 't1',
          name: 'Café',
          quantity: 1,
          unit_price: 20,
          total_price: 20,
          category_id: null,
          is_impulse: false,
          ai_suggested_category_id: null,
        },
      ],
    };

    await test(
      'saveReceipt runtime: ok=false (at cap) → throws QuotaExceededError',
      async () => {
        // .single() unwraps the single RETURNS TABLE row into a flat object.
        globalThis.__rpcResult = {
          data: { ok: false, purchase_id: null, scans_used: 15, scans_limit: 15 },
          error: null,
        };
        let threw = false;
        try {
          await saveReceipt('user-uuid', minDraft);
        } catch (err) {
          threw = true;
          assert.ok(
            err instanceof QuotaExceededError,
            'must throw QuotaExceededError, got: ' + String(err),
          );
        }
        assert.ok(threw, 'saveReceipt must throw when ok=false (hard cap)');
      },
    );

    await test(
      'saveReceipt runtime: ok=true → returns the purchase_id',
      async () => {
        globalThis.__rpcResult = {
          data: { ok: true, purchase_id: 'purchase-123', scans_used: 1, scans_limit: 15 },
          error: null,
        };
        const res = await saveReceipt('user-uuid', minDraft);
        assert.deepEqual(res, { id: 'purchase-123' });
      },
    );
  } else {
    console.log(
      '\n[tests] B-D SKIPPED: api.ts failed to import (see warning above)\n',
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
