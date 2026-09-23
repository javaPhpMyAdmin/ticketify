#!/usr/bin/env node
/**
 * Node harness for the `onboarding` namespace i18n key set.
 *
 * Asserts three contracts on the onboarding catalogs read directly
 * from disk (`src/i18n/locales/{es-AR,en,pt-BR}/onboarding.json`):
 *
 *   1. PARITY — the three locales have IDENTICAL key sets (REQ-1: locale
 *      parity across the i18n catalogs). The harness walks every leaf
 *      path so nested keys (`step1.headline`, `step3.dayLabels[0]` …)
 *      are counted too — a missing translation in any locale fails the
 *      build even if the parent key exists.
 *   2. PRESENCE — every key listed in the user's spec exists in every
 *      locale as a non-empty value.
 *   3. TEMPLATE SHAPE — `stepBadge` / `stepBadgeUpper` interpolate
 *      `{{step}}` and `{{total}}` in every locale.
 *
 * Usage: pnpm test:i18n-onboarding-keys
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const LOCALES_ROOT = join(root, 'src', 'i18n', 'locales');
const LOCALES = ['es-AR', 'en', 'pt-BR'];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(String((err && err.stack) || err));
  }
}

function readCatalog(locale, namespace) {
  return JSON.parse(
    readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8'),
  );
}

/**
 * Flatten a JSON tree to dot-paths so nested keys can be diffed across
 * locales. Arrays become indexed paths (`dayLabels.0`, `dayLabels.1` …)
 * — a missing/wrong-length array fails the parity check.
 */
function flatten(obj, prefix = '') {
  const out = [];
  if (obj == null || typeof obj !== 'object') {
    out.push(prefix);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((entry, idx) => {
      out.push(...flatten(entry, `${prefix}.${idx}`));
    });
    return out;
  }
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    const next = prefix ? `${prefix}.${key}` : key;
    if (value == null || typeof value !== 'object') {
      out.push(next);
    } else {
      out.push(...flatten(value, next));
    }
  }
  return out;
}

function keySet(obj) {
  return Object.keys(obj).sort().join(',');
}

/**
 * The top-level keys the spec defines. The screens enforce the
 * I18N key SHAPE — every leaf used at render time. Each is a
 * string (the screens render `t('step1.headline')` etc.).
 */
const REQUIRED_LEAF_KEYS = [
  'skip',
  'backA11y',
  'continue',
  'startNow',
  'hasAccountPrompt',
  'signInLink',
  'onboardingSetupBadge',
  'logoA11y',
  'accountA11y',
  'legalPrefix',
  'legalTermsLink',
  'legalPrivacyLink',
  'stepBadge',
  'stepBadgeUpper',
  // Step 1 (scanner)
  'step1.headline',
  'step1.body',
  'step1.aiSyncBadge',
  'step1.storeName',
  'step1.storeRef',
  'step1.total',
  'step1.item1',
  'step1.item2',
  'step1.item3',
  'step1.item1Price',
  'step1.item2Price',
  'step1.item3Price',
  'step1.chipCategory',
  'step1.chipTax',
  'step1.autoFocus',
  // Step 2 (budget)
  'step2.headline',
  'step2.body',
  'step2.limitActive',
  'step2.monthPill',
  'step2.used',
  'step2.total',
  'step2.safeToSpend',
  'step2.usedLabel',
  'step2.daysLeft',
  'step2.catHomeLabel',
  'step2.catFoodLabel',
  'step2.catSuperLabel',
  'step2.catLeisureLabel',
  'step2.catHomeAmount',
  'step2.catFoodAmount',
  'step2.catSuperAmount',
  'step2.catLeisureAmount',
  'step2.autoCatTitle',
  'step2.autoCatSubtitle',
  // Step 3 (insights)
  'step3.headline',
  'step3.body',
  'step3.weekHeader',
  'step3.weekTotal',
  'step3.weekDelta',
  'step3.dayHigh',
  'step3.milestone',
  'step3.perfLabel',
  'step3.perfValue',
];

