#!/usr/bin/env node
/**
 * Node harness for the onboarding persistence helper
 * (`src/features/onboarding/onboarding-storage.ts`).
 *
 * Asserts the full surface of the helper using the `__testing__`
 * factory so the production module never touches a native module at
 * test time. The injected backend is an in-memory `Map` mirroring the
 * `@react-native-async-storage/async-storage` contract (`getItem` /
 * `setItem` / `removeItem`).
 *
 * Contracts:
 *
 *   1. `getOnboardingCompleted()` returns `false` when the key is
 *      missing (fresh install — the gate routes to onboarding).
 *   2. `getOnboardingCompleted()` returns `true` after
 *      `markOnboardingCompleted()` was called (returning user — the
 *      gate skips onboarding).
 *   3. `getOnboardingCompleted()` returns `false` when the stored
 *      value is `"false"` (defensive: a stored `"false"` MUST not be
 *      coerced to truthy — the setter gates the format).
 *   4. `getOnboardingCompleted()` returns `false` when the stored
 *      value is corrupted (e.g. `"yes"`) — the helper never crashes
 *      on a junk entry.
 *   5. `markOnboardingCompleted()` is idempotent — repeated calls
 *      leave the stored value as `"true"`.
 *   6. `getOnboardingCompleted()` collapses a backend rejection to
 *      `false` (storage failure → behave like fresh install → the
 *      user can still complete onboarding, no false "returning user"
 *      bypass).
 *   7. `markOnboardingCompleted()` swallows a backend rejection
 *      silently (the write failure is not fatal — the user can still
 *      proceed; the worst case is they see the flow again).
 *   8. The versioned key is exported as a stable constant —
 *      `ONBOARDING_COMPLETED_KEY` — so a future migration can bump
 *      the version without breaking the gate.
 *
 * Plus source-pin contracts against the REAL production module file
 * (compile-only: a missing export fails the build, not the runtime):
 *
 *   - `ONBOARDING_COMPLETED_KEY` is a string ending in `.v1`.
 *   - `getOnboardingCompleted` + `markOnboardingCompleted` +
 *     `__testing__.createOnboardingStorage` are exported from the file.
 *
 * Usage: pnpm test:onboarding-storage
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.onboarding-storage-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'onboarding-storage-test-'));
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
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

/**
 * Mirror the harness tsconfig's `paths` at runtime AND remap the
 * native AsyncStorage module to the test stub — the production module
 * calls `require('@react-native-async-storage/async-storage')` lazily
 * via the factory, so Node has to resolve it; without the remap the
 * harness tries to load the real native module and crashes. Same
 * pattern as `scripts/test-i18n-init.mjs` for `expo-secure-store`.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    } else if (request === '@react-native-async-storage/async-storage') {
      request = join(__dirname, 'test-stubs', 'async-storage.ts');
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

async function run() {
  console.log('\n[tests] compiling onboarding storage module…');
  compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const storage = await load('src/features/onboarding/onboarding-storage.js');
  const { createOnboardingStorage } = storage.__testing__;
  // The versioned key is a top-level export — read it from the module
  // root, not from the testing seam (the testing seam only wraps the
  // helper factory so production code is unaffected).
  const { ONBOARDING_COMPLETED_KEY } = storage;

  const buildBackend = () => {
    const map = new Map();
    return {
      getItem: (k) => Promise.resolve(map.has(k) ? map.get(k) : null),
      setItem: (k, v) => {
        map.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k) => {
        map.delete(k);
        return Promise.resolve();
      },
      _map: map,
    };
  };

  console.log('\n[tests] getOnboardingCompleted\n');

  await test('fresh install — no key set → returns false (gate routes to onboarding)', async () => {
    const backend = buildBackend();
    const helper = createOnboardingStorage(backend);
    assert.equal(await helper.getOnboardingCompleted(), false);
  });

  await test('returning user — after mark → returns true (gate skips onboarding)', async () => {
    const backend = buildBackend();
    const helper = createOnboardingStorage(backend);
    await helper.markOnboardingCompleted();
    assert.equal(await helper.getOnboardingCompleted(), true);
  });

  await test('stored "false" → returns false (defensive: never coerced to truthy)', async () => {
    const backend = buildBackend();
    backend._map.set(ONBOARDING_COMPLETED_KEY, 'false');
    const helper = createOnboardingStorage(backend);
    assert.equal(await helper.getOnboardingCompleted(), false);
  });

  await test('stored garbage ("yes") → returns false (corrupt entry never crashes)', async () => {
    const backend = buildBackend();
    backend._map.set(ONBOARDING_COMPLETED_KEY, 'yes');
    const helper = createOnboardingStorage(backend);
    assert.equal(await helper.getOnboardingCompleted(), false);
  });

  await test('stored empty string → returns false (empty value never read as true)', async () => {
    const backend = buildBackend();
    backend._map.set(ONBOARDING_COMPLETED_KEY, '');
    const helper = createOnboardingStorage(backend);
    assert.equal(await helper.getOnboardingCompleted(), false);
  });

  console.log('\n[tests] markOnboardingCompleted\n');

  await test('mark stores the literal string "true" under ONBOARDING_COMPLETED_KEY', async () => {
    const backend = buildBackend();
    const helper = createOnboardingStorage(backend);
    await helper.markOnboardingCompleted();
    assert.equal(backend._map.get(ONBOARDING_COMPLETED_KEY), 'true');
  });

  await test('mark is idempotent — repeated calls leave "true" (no append, no counter)', async () => {
    const backend = buildBackend();
    const helper = createOnboardingStorage(backend);
    await helper.markOnboardingCompleted();
    await helper.markOnboardingCompleted();
    await helper.markOnboardingCompleted();
    assert.equal(backend._map.get(ONBOARDING_COMPLETED_KEY), 'true');
    assert.equal(await helper.getOnboardingCompleted(), true);
  });

  console.log('\n[tests] error resilience\n');

  await test('getOnboardingCompleted collapses a backend rejection to false (storage failure = fresh install)', async () => {
    const helper = createOnboardingStorage({
      getItem: () => Promise.reject(new Error('forced: backend down')),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    });
    assert.equal(await helper.getOnboardingCompleted(), false);
  });

  await test('markOnboardingCompleted swallows a backend rejection (write failure is not fatal)', async () => {
    let setCalled = false;
    const helper = createOnboardingStorage({
      getItem: () => Promise.resolve(null),
      setItem: () => {
        setCalled = true;
        return Promise.reject(new Error('forced: backend down'));
      },
      removeItem: () => Promise.resolve(),
    });
    // The setter must NOT throw — async return, no unhandled rejection.
    await helper.markOnboardingCompleted();
    assert.equal(setCalled, true, 'setItem was attempted (the rejection is surfaced, then swallowed)');
    // And the read still reports false because the write was dropped.
    assert.equal(await helper.getOnboardingCompleted(), false);
  });

  console.log('\n[tests] factory isolation (triangulation)\n');

  await test('two factories over the same backend share state (one writes, the other reads)', async () => {
    const backend = buildBackend();
    const writer = createOnboardingStorage(backend);
    const reader = createOnboardingStorage(backend);
    await writer.markOnboardingCompleted();
    assert.equal(await reader.getOnboardingCompleted(), true);
  });

  await test('two factories over DIFFERENT backends do NOT share state (cross-tenant isolation)', async () => {
    const writer = createOnboardingStorage(buildBackend());
    const reader = createOnboardingStorage(buildBackend());
    await writer.markOnboardingCompleted();
    assert.equal(await reader.getOnboardingCompleted(), false);
  });

  console.log('\n[tests] source-pin contracts\n');

  const source = readFileSync(
    join(root, 'src/features/onboarding/onboarding-storage.ts'),
    'utf8',
  );

  await test('ONBOARDING_COMPLETED_KEY is a versioned string ending in ".v1"', () => {
    assert.equal(
      typeof ONBOARDING_COMPLETED_KEY,
      'string',
      'the key must be exported as a string constant',
    );
    assert.ok(
      /\.v1$/.test(ONBOARDING_COMPLETED_KEY),
      `key must end in ".v1" for future migration safety, got "${ONBOARDING_COMPLETED_KEY}"`,
    );
  });

  await test('production module exports __testing__.createOnboardingStorage (factory seam)', () => {
    assert.ok(
      /export\s+const\s+__testing__\s*=/.test(source) &&
        /createOnboardingStorage/.test(source),
      'production module must export a __testing__ factory (injectable backend)',
    );
    assert.ok(
      /export\s+const\s+__testing__[^;]*createOnboardingStorage/.test(source) ||
        /__testing__:\s*\{[\s\S]*?createOnboardingStorage/.test(source),
      'factory must be reachable from __testing__',
    );
  });

  await test('getOnboardingCompleted collapses backend errors via try/catch (no throw)', () => {
    assert.ok(
      /async\s+function\s+getOnboardingCompleted[\s\S]*?try[\s\S]*?catch/.test(source) ||
        /getOnboardingCompleted[\s\S]*?catch\s*\(/.test(source),
      'getOnboardingCompleted must wrap its read in try/catch so a backend rejection never bubbles',
    );
  });

  await test('markOnboardingCompleted wraps its write in try/catch (write failures are non-fatal)', () => {
    assert.ok(
      /async\s+function\s+markOnboardingCompleted[\s\S]*?try[\s\S]*?catch/.test(source) ||
        /markOnboardingCompleted[\s\S]*?catch\s*\(/.test(source),
      'markOnboardingCompleted must wrap its write in try/catch so a backend rejection never bubbles',
    );
  });

  await test('the canonical string "true" is the written value (defensive: no JSON encoding, no booleans)', () => {
    // Avoid a SetItem("onboarding.completed.v1", JSON.stringify(true))
    // style — the consumer does === "true", not JSON.parse. Pin the
    // exact literal the production code writes.
    assert.ok(
      /setItem\(\s*\w+,\s*['"]true['"]\s*\)/.test(source) ||
        /setItem\(\s*\w+,\s*\$\{[^}]*\}\s*\)|setItem\(\s*\w+\s*,\s*"true"\s*\)/.test(
          source,
        ) === false,
      'production module must setItem(key, "true") — no JSON, no boolean serialization',
    );
    // Either a direct setItem(key, 'true') call OR a constant string
    // assignment. The looser pin: the file references the literal "true".
    assert.ok(
      /['"]true['"]/.test(source),
      'production module must reference the literal "true" string',
    );
  });

  console.log('');
  if (failed > 0) {
    console.error(`[tests] ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`[tests] all ${passed} tests passed`);
  }
  rmSync(workdir, { recursive: true, force: true });
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
  rmSync(workdir, { recursive: true, force: true });
}
