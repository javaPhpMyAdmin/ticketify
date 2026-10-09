#!/usr/bin/env node
/**
 * Node harness for the pure analytics headline decision
 * (`src/features/analytics/analytics-headline.ts`).
 *
 * Compiles the single dependency-free module into a temp directory with an
 * isolated tsconfig, then asserts the headline contract (since 0044 the
 * totals are GROUPED per unit, decision 9):
 *
 *   - personal mode → the caller's own per-unit totals + personal change
 *     badge (regression guard for the original behavior),
 *   - household mode with resolved data → the real household per-unit
 *     totals + NO personal change badge (scope mix would mislead),
 *   - household mode WITHOUT resolved data (loading/error) → a placeholder
 *     (null totals), NEVER a false "$0.00" from an unresolved RPC,
 *   - zero/empty household totals stay groups with numeric 0 (never NaN),
 *   - a NaN aggregate is coerced to 0 per group (never prints NaN).
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
    'personal mode returns overviewTotals + personal changePct (regression guard)',
    () => {
      const result = build('personal', {
        householdTotals: [{ total: 999999, currency: 'CLP' }],
        overviewTotals: [
          { total: 12345, currency: 'UYU' },
          { total: 678, currency: 'CLP' },
        ],
        personalChangePct: 12.5,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, {
        headlineTotals: [
          { total: 12345, currency: 'UYU' },
          { total: 678, currency: 'CLP' },
        ],
        headlineChangePct: 12.5,
      });
    },
  );

  await test('personal mode keeps a null personal changePct (no badge)', () => {
    const result = build('personal', {
      householdTotals: [],
      overviewTotals: [{ total: 0, currency: 'UYU' }],
      personalChangePct: null,
      hasHouseholdData: false,
    });
    assert.deepEqual(result, {
      headlineTotals: [{ total: 0, currency: 'UYU' }],
      headlineChangePct: null,
    });
  });

  console.log('\n[tests] household mode\n');

  await test(
    'household mode returns householdTotals per unit + changePct null (no scope mix)',
    () => {
      const result = build('household', {
        householdTotals: [
          { total: 54321, currency: 'UYU' },
          { total: 900, currency: 'CLP' },
        ],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [
          { total: 54321, currency: 'UYU' },
          { total: 900, currency: 'CLP' },
        ],
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: a unit-less group keeps its null unit (row fallback is caller-side)',
    () => {
      const result = build('household', {
        householdTotals: [{ total: 42, currency: undefined }],
        overviewTotals: [],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [{ total: 42, currency: undefined }],
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: empty household totals stay a numeric 0 group (never NaN, never placeholder)',
    () => {
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [{ total: 0 }],
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode: a NaN aggregate is coerced to 0 per group, never prints NaN',
    () => {
      const result = build('household', {
        householdTotals: [
          { total: NaN, currency: 'UYU' },
          { total: 50, currency: 'UYU' },
        ],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: true,
      });
      assert.deepEqual(result, {
        headlineTotals: [
          { total: 0, currency: 'UYU' },
          { total: 50, currency: 'UYU' },
        ],
        headlineChangePct: null,
      });
    },
  );

  console.log('\n[tests] household mode without resolved data\n');

  await test(
    'household mode WITHOUT data returns placeholder (null totals), never $0',
    () => {
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 999999, currency: 'UYU' }],
        personalChangePct: 12.5,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, {
        headlineTotals: null,
        headlineChangePct: null,
      });
    },
  );

  await test(
    'household mode while loading (data not yet resolved) → placeholder',
    () => {
      // During the RPC flight the totals are already [] (derived from an
      // empty `data ?? []`); hasHouseholdData false must gate it to null.
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 777, currency: 'UYU' }],
        personalChangePct: -5,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, { headlineTotals: null, headlineChangePct: null });
    },
  );

  await test(
    'household mode while errored (hasData false) → placeholder',
    () => {
      // On RPC error the data never resolves: same gate, no $0.00.
      const result = build('household', {
        householdTotals: [],
        overviewTotals: [{ total: 777, currency: 'UYU' }],
        personalChangePct: null,
        hasHouseholdData: false,
      });
      assert.deepEqual(result, { headlineTotals: null, headlineChangePct: null });
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