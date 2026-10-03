#!/usr/bin/env node
/**
 * Single-source-of-truth harness for the currency-universality catalog (AD-6).
 *
 * The point of this harness is that there is exactly ONE place the fourteen
 * supported codes are written down — `SUPPORTED_CURRENCIES` in
 * `src/lib/format.ts` — and everything else (the symbol table, the three
 * full-locale `currency.json` catalogs, the settings selector) is checked
 * against it rather than restating it. Before this change the selector kept its
 * own four-code array and its own hand-written key union, and REQ-1.2 held by
 * coincidence.
 *
 * Two halves:
 *
 *   1. VALUE assertions against the COMPILED format module — length 14, no
 *      duplicates, the exact alphabetical spec list, a symbol for every code,
 *      and key-set equality between the format list and en / es-419 / pt-BR
 *      `currency.json`.
 *   2. SOURCE pins for the three files that must REFERENCE the catalog
 *      instead of copying it, plus the two create-only invariants that live in
 *      prose and are trivially undone by a well-meaning refactor. Compiling
 *      those files would drag in the whole component barrel and the native
 *      Supabase client; a structural scan is the proportionate check, and it
 *      pins the "no second list" rule textually.
 *
 * The leaf-count pin (797) belongs to
 * `scripts/test-i18n-catalog-parity.mjs`, and duplicating it here would create
 * a second place to update on the next catalog bump.
 *
 * Usage: pnpm test:currency-catalog
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.currency-catalog-test.json');

const localesDir = join(root, 'src', 'i18n', 'locales');
const FULL_LOCALES = ['en', 'es-419', 'pt-BR'];

/** The exact set the spec names, spelled out here ONCE on purpose: this is the
 *  only place the list is restated, and it exists to catch a silent ADD or
 *  REMOVE from `SUPPORTED_CURRENCIES`. The catalog itself stays the authority
 *  for order. */
const SPEC_LIST = [
  'ARS', 'AUD', 'BRL', 'CAD', 'CLP', 'COP', 'EUR',
  'GBP', 'JPY', 'MXN', 'PEN', 'PYG', 'USD', 'UYU',
];

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'currency-catalog-test-'));
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

/** Isolate one exported function's body so a scan cannot be satisfied (or
 *  broken) by a sibling in the same file. `profile-sync.ts` has a legitimate
 *  `.upsert(` in `ensureProfile` and a forbidden one in
 *  `ensureProfileCurrency`; only a slice tells them apart.
 *
 *  The `\s*\(` is load-bearing, not decoration: a plain indexOf for
 *  `ensureProfile` matches `ensureProfileCurrency` first (it is the earlier
 *  declaration and a strict prefix), so the "is ensureProfile's payload clean"
 *  scan silently ran against the wrong function and reported a pass/fail for
 *  code it never read. */
function sliceFunction(src, name) {
  const decl = new RegExp(`export async function ${name}\\s*\\(`);
  const match = decl.exec(src);
  assert.ok(match, `${name} not found`);
  const rest = src.indexOf('\nexport ', match.index + 1);
  return src.slice(match.index, rest === -1 ? src.length : rest);
}

