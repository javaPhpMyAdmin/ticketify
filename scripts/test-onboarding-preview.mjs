#!/usr/bin/env node
/**
 * Node harness for the onboarding preview derivation
 * (`src/features/onboarding/onboarding-preview.ts` →
 * `resolveOnboardingPreview`).
 *
 * Compiles the module with an isolated tsconfig (no `@/` remap needed —
 * `onboarding-preview.ts` has zero imports) and asserts the dev/prod
 * matrix for the `EXPO_PUBLIC_ONBOARDING_PREVIEW` escape hatch:
 *
 *   - `__DEV__=true`,  env `'true'`             → `true`.
 *   - `__DEV__=true`,  env `'false'`/`'TRUE'`/unset → `false`.
 *   - `__DEV__=false`, env `'true'`             → `false` (production
 *     hardening: a leaked flag never routes release users into the
 *     wizard).
 *   - `__DEV__=undefined`, env `'true'`         → `false` (strict
 *     boolean — the cell that distinguishes `Boolean(__DEV__) &&` from a
 *     bare `__DEV__ &&`, which would yield `undefined`).
 *
 * Mirrors `test-pro-gating.mjs` (compile + require-hook + `withDev()`
 * scoped matrix). The source-pin contract for the LAYOUT wiring lives in
 * `test-onboarding-screens.mjs`; this harness pins the BEHAVIOR of the
 * extracted helper (issue #220).
 *
 * Usage: pnpm test:onboarding-preview
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
const harnessConfig = join(__dirname, 'tsconfig.onboarding-preview-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'onboarding-preview-test-'));
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
 * Mirror the harness tsconfig's `paths` at runtime. The helper has no
 * runtime imports, but we install the hook so the harness shape matches
 * every other compiled-module sibling (one mechanical change if we ever
 * add a dependency to onboarding-preview.ts).
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
  console.log('\n[tests] compiling onboarding preview module…');
  await compile();
  // The helper reads React Native's `__DEV__` global for its dev-only
  // behavior; plain node has none. Declared for tsc via
  // test-stubs/globals.d.ts; defined here so the compiled module behaves
  // like a Release build by default.
  globalThis.__DEV__ = false;
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const { resolveOnboardingPreview } = await import(
    pathToFileURL(
      join(outDir, 'src/features/onboarding/onboarding-preview.js'),
    ).href
  );

  console.log('\n[tests] EXPO_PUBLIC_ONBOARDING_PREVIEW matrix\n');

  // `resolveOnboardingPreview` reads `process.env` at call time. We
  // capture and restore the original value so other harnesses (or
  // re-runs with different env) are unaffected.
  const originalPreview = process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW;
  function setPreview(value) {
    if (value === undefined) {
      delete process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW;
    } else {
      process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW = value;
    }
  }

  // The preview read is gated on `__DEV__` (`Boolean(__DEV__) && …`), so
  // any assertion that expects the env var to flip the derivation must
  // run in a simulated DEV runtime — the harness default above is
  // Release. Scoped set/restore keeps both sides of the matrix honest.
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

  await test('__DEV__=true, env="true" → true (developer routes into the wizard for design iteration)', () => {
    withDev(true, () => {
      setPreview('true');
      assert.strictEqual(resolveOnboardingPreview(), true);
    });
  });

  await test('__DEV__=true, env="false" → false (explicit off)', () => {
    withDev(true, () => {
      setPreview('false');
      assert.strictEqual(resolveOnboardingPreview(), false);
    });
  });

  await test('__DEV__=true, non-"true" strings → false (only the literal "true" enables the preview)', () => {
    // The contract is strict — only the literal string "true" turns the
    // preview on. A developer who types "TRUE" or "1" by accident gets
    // the safe default and the normal gate behavior.
    withDev(true, () => {
      for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
        setPreview(value);
        assert.strictEqual(
          resolveOnboardingPreview(),
          false,
          `value=${JSON.stringify(value)} must NOT enable the preview`,
        );
      }
    });
    setPreview(originalPreview);
  });

  await test('__DEV__=true, env unset → false (safe default when the flag was never set)', () => {
    // The deleted env key reads back as `undefined` — pin the read
    // itself so the assertion documents WHICH input it covers.
    withDev(true, () => {
      setPreview(undefined);
      assert.strictEqual(process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW, undefined);
      assert.strictEqual(resolveOnboardingPreview(), false);
    });
  });

  await test('__DEV__=false, env="true" → false (production hardening: leaked flag is ignored)', () => {
    // The env read is gated on React Native's `__DEV__` global: even if
    // the flag leaks into a release build environment (e.g. a local
    // Gradle release or `eas build --local`), production bundles must
    // never force every user into the wizard.
    setPreview('true');
    assert.strictEqual(withDev(false, () => resolveOnboardingPreview()), false);
    setPreview(originalPreview);
  });

  await test('__DEV__=undefined, env="true" → false (strict boolean, NOT undefined)', () => {
    // The ONLY cell where the two forms diverge: a bare
    // `return __DEV__ && process.env.X === "true"` yields `undefined`
    // when `__DEV__` is explicitly undefined, while the
    // `Boolean(__DEV__)` coercion pins a strict boolean contract.
    // (Under `__DEV__ = false` both forms return `false`, so that cell
    // cannot distinguish them.)
    setPreview('true');
    assert.strictEqual(withDev(undefined, () => resolveOnboardingPreview()), false);
    setPreview(originalPreview);
  });

  await test('result is a strict boolean on every matrix cell (never undefined)', () => {
    // Sweep the whole matrix and pin the RETURN TYPE independently of
    // the expected value: `Boolean(__DEV__)` is what guarantees this.
    for (const devFlag of [true, false, undefined]) {
      for (const value of ['true', 'false', undefined]) {
        setPreview(value);
        const actual = withDev(devFlag, () => resolveOnboardingPreview());
        assert.strictEqual(
          typeof actual,
          'boolean',
          `typeof must be "boolean" for __DEV__=${String(devFlag)}, env=${JSON.stringify(value)} (got ${typeof actual})`,
        );
      }
    }
    setPreview(originalPreview);
  });

  await test('re-call with the same env returns the same result (pure projection of globals)', () => {
    withDev(true, () => {
      setPreview('true');
      const a = resolveOnboardingPreview();
      const b = resolveOnboardingPreview();
      assert.strictEqual(a, b, 'divergent result for the same env value');
    });
    setPreview(originalPreview);
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
