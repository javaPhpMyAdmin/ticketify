#!/usr/bin/env node
/**
 * Node harness for the pure parse-ticket helpers in
 * `supabase/functions/parse-ticket/lib/parse.ts`.
 *
 * Compiles the module with an isolated tsconfig and asserts the validation
 * contracts that both receipt mode and list mode rely on. Network/Deno
 * behavior (the Gemini call and the HTTP handler) is out of scope here.
 *
 * Usage: pnpm test:parse-ticket
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
const workdir = mkdtempSync(join(tmpRoot, 'parse-ticket-test-'));
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

function compile() {
  mkdirSync(srcDir, { recursive: true });

  const libDir = join(root, 'supabase', 'functions', 'parse-ticket', 'lib');
  copyFileSync(join(libDir, 'card.ts'), join(srcDir, 'card.ts'));
  const parseSource = readFileSync(join(libDir, 'parse.ts'), 'utf8')
    // Node's CJS loader needs the emitted .js file; Deno keeps the .ts path.
    .replace(/from ['"]\.\/card\.ts['"]/g, "from './card.js'");
  writeFileSync(join(srcDir, 'parse.ts'), parseSource);

  // The client catalog is compiled alongside so the parity pin compares the
  // edge's duplicate catalog against the REAL source of truth
  // (`src/lib/format.ts`), not a hand-written copy inside this harness —
  // a fixture would drift in lockstep with the duplicate and prove nothing.
  copyFileSync(join(root, 'src', 'lib', 'format.ts'), join(srcDir, 'format.ts'));

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
    include: ['./src/*.ts'],
  };
  writeFileSync(join(workdir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], {
    cwd: workdir,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

function item(overrides = {}) {
  return {
    name: 'Leche',
    quantity: 1,
    unit_price: 45,
    total_price: 45,
    suggested_category_slug: null,
    ...overrides,
  };
}

async function run() {
  console.log('\n[tests] compiling parse-ticket helpers…');
  compile();
  console.log('[tests] loading compiled module…');
  const parseMod = await load('src/parse.js');
  const formatMod = await load('src/format.js');
  const indexSource = readFileSync(
    join(root, 'supabase', 'functions', 'parse-ticket', 'index.ts'),
    'utf8',
  );
  const {
    parseListJson,
    parseItem,
    parseReceiptJson,
    ParseError,
    ProviderOverloadedError,
    withProviderRetry,
    PROVIDER_RETRY_DELAYS_MS,
    SUPPORTED_CURRENCIES,
  } = parseMod;

  console.log('\n[tests] parseListJson\n');

  await test('parseListJson extracts items and sums total_price', () => {
    const result = parseListJson({
      items: [
        item({ name: 'Leche', total_price: 45 }),
        item({ name: 'Pan', quantity: 2, unit_price: 30, total_price: 60 }),
      ],
    });
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 105);
    assert.equal(result.items[0].name, 'Leche');
    assert.equal(result.items[1].total_price, 60);
  });

  await test('parseListJson rejects an empty items array', () => {
    assert.throws(() => parseListJson({ items: [] }), ParseError);
  });

  await test('parseListJson rejects a missing items array', () => {
    assert.throws(() => parseListJson({}), ParseError);
  });

  await test('parseListJson rejects a top-level array', () => {
    assert.throws(() => parseListJson([item()]), ParseError);
  });

  await test('parseListJson normalizes invalid category slugs to null', () => {
    const result = parseListJson({
      items: [item({ suggested_category_slug: 'not-a-category' })],
    });
    assert.equal(result.items[0].suggested_category_slug, null);
  });

  await test('parseListJson keeps valid category slugs', () => {
    const result = parseListJson({
      items: [item({ suggested_category_slug: 'lacteos' })],
    });
    assert.equal(result.items[0].suggested_category_slug, 'lacteos');
  });

  console.log('\n[tests] parseItem validation reused by list mode\n');

  await test('parseItem rejects an empty name', () => {
    assert.throws(() => parseItem({ ...item(), name: '   ' }, 0), ParseError);
  });

  await test('parseItem rejects a non-numeric price', () => {
    assert.throws(
      () => parseItem({ ...item(), total_price: 'forty-five' }, 0),
      ParseError,
    );
  });

  await test('parseItem clamps quantity to a positive integer', () => {
    const parsed = parseItem({ ...item(), quantity: 0 }, 0);
    assert.equal(parsed.quantity, 1);
  });

  await test('parseItem re-derives unit_price when quantity × unit_price mismatches total', () => {
    const parsed = parseItem(
      { name: 'Coca', quantity: 2, unit_price: 94, total_price: 94 },
      0,
    );
    assert.equal(parsed.quantity, 2);
    assert.equal(parsed.unit_price, 47);
    assert.equal(parsed.total_price, 94);
  });

  console.log('\n[tests] parseReceiptJson still enforces receipt shape\n');

  await test('parseReceiptJson accepts a well-formed receipt', () => {
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2026-08-13',
      total: 100,
      payment_method: 'card',
      card_brand: 'Visa',
      card_type: 'credit',
      items: [item()],
    });
    assert.equal(result.store_name, 'Coto');
    assert.equal(result.purchase_date, '2026-08-13');
    assert.equal(result.card_brand, 'Visa');
    assert.equal(result.card_type, 'credit');
  });

  await test('parseReceiptJson rejects a missing store_name', () => {
    assert.throws(
      () =>
        parseReceiptJson({
          purchase_date: '2026-08-13',
          total: 100,
          payment_method: 'other',
          items: [item()],
        }),
      ParseError,
    );
  });

  await test('parseReceiptJson defaults an invalid purchase_date to today', () => {
    // A calendar-invalid date (2026-02-30) is best-effort: the parse must
    // NOT throw — it defaults to today so the scan survives Gemini
    // garbling the date (bug-fix contract: missing/invalid date → today).
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2026-02-30',
      total: 100,
      payment_method: 'other',
      items: [item()],
    });
    assert.equal(result.purchase_date, new Date().toISOString().slice(0, 10));
  });

  await test('parseReceiptJson rejects a purchase_date with a wrong year (hallucinated)', () => {
    // Gemini hallucinated 2023 instead of 2026 — the parser must reject it
    // and fall back to today (±1 year range guard).
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2023-08-19',
      total: 100,
      payment_method: 'other',
      items: [item()],
    });
    assert.equal(result.purchase_date, new Date().toISOString().slice(0, 10));
  });

  await test('parseReceiptJson accepts a purchase_date within ±1 year', () => {
    const currentYear = new Date().getUTCFullYear();
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: `${currentYear}-08-19`,
      total: 100,
      payment_method: 'other',
      items: [item()],
    });
    assert.equal(result.purchase_date, `${currentYear}-08-19`);
  });

  await test('parseReceiptJson defaults a missing purchase_date to today', () => {
    const result = parseReceiptJson({
      store_name: 'Coto',
      total: 100,
      payment_method: 'other',
      items: [item()],
    });
    assert.equal(result.purchase_date, new Date().toISOString().slice(0, 10));
  });

  await test('parseReceiptJson normalizes unknown payment methods to other', () => {
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2026-08-13',
      total: 100,
      payment_method: 'crypto',
      items: [item()],
    });
    assert.equal(result.payment_method, 'other');
  });

  console.log('\n[tests] currency extraction (REQ-LIST-2/3/4, REQ-8)\n');

  await test('parseListJson carries a catalog currency (REQ-LIST-2 s1)', () => {
    const result = parseListJson({
      items: [item()],
      currency: 'CLP',
    });
    assert.equal(result.currency, 'CLP');
    // REQ-LIST-4 s1: the unit rides alongside the pre-change members.
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 45);
  });

  await test('parseListJson omits an absent currency and still succeeds (REQ-LIST-2 s2)', () => {
    const result = parseListJson({ items: [item()] });
    assert.equal('currency' in result, false);
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 45);
  });

  await test('parseListJson drops an out-of-catalog currency without throwing (REQ-LIST-3 s1)', () => {
    const result = parseListJson({
      items: [item()],
      currency: 'XYZ',
    });
    assert.equal('currency' in result, false);
    // Items and total are untouched by a rejected unit — only the unit is
    // dropped, so the receipt falls back to the viewer's profile currency.
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 45);
  });

  await test('parseListJson upper-cases a lower-case catalog currency', () => {
    const result = parseListJson({
      items: [item()],
      currency: 'clp',
    });
    assert.equal(result.currency, 'CLP');
  });

  await test('parseListJson drops a non-string currency instead of throwing', () => {
    const result = parseListJson({
      items: [item()],
      currency: 5000,
    });
    assert.equal('currency' in result, false);
  });

  await test('parseReceiptJson carries a catalog currency (REQ-8 scan path)', () => {
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2026-08-13',
      total: 5000,
      payment_method: 'card',
      items: [item()],
      currency: 'CLP',
    });
    assert.equal(result.currency, 'CLP');
    // REQ-LIST-4 s1's "every other member unchanged" equivalent for receipt mode.
    assert.equal(result.store_name, 'Coto');
    assert.equal(result.total, 5000);
    assert.equal(result.payment_method, 'card');
    assert.equal(result.items.length, 1);
  });

  await test('parseReceiptJson omits an absent currency (legacy shape unchanged)', () => {
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2026-08-13',
      total: 100,
      payment_method: 'other',
      items: [item()],
    });
    assert.equal('currency' in result, false);
  });

  await test('parseReceiptJson drops an out-of-catalog currency without throwing (REQ-8 #2)', () => {
    const result = parseReceiptJson({
      store_name: 'Coto',
      purchase_date: '2026-08-13',
      total: 100,
      payment_method: 'other',
      items: [item()],
      currency: 'XYZ',
    });
    assert.equal('currency' in result, false);
    assert.equal(result.store_name, 'Coto');
  });

  console.log('\n[tests] prompt pins (index.ts source — the harness cannot import Deno)\n');

  const receiptPrompt = /const PROMPT = `([\s\S]*?)`;/.exec(indexSource)?.[1];
  const listPrompt = /const LIST_PROMPT = `([\s\S]*?)`;/.exec(indexSource)?.[1];

  await test('receipt prompt asks for the ISO 4217 unit', () => {
    assert.ok(receiptPrompt, 'PROMPT literal not found in index.ts');
    assert.match(receiptPrompt, /ISO 4217/);
    assert.match(receiptPrompt, /"currency"/);
  });

  await test('list prompt asks for the ISO 4217 unit', () => {
    assert.ok(listPrompt, 'LIST_PROMPT literal not found in index.ts');
    assert.match(listPrompt, /ISO 4217/);
    assert.match(listPrompt, /"currency"/);
  });

  await test('both prompts keep the plain-numbers rule (symbols stay out of money fields)', () => {
    assert.ok(receiptPrompt && listPrompt, 'prompt literals not found in index.ts');
    assert.match(
      receiptPrompt,
      /All money values must be plain numbers without currency symbols or thousands separators\./,
    );
    assert.match(
      listPrompt,
      /All money values must be plain numbers without currency symbols or thousands separators\./,
    );
  });

  await test('list-mode builder forwards the validated unit into the ParsedReceipt (REQ-LIST-4 s1)', () => {
    const fn = /function listToReceipt\([\s\S]*?\n\}/.exec(indexSource);
    assert.ok(fn, 'listToReceipt not found in index.ts');
    // Assignment, not token: a bare /currency/ also matches the surrounding
    // comments and the `currency` property on adjacent objects — pin the
    // forwarding line itself.
    assert.match(fn[0], /receipt\.currency\s*=\s*list\.currency/);
  });

  await test('list-mode builder leaves the other members defaulted (REQ-LIST-4 s2)', () => {
    const fn = /function listToReceipt\([\s\S]*?\n\}/.exec(indexSource);
    assert.ok(fn, 'listToReceipt not found in index.ts');
    for (const member of [
      "store_name: ''",
      'payment_method:',
      'card_brand: null',
      'card_type: null',
      'items: list.items',
    ]) {
      assert.ok(
        fn[0].includes(member),
        `listToReceipt must still default \`${member}\``,
      );
    }
  });

  console.log('\n[tests] edge catalog parity (duplicate + parity test — edge cannot import src/)\n');

  await test("edge SUPPORTED_CURRENCIES matches src/lib/format.ts SUPPORTED_CURRENCIES", () => {
    assert.ok(
      Array.isArray(SUPPORTED_CURRENCIES),
      'edge lib/parse.ts must export its own SUPPORTED_CURRENCIES duplicate',
    );
    assert.deepEqual(
      [...SUPPORTED_CURRENCIES].sort(),
      [...formatMod.SUPPORTED_CURRENCIES].sort(),
      'edge duplicate catalog drifted from the client source of truth',
    );
    assert.equal(
      new Set(SUPPORTED_CURRENCIES).size,
      SUPPORTED_CURRENCIES.length,
      'edge duplicate catalog has duplicate codes',
    );
  });

  console.log('\n[tests] withProviderRetry (transient provider overload backoff)\n');

  await test('retries a ProviderOverloadedError and succeeds on the second attempt', async () => {
    let calls = 0;
    const result = await withProviderRetry(async () => {
      calls += 1;
      if (calls === 1) throw new ProviderOverloadedError('overloaded');
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  await test('retries a ProviderOverloadedError and succeeds on the last attempt', async () => {
    let calls = 0;
    const result = await withProviderRetry(async () => {
      calls += 1;
      if (calls <= PROVIDER_RETRY_DELAYS_MS.length) {
        throw new ProviderOverloadedError('overloaded');
      }
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, PROVIDER_RETRY_DELAYS_MS.length + 1);
  });

  await test('re-throws ProviderOverloadedError when retries are exhausted', async () => {
    let calls = 0;
    await assert.rejects(
      withProviderRetry(async () => {
        calls += 1;
        throw new ProviderOverloadedError('overloaded');
      }),
      (err) => err instanceof ProviderOverloadedError && err.message === 'overloaded',
    );
    // One initial attempt + one retry per configured delay.
    assert.equal(calls, PROVIDER_RETRY_DELAYS_MS.length + 1);
  });

  await test('does NOT retry a non-provider error (LLM-content/validation)', async () => {
    let calls = 0;
    await assert.rejects(
      withProviderRetry(async () => {
        calls += 1;
        throw new ParseError('malformed json');
      }),
      (err) => err instanceof ParseError,
    );
    assert.equal(calls, 1);
  });

  await test('backoff delays are increasing and positive', () => {
    assert.equal(PROVIDER_RETRY_DELAYS_MS.length, 2);
    for (let i = 1; i < PROVIDER_RETRY_DELAYS_MS.length; i += 1) {
      assert.ok(PROVIDER_RETRY_DELAYS_MS[i] > PROVIDER_RETRY_DELAYS_MS[i - 1]);
      assert.ok(PROVIDER_RETRY_DELAYS_MS[i] > 0);
    }
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
