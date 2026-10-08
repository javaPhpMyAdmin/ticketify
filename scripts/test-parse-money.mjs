#!/usr/bin/env node
/**
 * Node harness for `parseMoney` in `src/lib/parse-money.ts`.
 *
 * Compiles the module with an isolated tsconfig and asserts the truth table
 * from the money-integrity change (REQ-7, decision 10 — symmetric rule).
 *
 * Usage: pnpm test:parse-money
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
const harnessConfig = join(__dirname, 'tsconfig.parse-money-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'parse-money-test-'));
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
  console.log('\n[tests] compiling parse-money module…');
  compile();
  console.log('[tests] loading compiled module…');
  const mod = await import(
    pathToFileURL(join(outDir, 'src', 'lib', 'parse-money.js')).href
  );
  const parseMoney = mod.parseMoney;

  console.log('\n[tests] symmetric separator rule (REQ-7)\n');

  await test('1.234 → 1234 (lone dot with three digits groups thousands)', () => {
    assert.equal(parseMoney('1.234', 'USD'), 1234);
  });

  await test('1,234 → 1234 (lone comma with three digits groups thousands)', () => {
    assert.equal(parseMoney('1,234', 'USD'), 1234);
  });

  await test('45.99 → 45.99 (lone dot with two digits is decimal)', () => {
    assert.equal(parseMoney('45.99', 'USD'), 45.99);
  });

  await test('47.5 → 47.5 (lone dot with one digit is decimal)', () => {
    assert.equal(parseMoney('47.5', 'USD'), 47.5);
  });

  await test('1234,56 → 1234.56 (LATAM comma decimal)', () => {
    assert.equal(parseMoney('1234,56', 'USD'), 1234.56);
  });

  await test('1234.56 → 1234.56 (INTL dot decimal)', () => {
    assert.equal(parseMoney('1234.56', 'USD'), 1234.56);
  });

  await test('1.234,56 → 1234.56 (rightmost is decimal)', () => {
    assert.equal(parseMoney('1.234,56', 'USD'), 1234.56);
  });

  await test('1,234.56 → 1234.56 (rightmost is decimal)', () => {
    assert.equal(parseMoney('1,234.56', 'USD'), 1234.56);
  });

  await test('1.234,56 as ARS → 1234.56 (scenario 6: neither code nor locale moves the result)', () => {
    assert.equal(parseMoney('1.234,56', 'ARS'), 1234.56);
  });

  await test('.5 → 0.5 (leading decimal separator)', () => {
    assert.equal(parseMoney('.5', 'USD'), 0.5);
  });

  await test('5. → 5 (trailing separator, no digits after)', () => {
    assert.equal(parseMoney('5.', 'USD'), 5);
  });

  await test('1234.5678 → 1234.5678 (four digits after → decimal; complement of the 45.999 trade-off)', () => {
    assert.equal(parseMoney('1234.5678', 'USD'), 1234.5678);
  });

  console.log('\n[tests] rejection — empty, no digit, or non [0-9.,] input\n');

  await test('\'\' → null (no digits)', () => {
    assert.equal(parseMoney('', 'USD'), null);
  });

  await test('\'abc\' → null (no digits)', () => {
    assert.equal(parseMoney('abc', 'USD'), null);
  });

  await test('\'12abc\' → null (design: reject non ^[0-9.,]+$)', () => {
    assert.equal(parseMoney('12abc', 'USD'), null);
  });

  await test('\'$45.99\' → null (design: reject non ^[0-9.,]+$)', () => {
    assert.equal(parseMoney('$45.99', 'USD'), null);
  });

  console.log('\n[tests] zero-decimal rounding — currencyCode is the only knob\n');

  await test('45.99 as JPY → 46 (zero-decimal rounds to the whole unit)', () => {
    assert.equal(parseMoney('45.99', 'JPY'), 46);
  });

  await test('45.4 as JPY → 45 (half-down boundary)', () => {
    assert.equal(parseMoney('45.4', 'JPY'), 45);
  });

  await test('45.99 as COP → 45.99 (COP stays 2-decimal — Non-Goal)', () => {
    assert.equal(parseMoney('45.99', 'COP'), 45.99);
  });

  console.log('\n[tests] currency independence — the API exposes no locale knob\n');

  await test('1,234 returns 1234 under ARS and USD alike', () => {
    assert.equal(parseMoney('1,234', 'ARS'), 1234);
    assert.equal(parseMoney('1,234', 'USD'), 1234);
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  rmSync(workdir, { recursive: true, force: true });

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
