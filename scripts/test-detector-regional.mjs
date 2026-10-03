#!/usr/bin/env node
/**
 * Node harness for the REGIONAL half of the device-locale detector
 * (`src/i18n/detector.ts`).
 *
 * `test-i18n-detector.mjs` owns the language table. This file owns the
 * region: which Spanish regional override a tag selects, how an explicit
 * `regionCode` from `AppleLanguages`/NativeModules overrides the tag, the
 * fallback CHAIN each regional locale inherits, and the viability
 * thresholds that decide whether a region is worth shipping at all.
 *
 * ── The rule this file exists to pin ──────────────────────────────────────
 * Spanish regionalizes three ways, and conflating them is the bug the
 * `es-419` base was introduced to prevent:
 *
 *   es-AR   voseo — Argentina (and Uruguay). "Ingresá un nombre".
 *   es-ES   peninsular — Spain. "Introduce un nombre", "Muévela".
 *   es-419  NEUTRAL LATIN AMERICAN — everything else. "Ingresa un nombre".
 *
 * `es-419` is not a synonym for `es-AR` and it is emphatically not a
 * fallback for a region the app does not know. It is the BASE: a Mexican
 * or Colombian reader must get tú-form neutral Spanish, never Argentine
 * voseo, and must never be handed English because their country has no
 * override.
 *
 * ── Why `regionCode` is a separate argument ───────────────────────────────
 * `AppleLanguages`/`getLocales()` return the user's PREFERRED languages,
 * but iOS/Android will happily report `es-MX` for a device whose region
 * setting is Argentina, and vice versa. The region the user is actually IN
 * is the stronger signal for a dialect decision, so the store passes
 * `regionCode` and it wins. Both are pure inputs: no clock, no `Intl`,
 * no environment, so every case below is a fixed pair.
 *
 * ── What this file also owns: `resolveRegionCode` + `detectDefaultCurrency`
 * Region PARSING is one shared, pure contract (`resolveRegionCode`) with two
 * consumers — `detectLocale` below, and `detectDefaultCurrency` for the
 * profile's currency. Normalization exists once, so a change to it cannot make
 * the locale and the currency disagree about which country a device is in.
 * `detectDefaultCurrency` is region-driven and NEVER language-driven: an
 * `en-GB` device gets `GBP` while still speaking `en`. All 23 pre-existing
 * `detectLocale` cases above stay UNEDITED — they are the regression proof
 * that adding currency detection did not move the locale mapping.
 *
 * Usage: pnpm test:detector-regional
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
const harnessConfig = join(__dirname, 'tsconfig.i18n-detector-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'detector-regional-test-'));
const outDir = join(workdir, 'out');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
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
  console.log('\n[tests] compiling detector module…');
  compile();
  console.log('[tests] loading compiled module…');
  const mod = await import(
    pathToFileURL(join(outDir, 'src/i18n/detector.js')).href
  );

  console.log('\n[tests] regional Spanish mapping (tag only)\n');

  await test('es-AR → es-AR (voseo)', () => {
    assert.equal(mod.detectLocale('es-AR'), 'es-AR');
  });

  await test('es_AR (underscore form) → es-AR', () => {
    // `Intl`/`NSLocale` can hand back underscores; a hyphen-only split
    // would treat `es_AR` as an unknown tag and drop the reader to `en`.
    assert.equal(mod.detectLocale('es_AR'), 'es-AR');
  });

  await test('es-UY → es-419 (the voseo override is scoped to Argentina)', () => {
    // Linguistically Uruguay is voseo, so `UY → es-AR` would be defensible.
    // The design scoped the voseo override to `AR` alone, so a Uruguayan
    // device gets tú-form neutral Spanish today. Pinned deliberately so the
    // behaviour is DOCUMENTED rather than accidental — widening the map to
    // `UY`/`PY` is a copy decision that needs its own native-speaker pass,
    // not something a harness should quietly assume.
    assert.equal(mod.detectLocale('es-UY'), 'es-419');
  });

  await test('es-ES → es-ES (peninsular)', () => {
    assert.equal(mod.detectLocale('es-ES'), 'es-ES');
  });

  await test('es-419 → es-419 (the neutral base addresses itself)', () => {
    assert.equal(mod.detectLocale('es-419'), 'es-419');
  });

  await test('bare "es" → es-419 (no region means no regional override)', () => {
    // Not `es-AR`. With no region the honest answer is the base: picking
    // voseo here is the exact bug this harness guards.
    assert.equal(mod.detectLocale('es'), 'es-419');
  });

  await test('es-MX → es-419', () => {
    assert.equal(mod.detectLocale('es-MX'), 'es-419');
  });

  await test('es-CL → es-419', () => {
    assert.equal(mod.detectLocale('es-CL'), 'es-419');
  });

  await test('es-CO → es-419', () => {
    assert.equal(mod.detectLocale('es-CO'), 'es-419');
  });

  await test('es-PE → es-419', () => {
    assert.equal(mod.detectLocale('es-PE'), 'es-419');
  });

  await test('es-US → es-419 (region outside the map falls to the base, never to en)', () => {
    assert.equal(mod.detectLocale('es-US'), 'es-419');
  });

  console.log('\n[tests] explicit regionCode wins over the tag\n');

  await test("es-AR + regionCode 'AR' → es-AR", () => {
    assert.equal(mod.detectLocale('es-AR', 'AR'), 'es-AR');
  });

  await test("es-MX + regionCode 'AR' → es-AR (device region beats the language tag)", () => {
    // The device is IN Argentina; a Mexican language preference does not
    // change that the user reads voseo.
    assert.equal(mod.detectLocale('es-MX', 'AR'), 'es-AR');
  });

  await test("es-MX + regionCode 'MX' → es-419", () => {
    assert.equal(mod.detectLocale('es-MX', 'MX'), 'es-419');
  });

  await test("es + regionCode 'ES' → es-ES (a bare tag plus a region resolves the region)", () => {
    assert.equal(mod.detectLocale('es', 'ES'), 'es-ES');
  });

  await test("es-AR + regionCode 'ES' → es-ES (region wins even against an explicit regional tag)", () => {
    assert.equal(mod.detectLocale('es-AR', 'ES'), 'es-ES');
  });

  await test("es-419 + regionCode '419' → es-419 (the base survives a redundant region)", () => {
    assert.equal(mod.detectLocale('es-419', '419'), 'es-419');
  });

  await test('en-US + regionCode AR → en (a non-Spanish language is not regionalized)', () => {
    // The region argument only disambiguates SPANISH. Letting it divert
    // `en-US` to Spanish on an Argentine device would be nonsense.
    assert.equal(mod.detectLocale('en-US', 'AR'), 'en');
  });

  console.log('\n[tests] fallback chain (every chain ends in `en`)\n');

  await test('es-AR inherits es-419 then en', () => {
    assert.deepEqual(mod.FALLBACK_CHAIN['es-AR'], ['es-419', 'en']);
  });

  await test('es-ES inherits es-419 then en', () => {
    assert.deepEqual(mod.FALLBACK_CHAIN['es-ES'], ['es-419', 'en']);
  });

  await test('es-419 falls back only to en', () => {
    assert.deepEqual(mod.FALLBACK_CHAIN['es-419'], ['en']);
  });

  await test('every supported locale terminates in the global default', () => {
    // A chain that dead-ends renders raw keys. `en` is the terminus for all
    // five, so no locale can ever resolve to nothing.
    for (const locale of mod.SUPPORTED_LOCALES) {
      const chain = mod.FALLBACK_CHAIN[locale];
      assert.ok(Array.isArray(chain) && chain.length > 0, `${locale} has no chain`);
      assert.equal(chain[chain.length - 1], 'en', `${locale} chain must end in en`);
    }
  });

  await test('a regional chain NEVER includes a sibling region', () => {
    // `es-AR → es-ES` would let a Peninsular imperative bleed into an
    // Argentine banner. Siblings are peers, not fallbacks.
    for (const region of ['es-AR', 'es-ES']) {
      const chain = mod.FALLBACK_CHAIN[region];
      for (const sibling of ['es-AR', 'es-ES']) {
        if (sibling === region) continue;
        assert.ok(!chain.includes(sibling), `${region} must not fall back to ${sibling}`);
      }
    }
  });

  console.log('\n[tests] shared region resolver (one normalizer, two consumers)\n');

  await test('resolveRegionCode("es_ES") → "ES" (separator + case normalized)', () => {
    // One implementation, two consumers: `detectLocale` (locale) and
    // `detectDefaultCurrency` (currency) both parse regions through here, so
    // normalization can never drift between them.
    assert.equal(mod.resolveRegionCode('es_ES'), 'ES');
  });

  await test('resolveRegionCode("es") → "ES" (a bare region IS a region)', () => {
    // The resolver is STRUCTURAL: the whole string is a region candidate,
    // which is what lets `detectDefaultCurrency('MX')` (REQ-3 scenario 1)
    // read a bare region. `detectLocale` never hands it a bare language
    // subtag — `splitTag` strips that first — which is why `detectLocale('es')`
    // is still the base (pinned above) and never the Peninsular override.
    assert.equal(mod.resolveRegionCode('es'), 'ES');
  });

  await test('resolveRegionCode("es-419") → "419" (UN M.49 is a region)', () => {
    assert.equal(mod.resolveRegionCode('es-419'), '419');
  });

  await test('resolveRegionCode("es-Ar-x-private") → "AR" (singletons skipped)', () => {
    // `x` is a private-use singleton (1 alpha) and `private` is a 7-letter
    // subtag; neither is regionish, so the hunt walks past them.
    assert.equal(mod.resolveRegionCode('es-Ar-x-private'), 'AR');
  });

  await test('resolveRegionCode("es-MX", "AR") → "AR" (explicit region wins)', () => {
    // The device is IN Argentina; the language preference does not override
    // the platform's own region answer.
    assert.equal(mod.resolveRegionCode('es-MX', 'AR'), 'AR');
  });

  await test('resolveRegionCode(undefined) and ("") → null (no region)', () => {
    assert.equal(mod.resolveRegionCode(undefined), null);
    assert.equal(mod.resolveRegionCode(''), null);
    assert.equal(mod.resolveRegionCode('   '), null);
  });

  await test('resolveRegionCode takes the LAST regionish segment', () => {
    // `es-419-MX`: the M.49 macro-region comes first, the country last, and
    // the country is the more specific answer.
    assert.equal(mod.resolveRegionCode('es-419-MX'), 'MX');
  });

  console.log('\n[tests] region → default currency (every supported code reachable)\n');

  await test('all fourteen mapped regions return their currency code', () => {
    // Table-driven from the spec map, one pair per code. Non-vacuous: the
    // table holds fourteen distinct regions.
    const table = [
      ['AR', 'ARS'],
      ['AU', 'AUD'],
      ['BR', 'BRL'],
      ['CA', 'CAD'],
      ['CL', 'CLP'],
      ['CO', 'COP'],
      ['ES', 'EUR'],
      ['GB', 'GBP'],
      ['JP', 'JPY'],
      ['MX', 'MXN'],
      ['PE', 'PEN'],
      ['PY', 'PYG'],
      ['US', 'USD'],
      ['UY', 'UYU'],
    ];
    assert.equal(table.length, 14);
    for (const [region, expected] of table) {
      assert.equal(mod.detectDefaultCurrency(region), expected, region);
    }
  });

  await test('REGION_DEFAULT_CURRENCY maps 14 uppercase regions to 14 codes', () => {
    const regions = Object.keys(mod.REGION_DEFAULT_CURRENCY);
    const codes = Object.values(mod.REGION_DEFAULT_CURRENCY);
    assert.equal(regions.length, 14);
    assert.equal(new Set(codes).size, 14);
    for (const region of regions) {
      assert.match(region, /^[A-Z]{2}$|^\d{3}$/, `${region} is not an uppercase region`);
    }
    for (const code of codes) {
      assert.match(code, /^[A-Z]{3}$/, `${code} is not an uppercase ISO 4217 code`);
    }
  });

  await test('an absent, empty or unmapped region falls back to USD', () => {
    // Universal, never regional: a device we cannot place gets the one code
    // that is valid everywhere.
    assert.equal(mod.detectDefaultCurrency('XX'), 'USD');
    assert.equal(mod.detectDefaultCurrency(undefined), 'USD');
    assert.equal(mod.detectDefaultCurrency(''), 'USD');
    // `es-419` resolves to the M.49 macro-region, which is deliberately NOT
    // in the map — a Latin-American macro-region must not be guessed into one
    // country's currency.
    assert.equal(mod.detectDefaultCurrency('es-419'), 'USD');
  });

  await test('region resolution is case- and separator-insensitive', () => {
    // REQ-3 scenario 5: `'mx'` and the Apple-style `es_MX` tag both resolve
    // through the SAME normalizer, never a second parser.
    assert.equal(mod.detectDefaultCurrency('mx'), 'MXN');
    assert.equal(mod.detectDefaultCurrency('es_MX'), 'MXN');
    assert.equal(mod.detectDefaultCurrency('es-MX'), 'MXN');
  });

  console.log('\n[tests] currency is region-driven, never language-driven\n');

  await test('en-GB + region GB → GBP while detectLocale still says en', () => {
    // The trap: an English device in Britain gets POUNDS, but the app still
    // speaks generic English. Currency detection must not regionalize a
    // language.
    assert.equal(mod.detectDefaultCurrency('en-GB', 'GB'), 'GBP');
    assert.equal(mod.detectLocale('en-GB', 'GB'), 'en');
  });

  await test('an explicit device region overrides the tag for currency too', () => {
    // iOS reports `es-MX` on a UY device; the row the user is actually in
    // wins.
    assert.equal(mod.detectDefaultCurrency('es-MX', 'UY'), 'UYU');
    assert.equal(mod.detectLocale('es-MX', 'UY'), 'es-419');
  });

  await test('detectDefaultCurrency is deterministic and stateless', () => {
    // NFR-2: no module-level mutable state, no Intl, no native bridge. Two
    // calls with the same input must agree, and one call must not influence
    // the next.
    for (const region of ['MX', 'PY', 'XX', undefined]) {
      const first = mod.detectDefaultCurrency(region);
      const second = mod.detectDefaultCurrency(region);
      assert.equal(first, second, `${region} is not deterministic`);
    }
    assert.equal(mod.detectDefaultCurrency('JP'), 'JPY');
    assert.equal(mod.detectDefaultCurrency('JP'), 'JPY');
  });

  await test('detectDefaultCurrency always returns a supported, non-null code', () => {
    // The signature promises `SupportedCurrency`, never `null` — REQ-3.
    for (const region of ['MX', 'XX', '', undefined, 'es', 'es-419', '419']) {
      const code = mod.detectDefaultCurrency(region);
      assert.equal(typeof code, 'string');
      assert.match(code, /^[A-Z]{3}$/);
    }
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});