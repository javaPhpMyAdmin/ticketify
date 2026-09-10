#!/usr/bin/env node
/**
 * Node harness for the device-locale detector (`src/i18n/detector.ts`,
 * PR 1, REQ-2 / NFR-4). The detector is a pure function exported from
 * a module that pulls in ZERO runtime dependencies — only the type
 * `SupportedLocale` from the module's barrel. We compile the file
 * directly with `tsc` and assert the 10 mapping cases from the
 * spec / design.md AD-1.
 *
 * Determinism: no clock, no `Intl`, no environment — every case is a
 * fixed input → fixed output pair. The module imports the empty
 * `localeSecureStore` chain only via its public type surface; the
 * runtime graph is the detector file alone.
 *
 * Usage: pnpm test:i18n-detector
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
const harnessConfig = join(__dirname, 'tsconfig.i18n-detector-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'i18n-detector-test-'));
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
  console.log('\n[tests] compiling detector module…');
  compile();
  console.log('[tests] loading compiled module…');
  const mod = await import(
    pathToFileURL(join(outDir, 'src/i18n/detector.js')).href
  );

  console.log('\n[tests] REQ-2 mapping cases\n');

  await test('pt-BR → pt-BR', () => {
    assert.equal(mod.detectLocale('pt-BR'), 'pt-BR');
  });

  await test('pt-PT → pt-BR (any Portuguese tag maps to pt-BR)', () => {
    assert.equal(mod.detectLocale('pt-PT'), 'pt-BR');
  });

  await test('en-US → en (any English tag maps to en)', () => {
    assert.equal(mod.detectLocale('en-US'), 'en');
  });

  await test('en-GB → en', () => {
    assert.equal(mod.detectLocale('en-GB'), 'en');
  });

  await test('es-AR → es-AR', () => {
    assert.equal(mod.detectLocale('es-AR'), 'es-AR');
  });

  await test('es-MX → es-AR (safety fallback — voseo is Argentina-only)', () => {
    assert.equal(mod.detectLocale('es-MX'), 'es-AR');
  });

  await test('fr-FR → es-AR (default fallback for any other tag)', () => {
    assert.equal(mod.detectLocale('fr-FR'), 'es-AR');
  });

  await test('undefined → es-AR (default — no device locale available)', () => {
    assert.equal(mod.detectLocale(undefined), 'es-AR');
  });

  await test('"" → es-AR (default — empty string)', () => {
    assert.equal(mod.detectLocale(''), 'es-AR');
  });

  await test('xx-XX → es-AR (unknown tag falls through to default)', () => {
    assert.equal(mod.detectLocale('xx-XX'), 'es-AR');
  });

  console.log('\n[tests] detector surface\n');

  await test('DEFAULT_LOCALE export is es-AR (mirrors fallbackLng in config.ts)', () => {
    assert.equal(mod.DEFAULT_LOCALE, 'es-AR');
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});