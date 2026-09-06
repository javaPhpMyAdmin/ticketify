#!/usr/bin/env node
/**
 * Node harness for the pure analytics headline decision
 * (`src/features/analytics/analytics-headline.ts`).
 *
 * Compiles the single dependency-free module into a temp directory with an
 * isolated tsconfig, then asserts the headline contract:
 *
 *   - personal mode → caller's own receipts total + personal change badge
 *     (byte-identical regression guard for the original behavior),
 *   - household mode → the real household total + NO personal change badge
 *     (scope mix would mislead),
 *   - zero/empty household totals stay numbers (0, never NaN).
 *
 * Deterministic: the function takes primitives only, no clock, no hooks.
 *
 * Usage: pnpm test:analytics-headline
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.analytics-headline-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'analytics-headline-test-'));
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

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

async function run() {
  console.log('\n[tests] compiling analytics-headline modules…');
  await compile();
  console.log('[tests] loading compiled modules…');

  const mod = await load('src/features/analytics/analytics-headline.js');
  const build = (viewMode, opts) => mod.buildOverviewHeadline(viewMode, opts);

  console.log('\n[tests] personal mode\n');

  await test(
    'personal mode returns overviewTotal + personal changePct (regression guard)',
    () => {
      const result = build('personal', {
        householdMonthTotal: 999999,
        overviewTotal: 12345,
        personalChangePct: 12.5,
      });
      assert.deepEqual(result, {
        headlineTotal: 12345,
        headlineChangePct: 12.5,
      });
    },
  );

  await test('personal mode keeps a null personal changePct (no badge)', () => {
    const result = build('personal', {
      householdMonthTotal: 999999,
      overviewTotal: 0,
      personalChangePct: null,
    });
    assert.deepEqual(result, { headlineTotal: 0, headlineChangePct: null });
  });

  console.log('\n[tests] household mode\n');

  await test(
    'household mode returns householdMonthTotal + changePct null (no scope mix)',
    () => {
      const result = build('household', {
        householdMonthTotal: 54321,
        overviewTotal: 999999,
        personalChangePct: 12.5,
      });
      assert.deepEqual(result, {
        headlineTotal: 54321,
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: empty household total stays numeric 0 (never NaN)',
    () => {
      const result = build('household', {
        householdMonthTotal: 0,
        overviewTotal: 999999,
        personalChangePct: 12.5,
      });
      assert.equal(result.headlineTotal, 0);
      assert.equal(Number.isNaN(result.headlineTotal), false);
    },
  );

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});