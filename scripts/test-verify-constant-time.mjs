#!/usr/bin/env node
/**
 * Node harness for the constant-time shared-secret compare
 * (`supabase/functions/revenuecat-webhook/lib/verify.ts` → `verifySecret`).
 *
 * Compiles the module with an isolated tsconfig (no project imports —
 * `verify.ts` consumes only the WebCrypto `crypto.subtle` + `TextEncoder`
 * globals, both available on Node ≥ 18 / Deno) and asserts:
 *
 *   - correctness: same secret → true; different / empty / length-mismatch
 *     → false; both-empty is also true (same digest).
 *   - determinism: same input → same result on re-call (no caching /
 *     nonce / global state that could flip the verdict).
 *   - WARNING-3 invariant (weak timing oracle check): SHA-256 + 32-byte
 *     XOR walk is constant-time in theory. We assert that the per-call
 *     time stays within a 2.5× max/min ratio across four "shapes" of
 *     input (match / mismatch / length-mismatch / prefix-mismatch). The
 *     tolerance is intentionally generous (CI runners are noisy); a
 *     blatant regression (e.g. an early `return false` on length diff)
 *     would push the ratio well past this and fail the test.
 *
 * The timing test is best-effort — it documents the WARNING-3 contract
 * in executable form but cannot prove constant-time in the cryptographic
 * sense. Run it locally for a tighter signal; CI gets a regression
 * tripwire.
 *
 * Usage: pnpm test:verify-constant-time
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
const harnessConfig = join(__dirname, 'tsconfig.verify-constant-time-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'verify-constant-time-test-'));
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

/**
 * Run `verifySecret(provided, expected)` N times serially, return the
 * average per-call wall time in milliseconds. Serial (not Promise.all)
 * keeps the comparison honest — no microtask scheduling noise.
 */
async function measurePerCallMs(iterations, provided, expected) {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    await verifySecret(provided, expected);
  }
  return (performance.now() - t0) / iterations;
}

let verifySecret;

async function run() {
  console.log('\n[tests] compiling verify module…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  ({ verifySecret } = await import(
    pathToFileURL(join(outDir, 'supabase/functions/revenuecat-webhook/lib/verify.js')).href
  ));

  console.log('\n[tests] correctness\n');

  await test('same secret → true', async () => {
    assert.equal(await verifySecret('a', 'a'), true);
  });

  await test('different secrets → false', async () => {
    assert.equal(await verifySecret('a', 'b'), false);
  });

  await test('both empty → true (same SHA-256 digest of the empty string)', async () => {
    assert.equal(await verifySecret('', ''), true);
  });

  await test('empty vs non-empty → false', async () => {
    assert.equal(await verifySecret('', 'a'), false);
  });

  await test('non-empty vs empty → false', async () => {
    assert.equal(await verifySecret('a', ''), false);
  });

  await test('length mismatch (1 vs 1000) → false', async () => {
    assert.equal(await verifySecret('a', 'a'.repeat(1000)), false);
  });

  await test('re-call with the same input is deterministic (no global state)', async () => {
    assert.equal(await verifySecret('a', 'a'), true);
    assert.equal(await verifySecret('a', 'a'), true);
    assert.equal(await verifySecret('a', 'b'), false);
    assert.equal(await verifySecret('a', 'b'), false);
  });

  console.log('\n[tests] WARNING-3 invariant (timing oracle — weak check)\n');

  await test('per-call time stays within a 2.5× max/min ratio across input shapes', async () => {
    // Warm up — the first few iterations hit JIT, GC, and module-load paths
    // that would otherwise skew the first measurement by an order of
    // magnitude. 50 calls is plenty for V8 to inline the helper.
    for (let i = 0; i < 50; i++) await verifySecret('warmup', 'warmup');

    const ITERS = 200;

    const tMatch = await measurePerCallMs(ITERS, 'shared-secret', 'shared-secret');
    const tMismatch = await measurePerCallMs(ITERS, 'shared-secret', 'shared-secrex');
    const tLengthDiff = await measurePerCallMs(ITERS, 'a', 'a'.repeat(2048));
    const tPrefixDiff = await measurePerCallMs(ITERS, 'shared', 'Xhared');

    const samples = [tMatch, tMismatch, tLengthDiff, tPrefixDiff];
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const ratio = max / min;

    console.log(
      `        per-call ms → match=${tMatch.toFixed(3)}  mismatch=${tMismatch.toFixed(3)}  length-diff=${tLengthDiff.toFixed(3)}  prefix-diff=${tPrefixDiff.toFixed(3)}  ratio=${ratio.toFixed(2)}x`,
    );

    // Tolerance: 2.5×. SHA-256 + the 32-byte XOR walk is constant-time by
    // design; CI noise is the only source of variance. A blatant regression
    // (early `return false` on length diff, or short-circuit on first byte)
    // pushes the ratio well past 2.5× and fails the test.
    assert.ok(
      ratio < 2.5,
      `WARNING-3 timing variance too high: max=${max.toFixed(3)}ms / min=${min.toFixed(3)}ms = ${ratio.toFixed(2)}× (tolerance 2.5×)`,
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
