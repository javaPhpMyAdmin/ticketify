#!/usr/bin/env node
/**
 * Node harness for the snacks/microgastos breakdown helpers
 * (`src/features/budget/snacks-breakdown.ts`) — the money-integrity cross-unit
 * follow-up (issue #166, PR2).
 *
 * Compiles the breakdown helpers into a temp directory with a pared-down
 * tsconfig and asserts the invariant: amounts recorded in different units are
 * NEVER summed. The single grand total now reuses the shared `bindViewerRows`
 * predicate from `@/lib/money`, so the harness installs a `@/` require hook to
 * resolve that alias against the compiled output.
 *
 *   - `groupImpulseItemsByUnit` keeps the SAME product recorded in two units as
 *     two rows, each labelled with its own unit — never a merged figure.
 *   - it folds a legacy unit-less row (`currency: null`) into the viewer unit,
 *     and merges rows that share a `(name, unit)` key.
 *   - it is deterministic and sorts by amount desc, then name.
 *   - `viewerImpulseTotal` reduces ONLY the viewer-currency rows: on a mixed
 *     month it deliberately under-reports (excludes the foreign unit) rather
 *     than re-denominating a foreign amount under the viewer label.
 *
 * Discriminating fixtures: the mixed cases carry at least TWO different
 * currencies AND a legacy null row — a single-row fixture cannot tell a correct
 * grouping from a naive cross-unit sum.
 *
 * Source pins (a node harness cannot mount the React Native modal):
 *   - the modal renders each row with ITS OWN `item.currency`, keys the list by
 *     `(name, currency)`, and derives the grand total via `viewerImpulseTotal`.
 *   - the data seam returns a `currency` label for each impulse row.
 *   - `readMonthlyImpulseTotal` no longer carries the never-accepted
 *     `householdId` / `p_h_household_id` argument (the latent PGRST202).
 *
 * Usage: pnpm test:snacks-breakdown
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.snacks-breakdown-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'snacks-breakdown-test-'));
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

/**
 * Resolve the `@/…` member alias against the compiled output. tsc emits the
 * alias verbatim under commonjs, so without this hook node cannot resolve
 * `@/lib/money` (precedent: test-home.mjs, test-charts.mjs).
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

/** A discriminating mixed-unit fixture: two units + one legacy (null) row. */
const MIXED = [
  { name: 'papas', amount: 100, currency: 'UYU' },
  { name: 'papas', amount: 70, currency: 'CLP' },
  { name: 'chocolate', amount: 50, currency: null },
];