async function run() {
  console.log('\n[tests] compiling format module (catalog authority)…');
  compile();
  const fmt = await import(
    pathToFileURL(join(outDir, 'src', 'lib', 'format.js')).href
  );
  const detector = await import(
    pathToFileURL(join(outDir, 'src', 'i18n', 'detector.js')).href
  );

  const codes = fmt.SUPPORTED_CURRENCIES;

  // ── 1. the catalog itself ───────────────────────────────────────────────
  console.log('\n[tests] catalog shape\n');

  await test('SUPPORTED_CURRENCIES carries exactly 14 codes', () => {
    assert.equal(codes.length, 14);
  });

  await test('SUPPORTED_CURRENCIES has no duplicates (Set size == length)', () => {
    assert.equal(new Set(codes).size, codes.length);
  });

  await test('the sorted catalog equals the 14 codes the spec names', () => {
    assert.deepEqual([...codes].sort(), SPEC_LIST);
  });

  await test('every code resolves a non-empty symbol, never a bare fallback', () => {
    for (const code of codes) {
      const symbol = fmt.CURRENCY_SYMBOL[code];
      assert.ok(symbol, `${code} has no CURRENCY_SYMBOL entry`);
      assert.notEqual(symbol, code, `${code} must not fall back to its own code`);
    }
  });

  // ── 2. the locale catalogs track the format list ────────────────────────
  console.log('\n[tests] locale currency.json track the format catalog\n');

  for (const locale of FULL_LOCALES) {
    await test(`${locale} currency.json key set === SUPPORTED_CURRENCIES`, () => {
      const json = JSON.parse(
        readFileSync(join(localesDir, locale, 'currency.json'), 'utf8'),
      );
      assert.deepEqual(
        Object.keys(json).sort(),
        [...codes].sort(),
        `${locale} currency.json has drifted from the catalog`,
      );
      for (const [key, value] of Object.entries(json)) {
        assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
        assert.notEqual(value.trim(), '', `${locale}.${key} must not be blank`);
      }
    });
  }

  await test('es-AR and es-ES inherit currency via es-419 (both stay {})', () => {
    for (const locale of ['es-AR', 'es-ES']) {
      const json = JSON.parse(
        readFileSync(join(localesDir, locale, 'currency.json'), 'utf8'),
      );
      assert.deepEqual(json, {}, `${locale}/currency.json must stay an empty override`);
    }
  });
  // ── 2b. locale label content pins and anti-paste guard ────────────────
  console.log('\n[tests] locale label content is correct (no English paste)\n');

  const ptBRPinned = {
    UYU: 'Peso uruguaio',
    USD: 'Dólar americano',
    ARS: 'Peso argentino',
    BRL: 'Real brasileiro',
    AUD: 'Dólar australiano',
    CAD: 'Dólar canadense',
    CLP: 'Peso chileno',
    COP: 'Peso colombiano',
    EUR: 'Euro',
    GBP: 'Libra esterlina',
    JPY: 'Iene japonês',
    MXN: 'Peso mexicano',
    PEN: 'Sol peruano',
    PYG: 'Guarani',
  };
  const es419Pinned = {
    UYU: 'Peso uruguayo',
    USD: 'Dólar estadounidense',
    ARS: 'Peso argentino',
    BRL: 'Real brasileño',
    AUD: 'Dólar australiano',
    CAD: 'Dólar canadiense',
    CLP: 'Peso chileno',
    COP: 'Peso colombiano',
    EUR: 'Euro',
    GBP: 'Libra esterlina',
    JPY: 'Yen japonés',
    MXN: 'Peso mexicano',
    PEN: 'Sol peruano',
    PYG: 'Guaraní paraguayo',
  };
  const enPinned = {
    UYU: 'Uruguayan peso',
    USD: 'US dollar',
    ARS: 'Argentine peso',
    BRL: 'Brazilian real',
    AUD: 'Australian dollar',
    CAD: 'Canadian dollar',
    CLP: 'Chilean peso',
    COP: 'Colombian peso',
    EUR: 'Euro',
    GBP: 'British pound sterling',
    JPY: 'Japanese yen',
    MXN: 'Mexican peso',
    PEN: 'Peruvian sol',
    PYG: 'Paraguayan guaraní',
  };

  for (const locale of FULL_LOCALES) {
    await test(`${locale} currency.json values match pinned values`, () => {
      const json = JSON.parse(
        readFileSync(join(localesDir, locale, 'currency.json'), 'utf8'),
      );
      const pinned = locale === 'pt-BR' ? ptBRPinned : locale === 'es-419' ? es419Pinned : enPinned;
      for (const code of codes) {
        assert.equal(json[code], pinned[code], `${locale}.${code} value does not match pinned value`);
      }
    });
  }

  await test('anti-paste guard: pt-BR and es-419 differ from en for all codes', () => {
    for (const code of codes) {
      assert.notEqual(ptBRPinned[code], enPinned[code], `pt-BR.${code} must differ from en.${code}`);
      assert.notEqual(es419Pinned[code], enPinned[code], `es-419.${code} must differ from en.${code}`);
    }
  });



  await test('REGION_DEFAULT_CURRENCY values exist in catalog', () => {
    for (const [region, currency] of Object.entries(detector.REGION_DEFAULT_CURRENCY)) {
      assert.ok(fmt.SUPPORTED_CURRENCIES.includes(currency), `${region} -> ${currency} not in SUPPORTED_CURRENCIES`);
    }
  });
  // ── 3. the selector REFERENCES the catalog ──────────────────────────────
  console.log('\n[tests] settings selector consumes the catalog\n');

  const selector = readFileSync(join(root, 'src', 'app', 'settings', 'currency.tsx'), 'utf8');

  await test('currency.tsx imports SUPPORTED_CURRENCIES from the format module', () => {
    assert.match(
      selector,
      /import\s*\{[^}]*\bSUPPORTED_CURRENCIES\b[^}]*\}\s*from\s*'@\/lib\/format'/,
      'the selector must import the catalog, not redeclare it',
    );
    assert.match(selector, /SUPPORTED_CURRENCIES\.map\(/);
  });

  await test('currency.tsx declares no currency-code array of its own', () => {
    // Matches `const FOO = ['UYU', ...]` / ReadonlyArray<string> style lists.
    assert.doesNotMatch(
      selector,
      /const\s+[A-Z_]*CURRENC[A-Z_]*\w*\s*(:\s*ReadonlyArray<[^>]*>)?\s*=/,
      'a second code array in the selector is the exact drift this change removed',
    );
    assert.doesNotMatch(
      selector,
      /'currency:[A-Z]{3}'/,
      'a hand-written currency key union is back in the selector',
    );
  });

  await test('currency.tsx has no `as` cast on its i18n key (the T-8 lesson)', () => {
    // `as \`currency:${CurrencyKey}\`` typechecks while silently narrowing a
    // wider union down to the catalog's — an assertion between two unions only
    // needs one direction of assignability. The guard that actually bites is
    // `satisfies`, which demands every member be assignable. Pinning BOTH cast
    // spellings so the decorative one cannot come back wearing a type-level
    // comment claiming it is a guard.
    assert.doesNotMatch(
      selector,
      /as\s+`?currency:/,
      'the selector must derive its key with `satisfies`, never `as`',
    );
    assert.match(
      selector,
      /satisfies\s+`currency:\$\{CurrencyKey\}`/,
      'the selector must narrow its i18n key with `satisfies`',
    );
  });

  await test('currency.tsx carries no region-default badge (REQ-6.6)', () => {
    assert.doesNotMatch(
      selector,
      /regionDefault|region_default|\bdefault:\s*true/i,
      'no region-default marker may reappear in the selector',
    );
  });

  // ── 4. create-only seeding survives a refactor ──────────────────────────
  console.log('\n[tests] profile creation seeds, never clobbers\n');

  const profileSync = readFileSync(join(root, 'src', 'lib', 'auth', 'profile-sync.ts'), 'utf8');

  await test('ensureProfileCurrency INSERTS and never upserts', () => {
    const body = sliceFunction(profileSync, 'ensureProfileCurrency');
    assert.match(body, /\.insert\(/, 'ensureProfileCurrency must stay a create-only .insert()');
    assert.doesNotMatch(
      body,
      /\.upsert\(/,
      'a .upsert() here would overwrite a currency the user already chose',
    );
    assert.doesNotMatch(
      body,
      /\.update\(/,
      'a .update() here would overwrite a currency the user already chose',
    );
  });

  await test("ensureProfile's payload still carries no currency", () => {
    const body = sliceFunction(profileSync, 'ensureProfile');
    // `ensureProfile` legitimately .upsert()s the profile row; what it must
    // never do is put a currency in that payload, or every sign-in would
    // silently reset the user's choice.
    assert.doesNotMatch(
      body,
      /currency/i,
      'ensureProfile must not mention currency — the region seed owns that column',
    );
  });

  await test('use-settings-store seeds USD, not the legacy UYU', () => {
    const store = readFileSync(join(root, 'src', 'stores', 'use-settings-store.ts'), 'utf8');
    assert.match(
      store,
      /currency:\s*'USD'/,
      "the settings store's pre-hydration seed must be the universal default",
    );
    assert.doesNotMatch(
      store,
      /currency:\s*'UYU'/,
      'the legacy UYU seed must not come back as the store default',
    );
  });

  // ── 5. NFR-1: the invariant is enforced in code, not in a constraint ────
  console.log('\n[tests] NFR-1 — no currency CHECK constraint\n');

  await test('no migration constrains currency to an IN (...) list', () => {
    const migrationsDir = join(root, 'supabase', 'migrations');
    const offenders = [];
    for (const file of readdirSync(migrationsDir)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
        .replace(/--[^\n]*/g, ''); // strip line comments before scanning
      if (/check\s*\([^)]*currency[^)]*\bin\s*\(/i.test(sql)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `currency CHECK constraints found in: ${offenders}`);
  });

  console.log(
    `\n[currency-catalog] ${passed} passed, ${failed} failed` +
      (failed ? '' : ' — the catalog has exactly one source of truth'),
  );
  if (failed > 0) process.exit(1);
}

run().then(
  () => rmSync(workdir, { recursive: true, force: true }),
  (err) => {
    rmSync(workdir, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
  },
);