#!/usr/bin/env node
/**
 * i18n catalog parity harness — the five-locale hierarchy contract.
 *
 * Pins the shape of the Spanish locale family that
 * `i18n-spanish-regionalization` introduced:
 *
 *   en / pt-BR          full catalogs (787 leaves, 18 namespaces)
 *   es-419              the Spanish BASE — full catalog, source of truth
 *   es-AR               sparse Rioplatense override (voseo)
 *   es-ES               sparse Peninsular override (perfect compounds + lexicon)
 *
 * 49 tests, composed as:
 *   R-1  full completeness (18 files / 787 leaves across en / es-419 / pt-BR)
 *   R-1  identical key sets across en / es-419 / pt-BR
 *   R-4  es-ES and es-AR key sets are subsets of es-419 (no invented keys)
 *   T3-1 sparse shape + PENINSULAR_EMPTY_NAMESPACES (7 namespaces pinned BY NAME)
 *   T3-2 42 value pins (PENINSULAR_LEAF_VALUE_SHA256) — one test per divergent leaf
 *   T3-3 the vosotros slot + ZERO voseo across all 122 es-ES leaves
 *   T3-4 es-AR anti-leak direction (voseo retained, Peninsular forms absent)
 *   T3-5 legal register pins + pasted-English-fragment scan
 *
 * The 42 es-ES value pins are SHA-256 over the exact UTF-8 value string. They
 * are deliberately content-addressed: a translator editing one leaf must
 * re-hash that leaf, which is the whole point — the override is a surgical
 * list of divergences, not a second translation.
 *
 * Usage: pnpm test:i18n-catalog-parity
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const localesDir = join(root, 'src', 'i18n', 'locales');
const detectorPath = join(root, 'src', 'i18n', 'detector.ts');

const ALL_LOCALES = ['en', 'es-419', 'es-AR', 'es-ES', 'pt-BR'];
const FULL_LOCALES = ['en', 'es-419', 'pt-BR'];
const EMPTY_FILES = new Set(['a11y', 'bootSplash', 'categories', 'common', 'currency', 'date', 'tabs']);

/**
 * The 7 namespaces es-ES deliberately leaves empty. Each is pinned BY NAME
 * with the reason it carries no genuine Peninsular divergence; removing one
 * from this list (or adding a namespace to it without a reason) fails.
 */
const PENINSULAR_EMPTY_NAMESPACES = {
  a11y: 'Accessibility labels describe UI roles, not regional register.',
  bootSplash: 'Splash/brand copy is locale-neutral and shipped identically.',
  categories: 'The 13 system category labels read identically in Spain.',
  common: 'Shared verbs and nouns carry no regional form.',
  currency: 'Currency formatting is an Intl concern, not catalog copy.',
  date:
    'Month/weekday arrays are shared; src/lib/format.ts maps es-ES to the ' +
    'es-419 MONTHS_FULL_ES arrays on purpose (no genuine Peninsular divergence).',
  tabs: 'Tab labels are region-neutral.',
};

/**
 * The 9 Peninsular override namespaces and their divergent-leaf counts.
 * 42 = 30 present-perfect compounds + 6 Peninsular lexicon + 6 second/first
 * person compounds (`hemos podido` / `has ocultado` / `te has unido`).
 */
const PENINSULAR_NAMESPACES = {
  analytics: 5,
  auth: 6,
  errors: 4,
  household: 5,
  onboarding: 3,
  pro: 3,
  receipts: 3,
  settings: 6,
  tickets: 7,
};

/**
 * SHA-256 of every divergent es-ES leaf value, keyed by
 * `{namespace}.{dotted.path}`. 42 entries — the T-8.1 divergence set.
 */