console.log('\n[tests] section 1 — onboarding.json catalog parity (REQ-1)\n');

test('top-level key sets are identical across the three locales', () => {
  const catalogs = Object.fromEntries(
    LOCALES.map((l) => [l, readCatalog(l, 'onboarding')]),
  );
  assert.equal(
    keySet(catalogs.en),
    keySet(catalogs['es-AR']),
    'onboarding parity: en vs es-AR',
  );
  assert.equal(
    keySet(catalogs['pt-BR']),
    keySet(catalogs['es-AR']),
    'onboarding parity: pt-BR vs es-AR',
  );
});

test('all leaf paths (including nested step1/step2/step3 objects and dayLabels array) are identical across locales', () => {
  const catalogs = Object.fromEntries(
    LOCALES.map((l) => [l, readCatalog(l, 'onboarding')]),
  );
  const leafSets = Object.fromEntries(
    LOCALES.map((l) => [l, flatten(catalogs[l]).sort()]),
  );
  const es = leafSets['es-AR'].join(',');
  assert.equal(leafSets.en.join(','), es, 'onboarding leaf parity: en vs es-AR');
  assert.equal(
    leafSets['pt-BR'].join(','),
    es,
    'onboarding leaf parity: pt-BR vs es-AR',
  );
});

test('step3.dayLabels is a 7-element array in every locale (L/M/X/J/V/S/D shape)', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'onboarding');
    assert.ok(
      Array.isArray(catalog.step3.dayLabels),
      `${locale}/onboarding.json:step3.dayLabels must be an array`,
    );
    assert.equal(
      catalog.step3.dayLabels.length,
      7,
      `${locale}/onboarding.json:step3.dayLabels must have exactly 7 weekday labels`,
    );
    for (let i = 0; i < 7; i += 1) {
      assert.equal(
        typeof catalog.step3.dayLabels[i],
        'string',
        `${locale}/onboarding.json:step3.dayLabels[${i}] must be a string`,
      );
      assert.ok(
        catalog.step3.dayLabels[i].length > 0,
        `${locale}/onboarding.json:step3.dayLabels[${i}] must be non-empty`,
      );
    }
  }
});

console.log('\n[tests] section 2 — required leaf keys present in all locales\n');

test('every required leaf key exists as a non-empty value in all three locales', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'onboarding');
    for (const leaf of REQUIRED_LEAF_KEYS) {
      const parts = leaf.split('.');
      let cursor = catalog;
      for (const part of parts) {
        assert.ok(
          cursor != null && typeof cursor === 'object' && part in cursor,
          `missing ${locale}/onboarding.json:${leaf} (object path broke on "${part}")`,
        );
        cursor = cursor[part];
      }
      assert.equal(
        typeof cursor,
        'string',
        `${locale}/onboarding.json:${leaf} must be a string (got ${typeof cursor})`,
      );
      assert.ok(
        cursor.length > 0,
        `${locale}/onboarding.json:${leaf} must be a non-empty string`,
      );
    }
  }
});

console.log('\n[tests] section 3 — template shapes\n');

test('stepBadge interpolates {{step}} and {{total}} in every locale', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'onboarding');
    assert.ok(
      catalog.stepBadge.includes('{{step}}'),
      `${locale}/onboarding.json:stepBadge must include {{step}} token`,
    );
    assert.ok(
      catalog.stepBadge.includes('{{total}}'),
      `${locale}/onboarding.json:stepBadge must include {{total}} token`,
    );
  }
});

test('stepBadgeUpper interpolates {{step}} and {{total}} in every locale', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'onboarding');
    assert.ok(
      catalog.stepBadgeUpper.includes('{{step}}'),
      `${locale}/onboarding.json:stepBadgeUpper must include {{step}} token`,
    );
    assert.ok(
      catalog.stepBadgeUpper.includes('{{total}}'),
      `${locale}/onboarding.json:stepBadgeUpper must include {{total}} token`,
    );
  }
});

console.log(`\n[tests] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
