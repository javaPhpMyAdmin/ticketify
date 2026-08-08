#!/usr/bin/env node
/**
 * Node harness for the pure month-over-month comparison
 * (`src/features/analytics/monthly-overview.ts`).
 *
 * Compiles the monthly-overview module plus its dependency graph (home feed,
 * auth store, receipts store, react-query) into a temp directory
 * with an isolated tsconfig that remaps the native/backend imports to the
 * hand-written test doubles, then asserts the overview contract:
 *
 *   - totals sum only the receipts that fall in each month bucket,
 *   - a positive change yields a signed positive `changePct`,
 *   - a drop yields a negative `changePct`,
 *   - no previous-month spend → `changePct: null` (no division by zero),
 *   - no current-month spend with a previous base → -100%,
 *   - receipts in other months are ignored,
 *   - the comparison rolls over across the year boundary (Jan vs Dec).
 *
 * Deterministic: no clock, fixed `YYYY-MM` inputs; the comparison is purely a
 * function of the records and the month key.
 *
 * Usage: pnpm test:monthly-overview
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
const harnessConfig = join(__dirname, 'tsconfig.monthly-overview-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'monthly-overview-test-'));
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
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request.startsWith('@/')) {
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

/** One receipt with a line total. */
function receipt(id, date, total) {
  return { id, store_name: 'Store', purchase_date: date, total };
}

async function run() {
  console.log('\n[tests] compiling monthly-overview modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const overviewMod = await load('src/features/analytics/monthly-overview.js');
  const compute = (records, monthKey) =>
    overviewMod.computeMonthOverview(records, monthKey);

  console.log('\n[tests] month buckets\n');

  await test('totals sum only receipts in the target month', () => {
    const result = compute(
      [
        receipt('r1', '2026-08-03', 1000),
        receipt('r2', '2026-08-15', 2000),
        receipt('r3', '2026-07-04', 9999),
      ],
      '2026-08',
    );
    assert.equal(result.currentTotal, 3000);
    // Only the July receipt counts for the previous month.
    assert.equal(result.previousTotal, 9999);
  });

  await test('a positive change yields a signed positive changePct', () => {
    const result = compute(
      [
        receipt('r1', '2026-07-03', 1000),
        receipt('r2', '2026-08-06', 1100),
      ],
      '2026-08',
    );
    assert.equal(result.currentTotal, 1100);
    assert.equal(result.previousTotal, 1000);
    assert.equal(result.changePct, 10);
  });

  await test('a drop yields a negative changePct', () => {
    const result = compute(
      [
        receipt('r1', '2026-07-03', 1200),
        receipt('r2', '2026-08-06', 900),
      ],
      '2026-08',
    );
    assert.equal(result.changePct, -25);
  });

  console.log('\n[tests] base and edge cases\n');

  await test('no previous-month spend → changePct null (no div by zero)', () => {
    const result = compute([receipt('r1', '2026-08-03', 500)], '2026-08');
    assert.equal(result.currentTotal, 500);
    assert.equal(result.previousTotal, 0);
    assert.equal(result.changePct, null);
  });

  await test('no current-month spend with a previous base → -100%', () => {
    const result = compute([receipt('r1', '2026-07-03', 500)], '2026-08');
    assert.equal(result.currentTotal, 0);
    assert.equal(result.previousTotal, 500);
    assert.equal(result.changePct, -100);
  });

  await test('receipts in other months are ignored', () => {
    const result = compute(
      [
        receipt('r1', '2026-06-03', 1000),
        receipt('r2', '2026-09-03', 1000),
      ],
      '2026-08',
    );
    assert.equal(result.currentTotal, 0);
    assert.equal(result.previousTotal, 0);
    assert.equal(result.changePct, null);
  });

  await test('comparison rolls over across the year boundary', () => {
    const result = compute(
      [
        receipt('r1', '2025-12-20', 1000),
        receipt('r2', '2026-01-05', 1100),
      ],
      '2026-01',
    );
    assert.equal(result.previousTotal, 1000);
    assert.equal(result.changePct, 10);
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