const PENINSULAR_LEAF_VALUE_SHA256 = {
  'analytics.insightMore': '2c25ec5f33517953f92fcae26b83fe0824c42013446607e08c0891ce95492a99',
  'analytics.insightLess': '76f7d39965ae016d7f7137fe415cbc8300580b9fff70b022401e71268eed1a06',
  'analytics.insightSame': '9cc08088a53f838816bc224a0a2e274bae6295b3affe01bd5249a6871a7490eb',
  'analytics.budgetProgressA11y': 'e59b549cc7965df601229b42c7bf886d97f56acdc4a9af8cb795f3a343d236da',
  'analytics.heroMostExpensiveDay': '7e25be3479a5bd088fd9adcf37ac6650b4e03828bcaa9d716d7749aa3dc7cb74',
  'auth.verifyResetHelp': '925b75d022bed74da27ad4cfa95760976f553c5b333ac5b243b2f7291f7db37d',
  'auth.couldNotStartSession': 'd17724e5ad34c60eaee9f3e0a75d9473ed8fec4efeb362e5b9f157da95904798',
  'auth.couldNotCreateAccount': 'eb0101f074ba75bbe4a640434c60fec6aadbcda38b90eda0e3778f9a2cb4cae7',
  'auth.couldNotSendReset': 'e3e08a22712a7ec71597340b7f532ef917ca41ac17cdbc8634c1ffb69d12f824',
  'auth.couldNotUpdatePassword': 'e936e829d572c1c329e76d2d45f82670e69295f9525a74ab643f7b2a88a87877',
  'auth.couldNotDeleteAccount': '73dfba6237fe4155a1679a550f441a4d717ba2d714c02dec97924a694f7c7c2e',
  'errors.featureAccess.generic': 'c174f37082f75f889397e82e2e4bad554f9893abcfc109b258fc56cf807c846a',
  'errors.featureAccess.createHouseholdFallback':
    'fc0c62ee9f5efb4a330783b8d3b177854ed775099443623e3bb23e27aaf82f7e',
  'errors.featureAccess.joinInvalidCode':
    'ff776b9b9bee24928db9d7a8e2aceed5e5d5372e16e2818294a6f50f19ac58b1',
  'errors.manualForm.items_required': '4f1a17a8ebf067e65b2fec8911414af6fb776140a6d821fe87aabeebf4cd84d8',
  'household.youSuffix': 'f6bc3bab719302e72d21c9036d9cdf6cdc00a671b1e438c8d5df51802596f7d1',
  'household.searchAllHidden': 'f5a59f383c1ae8383b42dd763ddc6f5ae2b26f324f21140f0d8f0e245a3d53fd',
  'household.householdJoinedSuccess': 'b3c26be0b3a340127f15478cbcd3426fdb98cafba5848162349aaaf20f7f9210',
  'household.householdJoinFallback': '8ac7eaecab1da5ff7ed12952bc62b6073cfd09c2b8002d718b25c6af4ebd3a1c',
  'household.inviteGenerateFallback': 'b072bd8a92c659721dcdc42350a792753d91b0a5c4f24ba8a81e18932f57bd49',
  'onboarding.step1.body': '09fde4655b29ae2e519f7ec2edf372caf70dbc773b027c7b670864896373e781',
  'onboarding.step3.body': 'b51e31866bbf38aedd93288a14d85534837f7d0b04874d942435a79f94ba4b30',
  'onboarding.step3.milestone': 'f5a5a20d3187ddb0750fb52a61347ce38cdbd0724b44ae3db82bd73db8ffaff1',
  'pro.errorPurchaseFailed': '69343766bd1b23fa75df529fdc4f5d79cd32312d2efedca148ad02ad78f24521',
  'pro.errorRestoreFailed': 'ad5734654c75b916033b916428a96b0dacca1883740529fe1f99f7e1db6aa5f0',
  'pro.errorGeneric': 'bdb7f0ab61dda1223180dacaddede36c061ea2d7cd2091c159a6786abe5c7408',
  'receipts.loadFailed': 'd67886a23af3dce27c329081f8c0f18a998a560c3be16481de87c4dac4105181',
  'receipts.deleteFailedTitle': '4600ffcbca567a7ed48f88485d56363c0450a60161391725f2339335b3eebf24',
  'receipts.editFailedTitle': 'c517fc64d9bb203552c8ed90008162c56d20bf47fc63793810266f2d1438b499',
  'settings.nameUpdated': '8bcfea3d489516e25e35034189665eaa9495048237400ff606189e5ee398253f',
  'settings.exportStaleData': '1c551e32cedfd3c1a8bcd8127ef9307dac87cfea6f284de74666fc753f3e3e2a',
  'settings.categoryBudgetSaveError':
    'fc089aac5a13e9ddd8503847f64bdc9b3d4c069f0c76006d9ede1cc06a8d0291',
  'settings.deleteAccountErrorTitle':
    '1799e89a9d3a094f6f73420e6159df38a3d1901ecc60eae2e987ef76d9f1d268',
  'settings.deleteAccountErrorRevokeBody':
    'fceebd2b86006107a02834d3a78db5c3c366f63380125e9fffc16aab03a10a23',
  'settings.deleteAccountErrorInternalBody':
    '0fa54fa1b1499fb499e5d24ce6e68ed35f0df69b6fac78d6e90bb149f3741541',
  'tickets.reviewFailedTitle': '2a0de74f913d49d538ea4d10bf11f7aed008418a810dc4ef9089bfd0569fbb03',
  'tickets.reviewFailedDialogTitle':
    '7a74b70a06664bacc1f50853b3bdbf4ccadab001168022ce25bd3f29e2a2d71e',
  'tickets.reviewCantProcess': 'c0441047c0e521f186bafa1360937280e8557fe303984a8e8c3d7b36fc73a050',
  'tickets.categoryCreateError': 'a8e0e4c6f7c3e8e2b2e0c47c87fa77c0135b57c83900adb670f530350dae83b5',
  'tickets.categoryDeleteError': '71d6cbfa52f1e197c8e6eac2c784b28665604d00bd0e9f26acdff1f6972c26ed',
  'tickets.categoryReassignError': '17540dbb6662839400d9942785b5c20537f5b23c095fc0fc5259d8b27622f975',
  'tickets.manualAddItem': '5782f0217a8b89979776db57864568b4f5a832cde6e4e99ef748fd8809dfcbe1',
};

