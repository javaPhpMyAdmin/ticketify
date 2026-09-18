#!/usr/bin/env node
/**
 * Dependency-free node harness for the in-app legal content slice
 * (legal-compliance U2, content L2/L3). Pattern: `scripts/test-legal-links.mjs`.
 *
 * The `legal` i18n namespace ships three locale catalogs
 * (`src/i18n/locales/{es-AR,en,pt-BR}/legal.json`, es-AR = source of truth)
 * that define the Privacy Policy and Terms documents as section arrays.
 * The spec (legal-content REQ-2) requires: identical key sets across the
 * three catalogs and non-empty values everywhere — the parity contract that
 * the hosted Markdown mirrors (U3) will extend to disk files.
 *
 * Sections:
 *   1. Catalog parity — flattened `legal` ns key sets identical across the
 *      three locales; section-id order identical per document; every leaf
 *      string non-empty. A divergence must be REPORTED naming locale + key
 *      (REQ-2 "reports a failure naming the locale and key"), which the
 *      self-checks in section 2 prove against fabricated catalogs.
 *   2. Required section coverage — privacy and terms must contain the
 *      legally-required section ids (data collected, purposes, third
 *      parties Supabase/RevenueCat, retention, account deletion, rights,
 *      contact; terms: acceptance, service description, subscriptions,
 *      liability, changes, governing law, contact), each with a non-empty
 *      title and body; every document carries a non-empty draft notice
 *      (design R-3: clearly-marked draft copy).
 *   3. Screen rendering — the `/legal/{privacy,terms}` routes render the
 *      CURRENT locale's document through `LegalScreen` (AD-1 static RG
 *      Text, no runtime fetch): document title, draft notice, every
 *      section title + body for the active catalog, and a working back
 *      button. Rendered with the es-AR and pt-BR catalogs to prove the
 *      component reads the active locale rather than hardcoded copy.
 *
 * The catalog checks read the JSON straight from disk (same parity
 * primitive as test-legal-links.mjs §4). The rendering section compiles
 * the routes + LegalScreen with hand-written test doubles
 * (scripts/test-stubs/) into a temp directory through an isolated
 * tsconfig (per-AD-5 harness pattern) and renders with react-test-renderer.
 *
 * Usage: pnpm test:legal-content  (or: node scripts/test-legal-content.mjs)
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
const harnessConfig = join(__dirname, 'tsconfig.legal-content-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'legal-content-test-'));
const outDir = join(workdir, 'out');

const LOCALES_ROOT = join(root, 'src', 'i18n', 'locales');
const LOCALE_TAGS = ['es-AR', 'en', 'pt-BR'];

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
  execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/**
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `react-i18next`, `react-native`, `expo-router`, `@/…` or the
 * stubbed packages in the compiled CommonJS output. The hook rewrites
 * exactly those specifiers to their compiled locations. `@/components` is
 * matched BEFORE the bare `@/` prefix so the components stub wins over the
 * real `src/components` barrel.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === 'react-i18next') {
      request = join(outDir, 'scripts', 'test-stubs', 'legal-i18next.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request === 'react-native-safe-area-context') {
      request = join(outDir, 'scripts', 'test-stubs', 'safe-area-context.js');
    } else if (request === 'expo-router') {
      request = join(outDir, 'scripts', 'test-stubs', 'expo-router.js');
    } else if (request === '@/components') {
      request = join(outDir, 'scripts', 'test-stubs', 'components.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

// ── catalog reading (same parity primitive as test-legal-links.mjs §4) ──
const readCatalog = (locale) =>
  JSON.parse(readFileSync(join(LOCALES_ROOT, locale, 'legal.json'), 'utf8'));

/**
 * Every string leaf of a catalog as `{ path, value }` (nested objects
 * walked, arrays skipped — section strings are verified separately by the
 * coverage section). The path is the i18next-style dotted key, e.g.
 * `privacy.draftNotice`.
 */
function stringLeaves(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...stringLeaves(value, path));
    } else if (typeof value === 'string') {
      out.push({ path, value });
    }
  }
  return out;
}

