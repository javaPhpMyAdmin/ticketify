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
 *      button whose label comes from the shipped es-AR common.json (F1).
 *      The locale-switch test refreshes the SAME mounted renderer (F2 —
 *      a remount could mask a snapshotting screen); fetch/XHR globals
 *      throw so a network-touching edit fails loudly (F3, REQ-4); two
 *      static contracts pin pre-auth reachability (F4, REQ-1); and the
 *      catalogs must keep cross-locale-distinct copy (F5) and unique
 *      section ids (F8).
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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
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
 * Reads the `common` namespace catalog like `readCatalog` — the back-button
 * accessibility label must come from the SHIPPED es-AR copy (F1), so a
 * future edit of common.json's `back` value can never silently drift away
 * from what the render harness asserts.
 */
const readCommon = (locale) =>
  JSON.parse(readFileSync(join(LOCALES_ROOT, locale, 'common.json'), 'utf8'));

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

/** Resolve an i18next-style dotted key against a catalog (F5 distinctness). */
function resolveKey(catalog, dotted) {
  return dotted.split('.').reduce(
    (acc, part) => (acc === null || typeof acc !== 'object' ? undefined : acc[part]),
    catalog,
  );
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

/**
 * Keys whose values MUST differ across the three locales (F5). A
 * copy-paste of the es-AR bodies into en/pt-BR with only the draftNotice
 * swapped would still pass every parity/coverage assert — these five
 * consent-gate strings (which U4/U5 render) plus the two draft notices
 * pin that each locale ships genuinely distinct copy. The gate keys ship
 * in U2's catalogs already, so all seven are asserted now; U5 adds the
 * gate UI that consumes them.
 */
const LOCALE_DISTINCT_KEYS = [
  'privacy.draftNotice',
  'terms.draftNotice',
  'consentGateTitle',
  'consentGateBody',
  'consentGateAccept',
  'consentGateSignOut',
  'signUpConsentRequired',
];

const catalogs = Object.fromEntries(LOCALE_TAGS.map((l) => [l, readCatalog(l)]));

// F1: the back-button a11y label contract is the disk value of es-AR
// `common.back` — the stub is injected with the same catalog (see
// legal-i18next.ts), so a hardcoded label elsewhere cannot drift silently.
const esArCommon = readCommon('es-AR');
const BACK_LABEL = esArCommon.back;

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

  // F8: a duplicated id would break React keys (LegalScreen renders
  // `sections.map((s) => <View key={s.id} …>)`) and would make U4/U5
  // acceptance records ambiguous — each document must use unique ids.
  await test('every section id is unique within its document in all three locales (F8)', () => {
    for (const locale of LOCALE_TAGS) {
      for (const doc of DOCUMENTS) {
        const ids = sectionIds(catalogs[locale], doc);
        assert.equal(
          new Set(ids).size,
          ids.length,
          `${locale}/legal.json ${doc} has duplicate section ids: ` +
            ids.filter((id, i) => ids.indexOf(id) !== i).join(', '),
        );
      }
    }
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

  // F5: copy-paste guard — values must differ across locales.
  await test('draft notices and consent-gate copy differ across the three locales (F5)', () => {
    for (const key of LOCALE_DISTINCT_KEYS) {
      const values = LOCALE_TAGS.map((l) => resolveKey(catalogs[l], key));
      values.forEach((v, i) => {
        assert.ok(
          typeof v === 'string' && v.length > 0,
          `${LOCALE_TAGS[i]}/legal.json ${key} must be a non-empty string`,
        );
      });
      assert.equal(
        new Set(values).size,
        values.length,
        `${key} must differ across locales (got: ${JSON.stringify(values)})`,
      );
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
  // the REAL shipped copy. The locale-switch test (F2) swaps the active
  // catalog and refreshes the SAME mounted renderer in place (a remount
  // could mask a mount-snapshotting screen); the back-label test (F1)
  // drives the label from the shipped es-AR common.json. REQ-4's "no
  // runtime fetch" is guarded by throwing fetch/XMLHttpRequest globals
  // (F3), and REQ-1's pre-auth reachability by two static contracts (F4):
  // the routes stay OUTSIDE the Stack.Protected gate in _layout.tsx, and
  // decideSessionNavigation never redirects a signed-out /legal/* visitor.
  console.log('\n[tests] section 3 — screen rendering (AD-1, current-locale content)\n');

  console.log('[tests] compiling legal routes + LegalScreen with isolated tsconfig…');
  compile();
  installRequireHook();

  globalThis.__DEV__ = false;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // F3 (REQ-4 "no runtime fetch"): LegalScreen is fetch-free today by
  // construction, but nothing else would fail if a future edit added a
  // network call. These throwing globals make ANY fetch/XHR attempt by
  // the compiled screen fail the render tests loudly.
  globalThis.fetch = function fetchProbe() {
    throw new Error('legal screen must not fetch during render (REQ-4, F3 guard)');
  };
  globalThis.XMLHttpRequest = function XMLHttpRequestProbe() {
    throw new Error('legal screen must not open XHR during render (REQ-4, F3 guard)');
  };
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

  // F4 (REQ-1 pre-auth reachability): the routes are reachable signed-out
  // ONLY because (a) they are not registered inside the Stack.Protected
  // gate in _layout.tsx — U5 registers them EXPLICITLY (outside the guard)
  // so the boundary is documented in code, and (b) decideSessionNavigation
  // never redirects a signed-out visitor off `/legal/*` (its flip/park
  // clauses both require a session). Both are asserted against the real
  // mechanism so a future gating change fails the harness loudly.
  await test('routes stay outside the auth gate: legal screens are NOT registered inside Stack.Protected (F4)', () => {
    const layoutSource = readFileSync(join(root, 'src', 'app', '_layout.tsx'), 'utf8');
    // Positive control: the gate is real — (tabs) IS registered inside it.
    assert.ok(
      layoutSource.includes('Stack.Screen name="(tabs)"'),
      'sanity: _layout.tsx must register (tabs) inside the protected stack',
    );
    // Slice the protected block and require the legal screens absent there.
    // ("Public by absence" was the pre-U5 contract; explicit registration
    // OUTSIDE the guard is the U5 contract — moving a legal screen INTO the
    // block below still fails this assertion loudly.)
    const protectedBlock =
      layoutSource.match(/<Stack\.Protected>[\s\S]*<\/Stack\.Protected>/)?.[0] ?? '';
    assert.ok(
      !protectedBlock.includes('Stack.Screen name="legal'),
      'legal routes must NOT be registered inside Stack.Protected (public by absence)',
    );
  });

  await test('decideSessionNavigation never redirects a signed-out /legal/* visitor (F4)', async () => {
    const sessionNavMod = await load('src/lib/auth/session-nav.js');
    const decide = sessionNavMod.decideSessionNavigation;
    for (const pathname of ['/legal/privacy', '/legal/terms']) {
      assert.equal(
        decide({ prevSession: null, session: null, pathname }).shouldNavigate,
        false,
        `signed-out ${pathname} must stay put (REQ-1 deep link)`,
      );
    }
    // Controls proving the mechanism is live, not vacuously false:
    // (a) /reset-password keeps its suppression even WITH a session flip;
    // (b) a flip on any other route still redirects — so a regression
    //     that turns the decide into a signed-out redirect would fail the
    //     loop above.
    assert.equal(
      decide({ prevSession: null, session: {}, pathname: '/reset-password' }).shouldNavigate,
      false,
      'control: /reset-password stays suppressed on a session flip',
    );
    assert.equal(
      decide({ prevSession: null, session: {}, pathname: '/tabs/home' }).shouldNavigate,
      true,
      'control: a session flip on a regular route must still redirect',
    );
  });

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
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR'], 'es-AR', esArCommon);
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
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR'], 'es-AR', esArCommon);
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

  // F2: proves a LIVE locale change — the SAME mounted renderer is
  // refreshed in place after the catalog swap. A mount-snapshotting
  // screen would keep the stale es-AR copy under `update()` and fail;
  // the direct-`t()` LegalScreen re-renders and passes.
  await test('switching the active catalog to pt-BR re-renders the SAME mounted screen (F2)', async () => {
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR'], 'es-AR', esArCommon);
    const renderer = await renderRoute(PrivacyRoute);
    const before = renderText(renderer);
    assert.ok(
      before.includes(catalogs['es-AR'].privacy.draftNotice),
      'es-AR draft notice shows while the es-AR catalog is active',
    );
    // Swap the catalog under the SAME renderer and refresh it in place.
    i18nStub.__setActiveLegalCatalog(catalogs['pt-BR'], 'pt-BR', esArCommon);
    await act(async () => {
      renderer.update(React.createElement(PrivacyRoute));
    });
    const after = renderText(renderer);
    const doc = catalogs['pt-BR'].privacy;
    assert.ok(
      after.includes(doc.title),
      'pt-BR privacy title must render after the in-place update',
    );
    const thirdParties = doc.sections.find((s) => s.id === 'thirdParties');
    assert.ok(
      after.includes(thirdParties.title),
      'pt-BR third-parties title must render after the in-place update',
    );
    assert.ok(
      after.includes(thirdParties.body),
      'pt-BR third-parties body must render after the in-place update',
    );
    // Negative check via the draft notices — the es-AR and pt-BR document
    // TITLES overlap as substrings ('Política de privacidad' ⊂
    // 'Política de privacidade'), so titles cannot separate the locales.
    assert.ok(
      !after.includes(catalogs['es-AR'].privacy.draftNotice),
      'es-AR copy must NOT remain after the in-place update',
    );
    await unmountRoute(renderer);
  });

  await test('back button presses router.back() with the shipped common:back a11y label (F1)', async () => {
    i18nStub.__setActiveLegalCatalog(catalogs['es-AR'], 'es-AR', esArCommon);
    routerStub.__resetRouterStub();
    assert.ok(
      typeof BACK_LABEL === 'string' && BACK_LABEL.length > 0,
      'es-AR common.back must be a non-empty string (disk contract)',
    );
    const renderer = await renderRoute(PrivacyRoute);
    const back = renderer.root.findByProps({ accessibilityLabel: BACK_LABEL });
    await act(async () => {
      back.props.onPress();
    });
    assert.equal(routerStub.__lastNav(), 'back');
    await unmountRoute(renderer);
  });

  // ───────────────────────────────────────────────────────────────────
  // Section 4 — hosted mirror (SDD U3: generate-legal-markdown.mjs)
  // ───────────────────────────────────────────────────────────────────
  // REQ-2 (U3) "the hosts mirror the same three documents, one per locale,
  // byte-stable with the in-app catalogs": a static generator
  // (scripts/generate-legal-markdown.mjs) reads the SHIPPED legal catalogs
  // from disk and emits six Markdown mirrors under docs/legal/
  // (docs/legal/{es-AR,en,pt-BR}/{privacy,terms}.md). The mirrors are
  // COMMITTED so GitHub Pages can serve them without a runtime renderer.
  //
  // Three contracts are pinned here:
  //   F6  mirror EXISTS for every (locale × document) and parses as a
  //       non-empty markdown document carrying the locale + document type.
  //   F7  each mirror is BYTE-IDENTICAL to a FRESH generation emitted to a
  //       temp dir — i.e. the committed mirror is exactly what the generator
  //       produces today. A stale/edited mirror diverges and fails loudly
  //       (fresh-generation equality check deferred from U2-2.5).
  //   F9  every legal section (id + title + body) from the shipped
  //       catalog leaf is present verbatim in its mirror — the mirror is
  //       content-COMPLETE vs the in-app text, and the DRAFT notice rides
  //       along so hosted copy never loses the draft marker (R-3).
  //
  // The generator ships as plain node ESM (.mjs), so the harness drives the
  // SAME file `node scripts/generate-legal-markdown.mjs` runs — no compile
  // step, no drift between the tested and the shipped implementation.
  console.log('\n[tests] section 4 — hosted mirrors (U3, REQ-2 byte-stable with in-app)\n');

  const DOCS_ROOT = join(root, 'docs', 'legal');
  const MIRROR_LOCALES = ['es-AR', 'en', 'pt-BR'];
  const MIRROR_DOCS = ['privacy', 'terms'];

  const generateLegalMarkdown = async (outDirOverride) => {
    const genMod = await import(
      pathToFileURL(join(root, 'scripts', 'generate-legal-markdown.mjs')).href
    );
    const outDirs = await genMod.__emitLegalMirrors({
      root,
      outRoot: outDirOverride,
    });
    return outDirs;
  };

  const mirrorPath = (locale, doc) =>
    join(DOCS_ROOT, locale, `${doc}.md`);

  const mirrorExists = (locale, doc) =>
    existsSync(mirrorPath(locale, doc));

  await test('six mirrors exist on disk for every (locale × document) and carry type+locale in their title (F6)', () => {
    for (const locale of MIRROR_LOCALES) {
      for (const doc of MIRROR_DOCS) {
        const file = mirrorPath(locale, doc);
        assert.ok(
          mirrorExists(locale, doc),
          `mirror missing: docs/legal/${locale}/${doc}.md (generator not run / not committed)`,
        );
        const text = readFileSync(file, 'utf8');
        assert.ok(
          text.trim().length > 0,
          `mirror must not be empty: ${file}`,
        );
        assert.ok(
          text.includes(`# ${doc} · ${locale}`) ||
            text.includes(`# ${doc === 'privacy' ? 'Privacy' : 'Terms'} — ${locale}`),
          `mirror must declare its document type + locale in the H1: ${file}`,
        );
      }
    }
  });

  await test('committed mirrors are byte-identical to a FRESH deterministic regeneration (F7, U2-2.5)', async () => {
    const freshRoot = mkdtempSync(join(tmpRoot, 'legal-mirror-fresh-'));
    try {
      await generateLegalMarkdown(freshRoot);
      for (const locale of MIRROR_LOCALES) {
        for (const doc of MIRROR_DOCS) {
          const committed = readFileSync(mirrorPath(locale, doc), 'utf8');
          const fresh = readFileSync(join(freshRoot, locale, `${doc}.md`), 'utf8');
          assert.equal(
            fresh,
            committed,
            `docs/legal/${locale}/${doc}.md is stale — regenerate with ` +
              '`node scripts/generate-legal-markdown.mjs` (fresh generation must match committed)',
          );
        }
      }
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  await test('every legal section title + body + draft notice from the shipped catalog appear verbatim in its mirror (F9)', () => {
    for (const locale of MIRROR_LOCALES) {
      for (const doc of MIRROR_DOCS) {
        const mirror = readFileSync(mirrorPath(locale, doc), 'utf8');
        const catalogDoc = catalogs[locale][doc];
        assert.ok(
          mirror.includes(catalogDoc.draftNotice),
          `${locale}/${doc}: draft notice must be present in the mirror (R-3)`,
        );
        for (const section of catalogDoc.sections) {
          assert.ok(
            mirror.includes(section.title),
            `${locale}/${doc}: section title '${section.title}' must appear in the mirror`,
          );
          assert.ok(
            mirror.includes(section.body),
            `${locale}/${doc}: section body must appear in the mirror`,
          );
        }
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