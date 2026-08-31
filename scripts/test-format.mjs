#!/usr/bin/env node
/**
 * Node harness for the pure Spanish formatters (`src/lib/format.ts`).
 *
 * Compiles the module into a temp directory with an isolated tsconfig (same
 * mechanism as test-auth/test-features) and asserts the formatting contract
 * with FIXED inputs — no `Intl`, no real clock:
 *
 *   - formatCurrency: UYU renders with the $ symbol, negatives prefixed,
 *     unknown codes fall back to "CODE ",
 *   - formatShortDate: day-first "12 ago" (Spanish convention), date-only
 *     strings parsed in LOCAL time (a UTC parse of '2026-08-01' renders
 *     "31 jul" under UTC-x zones — the regression this pins),
 *   - formatTime: 12-hour "02:30 p. m." / "12:00 a. m.",
 *   - formatRelativeDay: Hoy / Ayer / short date against an explicit `now`,
 *   - formatYearMonth: "ago 2026" / "Agosto 2026" from a `YYYY-MM`,
 *   - todayLocalISO: today's local calendar date (compared against a
 *     locally-constructed date, never a UTC slice).
 *
 * The module has no imports, so no `@/` remap hook is needed. The TZ is
 * pinned to America/Montevideo (UTC-3) so the date-only assertions are
 * deterministic regardless of the runner's zone.
 *
 * Usage: pnpm test:format
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
const harnessConfig = join(__dirname, 'tsconfig.format-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'format-test-'));
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
  console.log('\n[tests] compiling format module…');
  compile();
  // Pin the zone so the date-only local-parse assertions are deterministic
  // on any machine (Node honors mid-process TZ changes on POSIX).
  process.env.TZ = 'America/Montevideo';
  console.log('[tests] loading compiled module…');
  const fmt = await import(pathToFileURL(join(outDir, 'src', 'lib', 'format.js')).href);

  await test('formatCurrency UYU renders with the $ symbol', () => {
    assert.equal(fmt.formatCurrency(1234.5, 'UYU'), '$1,234.50');
    assert.equal(fmt.formatCurrency(1234.5, 'ARS'), '$1,234.50');
  });

  await test('formatCurrency prefixes negative amounts with the sign', () => {
    assert.equal(fmt.formatCurrency(-1234.5, 'UYU'), '-$1,234.50');
  });

  await test('formatCurrency falls back to "CODE " for unknown currencies', () => {
    assert.equal(fmt.formatCurrency(5, 'XYZ'), 'XYZ 5.00');
  });

  await test('formatShortDate → day-first "12 Ago." (capitalized month + period)', () => {
    const iso = new Date(2026, 7, 12, 14, 30).toISOString();
    assert.equal(fmt.formatShortDate(iso), '12 Ago. ');
  });

  await test('formatShortDate returns input on invalid date', () => {
    assert.equal(fmt.formatShortDate('not-a-date'), 'not-a-date');
  });

  await test('formatShortDate parses date-only strings in LOCAL time, not UTC', () => {
    // Under TZ=America/Montevideo (UTC-3) `new Date('2026-08-01')` is UTC
    // midnight → Jul 31 21:00 local → "31 jul". The local parse must stay
    // on the right calendar day: "1 Ago. ".
    assert.equal(fmt.formatShortDate('2026-08-01'), '1 Ago. ');
  });

  await test('formatTime → "02:30 p. m."', () => {
    const iso = new Date(2026, 7, 12, 14, 30).toISOString();
    assert.equal(fmt.formatTime(iso), '02:30 p. m.');
  });

  await test('formatTime → "12:00 a. m." for midnight', () => {
    const iso = new Date(2026, 7, 12, 0, 0).toISOString();
    assert.equal(fmt.formatTime(iso), '12:00 a. m.');
  });

  await test('formatRelativeDay → "Hoy" for the same day', () => {
    const now = new Date(2026, 7, 12, 9, 0);
    const iso = new Date(2026, 7, 12, 14, 30).toISOString();
    assert.equal(fmt.formatRelativeDay(iso, now), 'Hoy');
  });

  await test('formatRelativeDay → "Ayer" for the previous day', () => {
    const now = new Date(2026, 7, 12, 9, 0);
    const iso = new Date(2026, 7, 11, 14, 30).toISOString();
    assert.equal(fmt.formatRelativeDay(iso, now), 'Ayer');
  });

  await test('formatRelativeDay → short date for older days', () => {
    const now = new Date(2026, 7, 12, 9, 0);
    const iso = new Date(2026, 7, 10, 14, 30).toISOString();
    assert.equal(fmt.formatRelativeDay(iso, now), '10 Ago. ');
  });

  await test('formatRelativeDay treats a date-only string as a local day', () => {
    const now = new Date(2026, 7, 1, 12, 0);
    // A UTC parse of '2026-08-01' lands on Jul 31 in UTC-3 → "31 jul";
    // the local parse keeps "Hoy".
    assert.equal(fmt.formatRelativeDay('2026-08-01', now), 'Hoy');
  });

  await test('todayLocalISO returns today in local calendar time, not UTC', () => {
    const local = new Date();
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    assert.equal(fmt.todayLocalISO(), expected);
  });

  await test('formatYearMonth short → "ago 2026"', () => {
    assert.equal(fmt.formatYearMonth('2026-08'), 'ago 2026');
  });

  await test('formatYearMonth full + capitalize → "Agosto 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('2026-08', { full: true, capitalize: true }),
      'Agosto 2026',
    );
  });

  await test('formatYearMonth full lowercase → "agosto 2026"', () => {
    assert.equal(fmt.formatYearMonth('2026-08', { full: true }), 'agosto 2026');
  });

  await test('formatYearMonth returns input on malformed year-month', () => {
    assert.equal(fmt.formatYearMonth('2026-13'), '2026-13');
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