/** The two legal leaves T-8.2 corrected, pinned by value hash. */
const LEGAL_REGISTER_SHA256 = {
  'legal.privacy.sections[0].body':
    '409d42a2b743e6420e6dbcbcd7efff50825519f46d7c5e04e90dacab013b390a',
  'legal.terms.sections[5].body':
    '9dcde43c98afbfe70dd4c31fb7e57d883ba1fc4996f4b72db431c4b4684aef46',
};

/**
 * English fragments that must never appear in a Peninsular legal deck.
 * `faced interrupciones` was the pasted fragment T-8.2 removed; the others
 * are belt-and-braces scans for the same defect class.
 */
const PASTED_ENGLISH_FRAGMENTS = [
  'faced',
  'privacy policy',
  'terms and conditions',
  'we use',
  'you can',
];

/**
 * Curated Rioplatense-voseo markers. Deliberately explicit: a fuzzy
 * `-ás/-és/-ís` heuristic would false-positive on `café`, `país`, `además`,
 * so the harness matches whole-word voseo forms only.
 */
const VOSEO_REGEX =
  /\b(vos|sos|acá|tenés|tenes|podés|podes|querés|queres|sabés|sabes|venís|vivís|cerrás|gastás|ahorrás|Ingresá|Aceptá|Tomá|Digitalizá|Clasificá|Visualizá|Exportá|Escribí|Elegí|Agregá|Probá|Reintentá|Volvé|Creá|Activá|Unite|uníte|Compartí|Pegá|Movela|Movelas|Cancelala|Cancelá|Desbloqueá|Suscribite|suscribite|confirmá|recordá|revisá|seguí|enviá|buscá|hacé|poné|andá|mirá|fijate|escribime|decime|pedime|probá|usá|dejá|pasá|mandá|salí|vení)\b/iu;

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

function readJson(locale, ns) {
  return JSON.parse(readFileSync(join(localesDir, locale, `${ns}.json`), 'utf8'));
}

