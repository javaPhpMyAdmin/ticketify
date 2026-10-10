#!/usr/bin/env node
/**
 * Single-source-of-truth harness for the currency-universality catalog (AD-6).
 *
 * This harness enforces STRUCTURAL invariants (key-set equality, catalog
 * membership, region-map coverage, ordering). The fourteen supported codes are
 * authoritative in `SUPPORTED_CURRENCIES` (`src/lib/format.ts`); everything
 * else (symbol table, three full-locale `currency.json` catalogs, region
 * defaults, settings selector) must derive from that source. Label
 * TRANSLATION quality is not automatable and is not pretended to be. A
 * wrong-but-different label is out of scope for this harness.
 *
 * §3b is the one deliberate exception to "structural only": the picker's
 * selected-row decision was extracted into `src/lib/currency-selection.ts`, a
 * PURE and dependency-free module, precisely so it could be pinned
 * BEHAVIORALLY here. A regex over `currency.tsx` can prove the text still says
 * `code === currency`; it can never observe which rows actually render as
 * selected, which is where the reported regression lived.
 *
 * The leaf-count pin (799) belongs to
 * `scripts/test-i18n-catalog-parity.mjs`, and duplicating it here would create
 * a second place to update on the next catalog bump.
 *
 * Usage: pnpm test:currency-catalog
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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

/** Every currency code this app has EVER shipped, retired ones INCLUDED.
 *
 *  This is a HAND-MAINTAINED HISTORICAL RECORD, deliberately NOT derived from
 *  `SPEC_LIST`. An earlier revision wrote `const CATALOG_LEDGER = [...SPEC_LIST]`
 *  and the guard was inert: `SPEC_LIST` is pinned equal to the live catalog, so
 *  a maintainer who retires a code properly — dropping it from
 *  `SUPPORTED_CURRENCIES` AND from `SPEC_LIST`, which the ~8 required edits
 *  amount to — deletes it from a derived ledger too, and there is nothing left
 *  to flag. A ledger that shrinks with the thing it audits cannot audit it.
 *  So: hand-write the codes. Once a code appears here it stays here forever,
 *  even after it leaves the catalog. `retirementProblems` below then requires
 *  every one of them to be either still live or retired with a real backfill.
 *
 *  Why this matters at all: `ensureProfileCurrency` is INSERT-only, so it can
 *  never repair a profile whose stored `currency` has left the catalog. That
 *  row keeps a code no picker row matches (zero selected rows — the `CHF` case
 *  pinned in §3b) until a human taps a valid row, silently re-basing every
 *  amount in the app. Retiring a currency can therefore strand real profiles.
 *  `tsc` does stop the SLOPPY shrink (`Record<SupportedCurrency, string>` and
 *  the region map are exact types), but a clean shrink compiles fine. Nothing at
 *  the storage layer catches it: `profiles.currency` is deliberately free text
 *  (0041) and §5 forbids a CHECK constraint.
 *
 *  EDITING RULES: add a code here only if the app has shipped it. To retire a
 *  live code, do NOT remove it from this array — register it in
 *  `RETIRED_CURRENCIES` below.
 *
 *  RESIDUAL HOLE, stated plainly rather than papered over: removing a code from
 *  THIS array and from the catalog in the same change is self-consistent, so
 *  no assertion fires. There is no external record of what was once shipped, so
 *  this guard cannot close that path — review is the only defense. An edit to
 *  this array is therefore a ledger change, and should be reviewed as one. */
const CATALOG_LEDGER = [
  'ARS', 'AUD', 'BRL', 'CAD', 'CLP', 'COP', 'EUR',
  'GBP', 'JPY', 'MXN', 'PEN', 'PYG', 'USD', 'UYU',
];

/** Retired code -> the migration file in `supabase/migrations/` that rewrites
 *  `profiles.currency` for everyone still holding that code.
 *
 *  EMPTY TODAY, and the harness says so in its output rather than letting four
 *  green lines imply active protection: with no retirements, three of the §1b
 *  checks have nothing to iterate. That is why §1b also drives
 *  `retirementProblems` with SYNTHETIC fixtures — each failure mode below is
 *  proven to be caught today, instead of shipping a guard that has never run and
 *  breaking for the first time during an actual retirement.
 *
 *  Populate on the change that retires a code, e.g. after a backfill lands:
 *
 *    const RETIRED_CURRENCIES = {
 *      COP: '0042_currency_retire_cop.sql',
 *    }; */
