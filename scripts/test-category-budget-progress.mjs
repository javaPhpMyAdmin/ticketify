#!/usr/bin/env node
/**
 * Node harness for the shared category-budget progress helpers
 * (`src/features/analytics/category-budget-progress.ts`, delta spec
 * `category-budgets` — acceptance gates 1–2).
 *
 * Compiles the pure module plus the domain types into a temp directory with
 * an isolated tsconfig (mirror of `tsconfig.monthly-overview-test.json`,
 * pared down to this module's graph), then asserts the design.md AD-4/AD-5
 * contract:
 *
 *   - merge: matched slug + month + amount > 0 → budget_limit = amount;
 *     unmatched / amount <= 0 / foreign-month budget → budget_limit = null
 *   - budget rows for slugs absent from totals are ignored (no extra entries),
 *     and with no budgets at all the totals survive with null limits
 *   - inputs are never mutated (deep-frozen fixtures) and totals order is
 *     preserved — the result is a new array with new objects
 *   - `budgetProgressColor` boundary table: 0.69 → green,
 *     0.7 / 0.99 → amber, 1 / 1.2 → red
 *   - degenerate ratios (NaN / ±Infinity / negative) → `colors.primary`
 *     (never red), and `BUDGET_COLOR.green` is the same token as
 *     `colors.primary` (Correction 3 identity)
 *   - `budgetBySlug`: month filter + amount > 0 filter
 *
 * Near-dependency-free: type-only imports plus one runtime import
 * (`@/theme/colors`, itself self-contained). The require-hook below remaps
 * `@/theme/colors` to the compiled module; no other remapping is needed.
 *
 * Deterministic: no clock; all fixture months are explicit `YYYY-MM` keys.
 *
 * Usage: pnpm test:category-budget-progress
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
const harnessConfig = join(__dirname, 'tsconfig.category-budget-progress-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'category-budget-progress-test-'));
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

// The compiled category-budget-progress.js requires '@/theme/colors': remap
// it to the compiled colors module.
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/theme/colors') {
      request = join(outDir, 'src', 'theme', 'colors.js');
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/** One cache-backed category total (transformCacheToCategoryTotals shape). */
function total(slug, name, amount) {
  return {
    category_id: slug,
    category_name: name,
    category_slug: slug,
    total: amount,
    item_count: 3,
    percent_of_total: 42.1,
    budget_limit: null,
  };
}

/** One `category_budgets` row (readCategoryBudgets shape). */
function budget(slug, amount, month) {
  return {
    user_id: 'test-user-id',
    category_slug: slug,
    month,
    amount,
  };
}

