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
const formatConfig = join(__dirname, 'tsconfig.format-currency-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'detector-regional-test-'));
const outDir = join(workdir, 'out');
const formatOutDir = join(workdir, 'format-out');

let passed = 0;
let failed = 0;

/**
 * The EXACT set of region keys `REGION_DEFAULT_CURRENCY` must carry, sorted.
 * Pinned as a literal so a silent addition or removal of ANY region fails —
 * a count-only pin (210 → 212) is blind to a swap, which is exactly how the
 * SE/AX/XK class of "region falls through to USD" bug hides. Regenerate with:
 *
 *   node -e "import('./<compiled>/src/i18n/detector.js').then(m => \
 *     console.log(JSON.stringify(Object.keys(m.REGION_DEFAULT_CURRENCY).sort())))"
 *
 * or by diffing against this list after editing `src/i18n/detector.ts`.
 */
const EXPECTED_REGION_KEYS = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS',
  'AT', 'AU', 'AX', 'AZ', 'BA', 'BD', 'BE', 'BF', 'BG', 'BI',
  'BJ', 'BL', 'BO', 'BQ', 'BR', 'BT', 'BW', 'BY', 'CA', 'CC',
  'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO',
  'CR', 'CU', 'CX', 'CY', 'CZ', 'DE', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FM', 'FO',
  'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GL', 'GM',
  'GN', 'GP', 'GQ', 'GR', 'GT', 'GU', 'GW', 'HK', 'HN', 'HR',
  'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IQ', 'IR', 'IT',
  'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KN', 'KP',
  'KR', 'KW', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
  'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG',
  'MH', 'MK', 'ML', 'MM', 'MN', 'MP', 'MQ', 'MR', 'MS', 'MT',
  'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI',
  'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF',
  'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW',
  'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SD', 'SE',
  'SG', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SS', 'SV',
  'SY', 'TC', 'TD', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN',
  'TR', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA',
  'VC', 'VE', 'VG', 'VI', 'VN', 'WF', 'XK', 'YE', 'YT', 'ZA',
  'ZM', 'ZW',
];

/**
 * The official ISO 3166-1 alpha-2 code list (249 codes). User-assigned codes
 * (`XK`) are NOT part of it — they are carried by the map, not by ISO.
 */
const ISO_3166_1_ALPHA2 = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
  'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
  'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
  'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
  'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK',
  'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL',
  'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR',
  'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
  'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
  'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW',
  'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP',
  'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM',
  'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF',
  'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW',
  'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

/**
 * The ISO codes this map withholds ON PURPOSE, grouped by WHY.
 *
 * The reason split is DATA, not a comment, because the catalog-membership test
 * below asserts that the `currency-not-in-catalog` group is EXACTLY the region
 * set its fixture covers. A code excluded for a currency reason but missing from
 * the fixture is skipped by the membership loop and would fall through to USD
 * the moment its currency entered the catalog — the exact bug this file exists
 * to catch, reopened by a one-line edit.
 *
 * A territory is mapped iff it has a permanent population AND its circulating
 * currency is a catalog member (plus the user-assigned `XK`). Everything below
 * is therefore uninhabited, transient, or spends a currency the catalog does not
 * ship.
 */
const UNMAPPED_REASON = {
  UNINHABITED: 'uninhabited',
  TRANSIENT: 'transient',
  CURRENCY_NOT_IN_CATALOG: 'currency-not-in-catalog',
};