function localeFiles(locale) {
  return readdirSync(join(localesDir, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();
}

/** Deep flatten: arrays expand per element, objects recurse, scalars are leaves. */
function flatten(node, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      value.forEach((el, i) => {
        if (el && typeof el === 'object') out.push(...flatten(el, `${path}[${i}]`));
        else out.push([`${path}[${i}]`, el]);
      });
    } else if (value && typeof value === 'object') {
      out.push(...flatten(value, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

function leafMap(locale, ns) {
  return new Map(flatten(readJson(locale, ns)));
}

/** Every leaf across every namespace, keyed `namespace.path`. */
function fullLeafMap(locale) {
  const map = new Map();
  for (const ns of localeFiles(locale)) {
    for (const [path, value] of flatten(readJson(locale, ns))) {
      map.set(`${ns}.${path}`, value);
    }
  }
  return map;
}

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

async function run() {
  console.log('\n[i18n-parity] five-locale catalog hierarchy\n');

  // ── R-1: full completeness ────────────────────────────────────────────
  await test('R-1 full completeness: en / es-419 / pt-BR each ship 18 files / 787 leaves', () => {
    for (const locale of FULL_LOCALES) {
      const files = localeFiles(locale);
      assert.equal(files.length, 18, `${locale} must ship 18 namespace files`);
      const leaves = fullLeafMap(locale);
      assert.equal(leaves.size, 787, `${locale} must ship exactly 787 leaves`);
    }
  });

  await test('R-1 identical key sets across en / es-419 / pt-BR', () => {
    const [en, base, pt] = FULL_LOCALES.map((l) => fullLeafMap(l));
    const baseKeys = [...base.keys()].sort();
    assert.deepEqual([...en.keys()].sort(), baseKeys, 'en key set must equal es-419');
    assert.deepEqual([...pt.keys()].sort(), baseKeys, 'pt-BR key set must equal es-419');
  });

  // ── R-4: sparse overrides define no invented key ──────────────────────
  await test('R-4 es-ES and es-AR define no key absent from the es-419 base', () => {
    const baseKeys = new Set(fullLeafMap('es-419').keys());
    for (const locale of ['es-ES', 'es-AR']) {
      for (const key of fullLeafMap(locale).keys()) {
        assert.ok(baseKeys.has(key), `${locale} invented key not in es-419: ${key}`);
      }
    }
  });

  // ── T3-1: sparse shape + empty namespaces pinned BY NAME ──────────────
  await test('sparse shape: es-ES diverges in exactly the 9 Peninsular namespaces', () => {
    const emptyNames = Object.keys(PENINSULAR_EMPTY_NAMESPACES).sort();
    assert.deepEqual(emptyNames, [...EMPTY_FILES].sort(), 'empty-namespace list drifted');
    assert.equal(emptyNames.length, 7, 'exactly 7 namespaces must be empty');

    let divergent = 0;
    for (const [ns, expected] of Object.entries(PENINSULAR_NAMESPACES)) {
      const base = leafMap('es-419', ns);
      const es = leafMap('es-ES', ns);
      let nsDivergent = 0;
      for (const [path, value] of es) if (base.get(path) !== value) nsDivergent += 1;
      assert.equal(nsDivergent, expected, `${ns} must carry ${expected} divergent leaves`);
      divergent += nsDivergent;
      assert.ok(!EMPTY_FILES.has(ns), `${ns} must not be in the empty list`);
    }
    assert.equal(divergent, 42, 'es-ES must carry exactly 42 divergent leaves');

    for (const ns of EMPTY_FILES) {
      const node = readJson('es-ES', ns);
      assert.deepEqual(node, {}, `es-ES/${ns}.json must be {} (${PENINSULAR_EMPTY_NAMESPACES[ns]})`);
    }
    // settingsLanguage is a full 7-leaf copy byte-identical to the base, not a divergence.
    assert.equal(leafMap('es-ES', 'settingsLanguage').size, 7, 'settingsLanguage must keep 7 leaves');
  });

  // ── T3-2: 42 value pins, one test each ────────────────────────────────
  const pinnedKeys = Object.keys(PENINSULAR_LEAF_VALUE_SHA256);
  assert.equal(pinnedKeys.length, 42, 'there must be exactly 42 value pins');
  for (const key of pinnedKeys) {
    await test(`pin ${key}`, () => {
      const dot = key.indexOf('.');
      const ns = key.slice(0, dot);
      const path = key.slice(dot + 1);
      const value = leafMap('es-ES', ns).get(path);
      assert.notEqual(value, undefined, `${key} missing from es-ES`);
      assert.equal(sha256(value), PENINSULAR_LEAF_VALUE_SHA256[key], `${key} value hash drifted`);
    });
  }

  // ── T3-3: vosotros slot + zero voseo ──────────────────────────────────
  await test('vosotros: PLURAL_SECOND_PERSON es-ES is " (vosotros)" and es-ES has ZERO voseo', () => {
    const detector = readFileSync(detectorPath, 'utf8');
    assert.match(
      detector,
      /'es-ES':\s*' \(vosotros\)'/,
      'detector.ts must declare PLURAL_SECOND_PERSON es-ES = " (vosotros)"',
    );
    const esLeaves = fullLeafMap('es-ES');
    assert.equal(esLeaves.size, 122, 'es-ES must ship exactly 122 leaves');
    const voseo = [];
    for (const [key, value] of esLeaves) {
      if (typeof value === 'string' && VOSEO_REGEX.test(value)) voseo.push(`${key} = ${value}`);
    }
    assert.deepEqual(voseo, [], `voseo leaked into es-ES: ${voseo.join(' | ')}`);
    assert.equal(leafMap('es-ES', 'household').get('youSuffix'), ' (vosotros)');
  });

  // ── T3-4: es-AR anti-leak direction ───────────────────────────────────
  await test('es-AR keeps voseo, omits returnObjects containers, and leaks no Peninsular form', () => {
    const esAR = fullLeafMap('es-AR');
    // 1. voseo retained (a representative, falsifiable sample)
    const retained = [
      ['household.youSuffix', ' (vos)'],
      ['errors.manualForm.items_required', 'Agregá al menos un artículo'],
      ['errors.manualForm.store_required', 'Ingresá el nombre de la tienda'],
      ['onboarding.step1.body', 'Tomá una foto'],
      ['settings.monthlyBudgetHelper', 'querés gastar'],
    ];
    for (const [key, fragment] of retained) {
      const value = esAR.get(key);
      assert.ok(
        typeof value === 'string' && value.includes(fragment),
        `es-AR must retain voseo: ${key} should contain "${fragment}"`,
      );
    }
    // 2. no Peninsular-only form leaked into es-AR
    const peninsulaOnly = [
      'No se ha podido',
      'No se han podido',
      'No hemos podido',
      'Has gastado',
      'Has ocultado',
      'Te has unido',
      'Añadir',
      'añadir',
      'ha expirado',
      'importes',
      'informes',
    ];
    for (const [key, value] of esAR) {
      if (typeof value !== 'string') continue;
      for (const marker of peninsulaOnly) {
        assert.ok(
          !value.includes(marker),
          `Peninsular form "${marker}" leaked into es-AR ${key} = ${value}`,
        );
      }
    }
    // 3. returnObjects containers are absent, never partially copied
    assert.equal(leafMap('es-AR', 'date').size, 0, 'es-AR/date.json must be {} (omit containers)');
    assert.equal(
      Object.prototype.hasOwnProperty.call(readJson('es-AR', 'legal'), 'sections'),
      false,
      'es-AR/legal.json must not carry partial sections arrays',
    );
    assert.equal(
      leafMap('es-AR', 'onboarding').has('step3.dayLabels[0]'),
      false,
      'es-AR/onboarding.json must omit step3.dayLabels',
    );
  });

  // ── T3-5: legal register pins + pasted-fragment scan ──────────────────
  await test('legal: register pins hold and no pasted English fragment survives', () => {
    const legal = new Map(flatten(readJson('es-ES', 'legal')));
    assert.equal(legal.size, 73, 'es-ES/legal.json must ship all 73 leaves');
    for (const [key, hash] of Object.entries(LEGAL_REGISTER_SHA256)) {
      const path = key.replace(/^legal\./, '');
      const value = legal.get(path);
      assert.notEqual(value, undefined, `${key} missing from es-ES/legal.json`);
      assert.equal(sha256(value), hash, `${key} register value drifted`);
    }
    for (const [path, value] of legal) {
      if (typeof value !== 'string') continue;
      for (const fragment of PASTED_ENGLISH_FRAGMENTS) {
        assert.ok(
          !value.toLowerCase().includes(fragment),
          `pasted English fragment "${fragment}" found in es-ES/legal.json ${path}`,
        );
      }
    }
  });

  console.log(`\n[i18n-parity] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
