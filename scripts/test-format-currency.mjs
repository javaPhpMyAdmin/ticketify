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
 *   - ZERO-DECIMAL minor units: CLP, JPY, PEN and PYG are factually
 *     whole-unit currencies, so they render as whole amounts (`$ 1.235`,
 *     `¥ 1,235`, `S/ 1.235`, `₲ 100`) and NEVER emit a decimal separator.
 *     The one intentional change to ESTABLISHED shipped output is JPY, which
 *     used to render `¥ 1,234.56` — a fabricated cent. CLP and PEN had no
 *     symbol at all before this change and so rendered as bare codes.
 *   - Symbol coverage for every one of the 14 catalog codes — each renders
 *     symbol-prefixed, never as a bare code.
 *   - Edge cases: zero (`'$ 0'`), negative (`-US$ 1,234.56`), and a legacy
 *     lowercase row (`'usd'`).
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

  await test('formatCurrency JPY → "¥ 1,235" (INTL grouping, ZERO-decimal)', () => {
    // JPY has no minor unit. The old `¥ 1,234.56` printed a cent the
    // currency does not have; the zero-decimal rule (AD-5) rounds to the
    // nearest whole yen and emits no decimal separator.
    assert.equal(fmt.formatCurrency(1234.56, 'JPY'), '¥ 1,235');
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

  console.log('\n[tests] zero-decimal minor units + symbol coverage (AD-5)\n');

  await test('formatCurrency CLP → "$ 1.235" (LATAM, whole amount)', () => {
    // CLP has no minor unit, and it renders `$` like the other regional
    // pesos — the localized NAME in the catalog is what tells ARS / CLP /
    // COP / MXN apart. REQ-2.1.
    assert.equal(fmt.formatCurrency(1234.56, 'CLP'), '$ 1.235');
  });

  await test('formatCurrency PEN → "S/ 1.235" (LATAM, "S/" symbol, whole amount)', () => {
    // PEN retired the centavo; `S/` is the sol's symbol. REQ-2.2.
    assert.equal(fmt.formatCurrency(1234.56, 'PEN'), 'S/ 1.235');
  });

  await test('formatCurrency PYG → "₲ 1.235" (LATAM, guaraní symbol, whole)', () => {
    // `₲` is U+20B2. If a device font has no glyph for it, the symbol falls
    // back to the CODE (`PYG 1.235`) — one-line table change, verified on
    // device by the manual REQ-2.7 step.
    assert.equal(fmt.formatCurrency(1234.56, 'PYG'), '₲ 1.235');
  });

  await test('formatCurrency PYG 100.4 → "₲ 100" (sub-unit fraction rounds away)', () => {
    assert.equal(fmt.formatCurrency(100.4, 'PYG'), '₲ 100');
  });

  await test('every zero-decimal code renders without a decimal separator', () => {
    // Triangulation on the OTHER branch and across BOTH grouping styles: JPY
    // groups INTL, CLP / PEN / PYG group LATAM — and none of the four keeps a
    // `.` or `,` fraction. COP is absent on purpose (recorded scope decision).
    const zeroDecimal = ['CLP', 'JPY', 'PEN', 'PYG'];
    const expected = {
      CLP: '$ 1.235',
      JPY: '¥ 1,235',
      PEN: 'S/ 1.235',
      PYG: '₲ 1.235',
    };
    assert.equal(zeroDecimal.length, 4);
    for (const code of zeroDecimal) {
      const rendered = fmt.formatCurrency(1234.56, code);
      assert.equal(rendered, expected[code]);
      assert.ok(!/\d[.,]\d{2}$/.test(rendered), `${code} kept a fraction: ${rendered}`);
    }
    // The control: COP is factually zero-decimal but deliberately OUT of the
    // set, so it still renders a fraction.
    assert.equal(fmt.formatCurrency(1234.56, 'COP'), '$ 1.234,56');
  });

  await test('formatCurrency takes no locale argument (format is code-driven)', () => {
    // REQ-2.6 / REQ-2.5: the UI locale cannot reach the number shape, so a
    // zero-decimal code renders identically under `en` and `es-419`. The
    // guarantee is structural — there is no third parameter to branch on.
    assert.equal(fmt.formatCurrency.length, 2);
    assert.equal(fmt.formatCurrency(1234.56, 'JPY'), '¥ 1,235');
    assert.equal(fmt.formatCurrency(1234.56, 'ARS'), '$ 1.234,56');
  });

  await test('a legacy lowercase row renders like an uppercase one', () => {
    // Migration 0040 defaulted the column to lowercase `'usd'`, and no
    // migration in this change may rewrite those rows — so the display side
    // case-folds and the two must be indistinguishable.
    assert.equal(fmt.formatCurrency(1234.56, 'usd'), 'US$ 1,234.56');
  });

  await test('all 14 catalog codes render symbol-prefixed (never a bare code)', () => {
    // REQ-1.3.3. The loop is non-vacuous: the catalog is asserted to hold 14
    // distinct codes in the section below.
    for (const code of fmt.SUPPORTED_CURRENCIES) {
      const rendered = fmt.formatCurrency(1234.56, code);
      assert.ok(
        rendered.startsWith(`${fmt.CURRENCY_SYMBOL[code]} `),
        `${code} rendered without its symbol: ${rendered}`,
      );
      assert.ok(!rendered.startsWith(`${code} `), `${code} fell back to the bare code`);
    }
  });

  console.log('\n[tests] catalog single source of truth (AD-1)\n');

  await test('SUPPORTED_CURRENCIES is the 14-code catalog, no duplicates', () => {
    // REQ-1.1: the ordered set the selector renders. Pinned here (and again,
    // cross-file, in test-currency-catalog) because a 13th or 15th code is
    // exactly the drift this catalog exists to prevent.
    assert.equal(fmt.SUPPORTED_CURRENCIES.length, 14);
    assert.equal(new Set(fmt.SUPPORTED_CURRENCIES).size, 14);
    assert.deepEqual(
      [...fmt.SUPPORTED_CURRENCIES].sort(),
      [
        'ARS', 'AUD', 'BRL', 'CAD', 'CLP', 'COP', 'EUR', 'GBP', 'JPY',
        'MXN', 'PEN', 'PYG', 'USD', 'UYU',
      ],
    );
  });

  await test('the grouping Sets are derived from the catalog (no fourth list)', () => {
    // AD-1: LATAM/INTL are the SOURCE; the Sets formatCurrency groups with
    // are derived from them, so the two must partition the catalog exactly.
    const grouped = [...fmt.LATAM_CURRENCIES, ...fmt.INTL_CURRENCIES].sort();
    assert.deepEqual(grouped, [...fmt.SUPPORTED_CURRENCIES].sort());
  });

  await test('every catalog code resolves a symbol (never a bare code)', () => {
    // REQ-1.3. The table is typed `Record<SupportedCurrency, string>` so a
    // missing entry is a `tsc` error; this is the runtime half of the same
    // guarantee (the loop is non-vacuous — 14 codes are asserted above).
    for (const code of fmt.SUPPORTED_CURRENCIES) {
      assert.ok(fmt.CURRENCY_SYMBOL[code], `${code} has no symbol`);
    }
  });

  await test('the codes missing from the old symbol table now resolve', () => {
    // AD-1 adds CLP / PEN / PYG. `Record<SupportedCurrency, string>` also
    // forces COP, which shipped in the LATAM set with no symbol at all and so
    // rendered as the bare code `COP 1.234,56` — REQ-1.3 forbids that.
    assert.equal(fmt.CURRENCY_SYMBOL.CLP, '$');
    assert.equal(fmt.CURRENCY_SYMBOL.PEN, 'S/');
    assert.equal(fmt.CURRENCY_SYMBOL.PYG, '₲');
    assert.equal(fmt.CURRENCY_SYMBOL.COP, '$');
  });

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