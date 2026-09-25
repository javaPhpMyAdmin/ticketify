#!/usr/bin/env node
/**
 * Node harness for `validateConfirmPassword` from
 * `src/lib/auth/validation.ts` and the related `validateSignUpPassword`
 * parity checks.
 *
 * Pure-source pins + behavioral table (mirrors the pickStatusIndex
 * pattern in test-boot-splash.mjs):
 *
 *   - `validateConfirmPassword` is exported with the exact signature
 *     `(value: string, original: string)`.
 *   - The `PasswordErrorKey` union includes `passwordMismatch` so the
 *     existing screens' template-literal `t(\`auth:${passwordFieldError}\`)`
 *     still typechecks.
 *   - The new nullish guard at the top of `validateConfirmPassword`
 *     makes empty / null / undefined input ALWAYS map to
 *     `passwordRequired` (the screen surfaces that as
 *     "Confirmá tu contraseña." rather than as the
 *     "Las contraseñas no coinciden" mismatch copy — semantically,
 *     a missing value is a required-field error, not a mismatch).
 *   - The mismatch branch fires only for non-empty mismatched pairs
 *     (covers the leading-space and trailing-space cases).
 *
 * Compiles the module with an isolated tsconfig (no project imports —
 * the validators are framework-free) and asserts the contract table
 * below.
 *
 * Usage: pnpm test:auth-validation
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.auth-validation-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'auth-validation-test-'));
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

async function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

let validateConfirmPassword;

async function run() {
  console.log('\n[tests] compiling auth validation module…');
  await compile();
  console.log('[tests] loading compiled module…');
  ({ validateConfirmPassword } = await import(
    pathToFileURL(
      join(outDir, 'src/lib/auth/validation.js'),
    ).href
  ));

  console.log('\n[tests] validateConfirmPassword — behavior table\n');

  // Table-driven rows: [name, value, original, expected]
  //
  // Contract:
  //   - Empty / null / undefined `value` ALWAYS maps to `passwordRequired`
  //     (a missing value is a "must enter the field" error, not a
  //     mismatch — the screen renders different copy).
  //   - Non-empty value that differs from `original` → `passwordMismatch`.
  //   - Non-empty value equal to `original` → null (passes).
  //   - Leading / trailing whitespace on either side flips equality
  //     (the helper does not auto-trim; trimming lives in `validateEmail`).
  const TABLE = [
    ["('', '') → passwordRequired", '', '', 'passwordRequired'],
    ["('', 'x') → passwordRequired (empty wins over mismatch)", '', 'x', 'passwordRequired'],
    ["(' ', 'x') → passwordMismatch (non-empty whitespace)", ' ', 'x', 'passwordMismatch'],
    ["('abc', 'abc') → null (passes)", 'abc', 'abc', null],
    ["('abc ', 'abc') → passwordMismatch (trailing whitespace differs)", 'abc ', 'abc', 'passwordMismatch'],
    ["('abc', 'abcd') → passwordMismatch (length differs)", 'abc', 'abcd', 'passwordMismatch'],
    ['(null, \'x\') → passwordRequired (nullish guard)', null, 'x', 'passwordRequired'],
    ['(undefined, \'x\') → passwordRequired (nullish guard)', undefined, 'x', 'passwordRequired'],
    ["('a', null) → passwordMismatch (non-empty vs null original)", 'a', null, 'passwordMismatch'],
  ];

  for (const [name, value, original, expected] of TABLE) {
    await test(name, () => {
      assert.equal(
        validateConfirmPassword(value, original),
        expected,
        `validateConfirmPassword(${JSON.stringify(value)}, ${JSON.stringify(original)}) must return ${JSON.stringify(expected)}`,
      );
    });
  }

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
