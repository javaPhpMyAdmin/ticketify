#!/usr/bin/env node
/**
 * Node harness for the Pro gate truth table
 * (`src/features/pro/gate.ts` → `resolveGateState`).
 *
 * Compiles the module with an isolated tsconfig (no `@/` remap needed —
 * `gate.ts` has zero imports) and asserts the REQ-GATE-5 contract:
 *
 *   - `isLoading === true` ALWAYS renders 'locked' — no flash of pro
 *     content while the SDK is still resolving.
 *   - `isLoading === false && isPro === true`  → 'unlocked'.
 *   - `isLoading === false && isPro === false` → 'locked'.
 *
 * The truth table is enumerated explicitly (4 combinations) AND verified
 * via a parametric loop so the contract is pinned in code, not just in
 * design prose.
 *
 * Usage: pnpm test:pro-gating
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
const harnessConfig = join(__dirname, 'tsconfig.pro-gating-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'pro-gating-test-'));
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

/**
 * Mirror the harness tsconfig's `paths` at runtime. `gate.ts` has no
 * runtime imports, but we install the hook so the harness shape matches
 * every other M8.1 sibling (one mechanical change if we ever add a
 * dependency to gate.ts).
 */
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
  console.log('\n[tests] compiling gate module…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const { resolveGateState, isProOverrideEnabled } = await import(
    pathToFileURL(join(outDir, 'src/features/pro/gate.js')).href
  );

  console.log('\n[tests] EXPO_PUBLIC_PRO_OVERRIDE override\n');

  // `isProOverrideEnabled` reads `process.env` at call time. We capture and
  // restore the original value so other harnesses (or re-runs with
  // different env) are unaffected.
  const originalOverride = process.env.EXPO_PUBLIC_PRO_OVERRIDE;
  function setOverride(value) {
    if (value === undefined) {
      delete process.env.EXPO_PUBLIC_PRO_OVERRIDE;
    } else {
      process.env.EXPO_PUBLIC_PRO_OVERRIDE = value;
    }
  }

  await test('unset → false (safe default for production builds)', () => {
    setOverride(undefined);
    assert.equal(isProOverrideEnabled(), false);
  });

  await test('"true" → true (developer flips the gate on for a local build)', () => {
    setOverride('true');
    assert.equal(isProOverrideEnabled(), true);
  });

  await test('"false" → false (explicit off, e.g. after a test that toggled it on)', () => {
    setOverride('false');
    assert.equal(isProOverrideEnabled(), false);
  });

  await test('any non-"true" string → false (defensive: "TRUE" / "1" / "yes" do not flip the gate)', () => {
    // The contract is strict — only the literal string "true" turns the
    // gate on. A developer who types "TRUE" or "1" by accident gets the
    // safe default, and the gate stays locked.
    for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
      setOverride(value);
      assert.equal(
        isProOverrideEnabled(),
        false,
        `value=${JSON.stringify(value)} must NOT enable the override`,
      );
    }
    setOverride(originalOverride);
  });

  await test('re-call with the same env returns the same result (pure projection of process.env)', () => {
    setOverride('true');
    const a = isProOverrideEnabled();
    const b = isProOverrideEnabled();
    assert.equal(a, b, 'divergent result for the same env value');
    setOverride(originalOverride);
  });

  console.log('\n[tests] REQ-GATE-5 truth table\n');

  await test('isLoading=true, isPro=true → locked (loading wins, no flash)', () => {
    assert.equal(resolveGateState(true, true), 'locked');
  });

  await test('isLoading=true, isPro=false → locked', () => {
    assert.equal(resolveGateState(false, true), 'locked');
  });

  await test('isLoading=false, isPro=true → unlocked', () => {
    assert.equal(resolveGateState(true, false), 'unlocked');
  });

  await test('isLoading=false, isPro=false → locked', () => {
    assert.equal(resolveGateState(false, false), 'locked');
  });

  console.log('\n[tests] exhaustive 4-row truth table\n');

  await test('all 4 (isPro × isLoading) combinations match the contract', () => {
    const cases = [
      { isPro: false, isLoading: false, expected: 'locked' },
      { isPro: false, isLoading: true, expected: 'locked' },
      { isPro: true, isLoading: false, expected: 'unlocked' },
      { isPro: true, isLoading: true, expected: 'locked' },
    ];
    for (const { isPro, isLoading, expected } of cases) {
      const actual = resolveGateState(isPro, isLoading);
      assert.equal(
        actual,
        expected,
        `isPro=${isPro}, isLoading=${isLoading} → expected '${expected}', got '${actual}'`,
      );
    }
  });

  await test('isLoading always wins — both isPro=true cases collapse to locked when loading', () => {
    assert.equal(resolveGateState(true, true), 'locked');
  });

  await test('only isLoading=false AND isPro=true yields unlocked (single source of truth)', () => {
    // Negative assertion: any other combination MUST NOT yield 'unlocked'.
    const combinations = [
      [false, false],
      [false, true],
      [true, true],
    ];
    for (const [isPro, isLoading] of combinations) {
      assert.notEqual(
        resolveGateState(isPro, isLoading),
        'unlocked',
        `isPro=${isPro}, isLoading=${isLoading} must NOT be unlocked`,
      );
    }
  });

  console.log('\n[tests] return-type guard\n');

  await test('result is always one of the two literal states (no surprises)', () => {
    const allowed = new Set(['locked', 'unlocked']);
    for (const isPro of [false, true]) {
      for (const isLoading of [false, true]) {
        assert.ok(
          allowed.has(resolveGateState(isPro, isLoading)),
          `Unexpected state for isPro=${isPro}, isLoading=${isLoading}`,
        );
      }
    }
  });

  await test('isLoading=true ALWAYS produces "locked", no matter isPro (1000-iteration property)', () => {
    // Property: for ANY isPro value, isLoading=true → 'locked'. Loop 1000
    // times with deterministic isPro alternation to exercise the loader
    // fast-path and pin the "loading wins" invariant in code.
    for (let i = 0; i < 1000; i++) {
      const isPro = i % 2 === 0;
      assert.equal(resolveGateState(isPro, true), 'locked');
    }
  });

  await test('isLoading=false produces "unlocked" iff isPro=true (1000-iteration property)', () => {
    // Property: for ANY i, isLoading=false → 'unlocked' when isPro is true,
    // 'locked' when isPro is false. Pins the dual direction.
    for (let i = 0; i < 1000; i++) {
      const isPro = i % 2 === 0;
      const expected = isPro ? 'unlocked' : 'locked';
      assert.equal(resolveGateState(isPro, false), expected);
    }
  });

  await test('re-call with the same arguments returns the same result (pure / no global state)', () => {
    // Pin purity: no caching, no global state, no nonce — the function is
    // a pure projection, so two calls with identical inputs must agree.
    for (const [isPro, isLoading] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ]) {
      const a = resolveGateState(isPro, isLoading);
      const b = resolveGateState(isPro, isLoading);
      assert.equal(a, b, `divergent result for isPro=${isPro}, isLoading=${isLoading}`);
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
