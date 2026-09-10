#!/usr/bin/env node
/**
 * Node harness for the PR 2 hybrid `formatCurrency` (AD-6 — currency
 * code is the authority of format). Compiles `src/lib/format.ts` via
 * `tsc` with the same isolated tsconfig pattern as
 * `scripts/test-format.mjs` and asserts the 13-case table from the WU-2.2
 * spec.
 *
 * Coverage:
 *
 *   - INTL grouping (`,` thousands + `.` decimals) for USD/EUR/GBP/JPY/
 *     CAD/AUD.
 *   - LATAM grouping (`.` thousands + `,` decimals) for ARS/UYU/BRL/MXN.
 *   - Symbol form keyed by `CURRENCY_SYMBOL` (UYU → `$U`, USD → `US$`,
 *     etc.). Unknown codes fall back to the code itself.
 *   - Edge cases: zero (`'$ 0'`), negative (`-US$ 1,234.56`).
 *
 * The module under test has no runtime imports in PR 2 (it does not
 * actually read `i18next.language` — the function intentionally reads
 * it for FUTURE label/symbol-form choices per the spec, but the PR 2
 * behavior is pure). If a later WU wires i18next, this harness's
 * tsconfig stays the same — no remap hooks needed.
 *
 * Usage: pnpm test:format-currency
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
const harnessConfig = join(__dirname, 'tsconfig.format-currency-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'format-currency-test-'));
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
  console.log('\n[tests] compiling format module (formatCurrency)…');
  compile();
  console.log('[tests] loading compiled module…');
  const fmt = await import(
    pathToFileURL(join(outDir, 'src', 'lib', 'format.js')).href
  );

  console.log('\n[tests] INTL grouping (USD/EUR/GBP/JPY/CAD/AUD)\n');

  await test('formatCurrency USD → "US$ 1,234.56" (INTL grouping, space)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'USD'), 'US$ 1,234.56');
  });

  await test('formatCurrency EUR → "€ 1,234.56" (INTL grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'EUR'), '€ 1,234.56');
  });

  await test('formatCurrency GBP → "£ 1,234.56" (INTL grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'GBP'), '£ 1,234.56');
  });

  await test('formatCurrency JPY → "¥ 1,234.56" (INTL grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'JPY'), '¥ 1,234.56');
  });

  await test('formatCurrency CAD → "CA$ 1,234.56" (INTL grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'CAD'), 'CA$ 1,234.56');
  });

  await test('formatCurrency AUD → "A$ 1,234.56" (INTL grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'AUD'), 'A$ 1,234.56');
  });

  console.log('\n[tests] LATAM grouping (ARS/UYU/BRL/MXN)\n');

  await test('formatCurrency ARS → "$ 1.234,56" (LATAM grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'ARS'), '$ 1.234,56');
  });

  await test('formatCurrency UYU → "$U 1.234,56" (LATAM, disambiguated symbol)', () => {
    // UYU renders "$U" (not just "$") per the new symbol table — the old
    // format collapsed UYU/ARS/USD to a single "$".
    assert.equal(fmt.formatCurrency(1234.56, 'UYU'), '$U 1.234,56');
  });

  await test('formatCurrency BRL → "R$ 1.234,56" (LATAM grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'BRL'), 'R$ 1.234,56');
  });

  await test('formatCurrency MXN → "$ 1.234,56" (LATAM grouping)', () => {
    assert.equal(fmt.formatCurrency(1234.56, 'MXN'), '$ 1.234,56');
  });

  console.log('\n[tests] unknown / zero / negative edges\n');

  await test(
    'formatCurrency unknown code "XYZ" → "XYZ 1,234.56" (INTL default, code as symbol)',
    () => {
      // Unknown code → INTL grouping (the spec rule) + the code itself
      // as the symbol (backward-compatible with the old fallback).
      assert.equal(fmt.formatCurrency(1234.56, 'XYZ'), 'XYZ 1,234.56');
    },
  );

  await test('formatCurrency zero → "$ 0" (no decimals on whole numbers)', () => {
    // Zero's `toFixed(2)` returns "0.00"; the formatter skips the decimal
    // segment when it's all zeros (`decPart ? withSeparators + decSep + decPart : withSeparators`).
    assert.equal(fmt.formatCurrency(0, 'ARS'), '$ 0');
  });

  await test(
    'formatCurrency negative USD → "-US$ 1,234.56" (sign before symbol)',
    () => {
      // Negative values are prefixed with `-` BEFORE the symbol — the
      // common LATAM / INTL convention, matching the old behavior.
      assert.equal(fmt.formatCurrency(-1234.56, 'USD'), '-US$ 1,234.56');
    },
  );

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log(`[tests] all ${passed} tests passed`);
  }
  rmSync(workdir, { recursive: true, force: true });
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
}