#!/usr/bin/env node
/**
 * Category localization harness (strict TDD).
 *
 * Two layers:
 *
 *   A — the PURE helper (`localizedCategoryLabel`) compiled by tsc and run in
 *       plain node with fake translators built from the real on-disk `en` and
 *       `pt-BR` `categories` catalogs. No React, no i18next, no supabase.
 *
 *   B — static call-site assertions: catalog parity alone cannot pass while
 *       the render surfaces stay unwired. Each listed file must call the
 *       hook (UI boundary) or the pure helper with an injected translator
 *       (pure modules), and the pure modules must stay free of i18next.
 *
 * RED→GREEN: `pnpm test:category-localization` fails at compile time while
 * the helper does not exist. After GREEN the harness is chained into
 * `pnpm test` (package.json).
 *
 * Usage: pnpm test:category-localization
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require_.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.category-localization-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'category-localization-test-'));
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

function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

function catalogTranslator(locale) {
  const catalog = JSON.parse(
    readFileSync(join(root, 'src', 'i18n', 'locales', locale, 'categories.json'), 'utf8'),
  );
  return (key) => catalog[key.replace(/^categories:/, '')] ?? '';
}

/** Files that must wire the label mapping at their render/UI boundary. */
const UI_CALL_SITES = [
  'src/app/(tabs)/analytics.tsx',
  'src/features/analytics/components/CategoryBudgetRow.tsx',
  'src/app/(tabs)/history.tsx',
  'src/features/home/components/CategoryBudgetCard.tsx',
  'src/app/pro/charts.tsx',
  'src/app/receipts/[id].tsx',
  'src/features/receipts/components/ReceiptCategoryItemsModal.tsx',
  'src/app/categories/[key].tsx',
  'src/app/settings/category-budgets.tsx',
  'src/features/tickets/components/CategoryPickerModal.tsx',
  'src/features/tickets/components/ReviewItemRow.tsx',
  'src/features/tickets/components/ItemEditorModal.tsx',
  'src/app/ticket/manual.tsx',
];

/** Pure modules that take an injected translator instead of importing i18next. */
const PURE_CALL_SITES = [
  'src/features/tickets/category-picker-form.ts',
  'src/features/home/hooks/useHomeFeed.ts',
];

/**
 * Review finding: these sites fed `(key) => localizeCategory(key, '')` — a
 * labeler expecting a bare slug — into helpers that pass `categories:<slug>`
 * keys. The fix must inject `useCategoryTranslator()` instead.
 */
const TRANSLATOR_CONTRACT_SITES = [
  'src/app/ticket/manual.tsx',
  'src/features/tickets/components/CategoryPickerModal.tsx',
  'src/features/tickets/components/ItemEditorModal.tsx',
  'src/features/tickets/components/ReviewItemRow.tsx',
];

/** Each helper that receives a translator must actually receive the injected one. */
const TRANSLATOR_CALLS = {
  'src/app/ticket/manual.tsx': [
    /pickerRowForCategory\s*\([\s\S]{0,240}?categoryTranslator\s*,?\s*\)/,
  ],
  'src/features/tickets/components/CategoryPickerModal.tsx': [
    /pickerRowsFromCatalog\s*\(\s*catalog\s*,\s*categoryTranslator\s*,?\s*\)/,
    /canonicalFallbackRows\s*\(\s*categoryTranslator\s*,?\s*\)/,
    /reassignmentTargets\s*\([\s\S]{0,240}?categoryTranslator\s*,?\s*\)/,
  ],
  'src/features/tickets/components/ItemEditorModal.tsx': [
    /pickerRowForCategory\s*\(\s*catalog\s*,\s*categoryId\s*,\s*categoryTranslator\s*\)/,
  ],
  'src/features/tickets/components/ReviewItemRow.tsx': [
    /reviewChipRowForCategory\s*\(\s*catalog\s*,\s*categoryId\s*,\s*categoryTranslator\s*,?\s*\)/,
  ],
};

/** Budget surfaces whose limit copy was still hardcoded Spanish. */
const BUDGET_COPY_SURFACES = [
  'src/features/analytics/components/CategoryBudgetRow.tsx',
  'src/features/home/components/CategoryBudgetCard.tsx',
];

const source = (relative) => readFileSync(join(root, relative), 'utf8');
const jsonCatalog = (locale, namespace) =>
  JSON.parse(
    readFileSync(
      join(root, 'src', 'i18n', 'locales', locale, `${namespace}.json`),
      'utf8',
    ),
  );

