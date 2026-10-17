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
 * Post-cutover (0039, revenuecat-trial-migration slice B): the gate is
 * binary. The DB trial lifecycle is gone (the `'frozen'` state existed
 * ONLY to block writes between DB trial expiry and a paid subscription;
 * with no DB trial there is no frozen window). `resolveGateState` is
 * 2-arg `(isPro, isLoading)`; `GateState = 'locked' | 'unlocked'`.
 *
 * The truth table is enumerated explicitly (4 combinations) AND verified
 * via a parametric loop so the contract is pinned in code, not just in
 * design prose.
 *
 * The dev-override escape hatches (`isProOverrideEnabled`,
 * `isProExpiredOverrideEnabled`) are additionally pinned against the
 * `__DEV__` guard: the env-driven behavior only applies when React
 * Native's `__DEV__` global is true; production (Release-like) runs
 * ignore the flags entirely.
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
  // The app reads React Native's `__DEV__` global for dev-only behavior
  // (the Pro override escape hatches are gated on it); plain node has
  // none. Declared for tsc via test-stubs/globals.d.ts; defined here so
  // the compiled modules behave like a Release build.
  globalThis.__DEV__ = false;
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const { resolveGateState, isProOverrideEnabled, isProExpiredOverrideEnabled } =
    await import(pathToFileURL(join(outDir, 'src/features/pro/gate.js')).href);

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

  // The override reads are gated on `__DEV__` (`Boolean(__DEV__) && …`),
  // so any assertion that expects the env var to flip the gate must run
  // in a simulated DEV runtime — the harness default above is Release.
  // Scoped set/restore keeps both sides of the matrix honest.
  // SYNC-ONLY contract: `finally` restores `__DEV__` when `fn()` returns,
  // so an async callback would keep running after the restore under the
  // harness default. Pass a synchronous function only.
  function withDev(devFlag, fn) {
    const previous = globalThis.__DEV__;
    globalThis.__DEV__ = devFlag;
    try {
      return fn();
    } finally {
      globalThis.__DEV__ = previous;
    }
  }

  await test('unset → false (safe default for production builds)', () => {
    setOverride(undefined);
    assert.equal(isProOverrideEnabled(), false);
  });

  await test('"true" → true (developer flips the gate on for a local build)', () => {
    withDev(true, () => {
      setOverride('true');
      assert.equal(isProOverrideEnabled(), true);
    });
  });

  await test('__DEV__=false → "true" env is ignored (production bundle hardening)', () => {
    // The env read is gated on React Native's `__DEV__` global: even if
    // the flag leaks into a release build environment (e.g. a local
    // Gradle release), production bundles must keep the gate locked.
    setOverride('true');
    assert.equal(withDev(false, () => isProOverrideEnabled()), false);
  });

  await test('__DEV__=undefined → return value is a real boolean false (not undefined)', () => {
    // The ONLY cell where the two forms diverge: a bare
    // `return __DEV__ && process.env.X === "true"` yields `undefined`
    // when `__DEV__` is explicitly undefined, while the
    // `Boolean(__DEV__)` coercion pins a strict boolean contract.
    // (Under `__DEV__ = false` both forms return `false`, so that cell
    // cannot distinguish them.)
    setOverride('true');
    assert.strictEqual(withDev(undefined, () => isProOverrideEnabled()), false);
  });

  await test('__DEV__=true, env unset → false (unset cell under DEV)', () => {
    withDev(true, () => {
      setOverride(undefined);
      assert.equal(isProOverrideEnabled(), false);
    });
  });

  await test('"false" → false (explicit off, e.g. after a test that toggled it on)', () => {
    withDev(true, () => {
      setOverride('false');
      assert.equal(isProOverrideEnabled(), false);
    });
  });

  await test('any non-"true" string → false (defensive: "TRUE" / "1" / "yes" do not flip the gate)', () => {
    // The contract is strict — only the literal string "true" turns the
    // gate on. A developer who types "TRUE" or "1" by accident gets the
    // safe default, and the gate stays locked.
    withDev(true, () => {
      for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
        setOverride(value);
        assert.equal(
          isProOverrideEnabled(),
          false,
          `value=${JSON.stringify(value)} must NOT enable the override`,
        );
      }
    });
    setOverride(originalOverride);
  });

  await test('re-call with the same env returns the same result (pure projection of process.env)', () => {
    withDev(true, () => {
      setOverride('true');
      const a = isProOverrideEnabled();
      const b = isProOverrideEnabled();
      assert.equal(a, b, 'divergent result for the same env value');
    });
    setOverride(originalOverride);
  });

  console.log('\n[tests] EXPO_PUBLIC_PRO_EXPIRED_OVERRIDE override (downgrade QA)\n');

  // `isProExpiredOverrideEnabled` reads `process.env` at call time — same
  // capture/restore pattern as the true-override section above. The harness
  // sets the env BEFORE the assertions, never at import time (the compiled
  // module is ENV-AGNOSTIC: `EXPO_PUBLIC_*` is inlined by Metro at bundle
  // time, so the runtime value here only matters for these unit reads).
  const originalExpired = process.env.EXPO_PUBLIC_PRO_EXPIRED_OVERRIDE;
  function setExpired(value) {
    if (value === undefined) {
      delete process.env.EXPO_PUBLIC_PRO_EXPIRED_OVERRIDE;
    } else {
      process.env.EXPO_PUBLIC_PRO_EXPIRED_OVERRIDE = value;
    }
  }

  await test('unset → false (safe default for production builds)', () => {
    setExpired(undefined);
    assert.equal(isProExpiredOverrideEnabled(), false);
  });

  await test('"true" → true (developer simulates an expired entitlement for downgrade QA)', () => {
    withDev(true, () => {
      setExpired('true');
      assert.equal(isProExpiredOverrideEnabled(), true);
    });
  });

  await test('__DEV__=false → "true" env is ignored (production bundle hardening)', () => {
    // Same `__DEV__` gate as `isProOverrideEnabled`: the downgrade-QA
    // escape hatch must never fire in a production bundle, even if the
    // flag leaks into a release build environment.
    setExpired('true');
    assert.equal(withDev(false, () => isProExpiredOverrideEnabled()), false);
  });

  await test('__DEV__=undefined → return value is a real boolean false (not undefined)', () => {
    // Same divergence cell as above: only an explicitly-undefined
    // `__DEV__` distinguishes bare `__DEV__ && …` (yields `undefined`)
    // from the `Boolean(__DEV__) && …` coercion (yields `false`).
    setExpired('true');
    assert.strictEqual(withDev(undefined, () => isProExpiredOverrideEnabled()), false);
  });

  await test('__DEV__=true, env unset → false (unset cell under DEV)', () => {
    withDev(true, () => {
      setExpired(undefined);
      assert.equal(isProExpiredOverrideEnabled(), false);
    });
  });

  await test('"false" → false (explicit off, e.g. after a test that toggled it on)', () => {
    withDev(true, () => {
      setExpired('false');
      assert.equal(isProExpiredOverrideEnabled(), false);
    });
  });

  await test('any non-"true" string → false (defensive: "TRUE" / "1" / "yes" do not flip the override)', () => {
    // Same strict-literal contract as `isProOverrideEnabled` — only the
    // literal string "true" turns the override on.
    withDev(true, () => {
      for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
        setExpired(value);
        assert.equal(
          isProExpiredOverrideEnabled(),
          false,
          `value=${JSON.stringify(value)} must NOT enable the expired override`,
        );
      }
    });
    setExpired(originalExpired);
  });

  await test('independent env reads: the two overrides never cross-talk', () => {
    // The escape hatches read DIFFERENT env vars; flipping one must never
    // implicitly flip the other. The contradiction when BOTH are on is
    // resolved at the WIRING level (the EXPIRED override wins — the
    // conservative/locked default), pinned by test-pro-bootstrap.mjs.
    withDev(true, () => {
      setOverride('true');
      setExpired('true');
      assert.equal(isProOverrideEnabled(), true);
      assert.equal(isProExpiredOverrideEnabled(), true);
      setExpired('false');
      assert.equal(
        isProOverrideEnabled(),
        true,
        'the true override stays on when the expired one is toggled off',
      );
      assert.equal(isProExpiredOverrideEnabled(), false);
    });
    setOverride(originalOverride);
    setExpired(originalExpired);
  });

  await test('downgrade contract: the expired-override store inputs (isPro=false, isLoading=false) resolve to locked', () => {
    // Fix 2: when the expired override is ON, the bootstrap forces the
    // store to { isPro: false, isLoading: false }. That EXACT combination
    // must keep the gate locked so the downgrade UI is observable without
    // touching RevenueCat.
    assert.equal(resolveGateState(false, false), 'locked');
  });

  console.log('\n[tests] REQ-GATE-5 binary truth table (post-cutover 0039)\n');

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

  console.log('\n[tests] exhaustive 4-row truth table (2×2)\n');

  await test('all 4 (isPro × isLoading) combinations match the binary contract', () => {
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

  console.log('\n[tests] return-type guard (binary: locked | unlocked)\n');

  await test('result is always one of the two literal states (no surprises, no legacy "frozen")', () => {
    const allowed = new Set(['locked', 'unlocked']);
    for (const isPro of [false, true]) {
      for (const isLoading of [false, true]) {
        const actual = resolveGateState(isPro, isLoading);
        assert.ok(
          allowed.has(actual),
          `Unexpected state '${actual}' for isPro=${isPro}, isLoading=${isLoading} (post-cutover the binary gate must NEVER return 'frozen')`,
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

  await test('"frozen" never appears in the output (binary gate contract, post-cutover 0039)', () => {
    // Negative property: the binary gate never returns 'frozen' for any
    // combination. The 'frozen' state existed only to block writes during
    // the DB trial window (which is gone) — pins the contract that no
    // input combination can resurrect it.
    for (let i = 0; i < 1000; i++) {
      const isPro = i % 3 === 0;
      const isLoading = i % 5 === 0;
      const actual = resolveGateState(isPro, isLoading);
      assert.notEqual(
        actual,
        'frozen',
        `'frozen' is not a valid post-cutover gate state (i=${i}, isPro=${isPro}, isLoading=${isLoading})`,
      );
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