const KNOWN_UNMAPPED_BY_REASON = new Map([
  // No circulating currency / uninhabited.
  [UNMAPPED_REASON.UNINHABITED, ['AQ', 'BV', 'GS', 'HM', 'TF', 'UM']],
  // Transient population only (military / research rotations).
  [UNMAPPED_REASON.TRANSIENT, ['IO']],
  // Currency is NOT a catalog member (falls through to the USD default).
  [
    UNMAPPED_REASON.CURRENCY_NOT_IN_CATALOG,
    [
      'AW', 'BB', 'BH', 'BM', 'BN', 'BS', 'BZ', 'CV', 'CW', 'DJ', 'FJ', 'FK',
      'GI', 'GY', 'IS', 'KM', 'KY', 'MO', 'MU', 'MV', 'SB', 'SC', 'SH', 'SR',
      'ST', 'SX', 'SZ', 'TO', 'TT', 'VU', 'WS',
    ],
  ],
]);

/** Every excluded code, derived from the reason groups so the two cannot diverge. */
const KNOWN_UNMAPPED = new Set([...KNOWN_UNMAPPED_BY_REASON.values()].flat());

/** The currency-reason group: exactly the regions the fixture below must cover. */
const CURRENCY_NOT_IN_CATALOG_REGIONS = KNOWN_UNMAPPED_BY_REASON.get(
  UNMAPPED_REASON.CURRENCY_NOT_IN_CATALOG,
);

/**
 * The fixture pairing each currency-excluded region with its circulating ISO
 * 4217 code. Written independently of `KNOWN_UNMAPPED_BY_REASON` on purpose:
 * the coupling assertion below requires the two to agree, so neither the
 * exclusion policy nor the catalog check can be quietly edited alone.
 */
const REGION_TO_CURRENCY = new Map([
  ['AW', 'AWG'],
  ['BB', 'BBD'],
  ['BH', 'BHD'],
  ['BM', 'BMD'],
  ['BN', 'BND'],
  ['BS', 'BSD'],
  ['BZ', 'BZD'],
  ['CV', 'CVE'],
  ['CW', 'XCG'],
  ['DJ', 'DJF'],
  ['FJ', 'FJD'],
  ['FK', 'FKP'],
  ['GI', 'GIP'],
  ['GY', 'GYD'],
  ['IS', 'ISK'],
  ['KM', 'KMF'],
  ['KY', 'KYD'],
  ['MO', 'MOP'],
  ['MU', 'MUR'],
  ['MV', 'MVR'],
  ['SB', 'SBD'],
  ['SC', 'SCR'],
  ['SH', 'SHP'],
  ['SR', 'SRD'],
  ['ST', 'STN'],
  ['SX', 'XCG'],
  ['SZ', 'SZL'],
  ['TO', 'TOP'],
  ['TT', 'TTD'],
  ['VU', 'VUV'],
  ['WS', 'WST'],
]);

/**
 * The shipped guard, one real path: every region excluded for the currency
 * reason must still hold a currency OUTSIDE the given catalog. The catalog is a
 * parameter so the RED demo can inject a currency (e.g. `ISK`) into a copy and
 * prove this exact function throws, rather than asserting against a hand-rolled
 * re-implementation.
 */
