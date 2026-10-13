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
 *   - LATAM grouping (`.` thousands + `,` decimals) for ARS/UYU/BRL.
 *   - ZERO-DECIMAL minor units: the twelve catalog codes with ISO 4217 minor
 *     unit 0 (BIF, CLP, GNF, JPY, KRW, PYG, RWF, UGX, VND, XAF, XOF, XPF)
 *     are whole-unit currencies, so they render as whole amounts (`¥ 1,235`,
 *     `$ 1.235`, `₲ 1.235`, …) and NEVER emit a decimal separator — printing
 *     `¥ 1,234.56` fabricates a sub-unit that does not exist. PEN is NOT one of
 *     them: the Peruvian sol is ISO 4217 minor unit 2 and renders its two
 *     decimals like the other LATAM currencies.
 *   - THREE-DECIMAL minor units: the six catalog codes with ISO 4217 minor
 *     unit 3 (IQD, JOD, KWD, LYD, OMR, TND) render exactly three decimals
 *     (`KD 1.234`, `KD 1,234.560`) but DROP the fraction when all three digits
 *     are zero (`KD 1,234`), the same unit convention as the 2-decimal codes
 *     with a wider fraction window.
 *   - SEPARATOR OVERRIDES: the six LATAM-classified codes whose national
 *     convention is INTL grouping (MXN, GTQ, HNL, NIO, DOP, PAB) render
 *     `1,234.56` even though they belong to the LATAM group. The override is a
 *     per-code set consulted by BOTH `formatCurrency` and
 *     `formatCurrencyWhole`; it never mutates the LATAM membership.
 *   - Symbol form keyed by `CURRENCY_SYMBOL` (UYU → `$U`, USD → `US$`,
 *     etc.). Unknown codes fall back to the code itself.
 *   - Symbol coverage for every one of the 123 catalog codes — each renders
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

  console.log('\n[tests] LATAM grouping (ARS/UYU/BRL)\n');

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

  console.log('\n[tests] separator overrides (LATAM codes rendering INTL)\n');

  await test('formatCurrency MXN → "$ 1,234.56" (LATAM code, INTL override)', () => {
    // MXN belongs to the LATAM group but its recorded national convention is
    // INTL grouping. The override SET wins over group membership (REQ-005 /
    // S-005.1) without mutating LATAM_CURRENCIES.
    assert.equal(fmt.formatCurrency(1234.56, 'MXN'), '$ 1,234.56');
  });

  await test('formatCurrency GTQ → "Q 1,234.56" (LATAM code, INTL override)', () => {
    // GTQ is the second override code; `Q` is the quetzal symbol. Same rule.
    assert.equal(fmt.formatCurrency(1234.56, 'GTQ'), 'Q 1,234.56');
  });

  await test('the override set is exactly the six locked LATAM codes', () => {
    // REQ-005: the override mechanism is a per-code set, never a mutation.
    assert.deepEqual(
      [...fmt.SEPARATOR_OVERRIDES].sort(),
      ['DOP', 'GTQ', 'HNL', 'MXN', 'NIO', 'PAB'],
    );
    // And every override code is still a LATAM member (the set only changes
    // the SEPARATORS, not the group).
    for (const code of fmt.SEPARATOR_OVERRIDES) {
      assert.ok(fmt.LATAM_CURRENCIES.has(code), `${code} must stay a LATAM member`);
    }
  });

  await test('formatCurrencyWhole MXN → "$ 1,235" (override applies to the whole format)', () => {
    // The whole-number format shares the currency's unit convention: if
    // `formatCurrency(1234.56,'MXN')` is INTL, the truncated total must be too,
    // otherwise charts and totals disagree on the same screen (design §2).
    assert.equal(fmt.formatCurrencyWhole(1234.56, 'MXN'), '$ 1,235');
  });

  await test('formatCurrencyWhole ARS → "$ 1.235" (no override, LATAM grouping)', () => {
    // Regression control for the override: an un-overridden LATAM code keeps
    // the LATAM grouping in the whole format.
    assert.equal(fmt.formatCurrencyWhole(1234.56, 'ARS'), '$ 1.235');
  });

  console.log('\n[tests] three-decimal minor units (ISO 4217 minor unit 3)\n');

  await test('formatCurrency KWD 1.234 → "KD 1.234" (exactly three decimals)', () => {
    // KWD is minor unit 3; `CURRENCY_SYMBOL.KWD` is the committed literal `KD`.
    assert.equal(fmt.formatCurrency(1.234, 'KWD'), 'KD 1.234');
  });

  await test('formatCurrency KWD 1234 → "KD 1,234" (all-zero `000` fraction DROPPED)', () => {
    // `(1234).toFixed(3)` is `"1234.000"`; the length-aware zero-fraction guard
    // recognizes the all-zero `000` and drops the decimal segment (S-004.2 /
    // S-007.2), exactly like `formatCurrency(0,'ARS')` drops `00`.
    assert.equal(fmt.formatCurrency(1234, 'KWD'), 'KD 1,234');
  });

  await test('formatCurrency KWD 1234.56 → "KD 1,234.560" (non-zero fraction keeps 3)', () => {
    // INTL grouping with a three-digit non-zero fraction.
    assert.equal(fmt.formatCurrency(1234.56, 'KWD'), 'KD 1,234.560');
  });

  await test('formatCurrency JOD → "د.ا 1,234.560" (a second 3-decimal code)', () => {
    // Triangulation across the 3-decimal set: JOD shares the minor unit 3
    // model, so the same rule must generalize beyond KWD.
    assert.equal(fmt.formatCurrency(1234.56, 'JOD'), 'د.ا 1,234.560');
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

  await test('formatCurrency PEN → "S/ 1.234,56" (LATAM, "S/" symbol, two decimals)', () => {
    // The Peruvian sol is ISO 4217 minor unit 2: it renders its cents like the
    // other LATAM currencies, and `S/` is the sol's symbol. PEN is NOT
    // zero-decimal.
    assert.equal(fmt.formatCurrency(1234.56, 'PEN'), 'S/ 1.234,56');
  });

  await test('formatCurrency PYG → "₲ 1.235" (LATAM, guaraní symbol, whole)', () => {
    // `₲` is U+20B2, and `CURRENCY_SYMBOL.PYG` is the unconditional literal
    // `'₲'` — nothing here probes the device font for the glyph. The only
    // code-as-symbol fallback (`table[upperCode] ?? rawCode`) fires solely for
    // codes ABSENT from the table, so PYG never degrades to `PYG 1.235`.
    assert.equal(fmt.formatCurrency(1234.56, 'PYG'), '₲ 1.235');
  });

  await test('formatCurrency PYG 100.4 → "₲ 100" (sub-unit fraction rounds away)', () => {
    assert.equal(fmt.formatCurrency(100.4, 'PYG'), '₲ 100');
  });

  await test('every zero-decimal code renders without a decimal separator', () => {
    // The full ISO 4217 minor-unit-0 catalog set (twelve codes). Triangulation
    // across BOTH grouping styles: BIF / GNF / JPY / KRW / RWF / UGX / VND /
    // XAF / XOF / XPF group INTL, CLP / PYG group LATAM — and none keeps a `.`
    // or `,` fraction. PEN is GONE from this set (minor unit 2), and COP is
    // absent on purpose (recorded scope decision).
    const zeroDecimal = [
      'BIF', 'CLP', 'GNF', 'JPY', 'KRW', 'PYG',
      'RWF', 'UGX', 'VND', 'XAF', 'XOF', 'XPF',
    ];
    const expected = {
      BIF: 'FBu 1,235',
      CLP: '$ 1.235',
      GNF: 'FG 1,235',
      JPY: '¥ 1,235',
      KRW: '₩ 1,235',
      PYG: '₲ 1.235',
      RWF: 'RF 1,235',
      UGX: 'USh 1,235',
      VND: '₫ 1,235',
      XAF: 'FCFA 1,235',
      XOF: 'CFA 1,235',
      XPF: 'CFPF 1,235',
    };
    assert.equal(zeroDecimal.length, 12);
    assert.deepEqual(
      [...fmt.ZERO_DECIMAL_CURRENCIES].sort(),
      [...zeroDecimal].sort(),
      'the zero-decimal set must be exactly the twelve minor-unit-0 catalog codes',
    );
    for (const code of zeroDecimal) {
      const rendered = fmt.formatCurrency(1234.56, code);
      assert.equal(rendered, expected[code]);
      assert.ok(!/\d[.,]\d{2}$/.test(rendered), `${code} kept a fraction: ${rendered}`);
    }
    // Controls: PEN is no longer zero-decimal (minor unit 2) and renders its
    // cents; COP is factually zero-decimal but deliberately OUT of the set.
    assert.ok(!fmt.ZERO_DECIMAL_CURRENCIES.has('PEN'));
    assert.equal(fmt.formatCurrency(1234.56, 'PEN'), 'S/ 1.234,56');
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

  await test('all 123 catalog codes render symbol-prefixed (never a bare code)', () => {
    // REQ-1.3.3. The loop is non-vacuous: the catalog is asserted to hold 123
    // distinct codes in the section below. CHF is exempt from the "not the
    // bare code" half: its conventional symbol IS "CHF", so a correct render
    // legitimately starts with the code plus a space.
    for (const code of fmt.SUPPORTED_CURRENCIES) {
      const rendered = fmt.formatCurrency(1234.56, code);
      assert.ok(
        rendered.startsWith(`${fmt.CURRENCY_SYMBOL[code]} `),
        `${code} rendered without its symbol: ${rendered}`,
      );
      if (code !== 'CHF') {
        assert.ok(!rendered.startsWith(`${code} `), `${code} fell back to the bare code`);
      }
    }
  });

  console.log('\n[tests] catalog single source of truth (AD-1)\n');

  await test('SUPPORTED_CURRENCIES is the 123-code catalog, no duplicates', () => {
    // REQ-1.1: the ordered set the selector renders. Pinned here (and again,
    // cross-file, in test-currency-catalog) because an added or dropped code
    // is exactly the drift this catalog exists to prevent.
    assert.equal(fmt.SUPPORTED_CURRENCIES.length, 123);
    assert.equal(new Set(fmt.SUPPORTED_CURRENCIES).size, 123);
    assert.deepEqual(
      [...fmt.SUPPORTED_CURRENCIES].sort(),
      [
        'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD',
        'AZN', 'BAM', 'BDT', 'BGN', 'BIF', 'BOB', 'BRL',
        'BWP', 'BYN', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
        'COP', 'CRC', 'CUP', 'CZK', 'DKK', 'DOP', 'DZD',
        'EGP', 'ERN', 'ETB', 'EUR', 'GBP', 'GEL', 'GHS',
        'GMD', 'GNF', 'GTQ', 'HKD', 'HNL', 'HTG', 'HUF',
        'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'JMD', 'JOD',
        'JPY', 'KES', 'KGS', 'KHR', 'KPW', 'KRW', 'KWD',
        'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD',
        'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MRU',
        'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO',
        'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK',
        'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD',
        'RUB', 'RWF', 'SAR', 'SDG', 'SEK', 'SGD', 'SLE',
        'SOS', 'SSP', 'SYP', 'THB', 'TJS', 'TMT', 'TND',
        'TRY', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU',
        'UZS', 'VES', 'VND', 'XAF', 'XCD', 'XOF', 'XPF',
        'YER', 'ZAR', 'ZMW', 'ZWG',
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
    // guarantee (the loop is non-vacuous — 123 codes are asserted above).
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

  // ==========================================================================
  // Fail-closed hydration gate (F1 of the currency-universality review)
  //
  // The store seeds a PLACEHOLDER code before `profiles.currency` has been
  // read, and grouping is keyed BY CODE. So a gate that withheld only the
  // symbol would still print the seed's separators — an unconfirmed unit
  // convention on a real balance. These pins are the executable form of the
  // gate's contract: BARE while shut, fully formatted once open.
  //
  // The large-number cases are load-bearing. `1234.56` has nothing to group,
  // so it renders identically under both behaviors and cannot catch a revert;
  // `1234567.89` is what actually proves the separators are suppressed.
  // ==========================================================================
  console.log('\n[tests] fail-closed hydration gate (symbol AND separators)\n');

  /** Runs `fn` with the gate shut, then restores it OPEN for every later pin. */
  const withGateShut = async (fn) => {
    fmt.setCurrencySymbolGate(false);
    try {
      await fn();
    } finally {
      fmt.setCurrencySymbolGate(true);
    }
  };

  await test('a shut gate emits the SAME bare number for a LATAM and an INTL amount', async () => {
    await withGateShut(async () => {
      // The regression this pins: the store seeds `USD`, so a symbol-only gate
      // printed the INTL grouping `1,234.56` at a user whose currency is UYU —
      // who reads that as 1234,56 pesos' worth, off by 1000x, confidently.
      assert.equal(
        fmt.formatCurrency(1234.56, 'UYU'),
        '1234.56',
        'a LATAM amount must not borrow the INTL seed separators',
      );
      assert.equal(
        fmt.formatCurrency(1234.56, 'USD'),
        '1234.56',
        'and the same bare form for the seed itself — no convention claimed',
      );
    });
  });

  await test('a shut gate withholds the THOUSANDS separator (the 7-digit proof)', async () => {
    await withGateShut(async () => {
      // Every one of these asserts the absence of a separator that the
      // code-driven grouping would otherwise inject. Reverting the
      // separator suppression turns each into a loud failure.
      assert.equal(fmt.formatCurrency(1234567.89, 'USD'), '1234567.89');
      assert.equal(fmt.formatCurrency(1234567.89, 'UYU'), '1234567.89');
      assert.equal(fmt.formatCurrency(1234567.89, 'XYZ'), '1234567.89');
      // Shape-based catch-all: a separator followed by exactly three digits and
      // then a non-digit is a thousands separator (`.234.567,89` /
      // `1,234,567.89` both match). The bare form's plain `.` before two
      // decimals never matches, so this cannot fire on `1234567.89`.
      for (const code of ['USD', 'UYU', 'XYZ', 'JPY']) {
        assert.doesNotMatch(
          fmt.formatCurrency(1234567.89, code),
          /[.,]\d{3}(?!\d)/,
          `${code}: a shut gate must inject no thousands separator`,
        );
      }
    });
  });

  await test('a shut gate ignores the ZERO-DECIMAL rule too (it is a unit assumption)', async () => {
    await withGateShut(async () => {
      // JPY/CLP/PEN/PYG round to whole units when hydrated. Rounding while
      // shut would bake in a minor-unit claim the profile row has not made,
      // and would change the number the user is looking at mid-hydration.
      assert.equal(fmt.formatCurrency(1234.56, 'JPY'), '1234.56');
      assert.equal(fmt.formatCurrency(1234.56, 'CLP'), '1234.56');
      assert.equal(
        fmt.formatCurrency(1234.56, 'UYU'),
        '1234.56',
        'a minor-unit code renders the same bare value — the gate does not branch on it',
      );
    });
  });

  await test('a shut gate keeps the sign, the decimal point and the zero edge', async () => {
    await withGateShut(async () => {
      assert.equal(fmt.formatCurrency(-1234.56, 'UYU'), '-1234.56');
      assert.equal(fmt.formatCurrency(0, 'UYU'), '0', 'an all-zero fraction drops away');
      assert.equal(fmt.formatCurrency(-1234567.89, 'USD'), '-1234567.89');
      assert.equal(fmt.formatCurrency(0, 'JPY'), '0');
    });
  });

  await test('formatCurrencyWhole withholds the symbol AND the grouping', async () => {
    await withGateShut(async () => {
      assert.equal(fmt.formatCurrencyWhole(1234567.89, 'UYU'), '1234568');
      assert.equal(fmt.formatCurrencyWhole(1234567.89, 'USD'), '1234568');
      assert.equal(fmt.formatCurrencyWhole(-1234567.89, 'UYU'), '-1234568');
      assert.equal(fmt.formatCurrencyWhole(812.24, 'UYU'), '812');
    });
  });

  await test('re-opening the gate restores symbol AND separators for both families', async () => {
    // The other half of the contract: a gate stuck shut would render every
    // real balance bare forever, which is its own outage.
    fmt.setCurrencySymbolGate(true);
    assert.equal(fmt.formatCurrency(1234567.89, 'UYU'), '$U 1.234.567,89');
    assert.equal(fmt.formatCurrency(1234567.89, 'USD'), 'US$ 1,234,567.89');
    assert.equal(fmt.formatCurrency(1234567.89, 'XYZ'), 'XYZ 1,234,567.89');
    assert.equal(fmt.formatCurrency(1234.56, 'JPY'), '¥ 1,235');
    assert.equal(fmt.formatCurrencyWhole(1234567.89, 'UYU'), '$U 1.234.568');
    assert.equal(fmt.formatCurrencyWhole(1234567.89, 'USD'), 'US$ 1,234,568');
  });

  await test('this section leaves the gate OPEN (no leak into later consumers)', () => {
    // A harness that shuts the gate and forgets to re-open it would leave every
    // later assertion — and any module importing this one — rendering bare.
    assert.equal(
      fmt.isCurrencySymbolGateOpen(),
      true,
      'the gate must be back open after the fail-closed section',
    );
    assert.equal(fmt.formatCurrency(1234567.89, 'USD'), 'US$ 1,234,567.89');
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