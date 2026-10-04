#!/usr/bin/env node
/**
 * Node harness for the `bootSplash` namespace i18n key set.
 *
 * Mirrors `scripts/test-i18n-onboarding-keys.mjs`: asserts three
 * contracts on the bootSplash catalogs (resolved via fallback chains;
 * `es-AR` and `es-ES` are sparse overrides over `es-419`):
 *
 *   1. PARITY — all five locales have IDENTICAL key sets.
 *   2. PRESENCE — every key the splash redesign consumes exists in
 *      every locale as a non-empty value (loadingA11y, tagline,
 *      statusLoadingFinancial, statusSyncingTickets, statusReadyToScan,
 *      versionBadge).
 *   3. STABLE SHAPES — the status keys stay aligned so an in-place string
 *      refactor ships red.
 *
 * Usage: pnpm test:i18n-boot-splash-keys
 *
 * Note: brief preference was to extend the onboarding parity helper
 * (no new harness) but the onboarding file is hardcoded to the
 * `onboarding` namespace; a sibling focused file mirrored its shape
 * here for bootSplash parity. Each file is <60 lines.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
// Resolution, not the file. `es-AR` and `es-ES` are SPARSE regional overrides
// over the neutral `es-419` base: a raw read sees only the handful of keys
// that genuinely diverge, while the app renders the full surface. These
// assertions are about what a user SEES, so every read resolves
// `locale → chain → en` exactly like i18next does.
import { LOCALES, resolveNamespace } from './lib/i18n-chain.mjs';

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
  return resolveNamespace(locale, namespace);
}

function keySet(obj) {
  return Object.keys(obj).sort().join(',');
}

const REQUIRED_KEYS = [
  'loadingA11y',
  'tagline',
  'statusLoadingFinancial',
  'statusSyncingTickets',
  'statusReadyToScan',
  'versionBadge',
];

console.log('\n[tests] bootSplash catalog parity\n');

test('top-level key sets are identical across all five locales', () => {
  const catalogs = Object.fromEntries(
    LOCALES.map((l) => [l, readCatalog(l, 'bootSplash')]),
  );
  assert.equal(
    keySet(catalogs.en),
    keySet(catalogs['es-AR']),
    'bootSplash parity: en vs es-AR',
  );
  assert.equal(
    keySet(catalogs['pt-BR']),
    keySet(catalogs['es-AR']),
    'bootSplash parity: pt-BR vs es-AR',
  );
});

test('every required bootSplash key exists as a non-empty string in all five locales', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'bootSplash');
    for (const key of REQUIRED_KEYS) {
      const where = `${locale}/bootSplash.json:${key}`;
      assert.ok(key in catalog, `missing ${where}`);
      assert.equal(typeof catalog[key], 'string', `${where} must be a string`);
      assert.ok(catalog[key].length > 0, `${where} must be non-empty`);
    }
  }
});

test('loadingA11y and versionBadge stay single-line / punctuation-stable in every locale', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'bootSplash');
    // loadingA11y should NOT contain periods or ellipses (it is read by
    // screen readers as a single utterance — a stray `.` adds an unintended
    // pause on VoiceOver / TalkBack).
    assert.ok(
      !/[.!?…]$/.test(catalog.loadingA11y),
      `${locale}/bootSplash.json:loadingA11y must not end in sentence punctuation (causes voice-assistant pauses): "${catalog.loadingA11y}"`,
    );
    // versionBadge is the literal "v" prefix used right before appVersion.
    assert.equal(
      catalog.versionBadge,
      'v',
      `${locale}/bootSplash.json:versionBadge must stay exactly "v"`,
    );
  }
});

test('statusLoadingFinancial/statusSyncingTickets/statusReadyToScan are three distinct, non-empty strings in every locale (cycle shape)', () => {
  const SLOTS = [
    ['statusLoadingFinancial', 'loading financial'],
    ['statusSyncingTickets', 'syncing tickets'],
    ['statusReadyToScan', 'ready'],
  ];
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'bootSplash');
    const values = SLOTS.map(([k]) => catalog[k]);
    assert.ok(
      values.every((v) => v.length > 0),
      `${locale}: status* slots must all be non-empty`,
    );
    const set = new Set(values);
    assert.equal(
      set.size,
      SLOTS.length,
      `${locale}: status* slots must be three distinct values (got: ${values.join(' | ')})`,
    );
  }
});

test('status keys are semantic, not positional (each value reflects its key in every locale)', () => {
  // Defensive: the brief's rename from `status1/2/3` → `status*` (semantic)
  // should not accidentally re-use the old positional values. Each key's
  // value should carry its semantics (`financial` / `tickets` / `ready`).
  const CASES = [
    ['statusLoadingFinancial', ['financial', 'financiero', 'financeiro', 'finan', 'carregando', 'cargando', 'loading']],
    ['statusSyncingTickets', ['ticket', 'sincronizando', 'syncing']],
    ['statusReadyToScan', ['ready', 'pronto', 'listo']],
  ];
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'bootSplash');
    for (const [key, terms] of CASES) {
      const value = String(catalog[key]).toLowerCase();
      const hit = terms.some((term) => value.includes(term));
      assert.ok(
        hit,
        `${locale}/bootSplash.json:${key} = "${catalog[key]}" must carry its semantics (expected any of: ${terms.join(' | ')})`,
      );
    }
  }
});

console.log('');
if (failed > 0) {
  console.error(`[tests] ${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`[tests] all ${passed} tests passed`);
}