async function run() {
  console.log('\n[tests] compiling snacks-breakdown module…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled module…');
  const mod = await load('src/features/budget/snacks-breakdown.js');

  await test('groupImpulseItemsByUnit: same product in two units stays two rows (never summed)', () => {
    const out = mod.groupImpulseItemsByUnit(MIXED, 'UYU');
    assert.deepEqual(out, [
      { name: 'papas', amount: 100, currency: 'UYU' },
      { name: 'papas', amount: 70, currency: 'CLP' },
      { name: 'chocolate', amount: 50, currency: 'UYU' },
    ]);
    const papas = out.filter((r) => r.name === 'papas');
    assert.equal(papas.length, 2, 'papas must stay two rows, one per unit');
    assert.deepEqual(
      papas.map((r) => r.amount).sort((a, b) => b - a),
      [100, 70],
      'each papas amount must stay in its own row (100 and 70), never merged into one 170 figure',
    );
    assert.ok(
      papas.every((r) => r.amount !== 170),
      'no single row may carry the cross-unit 170 sum',
    );
  });

  await test('groupImpulseItemsByUnit: folds a legacy unit-less row into the viewer unit', () => {
    const out = mod.groupImpulseItemsByUnit(
      [{ name: 'chocolate', amount: 50, currency: null }],
      'UYU',
    );
    assert.deepEqual(out, [{ name: 'chocolate', amount: 50, currency: 'UYU' }]);
  });

  await test('groupImpulseItemsByUnit: merges rows that share a (name, unit) key', () => {
    const out = mod.groupImpulseItemsByUnit(
      [
        { name: 'papas', amount: 100, currency: 'UYU' },
        { name: 'papas', amount: 30, currency: 'UYU' },
        { name: 'papas', amount: 70, currency: 'CLP' },
      ],
      'UYU',
    );
    assert.deepEqual(out, [
      { name: 'papas', amount: 130, currency: 'UYU' },
      { name: 'papas', amount: 70, currency: 'CLP' },
    ]);
  });

  await test('viewerImpulseTotal: reduces ONLY the viewer-currency rows (under-report, never re-denominate)', () => {
    // UYU rows: papas 100 + chocolate 50 (legacy → viewer). CLP 70 excluded.
    assert.equal(
      mod.viewerImpulseTotal(MIXED, 'UYU'),
      150,
      'viewer total must be 150 (UYU only), never 220 (a cross-unit sum)',
    );
    assert.equal(
      mod.viewerImpulseTotal(
        [
          { name: 'papas', amount: 100, currency: 'UYU' },
          { name: 'papas', amount: 70, currency: 'CLP' },
        ],
        'CLP',
      ),
      70,
      'the viewer-currency reduction must follow the viewer unit',
    );
  });

  await test('viewerImpulseTotal: single-unit month equals the full sum', () => {
    const single = [
      { name: 'a', amount: 1100, currency: 'CLP' },
      { name: 'b', amount: 1300, currency: 'CLP' },
    ];
    assert.equal(mod.viewerImpulseTotal(single, 'CLP'), 2400);
  });

  await test('viewerImpulseTotal: a legacy unit-less row counts as the viewer', () => {
    assert.equal(
      mod.viewerImpulseTotal(
        [{ name: 'x', amount: 25, currency: null }],
        'UYU',
      ),
      25,
    );
  });

  await test('length of inputs is preserved per (name, unit) — no dropped rows', () => {
    const out = mod.groupImpulseItemsByUnit(MIXED, 'USD');
    assert.equal(out.length, 3, 'three distinct (name, unit) keys survive');
  });

  // ── Source pins (React Native modal is not mountable from plain node) ────
  await test('source pin: SnacksBreakdownModal renders each row with ITS own unit', () => {
    const src = readFileSync(
      join(root, 'src/features/budget/components/SnacksBreakdownModal.tsx'),
      'utf8',
    );
    assert.match(
      src,
      /formatCurrency\(\s*item\.amount\s*,\s*item\.currency\s*\)/,
      'each breakdown row must render with its own item.currency, never the viewer label',
    );
    assert.match(
      src,
      /keyExtractor=[^\n]*item\.currency/,
      'the list key must include the unit so the same name in two units is two rows',
    );
  });

  await test('source pin: the modal groups per unit and binds the total via viewerImpulseTotal', () => {
    const src = readFileSync(
      join(root, 'src/features/budget/components/SnacksBreakdownModal.tsx'),
      'utf8',
    );
    assert.match(
      src,
      /groupImpulseItemsByUnit\(/,
      'the modal must group rows per unit through the shared helper',
    );
    assert.match(
      src,
      /viewerImpulseTotal\(/,
      'the single grand total must bind viewer rows through viewerImpulseTotal',
    );
  });

  await test('source pin: the grand total shows a loading dash, never a $0 flash', () => {
    const src = readFileSync(
      join(root, 'src/features/budget/components/SnacksBreakdownModal.tsx'),
      'utf8',
    );
    // Bind the two branches in ONE scan: while the RPC is pending OR failed
    // the total slot must render the snacksModalLoading dash; only the
    // resolved branch may render formatCurrency(total, currency). A reverted
    // shape (total while pending, dash after resolve) fails this scan — a
    // plain ordering regex green-lit that exact regression.
    assert.match(
      src,
      /\{itemsQuery\.isPending \|\| itemsQuery\.isError \? \([\s\S]*?totalPlaceholder[\s\S]*?t\('snacksModalLoading'\)[\s\S]*?\)\s*:\s*\([\s\S]*?totalAmount[\s\S]*?formatCurrency\(\s*total\s*,\s*currency\s*\)/,
      'the pending/error branch must render the dash and the resolved branch the total (never a $0 flash)',
    );
  });

  await test('source pin: an RPC failure shows an error branch with Retry, never a false empty state', () => {
    const src = readFileSync(
      join(root, 'src/features/budget/components/SnacksBreakdownModal.tsx'),
      'utf8',
    );
    assert.match(
      src,
      /\) : itemsQuery\.isError \? \([\s\S]*?snacksModalError[\s\S]*?itemsQuery\.refetch\(\)/,
      'the error branch must render the error message and wire Retry to refetch',
    );
    assert.match(
      src,
      /snacksModalRetry/,
      'the retry control must come from the settings i18n namespace',
    );
  });

  await test('source pin: the loading dash and spinner carry an a11y label', () => {
    const src = readFileSync(
      join(root, 'src/features/budget/components/SnacksBreakdownModal.tsx'),
      'utf8',
    );
    const labelUses = (src.match(/snacksModalLoadingA11y/g) ?? []).length;
    assert.ok(
      labelUses >= 2,
      'snacksModalLoadingA11y must label both the total dash and the spinner',
    );
  });

  await test('source pin: readMonthlyImpulseItems returns a per-row currency label', () => {
    const src = readFileSync(
      join(root, 'src/lib/supabase/feature-access.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('export async function readMonthlyImpulseItems'));
    assert.match(
      body,
      /currency:\s*string\s*\|\s*null/,
      'readMonthlyImpulseItems must surface the row currency (0045)',
    );
  });

  await test('source pin: readMonthlyImpulseTotal dropped the never-accepted householdId arg', () => {
    const src = readFileSync(
      join(root, 'src/lib/supabase/feature-access.ts'),
      'utf8',
    );
    const body = src.slice(
      src.indexOf('export async function readMonthlyImpulseTotal'),
      src.indexOf('export async function readMonthlyImpulseItems'),
    );
    assert.doesNotMatch(
      body,
      /householdId|p_household_id/,
      'monthly_impulse_total(text) accepts only p_year_month — the stray householdId must be gone',
    );
  });

  console.log(`\n[tests] snacks-breakdown: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(workdir, { recursive: true, force: true });
  });