async function run() {
  console.log('\n[tests] compiling category-budget-progress modules…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();

  const mod = await load('src/features/analytics/category-budget-progress.js');
  const colorsMod = await load('src/theme/colors.js');
  const compute = (totals, budgets, monthKey) =>
    mod.mergeBudgetLimits(totals, budgets, monthKey);
  const color = (ratio) => mod.budgetProgressColor(ratio);
  const bySlug = (budgets, monthKey) => mod.budgetBySlug(budgets, monthKey);

  console.log('\n[tests] merge contract\n');

  await test('matched slug + month fills budget_limit; unmatched stays null', () => {
    const totals = [
      total('supermercado', 'Supermercado', 30000),
      total('transporte', 'Transporte', 8000),
    ];
    const budgets = [budget('supermercado', 50000, '2026-09')];
    const result = compute(totals, budgets, '2026-09');
    assert.equal(result.length, 2);
    assert.equal(result[0].budget_limit, 50000);
    assert.equal(result[0].total, 30000); // spend untouched — only the limit is merged
    assert.equal(result[1].budget_limit, null);
  });

  await test('no budgets → totals preserved with null limits; map empty', () => {
    const totals = [
      total('supermercado', 'Supermercado', 30000),
      total('transporte', 'Transporte', 8000),
    ];
    const result = compute(totals, [], '2026-09');
    assert.deepEqual(
      result.map((t) => t.budget_limit),
      [null, null],
    );
    assert.equal(result.length, totals.length); // never drops totals
    assert.equal(bySlug([], '2026-09').size, 0);
  });

  await test('budget slugs absent from totals are ignored (no extra entries)', () => {
    const totals = [total('supermercado', 'Supermercado', 30000)];
    const budgets = [
      budget('supermercado', 50000, '2026-09'),
      budget('indumentaria', 10000, '2026-09'), // no matching total
    ];
    const result = compute(totals, budgets, '2026-09');
    assert.equal(result.length, 1);
    assert.equal(result[0].budget_limit, 50000);
  });

  await test('foreign-month budget is ignored for the queried month', () => {
    const totals = [total('supermercado', 'Supermercado', 30000)];
    const budgets = [budget('supermercado', 50000, '2026-08')];
    assert.equal(compute(totals, budgets, '2026-09')[0].budget_limit, null);
    // Same row does apply when the other month is queried.
    assert.equal(compute(totals, budgets, '2026-08')[0].budget_limit, 50000);
  });

  await test('amount <= 0 budget rows never fill a limit (delete-on-zero)', () => {
    const totals = [total('supermercado', 'Supermercado', 30000)];
    const budgets = [
      budget('supermercado', 0, '2026-09'),
      budget('transporte', -5, '2026-09'),
    ];
    assert.equal(compute(totals, budgets, '2026-09')[0].budget_limit, null);
  });

  console.log('\n[tests] purity and order\n');

  await test('inputs are never mutated (deep-frozen) and result is new objects', () => {
    const totals = [
      total('supermercado', 'Supermercado', 30000),
      total('transporte', 'Transporte', 8000),
    ];
    const budgets = [budget('supermercado', 50000, '2026-09')];
    totals.forEach(Object.freeze);
    budgets.forEach(Object.freeze);
    Object.freeze(totals);
    Object.freeze(budgets);

    const result = compute(totals, budgets, '2026-09');
    assert.equal(result[0].budget_limit, 50000);
    assert.equal(totals[0].budget_limit, null); // original untouched
    assert.notEqual(result, totals); // new array
    assert.notEqual(result[0], totals[0]); // new objects
    assert.equal(totals[0].total, 30000);
  });

  await test('totals order is preserved', () => {
    const totals = [
      total('b', 'B', 100),
      total('a', 'A', 9000),
      total('c', 'C', 50),
    ];
    const result = compute(totals, [], '2026-09');
    assert.deepEqual(
      result.map((t) => t.category_slug),
      ['b', 'a', 'c'],
    );
  });

  console.log('\n[tests] budgetProgressColor boundary table\n');

  const GREEN = '#10B981';
  const AMBER = '#F59E0B';
  const RED = '#EF4444';

  await test('0.69 → green (< 0.7)', () => {
    assert.equal(color(0.69), GREEN);
    assert.equal(color(0), GREEN);
  });

  await test('0.7 → amber and 0.99 → amber (70–100%)', () => {
    assert.equal(color(0.7), AMBER);
    assert.equal(color(0.99), AMBER);
  });

  await test('1 → red and 1.2 → red (>= 100%)', () => {
    assert.equal(color(1), RED);
    assert.equal(color(1.2), RED);
  });

  await test('degenerate ratios → colors.primary, never red (Correction 3)', () => {
    const PRIMARY = colorsMod.colors.primary;
    assert.equal(PRIMARY, '#10B981', 'colors.primary is the brand emerald');
    assert.equal(color(NaN), PRIMARY, 'NaN (0/0 limit) → primary');
    assert.equal(color(Infinity), PRIMARY, '+Infinity → primary');
    assert.equal(color(-Infinity), PRIMARY, '-Infinity → primary');
    assert.equal(color(-0.5), PRIMARY, 'negative ratio → primary');
  });

  await test('BUDGET_COLOR.green is colors.primary (shared identity)', () => {
    assert.equal(mod.BUDGET_COLOR.green, colorsMod.colors.primary);
  });

  await test('BUDGET_COLOR exports the canonical palette', () => {
    assert.deepEqual(mod.BUDGET_COLOR, {
      green: GREEN,
      amber: AMBER,
      red: RED,
    });
  });

  console.log('\n[tests] budgetBySlug\n');

  await test('budgetBySlug maps slug → amount for the month only', () => {
    const map = bySlug(
      [
        budget('supermercado', 50000, '2026-09'),
        budget('transporte', 12000, '2026-09'),
        budget('indumentaria', 10000, '2026-08'), // foreign month
        budget('ocio', 0, '2026-09'), // delete-on-zero
      ],
      '2026-09',
    );
    assert.deepEqual([...map.entries()], [
      ['supermercado', 50000],
      ['transporte', 12000],
    ]);
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});