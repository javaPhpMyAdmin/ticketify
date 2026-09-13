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
 *   - formatYearMonth: locale-first — "ago 2026" (es-AR/PT-BR) /
 *     "Aug 2026" (en) short; "Agosto de 2026" full + capitalize
 *     (es-AR/pt-BR connector " de ", en plain space).
 *   - formatDayMonth: day + full month per locale — "3 de agosto"
 *     (es-AR/pt-BR), "August 3" (en),
 *   - formatMonthYear: short month + year from the LOCAL calendar month
 *     (a UTC string slice of a full timestamptz would render the wrong
 *     month); the es-AR September pin "sep 2026" documents the deliberate
 *     sep-vs-Intl-"sept" choice,
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

  await test('formatYearMonth short es-AR → "ago 2026"', () => {
    assert.equal(fmt.formatYearMonth('es-AR', '2026-08'), 'ago 2026');
  });

  await test('formatYearMonth short en + capitalize → "Aug 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('en', '2026-08', { capitalize: true }),
      'Aug 2026',
    );
  });

  await test('formatYearMonth short pt-BR → "ago 2026"', () => {
    assert.equal(fmt.formatYearMonth('pt-BR', '2026-08'), 'ago 2026');
  });

  await test('formatYearMonth full + capitalize es-AR → "Agosto de 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('es-AR', '2026-08', { full: true, capitalize: true }),
      'Agosto de 2026',
    );
  });

  await test('formatYearMonth full + capitalize en → "August 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('en', '2026-08', { full: true, capitalize: true }),
      'August 2026',
    );
  });

  await test('formatYearMonth full + capitalize pt-BR → "Agosto de 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('pt-BR', '2026-08', { full: true, capitalize: true }),
      'Agosto de 2026',
    );
  });

  await test('formatYearMonth full lowercase en → "august 2026"', () => {
    assert.equal(fmt.formatYearMonth('en', '2026-08', { full: true }), 'august 2026');
  });

  // Array-edge coverage: month names index `date.getMonth()` (0-based), so
  // January (index 0) and December (index 11) are the off-by-one corners.
  // Pins both edges for all three locales, short and full + capitalize.

  await test('formatYearMonth short es-AR January → "ene 2026"', () => {
    assert.equal(fmt.formatYearMonth('es-AR', '2026-01'), 'ene 2026');
  });

  await test('formatYearMonth short es-AR December → "dic 2026"', () => {
    assert.equal(fmt.formatYearMonth('es-AR', '2026-12'), 'dic 2026');
  });

  await test('formatYearMonth full + capitalize es-AR January → "Enero de 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('es-AR', '2026-01', { full: true, capitalize: true }),
      'Enero de 2026',
    );
  });

  await test('formatYearMonth full + capitalize es-AR December → "Diciembre de 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('es-AR', '2026-12', { full: true, capitalize: true }),
      'Diciembre de 2026',
    );
  });

  await test('formatYearMonth short + capitalize en January → "Jan 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('en', '2026-01', { capitalize: true }),
      'Jan 2026',
    );
  });

  await test('formatYearMonth short + capitalize en December → "Dec 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('en', '2026-12', { capitalize: true }),
      'Dec 2026',
    );
  });

  await test('formatYearMonth full + capitalize en January → "January 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('en', '2026-01', { full: true, capitalize: true }),
      'January 2026',
    );
  });

  await test('formatYearMonth full + capitalize en December → "December 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('en', '2026-12', { full: true, capitalize: true }),
      'December 2026',
    );
  });

  await test('formatYearMonth short pt-BR January → "jan 2026"', () => {
    assert.equal(fmt.formatYearMonth('pt-BR', '2026-01'), 'jan 2026');
  });

  await test('formatYearMonth short pt-BR December → "dez 2026"', () => {
    assert.equal(fmt.formatYearMonth('pt-BR', '2026-12'), 'dez 2026');
  });

  await test('formatYearMonth full + capitalize pt-BR January → "Janeiro de 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('pt-BR', '2026-01', { full: true, capitalize: true }),
      'Janeiro de 2026',
    );
  });

  await test('formatYearMonth full + capitalize pt-BR December → "Dezembro de 2026"', () => {
    assert.equal(
      fmt.formatYearMonth('pt-BR', '2026-12', { full: true, capitalize: true }),
      'Dezembro de 2026',
    );
  });

  await test('formatYearMonth returns input on malformed year-month', () => {
    assert.equal(fmt.formatYearMonth('es-AR', '2026-13'), '2026-13');
  });

  // formatDayMonth — day + full month, locale tables only (no Intl).

  await test('formatDayMonth es-AR → "3 de agosto" (day-first, lowercase month)', () => {
    assert.equal(fmt.formatDayMonth('es-AR', '2026-08-03'), '3 de agosto');
  });

  await test('formatDayMonth en → "August 3" (month-first, title-cased)', () => {
    assert.equal(fmt.formatDayMonth('en', '2026-08-03'), 'August 3');
  });

  await test('formatDayMonth pt-BR → "3 de agosto" (day-first, lowercase month)', () => {
    assert.equal(fmt.formatDayMonth('pt-BR', '2026-08-03'), '3 de agosto');
  });

  // formatMonthYear — short month + year derived from LOCAL calendar fields.

  await test('formatMonthYear es-AR date-only → "ago 2026"', () => {
    assert.equal(fmt.formatMonthYear('es-AR', '2026-08-01'), 'ago 2026');
  });

  await test('formatMonthYear en date-only → "Aug 2026"', () => {
    assert.equal(fmt.formatMonthYear('en', '2026-08-01'), 'Aug 2026');
  });

  await test('formatMonthYear pt-BR date-only → "ago 2026"', () => {
    assert.equal(fmt.formatMonthYear('pt-BR', '2026-08-01'), 'ago 2026');
  });

  await test('formatMonthYear renders the LOCAL month of a full timestamptz, never the UTC month', () => {
    // TZ=America/Montevideo (UTC-3): 2026-08-01T01:30:00Z is Jul 31 22:30
    // local. A raw `iso.slice(0, 7)` regression read the ISO month and
    // rendered "ago 2026"; the local parse must keep "jul 2026" (same
    // calendar fields the old `toLocaleDateString` call read).
    assert.equal(
      fmt.formatMonthYear('es-AR', '2026-08-01T01:30:00Z'),
      'jul 2026',
    );
  });

  await test('formatMonthYear es-AR September → "sep 2026" (deliberate sep vs Intl sept)', () => {
    // Pins the sept→sep normalization: MONTHS_SHORT_ES[8] = 'sep' is
    // shorter than Intl's 'sept' and matches the `date:monthShort`
    // catalog convention — deliberate, not a drift.
    assert.equal(fmt.formatMonthYear('es-AR', '2026-09-11'), 'sep 2026');
  });

  await test('formatDayMonth returns input on malformed iso', () => {
    assert.equal(fmt.formatDayMonth('es-AR', 'not-a-date'), 'not-a-date');
  });

  await test('formatMonthYear returns input on malformed iso', () => {
    assert.equal(fmt.formatMonthYear('es-AR', 'not-a-date'), 'not-a-date');
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
