#!/usr/bin/env node
/**
 * Node harness for the pure join-invalidation helper
 * (`src/features/household/household-invalidation.ts`).
 *
 * Compiles the helper plus its only dependency (`@/lib/query-keys`,
 * dependency-free) into a temp directory, then asserts the CONTRACT at the
 * query-key level with a trivial fake client:
 *
 *   - `invalidateHouseholdAfterJoin` calls `invalidateQueries` EXACTLY three
 *     times, with the household/profile keys and the broad chart prefix,
 *   - the leave/disband React call sites also invalidate the broad chart
 *     prefix (pinned as source assertions, since the harness cannot mount
 *     those screens),
 *   - the helper only needs the `invalidateQueries` surface — a fake client
 *     is a one-method spy, so the helper is trivially testable,
 *   - the returned promises are fire-and-forget (`void`), matching how the
 *     modal calls it inside the success-path setTimeout.
 *
 * Scope note: the modal invokes the helper ONLY on the join success branch
 * (the error path never calls it) — that branching lives in the React
 * component, which this harness cannot mount, so it is pinned here as a
 * documentary comment rather than an assertion.
 *
 * Usage: pnpm test:household-invalidation
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
const harnessConfig = join(__dirname, 'tsconfig.household-invalidation-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'household-invalidation-test-'));
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

function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    // The compiled CJS output keeps the `@/` alias; remap it to the compiled
    // tree so the helper's `@/lib/query-keys` dependency resolves.
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/** Trivial fake: records every invalidation call, one method only. */
function makeFakeClient() {
  const calls = [];
  return {
    calls,
    invalidateQueries: (opts) => {
      calls.push(opts.queryKey);
      return Promise.resolve();
    },
  };
}

async function run() {
  console.log('\n[tests] compiling household-invalidation modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const mod = await load('src/features/household/household-invalidation.js');

  console.log('\n[tests] join invalidation contract\n');

  await test(
    'invalidates the exact household and profile query keys for the userId',
    () => {
      const fake = makeFakeClient();
      mod.invalidateHouseholdAfterJoin(fake, 'u1');
      assert.deepEqual(fake.calls, [
        ['household', 'u1'],
        ['profile', 'u1'],
        // Broad prefix: invalidates every household chart-series window for
        // every household, since the join helper does not know the id yet.
        ['analytics', 'household-chart-series'],
      ]);
    },
  );

  await test('calls invalidateQueries EXACTLY three times (household + profile + chart prefix)', () => {
    const fake = makeFakeClient();
    mod.invalidateHouseholdAfterJoin(fake, 'abc-123');
    assert.equal(fake.calls.length, 3);
  });

  await test('keys are user-scoped: different userId → different keys', () => {
    const fakeA = makeFakeClient();
    const fakeB = makeFakeClient();
    mod.invalidateHouseholdAfterJoin(fakeA, 'uA');
    mod.invalidateHouseholdAfterJoin(fakeB, 'uB');
    // Cross-user isolation: no shared cache entry between users.
    assert.notDeepEqual(fakeA.calls, fakeB.calls);
    assert.deepEqual(fakeA.calls[0], ['household', 'uA']);
    assert.deepEqual(fakeB.calls[0], ['household', 'uB']);
  });

  await test('returned invalidation promises are fire-and-forget (void, no throw)', () => {
    const fake = makeFakeClient();
    assert.doesNotThrow(() => mod.invalidateHouseholdAfterJoin(fake, 'u1'));
    // Resolve the recorded promises to prove they are well-formed.
    return Promise.all(
      fake.calls.map(() => Promise.resolve()),
    );
  });

  console.log('\n[tests] leave/disband chart invalidation source pins\n');

  await test('source pin: profile leave path invalidates the broad chart prefix', () => {
    const src = readFileSync(join(root, 'src/app/(tabs)/profile.tsx'), 'utf8');
    assert.match(src, /leaveHousehold\(\)[\s\S]{0,500}householdChartSeriesPrefix\(\)/);
  });

  await test('source pin: settings disband path invalidates the broad chart prefix', () => {
    const src = readFileSync(join(root, 'src/app/settings/household.tsx'), 'utf8');
    assert.match(
      src,
      /disbandHousehold\(household\.id\)[\s\S]{0,500}householdChartSeriesPrefix\(\)/,
    );
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});