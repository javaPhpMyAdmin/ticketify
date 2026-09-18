#!/usr/bin/env node
/**
 * Dependency-free node harness for the legal-links slice (privacy-terms
 * change). Mirrors `scripts/test-auth.mjs`:
 *
 *   1. Compiles the modules under test PLUS the hand-written test double
 *      (`scripts/test-stubs/web-browser.ts`) into a temp directory with an
 *      isolated tsconfig that remaps `expo-web-browser` to the double.
 *   2. Imports the compiled CommonJS output through a `Module._resolveFilename`
 *      hook (`expo-web-browser` → compiled stub, generic `@/` → outDir/src).
 *   3. Runs behavioral tests against the real opener / URL map / resolver,
 *      and reads the three locale catalogs straight from disk for parity.
 *
 * The double is type-checked against the compiled production code, so a
 * signature drift between the app and its tests fails the compile here.
 *
 * Sections:
 *   1. Opener contract (REQ-1) — resolve → true + exact URL; reject → false,
 *      no exception escapes; default opener uses the stub `openBrowserAsync`.
 *   2. Legal URL map (REQ-2) — exactly two documents × three locales, all
 *      values `https:`. Placeholders are NOT asserted (REQ-7 release gate).
 *   3. Resolver fallback (REQ-2) — known locale wins; unknown/empty locales
 *      AND inherited-prototype keys ('constructor', '__proto__', 'toString')
 *      fall back to es-AR via an own-property guard; an unknown document
 *      falls back to the es-AR privacy URL without throwing.
 *   4. Catalog parity (REQ-5) — settings/auth key sets identical across the
 *      three locales; every legal key exists and is a non-empty string.
 *
 * Usage: pnpm test:legal-links  (or: node scripts/test-legal-links.mjs)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.legal-links-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'legal-links-test-'));
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

/**
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `@/…` or the stubbed expo package in the compiled CommonJS output.
 * The hook rewrites exactly those specifiers to their compiled locations.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === 'expo-web-browser') {
      request = join(outDir, 'scripts', 'test-stubs', 'web-browser.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function compile() {
  execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

const OPENED = { type: 'opened' };
const SAMPLE_PRIVACY_ES_AR = 'https://example.com/privacy/es-AR';
const SAMPLE_PRIVACY_EN = 'https://example.com/privacy/en';
const SAMPLE_TERMS_ES_AR = 'https://example.com/terms/es-AR';

let openerMod;
let legalMod;
let browserMod;

async function run() {
  console.log('\n[tests] compiling legal-links modules with isolated tsconfig…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  // Loaded first: section 1 only depends on the opener + the stub. The URL
  // map is loaded lazily before sections 2–3 so each TDD step's GREEN is
  // observable independently (open-external-url.ts lands before
  // legal-urls.ts).
  openerMod = await load('src/lib/open-external-url.js');
  browserMod = await load('scripts/test-stubs/web-browser.js');
  // Deterministic entry: clear any stub state a previous suite run could have
  // left behind (the null-then-recorded assertion below depends on it).
  browserMod.__resetWebBrowserStub();

  console.log('\n[tests] section 1 — opener contract (REQ-1)\n');

  await test('resolving stub opener → true, and the exact URL reaches the opener', async () => {
    const seen = [];
    const stub = async (url) => {
      seen.push(url);
      return OPENED;
    };
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_ES_AR, stub);
    assert.equal(result, true);
    assert.deepEqual(seen, [SAMPLE_PRIVACY_ES_AR], 'opener receives the URL verbatim');
  });

  await test('rejecting stub opener → false, no exception escapes', async () => {
    const stub = async () => {
      throw new Error('browser unavailable');
    };
    const result = await openerMod.openExternalUrl(SAMPLE_TERMS_ES_AR, stub);
    assert.equal(result, false, 'a rejected open resolves false, never rejects');
  });

  await test('no explicit opener → stub openBrowserAsync is used and records the URL', async () => {
    assert.equal(
      browserMod.__getLastOpenedUrl(),
      null,
      'nothing recorded before the first default-opener call',
    );
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_EN);
    assert.equal(result, true, 'the stub opener resolves');
    assert.equal(
      browserMod.__getLastOpenedUrl(),
      SAMPLE_PRIVACY_EN,
      'the default opener is the platform WebBrowser.openBrowserAsync (stub)',
    );
  });

  // Adversary probes: the opener contract MUST hold for hostile `opener`
  // shapes too (sync throws, non-callables, non-promise returns, non-Error
  // rejections) — `openExternalUrl` never throws and always resolves boolean.
  await test('sync-throwing opener → false, no exception escapes', async () => {
    const stub = () => {
      throw new Error('sync boom before any promise');
    };
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_EN, stub);
    assert.equal(result, false, 'a synchronously throwing opener resolves false');
  });

  await test('non-function opener 123 → false, no exception escapes', async () => {
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_EN, 123);
    assert.equal(result, false, 'a non-callable opener resolves false');
  });

  await test('non-function opener null → false, no exception escapes', async () => {
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_EN, null);
    assert.equal(result, false, 'a null opener resolves false');
  });

  await test('opener returning a plain non-promise value (42) → true', async () => {
    const stub = () => 42;
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_EN, stub);
    assert.equal(result, true, 'a non-promise return value counts as a resolved open');
  });

  await test('opener rejecting with a non-Error value ("oops") → false, no exception escapes', async () => {
    const stub = async () => {
      throw 'oops';
    };
    const result = await openerMod.openExternalUrl(SAMPLE_PRIVACY_EN, stub);
    assert.equal(result, false, 'a rejected non-Error throw resolves false');
  });

  await test('http URL → false and the opener is never invoked (https-only guard)', async () => {
    const seen = [];
    const stub = async (url) => {
      seen.push(url);
      return OPENED;
    };
    const result = await openerMod.openExternalUrl('http://example.com/privacy/es-AR', stub);
    assert.equal(result, false, 'a non-https URL must resolve false');
    assert.deepEqual(seen, [], 'the opener must not be invoked for http URLs');
  });

  console.log('\n[tests] section 2 — legal URL map (REQ-2)\n');

  legalMod = await load('src/lib/legal-urls.js');

  await test('LEGAL_URLS holds exactly two documents: privacy and terms', () => {
    assert.deepEqual(Object.keys(legalMod.LEGAL_URLS).sort(), ['privacy', 'terms']);
  });

  await test('each document maps exactly the three SupportedLocale tags', () => {
    const expected = ['en', 'es-AR', 'pt-BR'].sort();
    for (const doc of ['privacy', 'terms']) {
      assert.deepEqual(
        Object.keys(legalMod.LEGAL_URLS[doc]).sort(),
        expected,
        `${doc} must map every SupportedLocale`,
      );
    }
  });

  await test('all six URL values use the https: scheme', () => {
    for (const doc of ['privacy', 'terms']) {
      for (const locale of ['en', 'es-AR', 'pt-BR']) {
        const url = legalMod.LEGAL_URLS[doc][locale];
        assert.match(url, /^https:\/\//, `${doc}/${locale} must be https`);
      }
    }
  });

  console.log('\n[tests] section 3 — resolver fallback (REQ-2)\n');

  await test('legalUrlFor("privacy","pt-BR") → the pt-BR privacy URL', () => {
    assert.equal(
      legalMod.legalUrlFor('privacy', 'pt-BR'),
      legalMod.LEGAL_URLS.privacy['pt-BR'],
    );
  });

  await test('legalUrlFor("terms","fr-FR") → the es-AR terms URL (unsupported fallback)', () => {
    assert.equal(
      legalMod.legalUrlFor('terms', 'fr-FR'),
      legalMod.LEGAL_URLS.terms['es-AR'],
    );
  });

  await test('legalUrlFor("privacy","") → the es-AR privacy URL (empty fallback)', () => {
    assert.equal(
      legalMod.legalUrlFor('privacy', ''),
      legalMod.LEGAL_URLS.privacy['es-AR'],
    );
  });

  await test('legalUrlFor("terms","es-AR") → the es-AR terms URL', () => {
    assert.equal(
      legalMod.legalUrlFor('terms', 'es-AR'),
      legalMod.LEGAL_URLS.terms['es-AR'],
    );
  });

  // Inherited `Object.prototype` members are non-null, so `??` alone cannot
  // detect them; the resolver MUST use an own-property guard and fall back to
  // es-AR (REQ-2 "any missing or unsupported locale").
  await test('legalUrlFor("privacy","constructor") → the es-AR privacy URL (own-property guard)', () => {
    assert.equal(
      legalMod.legalUrlFor('privacy', 'constructor'),
      legalMod.LEGAL_URLS.privacy['es-AR'],
    );
  });

  await test('legalUrlFor("terms","__proto__") → the es-AR terms URL (own-property guard)', () => {
    assert.equal(
      legalMod.legalUrlFor('terms', '__proto__'),
      legalMod.LEGAL_URLS.terms['es-AR'],
    );
  });

  await test('legalUrlFor("privacy","toString") → the es-AR privacy URL (own-property guard)', () => {
    assert.equal(
      legalMod.legalUrlFor('privacy', 'toString'),
      legalMod.LEGAL_URLS.privacy['es-AR'],
    );
  });

  // An unknown document must fall back safely (es-AR privacy URL), never
  // throw.
  await test('legalUrlFor("bogus","en") → the es-AR privacy URL (unknown document, no throw)', () => {
    const result = legalMod.legalUrlFor('bogus', 'en');
    assert.equal(result, legalMod.LEGAL_URLS.privacy['es-AR']);
  });

  console.log('\n[tests] section 4 — catalog parity (REQ-5)\n');

  const LOCALES_ROOT = join(root, 'src', 'i18n', 'locales');
  const LOCALE_TAGS = ['es-AR', 'en', 'pt-BR'];
  const readCatalog = (locale, namespace) =>
    JSON.parse(
      readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8'),
    );
  // Same parity primitive as scripts/test-manual-screen.mjs: compare the
  // sorted key set per namespace, not the values.
  const keySet = (namespace) => Object.keys(namespace).sort().join(',');
  const LEGAL_KEYS = {
    settings: ['legalSectionTitle', 'privacyPolicy', 'termsConditions'],
    auth: ['signUpLegalPrefix', 'signUpLegalAnd'],
  };

  await test('settings.json key sets are identical across the three locales', () => {
    const esAr = readCatalog('es-AR', 'settings');
    const en = readCatalog('en', 'settings');
    const ptBr = readCatalog('pt-BR', 'settings');
    assert.equal(keySet(en), keySet(esAr), 'settings parity: en vs es-AR');
    assert.equal(keySet(ptBr), keySet(esAr), 'settings parity: pt-BR vs es-AR');
  });

  await test('auth.json key sets are identical across the three locales', () => {
    const esAr = readCatalog('es-AR', 'auth');
    const en = readCatalog('en', 'auth');
    const ptBr = readCatalog('pt-BR', 'auth');
    assert.equal(keySet(en), keySet(esAr), 'auth parity: en vs es-AR');
    assert.equal(keySet(ptBr), keySet(esAr), 'auth parity: pt-BR vs es-AR');
  });

  await test('every legal key exists as a non-empty string in all three locales', () => {
    for (const locale of LOCALE_TAGS) {
      const catalogs = {
        settings: readCatalog(locale, 'settings'),
        auth: readCatalog(locale, 'auth'),
      };
      for (const [namespace, keys] of Object.entries(LEGAL_KEYS)) {
        for (const key of keys) {
          const where = `${locale}/${namespace}.json:${key}`;
          assert.ok(key in catalogs[namespace], `missing legal key ${where}`);
          assert.equal(
            typeof catalogs[namespace][key],
            'string',
            `${where} must be a string`,
          );
          assert.ok(
            catalogs[namespace][key].length > 0,
            `${where} must be non-empty`,
          );
        }
      }
    }
  });

  // Golden per-locale tables (REQ-5): EXACT values, not cross-catalog
  // equality — a typo that keeps all three catalogs "in sync" must still
  // fail. Trailing spaces in the auth connectors are part of the contract.
  const GOLDEN_SETTINGS_LEGAL = {
    'es-AR': {
      legalSectionTitle: 'LEGAL',
      privacyPolicy: 'Política de privacidad',
      termsConditions: 'Términos y condiciones',
    },
    en: {
      legalSectionTitle: 'LEGAL',
      privacyPolicy: 'Privacy Policy',
      termsConditions: 'Terms & Conditions',
    },
    'pt-BR': {
      legalSectionTitle: 'LEGAL',
      privacyPolicy: 'Política de privacidade',
      termsConditions: 'Termos e condições',
    },
  };
  const GOLDEN_AUTH_LEGAL = {
    'es-AR': {
      signUpLegalPrefix: 'Al continuar aceptás la ',
      signUpLegalAnd: ' y los ',
    },
    en: {
      signUpLegalPrefix: 'By signing up you agree to the ',
      signUpLegalAnd: ' and the ',
    },
    'pt-BR': {
      signUpLegalPrefix: 'Ao se cadastrar você aceita a ',
      signUpLegalAnd: ' e os ',
    },
  };

  await test('settings legal values match the per-locale golden table', () => {
    for (const locale of LOCALE_TAGS) {
      const catalog = readCatalog(locale, 'settings');
      for (const [key, expected] of Object.entries(GOLDEN_SETTINGS_LEGAL[locale])) {
        assert.equal(
          catalog[key],
          expected,
          `${locale}/settings.json:${key} must equal the golden value`,
        );
      }
    }
  });

  await test('auth legal values match the per-locale golden table (trailing spaces preserved)', () => {
    for (const locale of LOCALE_TAGS) {
      const catalog = readCatalog(locale, 'auth');
      for (const [key, expected] of Object.entries(GOLDEN_AUTH_LEGAL[locale])) {
        assert.equal(
          catalog[key],
          expected,
          `${locale}/auth.json:${key} must equal the golden value`,
        );
      }
    }
  });

  await test('signUpLegalPrefix/signUpLegalAnd end with a space in all three locales', () => {
    for (const locale of LOCALE_TAGS) {
      const auth = readCatalog(locale, 'auth');
      for (const key of ['signUpLegalPrefix', 'signUpLegalAnd']) {
        const where = `${locale}/auth.json:${key}`;
        assert.ok(
          auth[key].endsWith(' '),
          `${where} must end with a space (footer connector convention)`,
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
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
