#!/usr/bin/env node
/**
 * Node harness for the display-only category-name truncation
 * (`truncateCategoryName` + `DISPLAY_MAX_CATEGORY_NAME_LENGTH` in
 * `src/lib/format.ts`).
 *
 * Device-testing feedback: when a user scans a ticket and creates a NEW
 * category whose name is long (exceeds 14 characters), the name must be
 * displayed trimmed with the unicode ellipsis `…` (U+2026) — the same
 * single-char ellipsis the i18n catalogs use ("Cargando…", "Loading…").
 * Truncation is DISPLAY-ONLY: the helper never mutates the stored name —
 * it is applied at render time, and the full name keeps being saved.
 *
 * Compiles the module into a temp directory with an isolated tsconfig
 * (same mechanism as test-format.mjs) and pins the pure contract with
 * FIXED inputs:
 *
 *   - a name that fits (<= maxLength) is returned UNCHANGED,
 *   - a name that exceeds maxLength becomes `slice(0, maxLength - 1) + '…'`
 *     (the ellipsis is ONE char, so the visible result is exactly
 *     `maxLength` chars),
 *   - empty input stays empty,
 *   - a name of EXACTLY `maxLength` chars is untouched (not truncated),
 *   - the `maxLength` parameter is honored when passed explicitly,
 *   - the default display cap is the named constant 14.
 *
 * Strict TDD: the harness was written FIRST (RED — the exports do not
 * exist yet, so every assertion fails with `undefined`); the GREEN landed
 * the two exports in `src/lib/format.ts`. Chained into `pnpm test`.
 *
 * Usage: pnpm test:truncate-category-name
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.truncate-category-name-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'truncate-category-name-test-'));
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

async function run() {
  console.log('\n[tests] compiling format module (truncateCategoryName)…');
  compile();
  console.log('[tests] loading compiled module…');
  const fmt = await import(
    pathToFileURL(join(outDir, 'src', 'lib', 'format.js')).href
  );

  const ELLIPSIS = '\u2026'; // '…' — the single-char ellipsis U+2026.

  await test('DISPLAY_MAX_CATEGORY_NAME_LENGTH is the default cap 14', () => {
    assert.equal(fmt.DISPLAY_MAX_CATEGORY_NAME_LENGTH, 14);
  });

  await test('default maxLength is 14 (a 14-char name is NOT truncated)', () => {
    assert.equal(
      fmt.truncateCategoryName('abcdefghijklmn'), // exactly 14 chars
      'abcdefghijklmn',
    );
  });

  await test('name that fits is returned unchanged (full name kept)', () => {
    assert.equal(fmt.truncateCategoryName('Bebidas'), 'Bebidas');
    assert.equal(fmt.truncateCategoryName('Delivery'), 'Delivery');
  });

  await test('name over 14 chars → slice(0, 13) + single-char ellipsis', () => {
    // 15 chars: 13 kept + 1 ellipsis char = 14 visible chars.
    assert.equal(
      fmt.truncateCategoryName('abcdefghijklmno'),
      'abcdefghijklm' + ELLIPSIS,
    );
    // A realistic long user-created category name (25 chars).
    assert.equal(
      fmt.truncateCategoryName('Supermercado Mayorista Central'),
      'Supermercado ' + ELLIPSIS,
    );
  });

  await test('every truncated result is exactly maxLength chars and ends with …', () => {
    for (const name of ['abcdefghijklmno', 'a'.repeat(40), 'a'.repeat(100)]) {
      const out = fmt.truncateCategoryName(name);
      assert.equal(out.length, 14, `${name.length}-char input -> 14 visible`);
      assert.equal(out.endsWith(ELLIPSIS), true, 'ends with the U+2026 ellipsis');
      assert.equal(out.includes('...'), false, 'never three ASCII dots');
    }
  });

  await test('empty string stays empty', () => {
    assert.equal(fmt.truncateCategoryName(''), '');
  });

  await test('explicit maxLength parameter is honored', () => {
    assert.equal(fmt.truncateCategoryName('abcdefghij', 5), 'abcd' + ELLIPSIS);
    assert.equal(fmt.truncateCategoryName('abcde', 5), 'abcde');
  });

  await test('stored name is never mutated (display-only contract)', () => {
    const stored = 'abcdefghijklmno';
    const out = fmt.truncateCategoryName(stored);
    assert.equal(stored, 'abcdefghijklmno', 'source string untouched');
    assert.equal(out, 'abcdefghijklm' + ELLIPSIS);
  });

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