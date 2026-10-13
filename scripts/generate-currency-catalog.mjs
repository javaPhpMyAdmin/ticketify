#!/usr/bin/env node
/**
 * Deterministic currency-catalog generator.
 *
 * ONE implementation, ONE shipped file: this module is both the library the
 * harness can drive and the CLI `node scripts/generate-currency-catalog.mjs`
 * that rewrites every derived artifact from the canonical catalog module
 * `scripts/currency-catalog.ts` — no hand-edited generated regions, no drift
 * between what the catalog declares and what ships.
 *
 * `loadCatalog()` REALLY loads the catalog:
 *   1. Node >= 22.18 strips `.ts` types natively, so it first imports the
 *      module directly;
 *   2. on any failure (older Node, `ERR_UNKNOWN_FILE_EXTENSION`, …) it falls
 *      back to a single-file `tsc` compile into a temp `.mjs` and imports that;
 *   3. if BOTH fail it THROWS — there is no stub and no silent fallback.
 *
 * Rendered artifacts (`renderFormatBlocks`, `renderParseArray`,
 * `renderCurrencyJson`, `renderMigration`) are pure functions of the catalog,
 * so write mode and `--check` produce byte-identical output. `--check` reads
 * each on-disk artifact, renders the expected bytes and exits non-zero on the
 * first mismatch — it never just prints "ok".
 *
 * Usage:
 *   node scripts/generate-currency-catalog.mjs           # write all outputs
 *   node scripts/generate-currency-catalog.mjs --check   # fail on drift
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const CATALOG_TS = join(__dirname, 'currency-catalog.ts');
const FULL_LOCALES = ['en', 'es-419', 'pt-BR'];

const TARGET = {
  format: join(root, 'src', 'lib', 'format.ts'),
  parse: join(root, 'supabase', 'functions', 'parse-ticket', 'lib', 'parse.ts'),
  migrationTemplate: join(
    root,
    'supabase',
    'migrations',
    '0046_widen_currency_catalog.sql',
  ),
  migration: join(
    root,
    'supabase',
    'migrations',
    '0047_widen_currency_catalog.sql',
  ),
  currencyJson: (locale) =>
    join(root, 'src', 'i18n', 'locales', locale, 'currency.json'),
};

/** Real catalog loader — native type stripping first, `tsc` fallback, else THROW. */
export async function loadCatalog() {
  try {
    const mod = await import(pathToFileURL(CATALOG_TS).href);
    return mod.CURRENCIES;
  } catch (nativeErr) {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'currency-catalog-gen-'));
    try {
      const tscBin = require.resolve('typescript/bin/tsc');
      execFileSync(
        process.execPath,
        [
          tscBin,
          CATALOG_TS,
          '--outDir',
          tmpRoot,
          '--module',
          'esnext',
          '--target',
          'es2022',
        ],
        { cwd: __dirname, stdio: ['ignore', 'inherit', 'inherit'] },
      );
      const emitted = readFileSync(join(tmpRoot, 'currency-catalog.js'), 'utf8');
      const mjsPath = join(tmpRoot, 'currency-catalog.mjs');
      writeFileSync(mjsPath, emitted);
      return (await import(pathToFileURL(mjsPath).href)).CURRENCIES;
    } catch (compileErr) {
      throw new Error(
        `loadCatalog: could not load ${CATALOG_TS} (native import and tsc ` +
          `fallback both failed).\nNative error: ${nativeErr}\nCompile error: ${compileErr}`,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

/** Emits a single-quoted string unless it contains `'`, then double-quoted. */
function quote(value) {
  return value.includes("'") ? `"${value}"` : `'${value}'`;
}

function sortCodes(entries) {
  return [...entries].map((entry) => entry.code).sort();
}

function setBlock(name, codes) {
  return [
    `export const ${name}: ReadonlySet<string> = new Set([`,
    ...codes.map((code) => `  '${code}',`),
    ']);',
  ].join('\n');
}

/**
 * Renders every `format.ts` region, keyed by the marker BLOCK name. Codes are
 * alphabetical WITHIN each group, exactly like the catalog.
 */
export function renderFormatBlocks(catalog) {
  const byCode = new Map(catalog.map((entry) => [entry.code, entry]));
  const latam = sortCodes(catalog.filter((entry) => entry.group === 'LATAM'));
  const intl = sortCodes(catalog.filter((entry) => entry.group === 'INTL'));
  const zero = sortCodes(catalog.filter((entry) => entry.minorUnit === 0));
  const three = sortCodes(catalog.filter((entry) => entry.minorUnit === 3));
  const overrides = sortCodes(catalog.filter((entry) => entry.separatorOverride));
  const all = sortCodes(catalog);

  return {
    LATAM_CURRENCY_CODES: [
      'export const LATAM_CURRENCY_CODES = [',
      ...latam.map((code) => `  '${code}', // ${byCode.get(code).labels.en}`),
      '] as const;',
    ].join('\n'),

    INTL_CURRENCY_CODES: [
      'export const INTL_CURRENCY_CODES = [',
      ...intl.map((code) => `  '${code}',`),
      '] as const;',
    ].join('\n'),

    ZERO_DECIMAL_CURRENCIES: setBlock('ZERO_DECIMAL_CURRENCIES', zero),
    THREE_DECIMAL_CURRENCIES: setBlock('THREE_DECIMAL_CURRENCIES', three),
    SEPARATOR_OVERRIDES: setBlock('SEPARATOR_OVERRIDES', overrides),

    CURRENCY_SYMBOL: [
      'export const CURRENCY_SYMBOL: Record<SupportedCurrency, string> = {',
      ...all.map((code) => `  ${code}: ${quote(byCode.get(code).symbol)},`),
      '};',
    ].join('\n'),
  };
}

/**
 * The `parse.ts` duplicate. ORDER is LATAM codes then INTL codes — the
 * `SUPPORTED_CURRENCIES` sequence, NOT a global alphabetical sort.
 */
export function renderParseArray(catalog) {
  const latam = sortCodes(catalog.filter((entry) => entry.group === 'LATAM'));
  const intl = sortCodes(catalog.filter((entry) => entry.group === 'INTL'));
  return [
    'export const SUPPORTED_CURRENCIES = [',
    ...latam.map((code) => `  '${code}',`),
    ...intl.map((code) => `  '${code}',`),
    '] as const;',
  ].join('\n');
}

/** Whole-file JSON: 2-space indent, keys sorted alphabetically, trailing newline. */
export function renderCurrencyJson(catalog, locale) {
  const entries = [...catalog].sort((a, b) => a.code.localeCompare(b.code));
  const obj = {};
  for (const entry of entries) obj[entry.code] = entry.labels[locale];
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** Wraps a flat code list into `indent`-prefixed, `width`-bounded lines. */
function wrapCodes(codes, indent, width) {
  const lines = [];
  let current = indent;
  for (const code of codes) {
    const token = `'${code}',`;
    if (current === indent) {
      current += token;
    } else if (current.length + 1 + token.length <= width) {
      current += ` ${token}`;
    } else {
      lines.push(current);
      current = indent + token;
    }
  }
  if (current !== indent) lines.push(current);
  return lines;
}

function replaceOnce(haystack, needle, replacement) {
  const count = haystack.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(
      `renderMigration: expected exactly one "${needle}" in the 0046 template, found ${count}`,
    );
  }
  return haystack.replace(needle, replacement);
}

/**
 * Renders `0047_widen_currency_catalog.sql` from the 0046 template: copy
 * 0046 VERBATIM, retitle the file, refresh the header count prose, and swap
 * the `v_currency not in (...)` literal for the 123 codes. The function BODY
 * stays byte-identical to 0046 apart from that literal.
 */
export function renderMigration(catalog) {
  let sql = readFileSync(TARGET.migrationTemplate, 'utf8');

  sql = replaceOnce(
    sql,
    '0046_widen_currency_catalog.sql',
    '0047_widen_currency_catalog.sql',
  );
  sql = replaceOnce(sql, '(14 → 28)', '(28 → 123)');
  sql = replaceOnce(
    sql,
    'widened from 14 to 28 ISO 4217',
    'widened from 28 to 123 ISO 4217',
  );
  sql = replaceOnce(
    sql,
    'the seven new LATAM codes and the seven new INTL codes',
    'the two new LATAM codes and the ninety-three new INTL codes',
  );
  sql = replaceOnce(sql, 'reads THIS file (0046)', 'reads THIS file (0047)');

  const latam = sortCodes(catalog.filter((entry) => entry.group === 'LATAM'));
  const intl = sortCodes(catalog.filter((entry) => entry.group === 'INTL'));
  const indent = '      ';
  const latamLines = wrapCodes(latam, indent, 78);
  const intlLines = wrapCodes(intl, indent, 78);
  // 0046 leaves the FINAL code without a trailing comma.
  const lastIndex = intlLines.length - 1;
  intlLines[lastIndex] = intlLines[lastIndex].replace(/,$/, '');
  const literalBody = [
    `${indent}-- LATAM`,
    ...latamLines,
    `${indent}-- INTL`,
    ...intlLines,
  ].join('\n');

  const gate = /v_currency\s+not\s+in\s*\([^)]*\)/;
  if (!gate.test(sql)) {
    throw new Error(
      'renderMigration: could not find the `v_currency not in (...)` gate',
    );
  }
  sql = sql.replace(gate, `v_currency not in (\n${literalBody}\n    )`);

  return sql;
}

/**
 * Replaces the text strictly BETWEEN the two marker lines of `blockName`,
 * keeping both marker lines. THROWS when either marker is missing.
 */
export function writeRegion(content, blockName, replacement) {
  const begin = `// @generated currency-catalog:begin ${blockName}`;
  const end = `// @generated currency-catalog:end ${blockName}`;
  const beginIdx = content.indexOf(begin);
  if (beginIdx === -1) throw new Error(`writeRegion: missing marker "${begin}"`);
  const endIdx = content.indexOf(end);
  if (endIdx === -1) throw new Error(`writeRegion: missing marker "${end}"`);
  if (endIdx < beginIdx) {
    throw new Error(`writeRegion: end marker precedes begin marker for ${blockName}`);
  }
  const afterBegin = beginIdx + begin.length;
  return `${content.slice(0, afterBegin)}\n${replacement}\n${content.slice(endIdx)}`;
}

/** Builds every target's expected on-disk bytes from the catalog. */
function buildTargets(catalog) {
  const blocks = renderFormatBlocks(catalog);

  let format = readFileSync(TARGET.format, 'utf8');
  for (const [blockName, block] of Object.entries(blocks)) {
    format = writeRegion(format, blockName, block);
  }

  const parse = writeRegion(
    readFileSync(TARGET.parse, 'utf8'),
    'SUPPORTED_CURRENCIES',
    renderParseArray(catalog),
  );

  const targets = [
    { name: 'src/lib/format.ts', path: TARGET.format, expected: format },
    {
      name: 'supabase/functions/parse-ticket/lib/parse.ts',
      path: TARGET.parse,
      expected: parse,
    },
    ...FULL_LOCALES.map((locale) => ({
      name: `src/i18n/locales/${locale}/currency.json`,
      path: TARGET.currencyJson(locale),
      expected: renderCurrencyJson(catalog, locale),
    })),
    {
      name: 'supabase/migrations/0047_widen_currency_catalog.sql',
      path: TARGET.migration,
      expected: renderMigration(catalog),
    },
  ];
  return targets;
}

async function main() {
  const check = process.argv.includes('--check');
  const catalog = await loadCatalog();
  const targets = buildTargets(catalog);

  if (check) {
    let drift = 0;
    for (const target of targets) {
      const actual = existsSync(target.path)
        ? readFileSync(target.path, 'utf8')
        : null;
      if (actual !== target.expected) {
        drift += 1;
        console.error(`[generate-currency-catalog] DRIFT: ${target.name}`);
      }
    }
    if (drift > 0) {
      console.error(
        `[generate-currency-catalog] --check failed: ${drift}/${targets.length} target(s) out of date`,
      );
      process.exit(1);
    }
    console.log(
      `[generate-currency-catalog] --check: all ${targets.length} targets match`,
    );
    return;
  }

  for (const target of targets) {
    writeFileSync(target.path, target.expected, 'utf8');
    console.log(`[generate-currency-catalog] wrote ${target.name}`);
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
