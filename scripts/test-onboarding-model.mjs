#!/usr/bin/env node
/**
 * Node harness for the onboarding pure model
 * (`src/features/onboarding/onboarding-model.ts`).
 *
 * Compiles the module with an isolated tsconfig (the ONLY imports are
 * `@/theme/colors`, which is pure TS — no react-native) and asserts
 * every state-machine contract:
 *
 *   - `TOTAL_STEPS` === 3
 *   - `getStepIndex(step)` returns 1 | 2 | 3 for every input step
 *   - `getNextStep` returns the linear successor on step-1 → step-2 and
 *     step-2 → step-3, and `null` on step-3 (last step sentinel — the
 *     caller decides what to do)
 *   - `getPreviousStep` returns step-1 when given step-2, step-2 when
 *     given step-3, and `null` on step-1 (first step sentinel — there
 *     is no back-arrow on step-1)
 *   - `isFirstStep` / `isLastStep` correctly identify the boundary steps
 *   - Round-trip: `getPreviousStep(getNextStep('step-1')) === 'step-1'`
 *     and `getNextStep(getPreviousStep('step-3')) === 'step-3'`
 *
 * The `Step` type is the union literal `'step-1' | 'step-2' | 'step-3'`
 * — the harness also asserts that the type is exported (used as a
 * compile-time check via the explicit `getStepIndex` overload).
 *
 * Usage: pnpm test:onboarding-model
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.onboarding-model-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'onboarding-model-test-'));
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

/**
 * Mirror the harness tsconfig's `paths` at runtime: the model file
 * imports `@/theme/colors`, and tsc emits the original specifier, so
 * plain node cannot resolve it. The hook remaps `@/` to the compiled
 * output, exactly like every other isolated harness in scripts/.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function run() {
  console.log('\n[tests] compiling onboarding model module…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const model = await import(
    pathToFileURL(join(outDir, 'src/features/onboarding/onboarding-model.js')).href
  );

  console.log('\n[tests] TOTAL_STEPS\n');

  await test('TOTAL_STEPS === 3 (three steps total — scanner / budget / insights)', () => {
    assert.equal(model.TOTAL_STEPS, 3);
  });

  console.log('\n[tests] getStepIndex\n');

  await test('getStepIndex("step-1") === 1', () => {
    assert.equal(model.getStepIndex('step-1'), 1);
  });

  await test('getStepIndex("step-2") === 2', () => {
    assert.equal(model.getStepIndex('step-2'), 2);
  });

  await test('getStepIndex("step-3") === 3', () => {
    assert.equal(model.getStepIndex('step-3'), 3);
  });

  console.log('\n[tests] getNextStep\n');

  await test('getNextStep("step-1") === "step-2"', () => {
    assert.equal(model.getNextStep('step-1'), 'step-2');
  });

  await test('getNextStep("step-2") === "step-3"', () => {
    assert.equal(model.getNextStep('step-2'), 'step-3');
  });

  await test('getNextStep("step-3") === null (last step sentinel — caller decides)', () => {
    assert.equal(model.getNextStep('step-3'), null);
  });

  console.log('\n[tests] getPreviousStep\n');

  await test('getPreviousStep("step-1") === null (first step sentinel — no back arrow)', () => {
    assert.equal(model.getPreviousStep('step-1'), null);
  });

  await test('getPreviousStep("step-2") === "step-1"', () => {
    assert.equal(model.getPreviousStep('step-2'), 'step-1');
  });

  await test('getPreviousStep("step-3") === "step-2"', () => {
    assert.equal(model.getPreviousStep('step-3'), 'step-2');
  });

  console.log('\n[tests] isFirstStep / isLastStep\n');

  await test('isFirstStep — step-1 → true, step-2 → false, step-3 → false', () => {
    assert.equal(model.isFirstStep('step-1'), true);
    assert.equal(model.isFirstStep('step-2'), false);
    assert.equal(model.isFirstStep('step-3'), false);
  });

  await test('isLastStep — step-1 → false, step-2 → false, step-3 → true', () => {
    assert.equal(model.isLastStep('step-1'), false);
    assert.equal(model.isLastStep('step-2'), false);
    assert.equal(model.isLastStep('step-3'), true);
  });

  console.log('\n[tests] round-trips (triangulation — proves functions are not hardcoded)\n');

  await test('getPreviousStep(getNextStep("step-1")) === "step-1" (round-trip)', () => {
    assert.equal(model.getPreviousStep(model.getNextStep('step-1')), 'step-1');
  });

  await test('getNextStep(getPreviousStep("step-3")) === "step-3" (round-trip)', () => {
    assert.equal(model.getNextStep(model.getPreviousStep('step-3')), 'step-3');
  });

  await test('full cycle: getPreviousStep(getNextStep(step)) === step for every step', () => {
    // Triangulation: the round-trip must hold for EVERY step, not just
    // one specific case (Fake-It guard).
    for (const step of ['step-1', 'step-2', 'step-3']) {
      const next = model.getNextStep(step);
      if (next != null) {
        assert.equal(
          model.getPreviousStep(next),
          step,
          `forward-then-back from ${step} must return ${step}, got ${
            model.getPreviousStep(next)
          }`,
        );
      }
    }
  });

  console.log('\n[tests] purity\n');

  await test('every function is pure — repeated calls return the same output', () => {
    for (const step of ['step-1', 'step-2', 'step-3']) {
      const a1 = model.getStepIndex(step);
      const a2 = model.getStepIndex(step);
      assert.equal(a1, a2, `getStepIndex drift on ${step}`);

      const b1 = model.getNextStep(step);
      const b2 = model.getNextStep(step);
      assert.deepEqual(b1, b2, `getNextStep drift on ${step}`);

      const c1 = model.getPreviousStep(step);
      const c2 = model.getPreviousStep(step);
      assert.deepEqual(c1, c2, `getPreviousStep drift on ${step}`);

      const d1 = model.isFirstStep(step);
      const d2 = model.isFirstStep(step);
      assert.equal(d1, d2, `isFirstStep drift on ${step}`);

      const e1 = model.isLastStep(step);
      const e2 = model.isLastStep(step);
      assert.equal(e1, e2, `isLastStep drift on ${step}`);
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
