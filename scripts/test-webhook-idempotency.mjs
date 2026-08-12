#!/usr/bin/env node
/**
 * Node harness for the RevenueCat webhook idempotency helpers:
 *
 *   - `supabase/functions/revenuecat-webhook/lib/uuid.ts` → `isUuid`
 *   - `supabase/functions/revenuecat-webhook/lib/event-types.ts` → `mapTier`,
 *     `isProductionEnvironment`
 *
 * Both modules are pure (no Deno globals, no I/O, no project imports) so
 * the harness compiles them with the minimal `@/*` remap and a single
 * `globals.d.ts` shim. Asserts:
 *
 *   `isUuid` — RFC 4122 v4 grammar:
 *     - version nibble MUST be `4`, variant nibble MUST be `8`/`9`/`a`/`b`,
 *     - case-insensitive (Postgres `uuid` accepts both),
 *     - rejects wrong version, wrong variant, non-canonical strings,
 *       empty input, and non-string input (defensive: callers pass a
 *       string, but the function must not crash on `null`).
 *
 *   `mapTier` — REQ-SYNC-1 / REQ-SYNC-2 / REQ-SYNC-7:
 *     - GRANT set → `'pro'`,
 *     - REVOKE set → `'free'`,
 *     - everything else (e.g. PRODUCT_CHANGE) → `null` (handler answers
 *       200 no-op — unrecognized events MUST NOT surface as errors).
 *
 *   `isProductionEnvironment` — env-var → boolean:
 *     - `'production'` → true,
 *     - `'sandbox'` → false,
 *     - `''` (unset / default) → true (safe-by-default posture).
 *
 * Usage: pnpm test:webhook-idempotency
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
const harnessConfig = join(__dirname, 'tsconfig.webhook-idempotency-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'webhook-idempotency-test-'));
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

function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function run() {
  console.log('\n[tests] compiling webhook idempotency modules…');
  await compile();
  console.log('[tests] loading compiled modules…');
  installRequireHook();
  const uuidMod = await import(
    pathToFileURL(join(outDir, 'supabase/functions/revenuecat-webhook/lib/uuid.js')).href
  );
  const eventMod = await import(
    pathToFileURL(join(outDir, 'supabase/functions/revenuecat-webhook/lib/event-types.js'))
      .href
  );
  const { isUuid } = uuidMod;
  const { mapTier, isProductionEnvironment } = eventMod;

  console.log('\n[tests] isUuid — RFC 4122 v4 grammar\n');

  await test('valid UUID v4 (lowercase) → true', () => {
    assert.equal(isUuid('00000000-0000-4000-8000-000000000000'), true);
  });

  await test('valid UUID v4 (uppercase) → true (case-insensitive)', () => {
    assert.equal(isUuid('FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF'), true);
  });

  await test('valid UUID v4 (mixed case) → true', () => {
    assert.equal(isUuid('A1B2c3D4-e5F6-4a7B-89c0-1234567890AB'), true);
  });

  await test('wrong variant nibble (4th group starts with 0) → false', () => {
    assert.equal(isUuid('00000000-0000-4000-0000-000000000000'), false);
  });

  await test('wrong version nibble (3rd group starts with 3) → false', () => {
    assert.equal(isUuid('00000000-0000-3000-8000-000000000000'), false);
  });

  await test('non-canonical string → false', () => {
    assert.equal(isUuid('not-a-uuid'), false);
  });

  await test('empty string → false', () => {
    assert.equal(isUuid(''), false);
  });

  await test('non-string input (null) → false (defensive, no throw)', () => {
    // @ts-expect-error — exercising the runtime guard, not the type contract.
    assert.equal(isUuid(null), false);
  });

  await test('too short (missing one nibble) → false', () => {
    assert.equal(isUuid('00000000-0000-4000-8000-00000000000'), false);
  });

  await test('too long (extra nibble) → false', () => {
    assert.equal(isUuid('00000000-0000-4000-8000-0000000000000'), false);
  });

  await test('missing dashes → false', () => {
    assert.equal(isUuid('00000000000040008000000000000000'), false);
  });

  await test('non-hex character in a group → false', () => {
    assert.equal(isUuid('00000000-0000-4000-8000-00000000000g'), false);
  });

  console.log('\n[tests] mapTier — GRANT / REVOKE / unrecognized\n');

  await test('INITIAL_PURCHASE → pro (grant)', () => {
    assert.equal(mapTier('INITIAL_PURCHASE'), 'pro');
  });

  await test('RENEWAL → pro (grant)', () => {
    assert.equal(mapTier('RENEWAL'), 'pro');
  });

  await test('UNCANCELLATION → pro (grant)', () => {
    assert.equal(mapTier('UNCANCELLATION'), 'pro');
  });

  await test('CANCELLATION → free (revoke)', () => {
    assert.equal(mapTier('CANCELLATION'), 'free');
  });

  await test('EXPIRATION → free (revoke)', () => {
    assert.equal(mapTier('EXPIRATION'), 'free');
  });

  await test('BILLING_ISSUE → free (revoke — REQ-SYNC-2)', () => {
    assert.equal(mapTier('BILLING_ISSUE'), 'free');
  });

  await test('PRODUCT_CHANGE → null (unrecognized → 200 no-op)', () => {
    assert.equal(mapTier('PRODUCT_CHANGE'), null);
  });

  await test('NON_RENEWING_PURCHASE → null (unrecognized → 200 no-op)', () => {
    assert.equal(mapTier('NON_RENEWING_PURCHASE'), null);
  });

  await test('empty string → null (defensive)', () => {
    assert.equal(mapTier(''), null);
  });

  console.log('\n[tests] isProductionEnvironment — env-var boolean\n');

  await test("'production' → true", () => {
    assert.equal(isProductionEnvironment('production'), true);
  });

  await test("'sandbox' → false", () => {
    assert.equal(isProductionEnvironment('sandbox'), false);
  });

  await test("'' (unset / default) → true (safe-by-default)", () => {
    assert.equal(isProductionEnvironment(''), true);
  });

  await test("unknown env values fall back to production (safe-by-default)", () => {
    // Anything other than the literal 'sandbox' is treated as production.
    assert.equal(isProductionEnvironment('PRODUCTION'), true);
    assert.equal(isProductionEnvironment('Sandbox'), true);
    assert.equal(isProductionEnvironment('dev'), true);
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
