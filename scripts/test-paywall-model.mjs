#!/usr/bin/env node
/**
 * Node harness for the paywall per-button busy model
 * (`src/features/pro/paywall-model.ts` → `isPlanBusy`, `planCaptionColor`).
 *
 * Compiles the module with an isolated tsconfig (the ONLY imports are
 * `@/theme/colors`, which is pure TS — no react-native) and asserts two
 * contracts from the paywall busy-regression fix:
 *
 *   `isPlanBusy(plan, purchasingPlan, state)` — per-plan busy spinner:
 *     - The shared `state === 'purchasing'` flag is NOT per-button: it
 *       drives BOTH plan buttons at once, so a monthly tap spun the
 *       annual (emphasis) button too — the white Spinner on the emerald
 *       background read as a "white rectangle". The fixed contract:
 *       exactly ONE plan shows busy, the one being purchased.
 *     - `purchasingPlan === plan && state === 'purchasing'` is the ONLY
 *       busy combination. Any other state (`loading` / `ready` / `error`)
 *       means neither button is busy, even if `purchasingPlan` was set
 *       earlier (stale after the purchase resolved).
 *
 *   `planCaptionColor(emphasis)` — emphasis caption contrast:
 *     - The intro caption ("X días gratis…") originally used
 *       `styles.planButtonCaption` with `color: colors.primary` for BOTH
 *       buttons. On the emphasis (emerald) button that is emerald-on-
 *       emerald — invisible. The fixed contract: the emphasis caption
 *       uses `colors.onPrimary` (white), the non-emphasis caption keeps
 *       `colors.primary`.
 *
 * Usage: pnpm test:paywall-model
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.paywall-model-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'paywall-model-test-'));
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
 * Mirror the harness tsconfig's `paths` at runtime: `paywall-model.ts`
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
  console.log('\n[tests] compiling paywall model module…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const { isPlanBusy, planCaptionColor } = await import(
    pathToFileURL(join(outDir, 'src/features/pro/paywall-model.js')).href
  );

  console.log('\n[tests] isPlanBusy — exactly one plan busy at a time\n');

  await test('monthly being purchased → ONLY monthly busy (the regression: annual must NOT spin)', () => {
    assert.equal(isPlanBusy('monthly', 'monthly', 'purchasing'), true);
    assert.equal(
      isPlanBusy('annual', 'monthly', 'purchasing'),
      false,
      'annual must NOT show busy while monthly is being purchased',
    );
  });

  await test('annual being purchased → ONLY annual busy (symmetric)', () => {
    assert.equal(isPlanBusy('annual', 'annual', 'purchasing'), true);
    assert.equal(
      isPlanBusy('monthly', 'annual', 'purchasing'),
      false,
      'monthly must NOT show busy while annual is being purchased',
    );
  });

  await test('no plan in flight → neither plan busy, even in purchasing state', () => {
    assert.equal(isPlanBusy('monthly', null, 'purchasing'), false);
    assert.equal(isPlanBusy('annual', null, 'purchasing'), false);
  });

  await test('state=loading → neither busy (offerings fetch in flight)', () => {
    assert.equal(isPlanBusy('monthly', 'monthly', 'loading'), false);
    assert.equal(isPlanBusy('annual', 'annual', 'loading'), false);
  });

  await test('state=ready → neither busy (idle, even if purchasingPlan is stale)', () => {
    // A purchase that RESOLVED leaves `purchasingPlan` set unless the
    // screen clears it; the button must not spin once state leaves
    // 'purchasing'.
    assert.equal(isPlanBusy('monthly', 'monthly', 'ready'), false);
    assert.equal(isPlanBusy('annual', 'annual', 'ready'), false);
  });

  await test('state=error → neither busy (purchase failed, buttons re-enabled)', () => {
    assert.equal(isPlanBusy('monthly', 'monthly', 'error'), false);
    assert.equal(isPlanBusy('annual', 'annual', 'error'), false);
  });

  await test('re-call with the same arguments returns the same result (pure projection)', () => {
    for (const [plan, purchasingPlan, state] of [
      ['monthly', 'monthly', 'purchasing'],
      ['annual', 'monthly', 'purchasing'],
      ['monthly', null, 'purchasing'],
      ['annual', 'annual', 'error'],
    ]) {
      const a = isPlanBusy(plan, purchasingPlan, state);
      const b = isPlanBusy(plan, purchasingPlan, state);
      assert.equal(a, b, `divergent result for ${plan}/${purchasingPlan}/${state}`);
    }
  });

  console.log('\n[tests] planCaptionColor — emphasis caption contrast\n');

  await test('non-emphasis caption → colors.primary (emerald, readable on light surface)', () => {
    assert.equal(planCaptionColor(false), '#10B981');
  });

  await test('emphasis caption → colors.onPrimary (white, readable on emerald)', () => {
    // The regression: the emphasis (emerald) button rendered the caption
    // in colors.primary — emerald-on-emerald, invisible. The fix must
    // flip the emphasis caption to white.
    assert.equal(planCaptionColor(true), '#FFFFFF');
  });

  await test('emphasis and non-emphasis captions DIFFER (contrast preserved)', () => {
    assert.notEqual(
      planCaptionColor(true),
      planCaptionColor(false),
      'emphasis caption must not collapse back to colors.primary',
    );
  });

  await test('re-call with the same argument returns the same result (pure projection)', () => {
    assert.equal(planCaptionColor(true), planCaptionColor(true));
    assert.equal(planCaptionColor(false), planCaptionColor(false));
  });

  console.log('\n[tests] paywall caption wiring — PlanButton applies planCaptionColor\n');

  // Slice-C wiring contract: the pure model decides the caption color
  // (emphasis → colors.onPrimary white, non-emphasis → colors.primary).
  // The SCREEN must apply it per-button, and the stylesheet must NOT
  // hardcode a caption color that overrides the model — the regression
  // was a fixed `colors.primary` caption that made the emphasis
  // (emerald) caption invisible (emerald-on-emerald). Source-level pins,
  // the same convention test-legal-content.mjs uses for its F4 routing
  // contracts (assert against the real file so a future gating change
  // fails the harness loudly).
  const proScreen = readFileSync(
    join(root, 'src', 'app', 'pro', 'index.tsx'),
    'utf8',
  );

  await test('PlanButton applies planCaptionColor(emphasis) to the caption Text (wiring)', () => {
    // The color must come from the model, parameterized by the button's
    // emphasis flag — the exact spelling of the normalization (e.g.
    // `!!emphasis`) is an implementation detail, so the pin matches any
    // call whose argument derives from `emphasis`.
    assert.ok(
      /planCaptionColor\([^)]*emphasis/.test(proScreen),
      'pro screen must call planCaptionColor with the button\'s emphasis flag in the PlanButton caption render',
    );
  });

  await test('caption color lives in the model, not hardcoded in the stylesheet', () => {
    // Slice the stylesheet entry for the caption and require it to carry
    // NO `color` — the per-emphasis color comes from planCaptionColor.
    const captionStyle =
      proScreen.match(/planButtonCaption: \{[\s\S]*?\},/)?.[0] ?? '';
    assert.ok(
      captionStyle.length > 0,
      'sanity: styles.planButtonCaption must still exist',
    );
    assert.ok(
      !/color:/.test(captionStyle),
      'styles.planButtonCaption must not hardcode a color (single source of truth: planCaptionColor)',
    );
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