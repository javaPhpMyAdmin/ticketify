#!/usr/bin/env node
/**
 * Node harness for the pure quota-state derivation
 * (`src/features/home/quota.ts` → `computeQuotaState`).
 *
 * Compiles the module with an isolated tsconfig (no `@/` remap needed —
 * `quota.ts` has zero imports) and asserts the CRITICAL-2 + REQ-QUOTA-6
 * contract:
 *
 *   - `isPro === true` short-circuits to UNLIMITED regardless of any
 *     stale numeric row (used/limit) — Pro users never see exhausted,
 *     never see a ratio, never see the upgrade CTA.
 *   - `isPro === false` derives the state from (used, limit):
 *       * `effectiveLimit = limit ?? FREE_DEFAULT_LIMIT (=15)` — mirror
 *         of the SQL `coalesce(scans_limit, 15)`.
 *       * `remaining = max(0, eff - used)` (clamped at 0, never negative).
 *       * `exhausted = eff > 0 && used >= eff` — gated on a positive
 *         cap, so `limit=0` does NOT spuriously flag exhaustion.
 *       * `ratio = min(1, used / eff)` — clamped at 1, so `used > limit`
 *         never overflows the progress bar.
 *       * `showUpgradeCta = !isPro && exhausted`.
 *
 * Usage: pnpm test:quota-tier
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
const harnessConfig = join(__dirname, 'tsconfig.quota-tier-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'quota-tier-test-'));
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
  console.log('\n[tests] compiling quota module…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const quotaMod = await import(
    pathToFileURL(join(outDir, 'src/features/home/quota.js')).href
  );
  const { computeQuotaState, FREE_DEFAULT_LIMIT } = quotaMod;

  console.log('\n[tests] CRITICAL-2 invariant — Pro is always unlimited\n');

  await test('isPro=true (any used/limit) → unlimited, no CTA, no ratio', () => {
    // Three different (used, limit) pairs; all must collapse to the same
    // CRITICAL-2 state — Pro wins regardless of the row's stored cap.
    const states = [
      computeQuotaState(0, 15, true),
      computeQuotaState(7, 15, true),
      computeQuotaState(15, 15, true),
    ];
    for (const s of states) {
      assert.equal(s.unlimited, true);
      assert.equal(s.exhausted, false);
      assert.equal(s.showUpgradeCta, false);
      assert.equal(s.ratio, 0);
      assert.equal(s.remaining, Number.POSITIVE_INFINITY);
    }
  });

  await test('isPro=true with null limit → unlimited (NULL stays neutral)', () => {
    const s = computeQuotaState(0, null, true);
    assert.equal(s.unlimited, true);
    assert.equal(s.exhausted, false);
    assert.equal(s.showUpgradeCta, false);
    assert.equal(s.ratio, 0);
  });

  await test('isPro=true overrides a stale numeric limit (grant-before-next-scan)', () => {
    // The CRITICAL-2 story: Pro user just got GRANT, scan_usage row still
    // carries limit=15 from a previous free month. isPro must win.
    const s = computeQuotaState(15, 15, true);
    assert.equal(s.unlimited, true);
    assert.equal(s.exhausted, false, 'Pro must not see exhausted');
    assert.equal(s.showUpgradeCta, false, 'Pro must not see upgrade CTA');
  });

  console.log('\n[tests] free-tier math (used, limit)\n');

  await test('isPro=false, used=0, limit=15 → fresh month', () => {
    const s = computeQuotaState(0, 15, false);
    assert.equal(s.unlimited, false);
    assert.equal(s.remaining, 15);
    assert.equal(s.exhausted, false);
    assert.equal(s.showUpgradeCta, false);
    assert.equal(s.ratio, 0);
    assert.equal(s.effectiveLimit, 15);
  });

  await test('isPro=false, used=15, limit=15 → fully exhausted', () => {
    const s = computeQuotaState(15, 15, false);
    assert.equal(s.unlimited, false);
    assert.equal(s.remaining, 0);
    assert.equal(s.exhausted, true);
    assert.equal(s.showUpgradeCta, true);
    assert.equal(s.ratio, 1);
  });

  await test('isPro=false, used=10, limit=15 → mid-range', () => {
    const s = computeQuotaState(10, 15, false);
    assert.equal(s.unlimited, false);
    assert.equal(s.remaining, 5);
    assert.equal(s.exhausted, false);
    assert.equal(s.showUpgradeCta, false);
    assert.equal(s.ratio, 10 / 15);
  });

  await test('isPro=false, used=20, limit=15 → over-limit, ratio clamped at 1', () => {
    const s = computeQuotaState(20, 15, false);
    assert.equal(s.unlimited, false);
    assert.equal(s.remaining, 0, 'remaining is clamped at 0, never negative');
    assert.equal(s.exhausted, true);
    assert.equal(s.showUpgradeCta, true);
    assert.equal(s.ratio, 1, 'ratio is clamped at 1, never above');
  });

  console.log('\n[tests] NULL/zero edge cases\n');

  await test('isPro=false, used=0, limit=null → coalesces to FREE_DEFAULT_LIMIT', () => {
    const s = computeQuotaState(0, null, false);
    assert.equal(s.effectiveLimit, FREE_DEFAULT_LIMIT);
    assert.equal(s.effectiveLimit, 15);
    assert.equal(s.remaining, 15);
    assert.equal(s.exhausted, false);
    assert.equal(s.ratio, 0);
  });

  await test('isPro=false, used=5, limit=0 → exhausted is FALSE (eff > 0 gate)', () => {
    // limit=0 means zero slots; the contract says `eff > 0 && used >= eff`
    // so a zero cap does NOT spuriously trigger the upgrade CTA. ratio is
    // also 0 (the `effectiveLimit <= 0` branch clamps it).
    const s = computeQuotaState(5, 0, false);
    assert.equal(s.effectiveLimit, 0);
    assert.equal(s.exhausted, false, 'limit=0 must not trip the exhausted guard');
    assert.equal(s.showUpgradeCta, false);
    assert.equal(s.ratio, 0);
    assert.equal(s.remaining, 0, 'remaining clamps at 0');
  });

  await test('isPro=false, used=0, limit=0 → not exhausted, ratio 0', () => {
    const s = computeQuotaState(0, 0, false);
    assert.equal(s.effectiveLimit, 0);
    assert.equal(s.exhausted, false);
    assert.equal(s.showUpgradeCta, false);
    assert.equal(s.ratio, 0);
  });

  console.log('\n[tests] invariants\n');

  await test('FREE_DEFAULT_LIMIT is the documented 15 (SQL mirror)', () => {
    assert.equal(FREE_DEFAULT_LIMIT, 15);
  });

  await test('showUpgradeCta is exactly (!isPro && exhausted) — never more, never less', () => {
    // Exhaustive truth table for the CTA predicate.
    const grid = [
      { used: 0, limit: 15, isPro: false, cta: false },
      { used: 15, limit: 15, isPro: false, cta: true },
      { used: 20, limit: 15, isPro: false, cta: true },
      { used: 0, limit: null, isPro: false, cta: false },
      { used: 15, limit: 15, isPro: true, cta: false }, // CRITICAL-2
      { used: 999, limit: 999, isPro: true, cta: false }, // CRITICAL-2
    ];
    for (const { used, limit, isPro, cta } of grid) {
      const s = computeQuotaState(used, limit, isPro);
      assert.equal(
        s.showUpgradeCta,
        cta,
        `used=${used}, limit=${limit}, isPro=${isPro} → expected cta=${cta}, got ${s.showUpgradeCta}`,
      );
    }
  });

  await test('ratio is always in [0, 1] — no NaN, no Infinity, no overflow', () => {
    const inputs = [
      [0, 15, false],
      [10, 15, false],
      [15, 15, false],
      [100, 15, false],
      [0, null, false],
      [0, 0, false],
      [0, 15, true],
    ];
    for (const [used, limit, isPro] of inputs) {
      const s = computeQuotaState(used, limit, isPro);
      assert.ok(
        Number.isFinite(s.ratio) && s.ratio >= 0 && s.ratio <= 1,
        `ratio out of [0,1] for (used=${used}, limit=${limit}, isPro=${isPro}): ${s.ratio}`,
      );
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