async function run() {
  console.log('\n[category-localization] pure helper + call sites\n');
  compile();
  installRequireHook();

  const { localizedCategoryLabel } = await load(
    'src/i18n/localizedCategoryLabel.js',
  );
  const en = catalogTranslator('en');
  const ptBR = catalogTranslator('pt-BR');

  await test('canonical slugs resolve from the en catalog', async () => {
    assert.equal(localizedCategoryLabel('panaderia', 'Panadería', en), 'Bakery');
    assert.equal(
      localizedCategoryLabel('frutas-verduras', 'Frutas y verduras', en),
      'Fruits and vegetables',
    );
    assert.equal(localizedCategoryLabel('lacteos', 'Lácteos', en), 'Dairy');
  });

  await test('canonical slugs resolve from the pt-BR catalog', async () => {
    assert.equal(localizedCategoryLabel('panaderia', 'Panadería', ptBR), 'Padaria');
    assert.equal(
      localizedCategoryLabel('frutas-verduras', 'Frutas y verduras', ptBR),
      'Frutas e verduras',
    );
  });

  await test('custom names are never translated', async () => {
    assert.equal(localizedCategoryLabel('delivery', 'Mi Delivery', en), 'Mi Delivery');
    assert.equal(localizedCategoryLabel('gimnasio', 'Gimnasio', ptBR), 'Gimnasio');
  });

  await test('missing/empty translation falls back to the DB name', async () => {
    const missing = () => '';
    assert.equal(localizedCategoryLabel('panaderia', 'Panadería', missing), 'Panadería');
    assert.equal(
      localizedCategoryLabel('frutas-verduras', 'Frutas y verduras', missing),
      'Frutas y verduras',
    );
    assert.equal(
      localizedCategoryLabel('panaderia', 'Panadería', (key) => key),
      'Panadería',
      'an untranslated i18next key must never be shown',
    );
  });

  await test('bare-slug i18next fallback is treated as untranslated', async () => {
    // Real i18next may echo just the slug when no catalog entry exists.
    const bareSlug = (key) => key.replace(/^categories:/, '');
    assert.equal(localizedCategoryLabel('panaderia', 'Panadería', bareSlug), 'Panadería');
    assert.equal(
      localizedCategoryLabel('frutas-verduras', 'Frutas y verduras', bareSlug),
      'Frutas y verduras',
    );
    assert.equal(localizedCategoryLabel('delivery', 'Mi Delivery', bareSlug), 'Mi Delivery');
  });

  await test('absent translator / null slug / empty DB name stay safe', async () => {
    assert.equal(localizedCategoryLabel('panaderia', 'Panadería', null), 'Panadería');
    assert.equal(localizedCategoryLabel(null, 'Sin categoría', en), 'Sin categoría');
    assert.equal(localizedCategoryLabel(undefined, undefined, en), '');
  });

  const {
    reviewChipRowForCategory,
    pickerRowForCategory,
    categoryRowLabel,
    categoryChipsReady,
    pickerRowsFromCatalog,
    canonicalFallbackRows,
  } = await load('src/features/tickets/category-picker-form.js');
  const { getExpenseCategory, EXPENSE_CATEGORIES } = await load(
    'src/features/home/categories.js',
  );

  await test('review row delegates chip resolution without a static fallback', async () => {
    const src = source('src/features/tickets/components/ReviewItemRow.tsx');
    assert.match(
      src,
      /reviewChipRowForCategory\s*\(\s*catalog\s*,\s*categoryId\s*,\s*categoryTranslator\s*,?\s*\)/,
      'the row must use the catalog-aware, never-mistranslating resolver',
    );
    assert.doesNotMatch(
      src,
      /getExpenseCategory\s*\(/,
      'the static registry must not supply chip copy',
    );
    assert.doesNotMatch(
      src,
      /localizeCategory\s*\(\s*item\.name/,
      'user-authored names must never be translated',
    );

    // Executed proof on the real static registry + real en catalog: only
    // canonical copy is localized; a custom row's own name still passes
    // through verbatim.
    const canonical = getExpenseCategory('panaderia');
    assert.equal(canonical.label, 'Panadería');
    assert.equal(localizedCategoryLabel(canonical.key, canonical.label, en), 'Bakery');
    assert.equal(localizedCategoryLabel('delivery', 'Mi Delivery', en), 'Mi Delivery');
  });

  await test('review chip keeps a custom slug verbatim with an empty catalog', async () => {
    const row = reviewChipRowForCategory({}, 'cafe-deli', en);
    assert.equal(row?.label, 'cafe-deli');
    assert.notEqual(row?.label, EXPENSE_CATEGORIES.otros.label);
    assert.equal(row?.icon, EXPENSE_CATEGORIES.otros.icon);
  });

  await test('review chip localizes a canonical slug with an empty catalog', async () => {
    const row = reviewChipRowForCategory({}, 'panaderia', en);
    assert.equal(row?.label, 'Bakery');
    assert.equal(row?.icon, EXPENSE_CATEGORIES.panaderia.icon);
  });

  await test('review chip has no category for a null slug', async () => {
    assert.equal(reviewChipRowForCategory({}, null, en), null);
    assert.equal(reviewChipRowForCategory({}, undefined, en), null);
  });

  await test('review chip never translates a custom slug', async () => {
    let calls = 0;
    const spy = (key) => {
      calls += 1;
      return en(key);
    };
    const row = reviewChipRowForCategory({}, 'cafe-deli', spy);
    assert.equal(row?.label, 'cafe-deli');
    assert.equal(calls, 0, 'custom slugs are identities, not translation keys');

    // Triangulation: canonical copy still exercises the real translator.
    assert.equal(reviewChipRowForCategory({}, 'panaderia', spy)?.label, 'Bakery');
    assert.equal(calls, 1);
  });

  await test('picker row preserves a custom slug with an empty catalog', async () => {
    const row = pickerRowForCategory({}, 'cafe-deli', en);
    assert.equal(row?.label, 'cafe-deli');
    assert.notEqual(row?.label, EXPENSE_CATEGORIES.otros.label);
    assert.notEqual(row?.label, 'Other');
    assert.equal(row?.icon, EXPENSE_CATEGORIES.otros.icon);
  });

  await test('picker row localizes a canonical slug exactly once', async () => {
    let calls = 0;
    const spy = (key) => {
      calls += 1;
      return en(key);
    };
    assert.equal(pickerRowForCategory({}, 'panaderia', spy)?.label, 'Bakery');
    assert.equal(calls, 1, 'the picker row owns the single localization');

    // Triangulation: a custom slug is an identity and never reaches t().
    calls = 0;
    assert.equal(pickerRowForCategory({}, 'cafe-deli', spy)?.label, 'cafe-deli');
    assert.equal(calls, 0);
  });

  await test('review chip keeps a catalog-known custom name', async () => {
    let calls = 0;
    const spy = (key) => {
      calls += 1;
      return en(key);
    };
    const catalog = {
      'cafe-deli': {
        id: 'cafe-id',
        slug: 'cafe-deli',
        name: 'Café & Deli',
        kind: 'want',
        icon: 'cup.and.saucer.fill',
        color: '#4B5563',
        sort_order: 100,
      },
    };
    const row = reviewChipRowForCategory(catalog, 'cafe-deli', spy);
    assert.equal(row?.label, 'Café & Deli');
    assert.equal(row?.icon, 'cup.and.saucer.fill');
    assert.equal(calls, 0);
  });

  await test('review chip gate withholds chips while the catalog is loading', async () => {
    assert.equal(categoryChipsReady(true), false);
  });

  await test('review chip gate opens on both terminal catalog states', async () => {
    // React Query settles success AND read failure with isLoading === false;
    // the gate opens so the row resolver can apply its own identity fallback.
    assert.equal(categoryChipsReady(false), true);
    const catalog = {
      'cafe-deli': {
        id: 'cafe-id',
        slug: 'cafe-deli',
        name: 'Café & Deli',
        kind: 'want',
        icon: 'cup.and.saucer.fill',
        color: '#4B5563',
        sort_order: 100,
      },
    };
    assert.equal(reviewChipRowForCategory(catalog, 'panaderia', en)?.label, 'Bakery');
    assert.equal(reviewChipRowForCategory(catalog, 'cafe-deli', en)?.label, 'Café & Deli');
    assert.equal(reviewChipRowForCategory({}, 'cafe-deli', en)?.label, 'cafe-deli');
  });

  await test('picker rows localize canonical slugs through injected en/pt-BR translators', async () => {
    const catalog = {
      panaderia: {
        id: 'pan-id',
        slug: 'panaderia',
        name: 'Panadería',
        kind: 'need',
        icon: 'birthday.cake.fill',
        color: '#D97706',
        sort_order: 1,
      },
    };
    assert.equal(
      pickerRowsFromCatalog(catalog, en).find((row) => row.slug === 'panaderia')?.label,
      'Bakery',
    );
    assert.equal(
      pickerRowsFromCatalog(catalog, ptBR).find((row) => row.slug === 'panaderia')?.label,
      'Padaria',
    );
    assert.equal(
      canonicalFallbackRows(en).find((row) => row.slug === 'panaderia')?.label,
      'Bakery',
    );
    assert.equal(
      canonicalFallbackRows(ptBR).find((row) => row.slug === 'panaderia')?.label,
      'Padaria',
    );
  });

  await test('picker rows keep a custom DB name verbatim in both locales', async () => {
    const catalog = {
      'mi-delivery': {
        id: 'delivery-id',
        slug: 'mi-delivery',
        name: 'Mi Delivery',
        kind: 'want',
        icon: 'sparkles',
        color: '#4F46E5',
        sort_order: 100,
      },
    };
    for (const translator of [en, ptBR]) {
      const row = pickerRowsFromCatalog(catalog, translator)[0];
      assert.equal(row.slug, 'mi-delivery');
      assert.equal(row.label, 'Mi Delivery');
    }
  });

  await test('picker rows fall back to DB/static names on missing translations', async () => {
    const catalog = {
      panaderia: {
        id: 'pan-id',
        slug: 'panaderia',
        name: 'Panadería',
        kind: 'need',
        icon: 'birthday.cake.fill',
        color: '#D97706',
        sort_order: 1,
      },
      'mi-delivery': {
        id: 'delivery-id',
        slug: 'mi-delivery',
        name: 'Mi Delivery',
        kind: 'want',
        icon: 'sparkles',
        color: '#4F46E5',
        sort_order: 100,
      },
    };
    const empty = () => '';
    const echo = (key) => key;
    for (const translator of [empty, echo, null, undefined]) {
      const rows = pickerRowsFromCatalog(catalog, translator);
      assert.equal(rows.find((row) => row.slug === 'panaderia')?.label, 'Panadería');
      assert.equal(rows.find((row) => row.slug === 'mi-delivery')?.label, 'Mi Delivery');
    }
    for (const translator of [empty, echo, null, undefined]) {
      assert.equal(
        canonicalFallbackRows(translator).find((row) => row.slug === 'panaderia')?.label,
        'Panadería',
      );
    }
  });

  await test('review screen hides item chips until the catalog is loaded', async () => {
    const src = source('src/app/ticket/review/[id].tsx');
    assert.match(
      src,
      /const\s*\{\s*catalog\s*,\s*isLoading\s*\}\s*=\s*useCategoryCatalog\s*\(\s*\)/,
      'the review screen must consume the catalog readiness flag',
    );
    assert.match(
      src,
      /\bcategoryChipsReady\b/,
      'the review screen must import the executed pure readiness helper',
    );
    const itemsSection = src.slice(src.indexOf('{/* Items */}'));
    assert.match(
      itemsSection,
      /categoryChipsReady\s*\(\s*isLoading\s*\)\s*\?/,
      'the list must gate on the helper, not a bare isLoading pin',
    );
    assert.match(
      itemsSection,
      /t\(\s*['"]common:loading['"]\s*\)/,
      'the loading state must use shipped neutral copy, never a category name',
    );
    assert.match(
      itemsSection,
      /categoryChipsReady\s*\(\s*isLoading\s*\)\s*\?[\s\S]*?<ReceiptItemsList[\s\S]*?\)\s*:\s*\(\s*<Text style=\{styles\.itemsLoading\}>\{t\(['"]common:loading['"]\)\}<\/Text>/,
      'the loading placeholder must be the else arm of the readiness gate, replacing the chips',
    );
    for (const locale of ['en', 'es-419', 'pt-BR']) {
      assert.ok(
        typeof jsonCatalog(locale, 'common').loading === 'string',
        `${locale} must ship the neutral loading copy`,
      );
    }
  });

  await test('hook uses the active i18next categories namespace', async () => {
    const hook = source('src/i18n/hooks/useCategoryLabel.ts');
    assert.match(hook, /useTranslation\(\s*['"]categories['"]\s*\)/);
    assert.match(hook, /localizedCategoryLabel\s*\(/);
  });

  await test('UI call sites bind a category i18n hook', async () => {
    const unwired = UI_CALL_SITES.filter((file) => {
      const src = source(file);
      return !/useCategoryLabel\s*\(/.test(src) &&
        !/useCategoryTranslator\s*\(/.test(src);
    });
    assert.deepEqual(unwired, [], `unwired UI surfaces: ${unwired.join(', ')}`);
  });

  await test('no call site adapts a labeler into a translator contract', async () => {
    const offenders = TRANSLATOR_CONTRACT_SITES.filter((file) =>
      /\(\s*key(?:\s*:\s*string)?\s*\)\s*=>\s*localizeCategory\s*\(/.test(
        source(file),
      ),
    );
    assert.deepEqual(
      offenders,
      [],
      `inverted adapter still present: ${offenders.join(', ')}`,
    );
  });

  await test('translator injection: i18next t() reaches every pure helper call', async () => {
    for (const file of TRANSLATOR_CONTRACT_SITES) {
      const src = source(file);
      assert.match(
        src,
        /import\s*\{[\s\S]*?\buseCategoryTranslator\b[\s\S]*?\}\s*from\s*['"]@\/i18n\/hooks\/useCategoryLabel['"]/,
        `${file} must import useCategoryTranslator from the label hook module`,
      );
      assert.match(
        src,
        /const\s+categoryTranslator\s*=\s*useCategoryTranslator\s*\(\s*\)/,
        `${file} must bind the i18next-bound translator directly`,
      );
      assert.doesNotMatch(
        src,
        /useCallback/,
        `${file} must not keep the removed adapter's useCallback import`,
      );
      for (const contract of TRANSLATOR_CALLS[file]) {
        assert.match(
          src,
          contract,
          `${file} must inject categoryTranslator into ${contract}`,
        );
      }
    }
  });

  await test('budget limit copy uses the shipped analytics keys', async () => {
    for (const file of BUDGET_COPY_SURFACES) {
      const src = source(file);
      assert.match(
        src,
        /t\(['"]budgetSpentOf['"]\)/,
        `${file} must use the localized "of" separator`,
      );
      assert.match(
        src,
        /t\(['"]budgetProgressA11y['"]\s*,\s*\{\s*spent:/,
        `${file} must use the localized progress accessibility sentence`,
      );
      assert.doesNotMatch(src, /de\{' '\}/, `${file} still hardcodes " de "`);
      assert.doesNotMatch(src, /Gastaste \$\{/, `${file} still hardcodes Spanish a11y copy`);
    }

    // Executed proof with the real catalogs: the exact shipped keys and args
    // produce localized copy in en/pt-BR and keep the Spanish es-419 fallback.
    const format = (template, vars) =>
      template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key]);
    const spentText = (catalog) =>
      format(catalog.budgetProgressA11y, {
        spent: `100${catalog.budgetSpentOf}200`,
      });
    assert.equal(spentText(jsonCatalog('en', 'analytics')), 'You spent 100 of 200.');
    assert.equal(spentText(jsonCatalog('pt-BR', 'analytics')), 'Você gastou 100 de 200.');
    assert.equal(spentText(jsonCatalog('es-419', 'analytics')), 'Gastaste 100 de 200.');
  });

  await test('pure modules translate only through an injected translator', async () => {
    const unwired = PURE_CALL_SITES.filter(
      (file) => !/localizedCategoryLabel\s*\(/.test(source(file)),
    );
    assert.deepEqual(unwired, [], `unwired pure modules: ${unwired.join(', ')}`);
    for (const file of [
      'src/i18n/localizedCategoryLabel.ts',
      'src/features/home/categories.ts',
      'src/features/tickets/category-picker-form.ts',
      'src/features/home/hooks/useHomeFeed.ts',
    ]) {
      assert.doesNotMatch(
        source(file),
        /from\s+['"](?:react-i18next|i18next)['"]/,
        `${file} must stay free of i18next imports`,
      );
    }
  });

  // ── Safe custom-category identity (critical pre-commit finding) ────────
  // One pure resolver owns the identity fallback for every mounted surface.
  // A user-authored slug is never relabeled as 'Otros' while the catalog is
  // loading or after a catalog read failure.
  const { resolveCategoryIdentity } = await load('src/features/home/categories.js');

  await test('identity resolver: canonical slug keeps static visuals', async () => {
    const row = resolveCategoryIdentity({}, 'panaderia');
    assert.equal(row.key, 'panaderia');
    assert.equal(row.label, EXPENSE_CATEGORIES.panaderia.label);
    assert.equal(row.icon, EXPENSE_CATEGORIES.panaderia.icon);
    assert.equal(row.background, EXPENSE_CATEGORIES.panaderia.background);
  });

  await test('identity resolver: catalog row keeps its own name and visuals', async () => {
    const catalog = {
      'cafe-deli': {
        id: 'cafe-id',
        slug: 'cafe-deli',
        name: 'Café & Deli',
        kind: 'want',
        icon: 'cup.and.saucer.fill',
        color: '#4B5563',
        sort_order: 100,
      },
    };
    const row = resolveCategoryIdentity(catalog, 'cafe-deli');
    assert.equal(row.key, 'cafe-deli');
    assert.equal(row.label, 'Café & Deli');
    assert.equal(row.icon, 'cup.and.saucer.fill');
    assert.equal(row.background, '#4B5563');
    assert.equal(
      row.foreground,
      EXPENSE_CATEGORIES.otros.foreground,
      'the palette-derived foreground must remain readable',
    );
  });

  await test('identity resolver: unknown slug with empty catalog uses the slug, never Otros', async () => {
    const row = resolveCategoryIdentity({}, 'cafe-deli');
    assert.equal(row.key, 'cafe-deli');
    assert.equal(row.label, 'cafe-deli');
    assert.notEqual(row.label, EXPENSE_CATEGORIES.otros.label);
    assert.equal(row.icon, EXPENSE_CATEGORIES.otros.icon);
    assert.equal(row.background, EXPENSE_CATEGORIES.otros.background);
  });

  await test('identity resolver: null slug has no identity (callers own no-category copy)', async () => {
    assert.equal(resolveCategoryIdentity({}, null), null);
    assert.equal(resolveCategoryIdentity({}, undefined), null);
  });

  await test('identity resolver: prototype keys are synthetic identities, never borrowed rows', async () => {
    const plain = {
      constructor: {
        id: 'x',
        slug: 'constructor',
        name: 'Hacked',
        kind: 'want',
        icon: 'sparkles',
        color: '#4B5563',
        sort_order: 100,
      },
    };
    assert.equal(resolveCategoryIdentity(plain, 'constructor').label, 'Hacked');
    assert.equal(resolveCategoryIdentity({}, 'constructor').label, 'constructor');
    assert.notEqual(resolveCategoryIdentity({}, '__proto__').label, EXPENSE_CATEGORIES.otros.label);
  });

  await test('review chip delegates to the identity resolver (one ownership point)', async () => {
    assert.match(
      source('src/features/tickets/category-picker-form.ts'),
      /reviewChipRowForCategory[\s\S]{0,700}?resolveCategoryIdentity\s*\(/,
      'reviewChipRowForCategory must delegate to the shared resolver',
    );
    const row = reviewChipRowForCategory({}, 'cafe-deli', en);
    assert.equal(row?.label, 'cafe-deli');
    assert.notEqual(row?.label, EXPENSE_CATEGORIES.otros.label);
  });

  await test('receipt detail routes category rows and the sheet label through the identity resolver', async () => {
    const src = source('src/app/receipts/[id].tsx');
    assert.match(src, /resolveCategoryIdentity\s*\(/);
    assert.match(src, /def:\s*resolveCategoryIdentity\s*\(\s*catalog,\s*key\s*\)/);
    assert.match(
      src,
      /resolveCategoryIdentity\(\s*catalog,\s*openCategory\s*\)\?\.label/,
    );
    assert.doesNotMatch(
      src,
      /resolveCategoryDisplay\s*\(/,
      'the old Otros-bucketing resolver must not remain on this surface',
    );
    assert.match(src, /<ReceiptCategoryItemsModal[\s\S]{0,240}?catalog=\{catalog\}/);
    const identity = resolveCategoryIdentity({}, 'cafe-deli');
    assert.equal(localizedCategoryLabel(identity.key, identity.label, en), 'cafe-deli');
    assert.notEqual(localizedCategoryLabel(identity.key, identity.label, en), EXPENSE_CATEGORIES.otros.label);
  });

  await test('receipt category sheet resolves its kicker through the identity resolver', async () => {
    const src = source('src/features/receipts/components/ReceiptCategoryItemsModal.tsx');
    assert.match(src, /catalog\?:\s*CategoryCatalog/);
    assert.match(
      src,
      /resolveCategoryIdentity\(\s*catalog,\s*categorySlug\s*\)/,
    );
    assert.match(
      src,
      /kicker=\{localizeCategory\(\s*categorySlug,\s*identity\?\.label \?\? categoryLabel\s*\)\}/,
    );
    const identity = resolveCategoryIdentity({}, 'cafe-deli');
    assert.equal(localizedCategoryLabel('cafe-deli', identity.label, en), 'cafe-deli');
  });

  await test('chart legend label resolves an unknown custom slug to the slug, never Otros', async () => {
    const src = source('src/app/pro/charts.tsx');
    const topCategory = src.slice(src.indexOf('const topCategory = useMemo'));
    assert.match(topCategory, /resolveCategoryIdentity\(\s*catalog,\s*slug\s*\)/);
    assert.match(topCategory, /name:\s*localizeCategory\(\s*slug,\s*identity\.label\s*\)/);
    assert.doesNotMatch(
      topCategory.slice(0, topCategory.indexOf('const categories = aggregateCategoriesByMonth')),
      /resolveCategoryDisplay\s*\(/,
    );
    const identity = resolveCategoryIdentity({}, 'cafe-deli');
    assert.equal(localizedCategoryLabel('cafe-deli', identity.label, en), 'cafe-deli');
    assert.notEqual(localizedCategoryLabel('cafe-deli', identity.label, en), EXPENSE_CATEGORIES.otros.label);
  });

  await test('category detail route resolves an unknown custom slug to the slug, never Otros', async () => {
    const src = source('src/app/categories/[key].tsx');
    assert.match(
      src,
      /const visual = resolveCategoryIdentity\(\s*catalog,\s*key \?\? 'otros'\s*\)/,
    );
    assert.doesNotMatch(src, /resolveCategoryDisplay\s*\(/);
    const identity = resolveCategoryIdentity({}, 'cafe-deli');
    assert.equal(localizedCategoryLabel('cafe-deli', identity.label, en), 'cafe-deli');
    assert.equal(
      resolveCategoryIdentity({}, 'otros').label,
      EXPENSE_CATEGORIES.otros.label,
      'a missing route key keeps the canonical Otros behavior',
    );
  });

  await test('manual and editor render the already-localized row once', async () => {
    for (const file of [
      'src/app/ticket/manual.tsx',
      'src/features/tickets/components/ItemEditorModal.tsx',
    ]) {
      const src = source(file);
      assert.match(
        src,
        /pickerRowForCategory\s*\(/,
        `${file} must use the resolver that owns localization`,
      );
      assert.match(
        src,
        /categoryRowLabel\s*\(\s*categoryRow\b/,
        `${file} must render the resolved row verbatim`,
      );
      assert.doesNotMatch(
        src,
        /localizeCategory\s*\(/,
        `${file} must not localize a row that is already localized`,
      );
      assert.doesNotMatch(
        src,
        /reviewChipRowForCategory\s*\(/,
        `${file} must not keep the unreachable second resolver`,
      );
      assert.doesNotMatch(
        src,
        /getExpenseCategory\s*\(/,
        `${file} must not borrow the static Otros label for a custom slug`,
      );
    }
    const noCategory = 'No category';
    assert.equal(
      categoryRowLabel(pickerRowForCategory({}, 'cafe-deli', en), noCategory),
      'cafe-deli',
    );
    assert.equal(
      categoryRowLabel(pickerRowForCategory({}, 'panaderia', en), noCategory),
      'Bakery',
    );
    assert.equal(categoryRowLabel(null, noCategory), noCategory);
  });

  await test('mapPurchaseRowsToHomeFeed has no dead translator parameter', async () => {
    const src = source('src/features/home/hooks/useHomeFeed.ts');
    assert.match(
      src,
      /export function mapPurchaseRowsToHomeFeed\([\s\S]{0,420}?viewerCurrency:\s*string,\s*\n\)\s*:\s*HomeFeed/,
      'the sixth parameter must be removed when no production caller supplies it',
    );
    assert.doesNotMatch(
      src,
      /mapPurchaseRowsToHomeFeed\([\s\S]{0,420}?translator\?:/,
    );
  });

  console.log(`\n[category-localization] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
