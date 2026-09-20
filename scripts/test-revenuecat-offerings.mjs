#!/usr/bin/env node
/**
 * Node harness for `src/lib/revenuecat.ts` — the intro-phase projection
 * functions added by migration 0039 (revenuecat-trial-migration slice B).
 *
 * Compiles the module with an isolated tsconfig (no other src imports
 * reach into the rest of the app — only `@/lib/with-timeout` is needed,
 * which is a pure bounded-wait helper). Asserts:
 *
 *   `projectAndroidIntroPhase(pkg)` — REQ-PRO-INTRO-CAPTION:
 *     - Scans `pkg.product.defaultOption.pricingPhases` for an
 *       `offerPaymentMode === 'FREE_TRIAL'` entry.
 *     - Returns `null` when no FREE_TRIAL phase exists (the package
 *       has no intro offer — caption MUST be hidden).
 *     - Returns `{ priceAfterTrial, trialDays, cycles }` otherwise.
 *     - `trialDays` is computed from the phase's `billingPeriod.iso8601`
 *       × `billingCycleCount`. P1D × 1 = 1 day, P1W × 1 = 7 days,
 *       P1M × 1 = 30 days, P1Y × 1 = 365 days.
 *
 *   `projectIosIntroPhase(pkg)` — REQ-PRO-INTRO-CAPTION:
 *     - Reads `pkg.product.introPrice` (StoreKit 2's canonical intro
 *       price shape). Returns `null` when absent.
 *     - Returns `{ priceAfterTrial: pkg.product.priceString, trialDays,
 *       cycles: introPrice.cycles }` otherwise.
 *     - `trialDays` = `cycles × periodNumberOfUnits × unit_to_days(
 *       periodUnit)`. The unit factor handles DAY (×1), WEEK (×7),
 *       MONTH (×30), YEAR (×365).
 *
 * Both projections are PURE functions of the input — no SDK mocking is
 * needed. Pass plain object literals shaped like the SDK's offering
 * objects and assert the projected `IntroPhase`. Triangulation runs
 * over (Android/iOS × FREE_TRIAL/no-trial) combinations plus the
 * 4 unit_to_days branches (DAY/WEEK/MONTH/YEAR) to pin every code
 * path the paywall caption consumer depends on.
 *
 * Usage: pnpm test:revenuecat-offerings
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
const harnessConfig = join(__dirname, 'tsconfig.revenuecat-offerings-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'revenuecat-offerings-test-'));
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
 * Remap `@/*` → compiled output (matches the sibling harnesses in
 * scripts/). The `react-native-purchases` runtime require inside
 * `revenuecat.ts` is NOT remapped — the load attempt fails, the
 * wrapper's `Purchases` stays `null`, and the pure-function tests
 * (which never call `getOfferings()`) are unaffected.
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
  console.log('\n[tests] compiling revenuecat module…');
  await compile();
  console.log('[tests] loading compiled module…');
  installRequireHook();
  const {
    projectAndroidIntroPhase,
    projectIosIntroPhase,
  } = await import(
    pathToFileURL(join(outDir, 'src/lib/revenuecat.js')).href
  );

  console.log('\n[tests] projectAndroidIntroPhase (REQ-PRO-INTRO-CAPTION)\n');

  await test('null pkg → null (defensive, no throw)', () => {
    assert.equal(projectAndroidIntroPhase(null), null);
  });

  await test('pkg with no product → null', () => {
    assert.equal(projectAndroidIntroPhase({}), null);
  });

  await test('pkg with no defaultOption → null', () => {
    assert.equal(
      projectAndroidIntroPhase({ product: { defaultOption: null } }),
      null,
    );
  });

  await test('pkg with empty pricingPhases → null (no FREE_TRIAL offered)', () => {
    assert.equal(
      projectAndroidIntroPhase({
        product: {
          defaultOption: { pricingPhases: [] },
        },
      }),
      null,
    );
  });

  await test('P1D × 1 cycle → trialDays=1 (1-day trial)', () => {
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'FREE_TRIAL',
              billingPeriod: { iso8601: 'P1D' },
              billingCycleCount: 1,
              price: { formatted: '$5.99' },
            },
          ],
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$5.99',
      trialDays: 1,
      cycles: 1,
    });
  });

  await test('P1W × 1 cycle → trialDays=7 (1-week trial)', () => {
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'FREE_TRIAL',
              billingPeriod: { iso8601: 'P1W' },
              billingCycleCount: 1,
              price: { formatted: '$9.99' },
            },
          ],
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$9.99',
      trialDays: 7,
      cycles: 1,
    });
  });

  await test('P1M × 1 cycle → trialDays=30 (1-month trial)', () => {
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'FREE_TRIAL',
              billingPeriod: { iso8601: 'P1M' },
              billingCycleCount: 1,
              price: { formatted: '€12.99' },
            },
          ],
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '€12.99',
      trialDays: 30,
      cycles: 1,
    });
  });

  await test('P1Y × 1 cycle → trialDays=365 (1-year trial)', () => {
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'FREE_TRIAL',
              billingPeriod: { iso8601: 'P1Y' },
              billingCycleCount: 1,
              price: { formatted: '$99.99' },
            },
          ],
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$99.99',
      trialDays: 365,
      cycles: 1,
    });
  });

  await test('P7D × 2 cycles → trialDays=14 (multi-cycle trial)', () => {
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'FREE_TRIAL',
              billingPeriod: { iso8601: 'P7D' },
              billingCycleCount: 2,
              price: { formatted: '$19.99' },
            },
          ],
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$19.99',
      trialDays: 14,
      cycles: 2,
    });
  });

  await test('non-FREE_TRIAL phase (DISCOUNTED_RECURRING_PAYMENT) → null', () => {
    // The intro phase is specifically a free trial. A discounted recurring
    // payment is NOT a free trial — no caption should render.
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'DISCOUNTED_RECURRING_PAYMENT',
              billingPeriod: { iso8601: 'P1M' },
              billingCycleCount: 3,
              price: { formatted: '$5.99' },
            },
          ],
        },
      },
    });
    assert.equal(result, null);
  });

  await test('FREE_TRIAL phase is the SECOND entry (paid-first, trial-second) → still projects', () => {
    // The SDK models the order as: paid phase first, FREE_TRIAL second
    // (or vice versa). The projection must find FREE_TRIAL regardless
    // of position in the array.
    const result = projectAndroidIntroPhase({
      product: {
        defaultOption: {
          pricingPhases: [
            {
              offerPaymentMode: 'SINGLE_PAYMENT',
              billingPeriod: { iso8601: 'P1Y' },
              billingCycleCount: 1,
              price: { formatted: '$99.99' },
            },
            {
              offerPaymentMode: 'FREE_TRIAL',
              billingPeriod: { iso8601: 'P1W' },
              billingCycleCount: 1,
              price: { formatted: '$9.99' }, // post-trial price
            },
          ],
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$9.99',
      trialDays: 7,
      cycles: 1,
    });
  });

  console.log('\n[tests] projectIosIntroPhase (REQ-PRO-INTRO-CAPTION)\n');

  await test('null pkg → null (defensive)', () => {
    assert.equal(projectIosIntroPhase(null), null);
  });

  await test('pkg with no product → null', () => {
    assert.equal(projectIosIntroPhase({}), null);
  });

  await test('pkg with no introPrice → null (no intro offer configured)', () => {
    assert.equal(
      projectIosIntroPhase({ product: { introPrice: null } }),
      null,
    );
  });

  await test('DAY period, 7 units, 1 cycle → trialDays=7 (1-week trial)', () => {
    const result = projectIosIntroPhase({
      product: {
        priceString: '$9.99',
        introPrice: {
          cycles: 1,
          periodUnit: 'DAY',
          periodNumberOfUnits: 7,
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$9.99',
      trialDays: 7,
      cycles: 1,
    });
  });

  await test('WEEK period, 1 unit, 1 cycle → trialDays=7', () => {
    const result = projectIosIntroPhase({
      product: {
        priceString: '$9.99',
        introPrice: {
          cycles: 1,
          periodUnit: 'WEEK',
          periodNumberOfUnits: 1,
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$9.99',
      trialDays: 7,
      cycles: 1,
    });
  });

  await test('MONTH period, 1 unit, 1 cycle → trialDays=30', () => {
    const result = projectIosIntroPhase({
      product: {
        priceString: '€12.99',
        introPrice: {
          cycles: 1,
          periodUnit: 'MONTH',
          periodNumberOfUnits: 1,
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '€12.99',
      trialDays: 30,
      cycles: 1,
    });
  });

  await test('YEAR period, 1 unit, 1 cycle → trialDays=365', () => {
    const result = projectIosIntroPhase({
      product: {
        priceString: '$99.99',
        introPrice: {
          cycles: 1,
          periodUnit: 'YEAR',
          periodNumberOfUnits: 1,
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$99.99',
      trialDays: 365,
      cycles: 1,
    });
  });

  await test('multi-cycle intro (3 cycles of 1 month each) → trialDays=90, cycles=3', () => {
    // "3 months free, then $9.99/month" — a real-world intro pattern.
    const result = projectIosIntroPhase({
      product: {
        priceString: '$9.99',
        introPrice: {
          cycles: 3,
          periodUnit: 'MONTH',
          periodNumberOfUnits: 1,
        },
      },
    });
    assert.deepEqual(result, {
      priceAfterTrial: '$9.99',
      trialDays: 90,
      cycles: 3,
    });
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
