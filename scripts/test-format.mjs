#!/usr/bin/env node
/**
 * Node harness for the pure Spanish formatters (`src/lib/format.ts`).
 *
 * Compiles the module into a temp directory with an isolated tsconfig (same
 * mechanism as test-auth/test-features) and asserts the formatting contract
 * with FIXED inputs — no `Intl`, no real clock:
 *
 *   - formatShortDate: day-first "12 ago" (Spanish convention),
 *   - formatTime: 12-hour "02:30 p. m." / "12:00 a. m.",
 *   - formatRelativeDay: Hoy / Ayer / short date against an explicit `now`,
 *   - formatYearMonth: "ago 2026" / "Agosto 2026" from a `YYYY-MM`.
 *
 * The module has no imports, so no `@/` remap hook is needed.
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
  console.log('[tests] loading compiled module…');
  const fmt = await import(pathToFileURL(join(outDir, 'src', 'lib', 'format.js')).href);

  await test('formatShortDate → day-first "12 ago"', () => {
    const iso = new Date(2026, 7, 12, 14, 30).toISOString();
    assert.equal(fmt.formatShortDate(iso), '12 ago');
  });

  await test('formatShortDate returns input on invalid date', () => {
    assert.equal(fmt.formatShortDate('not-a-date'), 'not-a-date');
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
    assert.equal(fmt.formatRelativeDay(iso, now), '10 ago');
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