/** Empty-string leaves of a catalog (paths only) — the non-empty contract. */
function emptyStringLeaves(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...emptyStringLeaves(value, path));
    } else if (typeof value === 'string' && value.length === 0) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Failure message for a key-set mismatch between two catalogs, naming both
 * locales and the concrete missing keys (REQ-2 "reports a failure naming
 * the locale and key"). Returns '' when the sets are identical.
 */
function describeParityDiff(aName, bName, leavesA, leavesB) {
  const keysA = new Set(leavesA.map((l) => l.path));
  const keysB = new Set(leavesB.map((l) => l.path));
  const missingInB = [...keysA].filter((k) => !keysB.has(k));
  const missingInA = [...keysB].filter((k) => !keysA.has(k));
  const parts = [];
  if (missingInB.length > 0) {
    parts.push(`${bName} missing keys from ${aName}: ${missingInB.join(', ')}`);
  }
  if (missingInA.length > 0) {
    parts.push(`${aName} missing keys from ${bName}: ${missingInA.join(', ')}`);
  }
  return parts.join('; ');
}

/** Section ids of one document, in catalog order (parity + coverage). */
function sectionIds(catalog, doc) {
  return catalog[doc].sections.map((s) => s.id);
}

/**
 * Legally-required section ids per document. Whenever the copy drops one of
 * these from ALL locales at once, key-set parity alone would still pass —
 * the coverage assertion keeps the legal surface explicit.
 */
const REQUIRED_PRIVACY_SECTIONS = [
  'dataCollected',
  'purposes',
  'thirdParties',
  'retention',
  'accountDeletion',
  'rights',
  'contact',
];
const REQUIRED_TERMS_SECTIONS = [
  'acceptance',
  'serviceDescription',
  'subscriptions',
  'liability',
  'changes',
  'governingLaw',
  'contact',
];
const DOCUMENTS = ['privacy', 'terms'];

const catalogs = Object.fromEntries(LOCALE_TAGS.map((l) => [l, readCatalog(l)]));

async function run() {
  console.log('\n[tests] section 1 — legal ns key-set parity (REQ-2)\n');

  const leaves = Object.fromEntries(
    LOCALE_TAGS.map((l) => [l, stringLeaves(catalogs[l])]),
  );

  await test('legal.json key sets identical: en vs es-AR (source of truth)', () => {
    const diff = describeParityDiff('es-AR', 'en', leaves['es-AR'], leaves.en);
    assert.equal(diff, '', diff || undefined);
  });

  await test('legal.json key sets identical: pt-BR vs es-AR (source of truth)', () => {
    const diff = describeParityDiff('es-AR', 'pt-BR', leaves['es-AR'], leaves['pt-BR']);
    assert.equal(diff, '', diff || undefined);
  });

  await test('every legal.json leaf value is a non-empty string in all three locales', () => {
    for (const locale of LOCALE_TAGS) {
      const empties = emptyStringLeaves(catalogs[locale]);
      assert.deepEqual(
        empties,
        [],
        `${locale}/legal.json has empty values at: ${empties.join(', ')}`,
      );
    }
  });

  await test('privacy section ids identical AND in the same order across locales', () => {
    const esAr = sectionIds(catalogs['es-AR'], 'privacy');
    for (const locale of ['en', 'pt-BR']) {
      assert.deepEqual(
        sectionIds(catalogs[locale], 'privacy'),
        esAr,
        `${locale}/legal.json privacy section order diverges from es-AR`,
      );
    }
    assert.ok(esAr.length > 0, 'privacy must define at least one section');
  });

  await test('terms section ids identical AND in the same order across locales', () => {
    const esAr = sectionIds(catalogs['es-AR'], 'terms');
    for (const locale of ['en', 'pt-BR']) {
      assert.deepEqual(
        sectionIds(catalogs[locale], 'terms'),
        esAr,
        `${locale}/legal.json terms section order diverges from es-AR`,
      );
    }
    assert.ok(esAr.length > 0, 'terms must define at least one section');
  });

  console.log('\n[tests] section 2 — required section coverage + draft marker\n');

  await test('privacy covers every required section in all three locales', () => {
    for (const locale of LOCALE_TAGS) {
      const ids = sectionIds(catalogs[locale], 'privacy');
      for (const required of REQUIRED_PRIVACY_SECTIONS) {
        assert.ok(
          ids.includes(required),
          `${locale}/legal.json privacy missing required section '${required}' (have: ${ids.join(', ')})`,
        );
      }
    }
  });

  await test('terms covers every required section in all three locales', () => {
    for (const locale of LOCALE_TAGS) {
      const ids = sectionIds(catalogs[locale], 'terms');
      for (const required of REQUIRED_TERMS_SECTIONS) {
        assert.ok(
          ids.includes(required),
          `${locale}/legal.json terms missing required section '${required}' (have: ${ids.join(', ')})`,
        );
      }
    }
  });

  await test('every section has a non-empty title AND body in all three locales', () => {
    for (const locale of LOCALE_TAGS) {
      for (const doc of DOCUMENTS) {
        for (const section of catalogs[locale][doc].sections) {
          const where = `${locale}/legal.json ${doc}.sections.${section.id}`;
          assert.ok(
            typeof section.title === 'string' && section.title.length > 0,
            `${where}.title must be a non-empty string`,
          );
          assert.ok(
            typeof section.body === 'string' && section.body.length > 0,
            `${where}.body must be a non-empty string`,
          );
        }
      }
    }
  });

  await test('every document carries a non-empty draft notice in all three locales (R-3)', () => {
    for (const locale of LOCALE_TAGS) {
      for (const doc of DOCUMENTS) {
        const notice = catalogs[locale][doc].draftNotice;
        const where = `${locale}/legal.json ${doc}.draftNotice`;
        assert.ok(
          typeof notice === 'string' && notice.length > 0,
          `${where} must be a non-empty string (draft copy must be visibly marked)`,
        );
      }
    }
  });

  // Self-checks: the harness's own detection primitives must prove they
  // would CATCH divergence — a catalog missing a key / holding empty or
  // blank values (spec REQ-2 "Divergence is detected" scenario) — using
  // fabricated catalogs instead of mutating the real ones on disk.
  console.log('\n[tests] section 2b — detection self-checks (divergence is detected)\n');

  await test('parity diff names BOTH locales and the missing key', () => {
    const fakeA = [
      { path: 'privacy.title', value: 'x' },
      { path: 'privacy.sections', value: 'x' },
    ];
    const fakeB = [{ path: 'privacy.title', value: 'x' }];
    const diff = describeParityDiff('es-AR', 'en', fakeA, fakeB);
    assert.match(diff, /en missing keys from es-AR: privacy\.sections/);
  });

  await test('empty-string scan reports the exact leaf path', () => {
    assert.deepEqual(
      emptyStringLeaves({ a: 'x', b: { c: '', d: 'y' } }),
      ['b.c'],
    );
  });

  await test('every section id in the shipped catalogs is a non-empty trimmed string', () => {
    for (const locale of LOCALE_TAGS) {
      for (const doc of DOCUMENTS) {
        for (const section of catalogs[locale][doc].sections) {
          const where = `${locale}/legal.json ${doc}.sections`;
          assert.ok(
            typeof section.id === 'string' && section.id.trim().length > 0,
            `${where} has a blank section id`,
          );
        }
      }
    }
  });

  // ── section 3 — screen rendering (AD-1 static RG text, no runtime fetch) ──
  // The `/legal/{privacy,terms}` routes + LegalScreen are compiled with the
  // hand-written test doubles in scripts/test-stubs/ (per-AD-5 harness
  // pattern) and rendered with react-test-renderer. The legal-i18next stub
  // resolves `legal:` keys against a catalog INJECTED by the harness — the
  // SAME in-memory catalogs section 1 asserts over — so a render test pins
  // the REAL shipped copy, and swapping the active catalog (es-AR → pt-BR)
  // proves the screen reads the CURRENT locale instead of hardcoded text.
  console.log('\n[tests] section 3 — screen rendering (AD-1, current-locale content)\n');

  console.log('[tests] compiling legal routes + LegalScreen with isolated tsconfig…');
  compile();
  installRequireHook();

  globalThis.__DEV__ = false;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require(require.resolve('react'));
  const TestRenderer = require(require.resolve('react-test-renderer'));
  const { act, create } = TestRenderer;

  const i18nStub = await load('scripts/test-stubs/legal-i18next.js');
  const routerStub = await load('scripts/test-stubs/expo-router.js');
  // Loaded through the compile-and-load bridge (named re-exports) — a
  // direct `import()` of the compiled route gives node's CJS interop an
  // OBJECT for `.default`, which must not be rendered as a component.
  const routeMod = await load('scripts/render-legal-screen.js');
  const PrivacyRoute = routeMod.PrivacyRoute;
  const TermsRoute = routeMod.TermsRoute;

  /** Flatten every string leaf of a react-test-renderer host tree. */
  function flattenStrings(node) {
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(flattenStrings);
    if (node && typeof node === 'object') return flattenStrings(node.children);
    return [];
  }

  const renderText = (renderer) => flattenStrings(renderer.toJSON()).join('\n');

  async function renderRoute(RouteComponent) {
    let renderer;
    await act(async () => {
      renderer = create(React.createElement(RouteComponent));
    });
    return renderer;
  }

  async function unmountRoute(renderer) {
    await act(async () => {
      renderer.unmount();
    });
  }

  await test('privacy route renders the es-AR document: title, draft notice, every section', async () => {
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR']);
    const renderer = await renderRoute(PrivacyRoute);
    const text = renderText(renderer);
    const doc = catalogs['es-AR'].privacy;
    assert.ok(text.includes(doc.title), 'document title must be rendered');
    assert.ok(text.includes(doc.draftNotice), 'draft notice must be rendered (R-3)');
    for (const section of doc.sections) {
      assert.ok(
        text.includes(section.title),
        `section '${section.id}' title must be rendered`,
      );
      assert.ok(
        text.includes(section.body),
        `section '${section.id}' body must be rendered`,
      );
    }
    await unmountRoute(renderer);
  });

  await test('terms route renders the es-AR document incl. every required section', async () => {
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR']);
    const renderer = await renderRoute(TermsRoute);
    const text = renderText(renderer);
    const doc = catalogs['es-AR'].terms;
    assert.ok(text.includes(doc.title), 'document title must be rendered');
    assert.ok(text.includes(doc.draftNotice), 'draft notice must be rendered (R-3)');
    for (const required of REQUIRED_TERMS_SECTIONS) {
      const section = doc.sections.find((s) => s.id === required);
      assert.ok(
        text.includes(section.title) && text.includes(section.body),
        `required section '${required}' must be rendered`,
      );
    }
    await unmountRoute(renderer);
  });

  await test('switching the active catalog to pt-BR re-renders the pt-BR copy (not hardcoded)', async () => {
    i18nStub.__setActiveLegalCatalog(catalogs['pt-BR']);
    const renderer = await renderRoute(PrivacyRoute);
    const text = renderText(renderer);
    const doc = catalogs['pt-BR'].privacy;
    assert.ok(text.includes(doc.title), 'pt-BR privacy title must be rendered');
    const thirdParties = doc.sections.find((s) => s.id === 'thirdParties');
    assert.ok(
      text.includes(thirdParties.title),
      'pt-BR third-parties title must be rendered',
    );
    assert.ok(
      text.includes(thirdParties.body),
      'pt-BR third-parties body must be rendered',
    );
    // The es-AR and pt-BR document TITLES overlap as substrings
    // ('Política de privacidad' ⊂ 'Política de privacidade'), so the
    // negative check uses the draft notices — distinct in every locale.
    assert.ok(
      !text.includes(catalogs['es-AR'].privacy.draftNotice),
      'es-AR copy must NOT render under the pt-BR catalog',
    );
    await unmountRoute(renderer);
  });

  await test('back button presses router.back() with the common:back a11y label', async () => {
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR']);
    routerStub.__resetRouterStub();
    const renderer = await renderRoute(PrivacyRoute);
    const back = renderer.root.findByProps({ accessibilityLabel: 'Volver' });
    await act(async () => {
      back.props.onPress();
    });
    assert.equal(routerStub.__lastNav(), 'back');
    await unmountRoute(renderer);
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