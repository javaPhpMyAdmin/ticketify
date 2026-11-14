#!/usr/bin/env node
/**
 * Node harness for the household-card currency split
 * (`splitHouseholdTotals` in
 * `src/features/household/household-currency-split.ts`).
 *
 * Product decision: the Home household card renders the VIEWER currency as
 * the headline figure and every other recorded unit as a secondary note.
 * Amounts of different currencies are NEVER summed or converted
 * (money-integrity spec), and a unit-less row binds to the viewer unit —
 * the same rule as the shared `bindViewerRows` helper.
 *
 * Compiles the module into a temp directory with an isolated tsconfig (same
 * mechanism as test-truncate-category-name.mjs) and pins the pure contract:
 *
 *   - empty totals → viewerTotal 0, no foreign rows,
 *   - a single viewer row → that total, no foreign rows,
 *   - mixed units → viewer headline keeps ONLY the viewer total and the
 *     other unit is listed separately (never added into the headline),
 *   - a unit-less legacy row binds to the viewer,
 *   - a month with foreign spend only → viewerTotal 0 (never a fabricated
 *     foreign total labeled as the viewer unit),
 *   - duplicate rows for one unit accumulate defensively,
 *   - foreign rows sort by total desc.
 *
 * Usage: pnpm test:household-currency-split
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
const harnessConfig = join(
  __dirname,
  'tsconfig.household-currency-split-test.json',
);

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'household-currency-split-test-'));
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

async function run() {
  console.log('\n[tests] compiling household-currency-split module…');
  compile();
  console.log('[tests] loading compiled module…');
  const mod = await import(
    pathToFileURL(
      join(
        outDir,
        'src',
        'features',
        'household',
        'household-currency-split.js',
      ),
    ).href
  );

  await test('empty totals → viewer 0, no foreign rows', () => {
    assert.deepEqual(mod.splitHouseholdTotals([], 'UYU'), {
      viewerTotal: 0,
      foreignTotals: [],
    });
  });

  await test('single viewer row → headline only', () => {
    assert.deepEqual(
      mod.splitHouseholdTotals([{ currency: 'UYU', total: 22684.7 }], 'UYU'),
      { viewerTotal: 22684.7, foreignTotals: [] },
    );
  });

  await test('mixed units → viewer headline NEVER includes the foreign total', () => {
    const out = mod.splitHouseholdTotals(
      [
        { currency: 'COP', total: 12198.09 },
        { currency: 'UYU', total: 22684.7 },
      ],
      'UYU',
    );
    assert.equal(out.viewerTotal, 22684.7);
    assert.deepEqual(out.foreignTotals, [
      { currency: 'COP', total: 12198.09 },
    ]);
  });

  await test('unit-less legacy row binds to the viewer', () => {
    assert.deepEqual(
      mod.splitHouseholdTotals([{ total: 100 }], 'UYU'),
      { viewerTotal: 100, foreignTotals: [] },
    );
  });

  await test('foreign-only month → viewer 0 (never relabeled)', () => {
    const out = mod.splitHouseholdTotals(
      [{ currency: 'COP', total: 12198.09 }],
      'UYU',
    );
    assert.equal(out.viewerTotal, 0);
    assert.deepEqual(out.foreignTotals, [
      { currency: 'COP', total: 12198.09 },
    ]);
  });

  await test('duplicate rows for one unit accumulate defensively', () => {
    const out = mod.splitHouseholdTotals(
      [
        { currency: 'UYU', total: 100 },
        { currency: 'UYU', total: 200 },
        { currency: 'COP', total: 50 },
        { currency: 'COP', total: 25 },
      ],
      'UYU',
    );
    assert.equal(out.viewerTotal, 300);
    assert.deepEqual(out.foreignTotals, [{ currency: 'COP', total: 75 }]);
  });

  await test('foreign rows sort by total desc', () => {
    const out = mod.splitHouseholdTotals(
      [
        { currency: 'CLP', total: 10 },
        { currency: 'COP', total: 500 },
        { currency: 'UYU', total: 1 },
      ],
      'UYU',
    );
    assert.deepEqual(
      out.foreignTotals.map((r) => r.currency),
      ['COP', 'CLP'],
    );
  });

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