const RETIRED_CURRENCIES = {};

/** Validates the retirement ledger. Returns an array of human-readable
 *  problems; empty means consistent.
 *
 *  `readMigration(file)` returns the migration's SQL, or `null` when the file
 *  does not exist. It is injected so §1b can exercise every failure mode against
 *  fixtures without touching the real migrations directory.
 *
 *  This is deliberately a FLOOR, not proof of a backfill. It can only require
 *  that the named migration exists and contains an UPDATE that writes the
 *  currency column while mentioning the code — it cannot prove the UPDATE
 *  targets the right rows, or that anyone ran it. Do not describe it as more. */
function retirementProblems({ ledger, live, retired, readMigration }) {
  const problems = [];
  const liveSet = new Set(live);
  const retiredKeys = Object.keys(retired);

  const stranded = ledger.filter(
    (code) => !liveSet.has(code) && !retiredKeys.includes(code),
  );
  if (stranded.length > 0) {
    problems.push(
      `these codes left SUPPORTED_CURRENCIES but appear in neither the live ` +
        `catalog nor RETIRED_CURRENCIES, so every profile still storing one is ` +
        `stranded with no selectable row: ${stranded.join(', ')}. Register each ` +
        `in RETIRED_CURRENCIES naming the migration that rewrites its holders, ` +
        `or put it back in SUPPORTED_CURRENCIES.`,
    );
  }

  if (ledger.length !== live.length + retiredKeys.length) {
    problems.push(
      `CATALOG_LEDGER holds ${ledger.length} codes but the live catalog ` +
        `(${live.length}) plus RETIRED_CURRENCIES (${retiredKeys.length}) ` +
        `account for ${live.length + retiredKeys.length}. Retiring a code means ` +
        `registering it, not deleting it from the ledger.`,
    );
  }

  const stillLive = retiredKeys.filter((code) => liveSet.has(code));
  if (stillLive.length > 0) {
    problems.push(
      `these codes are registered as retired but still ship in ` +
        `SUPPORTED_CURRENCIES: ${stillLive.join(', ')}`,
    );
  }

  for (const [code, file] of Object.entries(retired)) {
    const sql = readMigration(file);
    if (sql === null) {
      problems.push(
        `retiring ${code} names migration ${file}, which does not exist in ` +
          `supabase/migrations/ — stranded profiles need a real backfill`,
      );
      continue;
    }
    // Strip line comments BEFORE scanning, but NOT inside string literals:
    // otherwise `-- SCOPE` satisfies a search for `COP` (0041's only mention of
    // COP is inside that word, and 0041 rewrites no rows), while a naive strip
    // would also eat `--` inside a literal and truncate a real statement —
    // `set notes = 'a -- b', currency = 'USD'` lost its currency assignment that
    // way. Quoted strings are matched first and kept, `''` escapes included.
    // KNOWN LIMIT: a `--` inside a dollar-quoted body ($$...$$) is still treated
    // as a comment, which can only cause a false REJECT of a valid backfill, not
    // a false accept — the safe direction to err in.
    const stripped = sql.replace(/'(?:''|[^'])*'|--[^\n]*/g, (m) =>
      m.startsWith("'") ? m : '',
    );
    if (!new RegExp(`\\b${code}\\b`, 'i').test(stripped)) {
      problems.push(
        `${file} is named as the backfill for ${code} but never references ` +
          `${code} outside a comment; it cannot be the migration that repairs ` +
          `its holders`,
      );
      continue;
    }
    // Require an ACTUAL assignment to the currency column inside a SET clause.
    // A bare "the word currency appears after SET" is not enough:
    // `update profiles set notes = 'x' where currency = 'COP'` mentions currency
    // only in its WHERE and backfills nothing. Every SET clause in the file is
    // considered, so a migration with a `set search_path` preamble plus a real
    // backfill still passes.
    const writesCurrency = [...stripped.matchAll(/\bset\b([\s\S]*?)(?:\bwhere\b|\bfrom\b|\breturning\b|;|$)/gi)]
      .some((m) => /\bcurrency\b\s*=/i.test(m[1]));
    if (!writesCurrency) {
      problems.push(
        `${file} mentions ${code} but never ASSIGNS the currency column in any ` +
          `SET clause; a mention, or an update that writes a different column, ` +
          `is not a backfill`,
      );
    }
  }

  return problems;
}

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
  const { isCurrencySelected } = await import(
    pathToFileURL(join(outDir, 'src', 'lib', 'currency-selection.js')).href
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

  // ── 1a. the 0042 SQL re-check literal tracks the catalog ────────────────
  // The migration's `v_currency not in (...)` gate is the server-side copy
  // of this list (see the comment above it). It cannot import src/, so it
  // is pinned here against the compiled source of truth — an edit to either
  // side that makes them disagree fails this harness.

  console.log('\n[tests] 0042 SQL catalog literal tracks SUPPORTED_CURRENCIES\n');

  await test('0042 `v_currency not in (...)` literal === SUPPORTED_CURRENCIES', () => {
    const sql = readFileSync(
      join(root, 'supabase', 'migrations', '0042_receipt_currency.sql'),
      'utf8',
    );
    const gate = /v_currency not in \(([\s\S]*?)\) then/.exec(sql);
    assert.ok(gate, '0042 catalog re-check (v_currency not in (...)) not found');
    const sqlCodes = [...gate[1].matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]);
    assert.deepEqual(
      [...sqlCodes].sort(),
      [...codes].sort(),
      '0042 SQL catalog literal drifted from SUPPORTED_CURRENCIES (src/lib/format.ts)',
    );
    assert.equal(
      new Set(sqlCodes).size,
      sqlCodes.length,
      '0042 SQL catalog literal has duplicate codes',
    );
  });

  // ── 1b. retirement ledger: a code may not leave the catalog unaccounted for
  // `ensureProfileCurrency` is INSERT-only, so a profile whose stored code left
  // the catalog is never repaired: the picker selects zero rows and only a
  // manual tap recovers it. The storage layer cannot catch that (currency is
  // free text by design, §5 forbids a CHECK constraint), so a shrink is caught
  // HERE or not at all.

  const migrationsDir = join(root, 'supabase', 'migrations');
  const readRealMigration = (file) => {
    const full = join(migrationsDir, file);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  };

  console.log(
    `\n[tests] retirement ledger (retirements registered: ` +
      `${Object.keys(RETIRED_CURRENCIES).length})`,
  );
  if (Object.keys(RETIRED_CURRENCIES).length === 0) {
    console.log(
      '  note: no currency has ever been retired, so the per-migration checks ' +
        'below have nothing to iterate against the REAL registry. The synthetic ' +
        'fixtures that follow still exercise every failure mode.',
    );
  }

  await test('the retirement ledger is consistent', () => {
    assert.deepEqual(
      retirementProblems({
        ledger: CATALOG_LEDGER,
        live: codes,
        retired: RETIRED_CURRENCIES,
        readMigration: readRealMigration,
      }),
      [],
    );
  });

  // The validator above is only worth trusting if it rejects bad input, so each
  // failure mode is driven through a fixture. This is what makes an empty
  // RETIRED_CURRENCIES safe to ship: the guard is exercised today rather than
  // for the first time during a live retirement.
  const LIVE_14 = [...SPEC_LIST];
  // Fixtures retire COP because it is genuinely in the catalog — an earlier
  // draft used CHF, which the catalog never shipped, so every fixture silently
  // produced zero problems and every "rejects" assertion passed vacuously.
  const BACKFILL = "update profiles set currency = 'USD' where currency = 'COP';";
  const without = (code) => LIVE_14.filter((c) => c !== code);
  const fixture = (files) => (file) =>
    Object.prototype.hasOwnProperty.call(files, file) ? files[file] : null;
  // Assert the mode is REPORTED, not the exact count: one bad state can trip
  // several rules at once (a stray retirement also breaks the ledger identity),
  // and pinning the count would make these tests brittle without making them
  // stricter about the thing that matters.
  const assertReports = (problems, pattern) => {
    assert.ok(
      problems.some((p) => pattern.test(p)),
      `expected a problem matching ${pattern}; got ${JSON.stringify(problems)}`,
    );
  };

  await test('the validator rejects a code stranded by a catalog shrink', () => {
    const problems = retirementProblems({
      ledger: CATALOG_LEDGER,
      live: without('COP'),
      retired: {},
      readMigration: fixture({}),
    });
    assertReports(problems, /stranded/);
    assertReports(problems, /COP/);
  });

  await test('the validator rejects a retirement with no migration', () => {
    const problems = retirementProblems({
      ledger: CATALOG_LEDGER,
      live: without('COP'),
      retired: { COP: '9999_absent.sql' },
      readMigration: fixture({}),
    });
    assertReports(problems, /does not exist/);
  });

  await test('the validator rejects a migration that only mentions the code', () => {
    // The real 0041 trap: its only occurrence of `COP` is inside `-- SCOPE`, and
    // it rewrites no rows. A substring search passes this; a comment-stripped
    // search does not.
    const problems = retirementProblems({
      ledger: CATALOG_LEDGER,
      live: without('COP'),
      retired: { COP: 'scope_only.sql' },
      readMigration: fixture({
        'scope_only.sql': '-- SCOPE: retire COP\nselect 1;\n',
      }),
    });
    assertReports(problems, /never references COP/);
  });

  await test('the validator rejects a migration that rewrites no rows', () => {
    const problems = retirementProblems({
      ledger: CATALOG_LEDGER,
      live: without('COP'),
      retired: { COP: 'mention_only.sql' },
      readMigration: fixture({ 'mention_only.sql': "select 'COP';\n" }),
    });
    assertReports(problems, /never ASSIGNS/);
  });

  await test('the validator rejects an update that writes a different column', () => {
    // The word `currency` appears, but only in the WHERE clause. A naive
    // "UPDATE ... SET ... currency" proximity check accepts this and a stranded
    // profile gets no backfill at all.
    const problems = retirementProblems({
      ledger: CATALOG_LEDGER,
      live: without('COP'),
      retired: { COP: 'wrong_column.sql' },
      readMigration: fixture({
        'wrong_column.sql': "update profiles set notes = 'x' where currency = 'COP';\n",
      }),
    });
    assertReports(problems, /never ASSIGNS/);
  });

  await test('the validator survives a comment marker inside a string literal', () => {
    // A naive `--` strip truncates this at the `--` and loses the currency
    // assignment, wrongly rejecting a perfectly good backfill.
    assert.deepEqual(
      retirementProblems({
        ledger: CATALOG_LEDGER,
        live: without('COP'),
        retired: { COP: 'literal_dash.sql' },
        readMigration: fixture({
          'literal_dash.sql':
            "update profiles set notes = 'a -- b', currency = 'USD' where currency = 'COP';\n",
        }),
      }),
      [],
    );
  });

  await test('the validator accepts a backfill among unrelated statements', () => {
    // Several SET clauses in one file, only one of which writes currency: a
    // `set search_path` preamble must not disqualify the real backfill.
    assert.deepEqual(
      retirementProblems({
        ledger: CATALOG_LEDGER,
        live: without('COP'),
        retired: { COP: '0042_retire_cop.sql' },
        readMigration: fixture({
          '0042_retire_cop.sql': [
            'set search_path = public;',
            "update profiles set display_name = 'x' where id = '1';",
            "update profiles set currency = 'USD' where currency = 'COP';",
          ].join('\n'),
        }),
      }),
      [],
    );
  });

  await test('the validator rejects a retired code that is still live', () => {
    const problems = retirementProblems({
      ledger: CATALOG_LEDGER,
      live: LIVE_14,
      retired: { COP: 'backfill.sql' },
      readMigration: fixture({ 'backfill.sql': BACKFILL }),
    });
    assertReports(problems, /still ship/);
  });

  await test('the validator rejects a ledger edited out of step with the catalog', () => {
    // A ledger that loses a code the catalog still ships is caught by the
    // identity check. The residual hole is documented on CATALOG_LEDGER and is
    // NOT tested here because it is not detectable: dropping a code from the
    // ledger AND the catalog together is self-consistent, so nothing fails and
    // only review catches it.
    const problems = retirementProblems({
      ledger: without('COP'),
      live: LIVE_14,
      retired: {},
      readMigration: fixture({}),
    });
    assertReports(problems, /CATALOG_LEDGER holds/);
  });

  await test('the validator accepts a proper retirement', () => {
    // And the happy path, so the fixtures above cannot be satisfied by simply
    // rejecting everything.
    assert.deepEqual(
      retirementProblems({
        ledger: CATALOG_LEDGER,
        live: without('COP'),
        retired: { COP: '0042_retire_cop.sql' },
        readMigration: fixture({ '0042_retire_cop.sql': BACKFILL }),
      }),
      [],
    );
  });

  await test('the validator accepts a case-insensitive backfill', () => {
    // 0041 is direct evidence that lowercase values exist in the wild, so a
    // correct backfill may well write `lower(currency) = 'cop'`. A
    // case-sensitive check would reject it and train the author to append a
    // comment instead.
    assert.deepEqual(
      retirementProblems({
        ledger: CATALOG_LEDGER,
        live: without('COP'),
        retired: { COP: '0042_retire_cop.sql' },
        readMigration: fixture({
          '0042_retire_cop.sql':
            "update profiles set currency = 'USD' where lower(currency) = 'cop';",
        }),
      }),
      [],
    );
  });

  await test('the catalog order is pinned to the declared sequence', () => {
    assert.deepEqual(
      codes,
      [
        'ARS',
        'BRL',
        'CLP',
        'COP',
        'MXN',
        'PEN',
        'PYG',
        'UYU',
        'AUD',
        'CAD',
        'EUR',
        'GBP',
        'JPY',
        'USD',
      ],
    );
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
  // ── 2b. locale label content — anti-paste guard and the shared-term pin ─
  console.log('\n[tests] locale label content is correct (no English paste)\n');

  // The three per-locale label tables that used to sit here (42 duplicated
  // strings) are GONE, and their absence is the point: they were a second
  // copy of the shipped `currency.json` files that had to be hand-updated in
  // lockstep, and had already drifted. Label content is now read from the
  // shipped files and compared cross-file, so a locale edit cannot leave a
  // stale copy behind asserting the old value. What is still pinned here is
  // what a cross-file comparison cannot express: that the two locales which
  // legitimately share a term with en say so EXPLICITLY.
  //
  // Labels legitimately identical to English are whitelisted here and pinned below.
  const SHARED_TERM_WHITELIST = new Set(['EUR']);

  await test('shared-term exemption is scoped to EUR alone', () => {
    // An EXEMPTION list that can grow silently is not a guard, it is a leak.
    // Demonstrated: add 'USD' here and revert pt-BR.USD to the English
    // "US dollar", and both harnesses stay green — test:currency-catalog (this
    // file) and test:i18n-catalog-parity — while a shipped locale paints an
    // English string. Pinning EUR's three labels only proves the exemption is
    // justified; nothing stopped the NEXT code from being exempted, and the
    // growth is invisible in the diff of a locale file. A new entry has to be
    // argued HERE, in a test that fails until it is.
    assert.deepEqual(
      [...SHARED_TERM_WHITELIST],
      ['EUR'],
      'the shared-term exemption must stay EUR alone: it is the one ISO code whose name is spelled identically in en, es-419 and pt-BR, so it is the only label that may match the English source legitimately',
    );
  });

  await test('anti-paste guard: pt-BR and es-419 differ from en for codes that differ legitimately', () => {
    const en = JSON.parse(
      readFileSync(join(localesDir, 'en', 'currency.json'), 'utf8'),
    );
    const es = JSON.parse(
      readFileSync(join(localesDir, 'es-419', 'currency.json'), 'utf8'),
    );
    const pt = JSON.parse(
      readFileSync(join(localesDir, 'pt-BR', 'currency.json'), 'utf8'),
    );
    const skipSame = SHARED_TERM_WHITELIST;
    for (const code of codes) {
      if (skipSame.has(code)) continue;
      assert.notEqual(pt[code], en[code], `pt-BR.${code} must differ from en.${code}`);
      assert.notEqual(es[code], en[code], `es-419.${code} must differ from en.${code}`);
    }
  });

  await test('shared term exemption pinned: EUR labels are identical', () => {
    const en = JSON.parse(
      readFileSync(join(localesDir, 'en', 'currency.json'), 'utf8'),
    );
    const es = JSON.parse(
      readFileSync(join(localesDir, 'es-419', 'currency.json'), 'utf8'),
    );
    const pt = JSON.parse(
      readFileSync(join(localesDir, 'pt-BR', 'currency.json'), 'utf8'),
    );
    assert.equal(pt.EUR, 'Euro');
    assert.equal(es.EUR, 'Euro');
    assert.equal(en.EUR, 'Euro');
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

  // ── 3b. the picker SELECTS what the store says (behavioral) ─────────────
  //
  // The reported regression was a SELECTION bug, not a formatting bug: a
  // stored lowercase 'usd' (written by an earlier migration) rendered
  // correctly in every money formatter because those case-fold, yet matched
  // no UPPERCASE catalog code, so no row appeared selected and
  // `accessibilityState={{ selected }}` was false for all fourteen. The user
  // could not distinguish "my currency is gone" from "the list doesn't know
  // it", and tapping another row is a SILENT currency change that re-bases
  // every amount in the app.
  //
  // Asserting `useSettingsStore.getState().currency === 'USD'` after hydration
  // (see test-profile-hook.mjs) covers only HALF of that: revert the
  // normalization at the hydration boundary and the store assertion is still
  // green while the bug is back in full. These pins call the predicate the
  // component actually renders with.
  console.log('\n[tests] picker selected-row decision (behavioral)\n');

  const selectedFor = (current) => codes.filter((code) => isCurrencySelected(code, current));

  await test("current 'USD' selects exactly ONE row, and it is USD", () => {
    assert.deepEqual(selectedFor('USD'), ['USD']);
  });

  await test("legacy lowercase 'usd' selects exactly ONE row: USD (the regression)", () => {
    assert.deepEqual(selectedFor('usd'), ['USD']);
    // The mixed-case spelling is the same decision, asserted so a future
    // "normalize to lowercase" edit cannot silently flip the direction.
    assert.deepEqual(selectedFor('uSd'), ['USD']);
  });

  await test('an out-of-catalog current value selects ZERO rows (no fallback row invented)', () => {
    // Pinned, not wished: a currency the catalog does not ship renders an
    // unselected list. The graceful-degradation UI for it is a tracked
    // follow-up; inventing a synthetic row here would hide the gap.
    assert.deepEqual(selectedFor('CHF'), []);
    assert.deepEqual(selectedFor('usd2'), []);
  });

  await test('no current currency selects ZERO rows', () => {
    for (const empty of [null, undefined, '']) {
      assert.deepEqual(selectedFor(empty), [], `${JSON.stringify(empty)} must select nothing`);
    }
  });

  await test('every catalog code is selectable — not a hardcoded truthy table', () => {
    // Guards the failure mode where a predicate is written against a few codes
    // (or is accidentally always true): each code, fed in as the current
    // value, must select ITSELF and nothing else.
    assert.equal(codes.length, 14);
    for (const code of codes) {
      assert.deepEqual(selectedFor(code), [code], `${code} must be selectable`);
    }
  });

  await test('the picker calls the predicate instead of inlining its own compare', () => {
    assert.match(
      selector,
      /const\s+selected\s*=\s*isCurrencySelected\(\s*code\s*,\s*currency\s*\)/,
      'currency.tsx must derive `selected` from the pinned predicate, not re-implement it',
    );
    assert.doesNotMatch(
      selector,
      /const\s+selected\s*=\s*code\s*===/,
      'an inlined case-sensitive `code === currency` is the exact regression being prevented',
    );
  });

  await test('the checkmark and the a11y state read the SAME `selected` value', () => {
    // The comment above `const selected` in currency.tsx promises the visual
    // checkmark and `accessibilityState` "cannot drift apart" because both read
    // that one value. Nothing pinned the promise, and it breaks from inside a
    // single row: `{code === currency.toUpperCase() || selected ? <Icon
    // name="checkmark" …/> : null}` leaves `selected` derived from the pinned
    // predicate, so every behavioral assertion above still passes — while a
    // stored lowercase 'usd' paints the checkmark on a row the predicate does
    // not select, and screen readers are told the opposite. The regression
    // returns with every behavioural pin satisfied. So pin where `selected` is
    // CONSUMED, not only where it is derived.
    const checkmark = /\{([^{}]*?)\?\s*\(\s*<Icon\b[^>]*\bname=["']checkmark["']/.exec(selector);
    assert.ok(checkmark, 'the checkmark Icon must still be rendered by a ternary');
    assert.equal(
      checkmark[1].trim(),
      'selected',
      'the checkmark must be gated on `selected` alone — an inline `code === …` there re-opens the regression while every behavioural pin stays green',
    );
    assert.match(
      selector,
      /accessibilityState=\{\{\s*selected\s*\}\}/,
      '`accessibilityState` must read the same `selected` value as the checkmark',
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