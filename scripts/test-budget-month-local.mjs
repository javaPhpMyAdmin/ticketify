#!/usr/bin/env node
/**
 * Regression harness for the UTC-vs-local month-key bug (spec
 * `category-budgets` — REQ-C / NFR-2: budget keys derive from the LOCAL
 * month, never the UTC month).
 *
 * Deviation from the review prompt (documented): the prompt's literal pair —
 * instant 2026-08-31T23:30:00Z expecting 2026-09 under both TZ=UTC and
 * TZ=America/Montevideo — is arithmetically impossible. Montevideo is UTC-3
 * year-round (no DST since 2015): at that instant the local time is
 * 2026-08-31T20:30, i.e. month 2026-08 in BOTH zones (no divergence exists).
 * The authoritative contract is design.md line ~119 "(local 2026-08 vs UTC
 * 2026-09)", which is only produced at 2026-09-01T00:30:00Z (UTC → 2026-09,
 * Montevideo → 2026-08). That boundary instant is Cases A/B.
 * A same-month pair (2026-09-30T23:30:00Z → both 2026-09) covers the
 * prompt's literal "mismo instante → ambos 2026-09" expectation.
 *
 * Cases:
 *   A  boundary: TZ=UTC + fixed 2026-09-01T00:30:00Z            → '2026-09'
 *   B  boundary: TZ=America/Montevideo + same fixed instant      → '2026-08'
 *   A2 same-month: TZ=UTC + fixed 2026-09-30T23:30:00Z          → '2026-09'
 *   B2 same-month: TZ=America/Montevideo + same fixed instant   → '2026-09'
 *   C  source regression: compiled `useCategoryBudgets.js` AND compiled
 *      `settings/category-budgets.js` must reference `currentMonthKey` and
 *      must NOT reference `utcYearMonth` anywhere.
 *
 * The month key comes from the REAL compiled `useHomeFeed.js`
 * (`currentMonthKey` — local calendar time). The subprocess driver pins the
 * clock to the fixed instant and inherits `TZ` from its spawn env; each run
 * is a fresh process so Node re-derives the zone offset.
 *
 * Determinism: no network, no real clock (fixed Date double), TZ injected
 * per subprocess.
 *
 * Usage: pnpm test:budget-month-local
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.budget-month-local-test.json');
const driver = join(__dirname, 'test-budget-month-local-driver.mjs');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'budget-month-local-test-'));
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

/** Spawn the driver in a fresh process with a fixed instant + TZ. */
function monthKeyAt(tz, fixedInstant) {
  const res = spawnSync(process.execPath, [driver], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      TZ: tz,
      BUDGET_FIXED_INSTANT: fixedInstant,
      BUDGET_MONTH_OUT_DIR: outDir,
    },
  });
  if (res.status !== 0) {
    throw new Error(
      `driver exited ${res.status} (TZ=${tz}, instant=${fixedInstant})\n${res.stderr}`,
    );
  }
  return res.stdout.trim();
}

async function run() {
  console.log('\n[tests] compiling budget-month-local graph (REAL useHomeFeed + settings)…');
  await compile();
  console.log('[tests] running subprocess cases…\n');

  // -----------------------------------------------------------------------
  // Cases A/B — the boundary divergence instant (design.md ~119):
  // 2026-09-01T00:30:00Z → UTC month 2026-09 vs Montevideo local 2026-08.
  // -----------------------------------------------------------------------
  await test('case A: TZ=UTC at 2026-09-01T00:30:00Z → currentMonthKey() = 2026-09', () => {
    assert.equal(monthKeyAt('UTC', '2026-09-01T00:30:00.000Z'), '2026-09');
  });

  await test('case B: TZ=America/Montevideo at 2026-09-01T00:30:00Z → currentMonthKey() = 2026-08', () => {
    // The local calendar month (the one budgets must save under) is August.
    assert.equal(
      monthKeyAt('America/Montevideo', '2026-09-01T00:30:00.000Z'),
      '2026-08',
    );
  });

  // -----------------------------------------------------------------------
  // Cases A2/B2 — same-month pair: both zones agree on 2026-09 (the
  // prompt's literal "ambos 2026-09" expectation).
  // -----------------------------------------------------------------------
  await test('case A2: TZ=UTC at 2026-09-30T23:30:00Z → currentMonthKey() = 2026-09', () => {
    assert.equal(monthKeyAt('UTC', '2026-09-30T23:30:00.000Z'), '2026-09');
  });

  await test('case B2: TZ=America/Montevideo at 2026-09-30T23:30:00Z → currentMonthKey() = 2026-09', () => {
    assert.equal(
      monthKeyAt('America/Montevideo', '2026-09-30T23:30:00.000Z'),
      '2026-09',
    );
  });

  // -----------------------------------------------------------------------
  // Case C — source regression over the COMPILED budget-flow modules:
  // the default month key must come from currentMonthKey (local), and the
  // old utcYearMonth derivation must not be referenced anywhere.
  // -----------------------------------------------------------------------
  console.log('\n[tests] case C: compiled source regression (utcYearMonth must be gone)\n');

  await test('compiled useCategoryBudgets.js has currentMonthKey, no utcYearMonth', () => {
    const file = join(outDir, 'src/features/analytics/hooks/useCategoryBudgets.js');
    assert.ok(existsSync(file), 'compiled useCategoryBudgets.js exists');
    const js = readFileSync(file, 'utf8');
    assert.ok(js.includes('currentMonthKey'), 'defaults to the LOCAL currentMonthKey');
    assert.ok(!js.includes('utcYearMonth'), 'no utcYearMonth in the hook');
  });

  await test('compiled settings/category-budgets.js has currentMonthKey, no utcYearMonth', () => {
    const file = join(outDir, 'src/app/settings/category-budgets.js');
    assert.ok(existsSync(file), 'compiled settings/category-budgets.js exists');
    const js = readFileSync(file, 'utf8');
    assert.ok(js.includes('currentMonthKey'), 'settings derives the month locally');
    assert.ok(!js.includes('utcYearMonth'), 'no utcYearMonth in the settings screen');
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});