function checkCatalogMembership(catalogSet) {
  for (const region of CURRENCY_NOT_IN_CATALOG_REGIONS) {
    const currency = REGION_TO_CURRENCY.get(region);
    assert.ok(currency, `missing currency mapping for ${region}`);
    assert.ok(
      !catalogSet.has(currency),
      `region ${region} is excluded as currency-not-in-catalog but ${currency} is in the catalog; ` +
        `removing ${region} from KNOWN_UNMAPPED or adding ${currency} to the catalog ` +
        `would fall back to USD — map the territory to ${currency} instead of deleting this check`,
    );
  }
}

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
  // The catalog (`SUPPORTED_CURRENCIES`) lives in `format.ts`; compile it too so
  // the region-map membership pin can assert against the REAL catalog rather
  // than a restated list.
  execFileSync(
    process.execPath,
    [tscBin, '-p', formatConfig, '--outDir', formatOutDir],
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
  const fmt = await import(
    pathToFileURL(join(formatOutDir, 'src/lib/format.js')).href
  );
  const CATALOG = new Set(fmt.SUPPORTED_CURRENCIES);

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

  console.log('\n[tests] region → default currency (widened map)\n');

  await test('every mapped region returns its currency code', () => {
    // A representative slice of the widened map: the original fourteen rows
    // (kept intact), the design's concrete anchors, and one member of each
    // currency union. Non-vacuous: every pair is a distinct region.
    const table = [
      // The original fourteen rows stay intact.
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
      // The design's concrete anchors.
      ['NG', 'NGN'],
      ['IN', 'INR'],
      ['VN', 'VND'],
      ['KW', 'KWD'],
      ['ZA', 'ZAR'],
      ['KE', 'KES'],
      ['EG', 'EGP'],
      ['PL', 'PLN'],
      ['TR', 'TRY'],
      ['UA', 'UAH'],
      ['SA', 'SAR'],
      ['AE', 'AED'],
      ['IL', 'ILS'],
      ['KR', 'KRW'],
      ['TH', 'THB'],
      ['PH', 'PHP'],
      ['ID', 'IDR'],
      ['MY', 'MYR'],
      ['TZ', 'TZS'],
      ['GH', 'GHS'],
      ['MA', 'MAD'],
      ['DZ', 'DZD'],
      // One member of each multi-country currency union.
      ['DE', 'EUR'],
      ['SN', 'XOF'],
      ['CM', 'XAF'],
      ['AG', 'XCD'],
      ['NC', 'XPF'],
      // The commit's own claim, asserted through the exported behaviour rather
      // than by induction through the map: an Åland or Kosovo device gets EUR.
      ['AX', 'EUR'],
      ['XK', 'EUR'],
    ];
    for (const [region, expected] of table) {
      assert.equal(mod.detectDefaultCurrency(region), expected, region);
    }
  });

  await test('REGION_DEFAULT_CURRENCY is a well-formed region → catalog-code map', () => {
    const regions = Object.keys(mod.REGION_DEFAULT_CURRENCY);
    const codes = Object.values(mod.REGION_DEFAULT_CURRENCY);
    // Exact row count pinned: every inhabited country/territory whose circulating
    // currency is in the catalog (plus the user-assigned XK), unions expanding
    // to all their members.
    assert.equal(regions.length, 212);
    // Unions SHARE codes, so the distinct-code count is SMALLER than the row
    // count — the pre-widening `new Set(codes).size === regions.length`
    // invariant is WRONG now that many regions map to EUR/XOF/XAF/XCD/XPF.
    // Pinned exactly at 123: all 123 catalog codes are reachable from some region
    // (the count is still smaller than the row count because EUR/XOF/XAF/XCD/XPF
    // are shared by many regions).
    assert.equal(new Set(codes).size, 123);
    for (const region of regions) {
      assert.match(region, /^[A-Z]{2}$|^\d{3}$/, `${region} is not an uppercase region`);
    }
    for (const code of codes) {
      assert.match(code, /^[A-Z]{3}$/, `${code} is not an uppercase ISO 4217 code`);
      assert.ok(CATALOG.has(code), `${code} is not a SUPPORTED_CURRENCIES code`);
    }
    // The Latin-American macro-region must never be guessed into one country.
    assert.ok(!('419' in mod.REGION_DEFAULT_CURRENCY), '419 must stay absent');
    // Sweden now maps to its own currency.
    assert.equal(mod.REGION_DEFAULT_CURRENCY.SE, 'SEK', 'SE maps to SEK');
    // Åland (AX) is an autonomous region of Finland that spends the euro; it
    // was absent and fell through to USD on every Åland device.
    assert.equal(mod.REGION_DEFAULT_CURRENCY.AX, 'EUR', 'AX maps to EUR');
    // Kosovo (XK) is a user-assigned ISO code (not UN M.49) whose people spend
    // the euro; it was skipped by the M.49 sweep and fell through to USD.
    assert.equal(mod.REGION_DEFAULT_CURRENCY.XK, 'EUR', 'XK maps to EUR');
  });

  await test('REGION_DEFAULT_CURRENCY maps EXACTLY the expected region set', () => {
    // A count-only pin cannot see a SWAP: dropping one region and adding
    // another keeps the length identical while silently sending a country's
    // devices to USD. Pinning the exact sorted key set makes any addition or
    // removal fail by name — the SE/AX/XK class of bug cannot hide here.
    assert.deepEqual(
      Object.keys(mod.REGION_DEFAULT_CURRENCY).sort(),
      [...EXPECTED_REGION_KEYS].sort(),
    );
  });

  await test('currency-not-in-catalog reason group matches the fixture, and every entry still holds a non-catalog currency', () => {
    // COUPLING: the exclusion policy (data) and the fixture the catalog check
    // walks must name the SAME regions. A one-sided edit — deleting 'WS' from
    // the fixture, say — would otherwise make the membership loop silently skip
    // it and all tests would still pass while WST could drift back to USD.
    const fixtureRegions = [...REGION_TO_CURRENCY.keys()].sort();
    const reasonGroupRegions = [...CURRENCY_NOT_IN_CATALOG_REGIONS].sort();
    const fixtureOnly = fixtureRegions.filter((r) => !reasonGroupRegions.includes(r));
    const reasonGroupOnly = reasonGroupRegions.filter((r) => !fixtureRegions.includes(r));
    const drift = [
      ...fixtureOnly.map((r) => `${r} (in REGION_TO_CURRENCY only)`),
      ...reasonGroupOnly.map((r) => `${r} (in the reason group only)`),
    ];
    assert.deepEqual(
      fixtureRegions,
      reasonGroupRegions,
      drift.length
        ? `the KNOWN_UNMAPPED "${UNMAPPED_REASON.CURRENCY_NOT_IN_CATALOG}" reason group and the ` +
          `REGION_TO_CURRENCY fixture have drifted: ${drift.join(', ')}. Update BOTH ` +
          `KNOWN_UNMAPPED_BY_REASON and REGION_TO_CURRENCY with the same region — a region ` +
          `excluded for its currency but absent from the fixture is silently unchecked and ` +
          `would fall through to USD if its currency ever entered the catalog.`
        : 'the currency reason group must equal the REGION_TO_CURRENCY fixture key set',
    );

    // The real guard: every currency-excluded region still holds a currency the
    // catalog does not ship.
    checkCatalogMembership(CATALOG);

    // RED demo: inject ISK into a COPY of the catalog and call the SHIPPED
    // guard. It must throw from its OWN assertion (region IS / ISK in catalog),
    // proving the function — not a re-implementation — fails on expansion.
    assert.throws(
      () => checkCatalogMembership(new Set([...CATALOG, 'ISK'])),
      /region IS .* but ISK is in the catalog/,
      'injecting ISK must make the shipped membership guard reject IS',
    );
  });

  await test('KNOWN_UNMAPPED reason groups are non-empty, non-overlapping and map exactly the derived set', () => {
    // The reason split exists so it can be asserted; that only helps if the
    // groups themselves are well-formed. A duplicated code would be counted
    // once by the Set while hiding a second, contradictory reason.
    const seen = new Set();
    const duplicates = [];
    for (const codes of KNOWN_UNMAPPED_BY_REASON.values()) {
      assert.ok(codes.length > 0, 'a reason group must not be empty');
      for (const code of codes) {
        if (seen.has(code)) duplicates.push(code);
        seen.add(code);
      }
    }
    assert.deepEqual(
      duplicates,
      [],
      `codes listed under more than one reason: ${duplicates.join(', ')}`,
    );
    assert.deepEqual(
      [...seen].sort(),
      [...KNOWN_UNMAPPED].sort(),
      'KNOWN_UNMAPPED must be exactly the union of the reason groups',
    );
    // A code cannot be both mapped and excluded.
    const mapped = new Set(Object.keys(mod.REGION_DEFAULT_CURRENCY));
    for (const code of KNOWN_UNMAPPED) {
      assert.ok(!mapped.has(code), `${code} is both mapped and KNOWN_UNMAPPED`);
    }
  });

  await test('every ISO 3166-1 alpha-2 code is mapped or in the KNOWN_UNMAPPED policy', () => {
    // The guard that WOULD have caught AX: walk the official 249-code list and
    // require each code to be either a mapped region or an explicitly excluded
    // one. An inhabited territory that spends a catalog currency but is missing
    // from the map falls into neither bucket and fails here — no count needed.
    const mapped = new Set(Object.keys(mod.REGION_DEFAULT_CURRENCY));
    // Non-vacuous: the ISO list is the real 249, XK is deliberately NOT among
    // them (it is user-assigned), and the map carries it anyway.
    assert.equal(ISO_3166_1_ALPHA2.length, 249);
    assert.equal(new Set(ISO_3166_1_ALPHA2).size, 249, 'ISO list has no duplicates');
    assert.ok(!ISO_3166_1_ALPHA2.includes('XK'), 'XK is user-assigned, not ISO');
    assert.ok(mapped.has('XK'), 'XK is mapped even though ISO omits it');
    assert.equal(mapped.size, 212);
    assert.equal(KNOWN_UNMAPPED.size, 38);
    for (const code of ISO_3166_1_ALPHA2) {
      assert.ok(
        mapped.has(code) || KNOWN_UNMAPPED.has(code),
        `${code} is neither mapped nor in KNOWN_UNMAPPED`,
      );
    }
    // ...and the complement is EXACTLY KNOWN_UNMAPPED: nothing is both mapped
    // and "known unmapped", and the policy set is not padded with codes that
    // are actually in the map (which would let a real omission hide behind it).
    const uncovered = ISO_3166_1_ALPHA2.filter((code) => !mapped.has(code));
    assert.deepEqual(
      uncovered.sort(),
      [...KNOWN_UNMAPPED].sort(),
      'the ISO complement must be exactly KNOWN_UNMAPPED',
    );
  });

  console.log('\n[tests] codesForRegion — review-subset forward lookup\n');

  await test('a mapped region yields exactly its single code', () => {
    assert.deepEqual(mod.codesForRegion('NG'), ['NGN']);
    assert.deepEqual(mod.codesForRegion('MX'), ['MXN']);
    assert.deepEqual(mod.codesForRegion('DE'), ['EUR']);
    // The Åland / Kosovo rows in the behaviour table are covered by induction;
    // assert the exported lookup directly too, so the claim holds through the
    // forward-lookup consumer as well.
    assert.deepEqual(mod.codesForRegion('AX'), ['EUR']);
    assert.deepEqual(mod.codesForRegion('XK'), ['EUR']);
  });

  await test('codesForRegion lookup is case-insensitive', () => {
    assert.deepEqual(mod.codesForRegion('mx'), ['MXN']);
    assert.deepEqual(mod.codesForRegion('ng'), ['NGN']);
  });

  await test('an unmapped, macro-region, empty or absent region yields [] (never USD)', () => {
    // AQ (Antarctica) has no circulating currency in the catalog and is not mapped.
    assert.deepEqual(mod.codesForRegion('AQ'), []);
    assert.deepEqual(mod.codesForRegion('419'), []);
    assert.deepEqual(mod.codesForRegion('XX'), []);
    assert.deepEqual(mod.codesForRegion(''), []);
    assert.deepEqual(mod.codesForRegion(null), []);
    assert.deepEqual(mod.codesForRegion(undefined), []);
    // The subset must never inject a currency the user never chose.
    assert.ok(!mod.codesForRegion('AQ').includes('USD'));
    assert.ok(!mod.codesForRegion('419').includes('USD'));
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