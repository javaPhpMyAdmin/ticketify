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
 * Two test layers:
 *
 *   1. PURE projection tests (no SDK mocking) — pass plain object
 *      literals shaped like the SDK's offering objects and assert the
 *      projected `IntroPhase`. Covers Android + iOS × every
 *      trial-window / no-trial branch.
 *
 *   2. INTEGRATION tests via a mock SDK module — verify the
 *      `getOfferings()` end-to-end path projects the right
 *      `introPhase` into the returned `OfferingsSnapshot`. The mock
 *      is a tiny CommonJS module written to the workdir and bound via
 *      a Node `Module._resolveFilename` hook before the revenuecat
 *      module is imported. The mock exposes mutable `offeringsFixture`
 *      / `customerInfoFixture` so each test can swap scenarios without
 *      re-importing the module.
 *
 * Usage: pnpm test:revenuecat-offerings
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const mockPath = join(workdir, 'react-native-purchases-mock.cjs');

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
 * Mock `react-native-purchases` CommonJS module. The compiled
 * `revenuecat.js` does `require('react-native-purchases')` at module
 * load time; the require hook below redirects that to this file.
 *
 * Mutable fixtures (`offeringsFixture` / `customerInfoFixture`) let
 * each integration test swap scenarios without re-importing the
 * module — the SDK surface is called fresh on every `getOfferings()`
 * call.
 */
writeFileSync(
  mockPath,
  [
    '// Mutable fixtures for the integration tests. Tests rewrite',
    '// `offeringsFixture` / `customerInfoFixture` between calls.',
    'let offeringsFixture = null;',
    'class MockPurchases {',
    '  static configure() { return true; }',
    '  static async getCustomerInfo() { return null; }',
    '  static async getOfferings() { return offeringsFixture; }',
    '  static async logIn() { return { created: false }; }',
    '  static async logOut() {}',
    '  static async purchasePackage() { return { customerInfo: { entitlements: { all: { pro: { isActive: true } } } } }; }',
    '  static async restorePurchases() { return { entitlements: { all: { pro: { isActive: true } } } }; }',
    '  static async showManageSubscriptions() {}',
    '  static addCustomerInfoUpdateListener() { return { unsubscribe() {} }; }',
    '}',
    'MockPurchases.__setOfferings = (fixture) => { offeringsFixture = fixture; };',
    'MockPurchases.__reset = () => { offeringsFixture = null; };',
    'module.exports = MockPurchases;',
    'module.exports.default = MockPurchases;',
    '',
  ].join('\n'),
);

/**
 * Redirect `@/*` to compiled output AND `react-native-purchases` to
 * the mock fixture. The hook must be installed BEFORE the compiled
 * revenuecat.js is `await import()`ed (otherwise the runtime require
 * resolves to the real native module, which isn't linked in the
 * harness, and `Purchases` stays `null`).
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === 'react-native-purchases') return mockPath;
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
  // Import via a unique cache-busting query string. Node's import cache
  // is keyed by URL + querystring; without the nonce, the second
  // `await import()` in this run() would return the cached module
  // (without our mock hooked). One import per run() is enough — the
  // mock module exposes mutable fixtures so the in-memory Purchases
  // reference reads the latest fixture on every getOfferings() call.
  const nonce = `?t=${Date.now()}`;
  const { createRequire: makeRequire } = await import('node:module');
  const liveRequire = makeRequire(import.meta.url);
  const revenuecatUrl = pathToFileURL(join(outDir, 'src/lib/revenuecat.js')).href + nonce;
  const revenuecatModule = await import(revenuecatUrl);
  const {
    projectAndroidIntroPhase,
    projectIosIntroPhase,
    buildIntroCaption,
    getTrialPillState,
    deriveCustomerInfoSnapshot,
    getOfferings,
  } = revenuecatModule;
  // The mock module is also loaded via `liveRequire` so the integration
  // tests can mutate the mutable fixtures. (The revenuecat module reads
  // the same mock via the require hook; mutating `__setOfferings`
  // updates the SAME fixture object.)
  const MockPurchases = liveRequire(mockPath);

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

  console.log('\n[tests] buildIntroCaption (REQ-PRO-INTRO-CAPTION)\n');

  await test('null introPhase → null (no caption, paywall hides it)', () => {
    assert.equal(
      buildIntroCaption(null, '{{trialDays}} días gratis, después {{priceAfterTrial}}/mes'),
      null,
    );
  });

  await test('renders the {{trialDays}} + {{priceAfterTrial}} tokens', () => {
    const result = buildIntroCaption(
      { priceAfterTrial: '$5.99', trialDays: 7, cycles: 1 },
      '{{trialDays}} días gratis, después {{priceAfterTrial}}/mes',
    );
    assert.equal(result, '7 días gratis, después $5.99/mes');
  });

  await test('en locale template renders correctly (regression check on the en string)', () => {
    const result = buildIntroCaption(
      { priceAfterTrial: '$5.99', trialDays: 7, cycles: 1 },
      '{{trialDays}} days free, then {{priceAfterTrial}}/month',
    );
    assert.equal(result, '7 days free, then $5.99/month');
  });

  await test('substitutes BOTH tokens when they appear multiple times (idempotent / global replace)', () => {
    const result = buildIntroCaption(
      { priceAfterTrial: '$9.99', trialDays: 30, cycles: 1 },
      '{{trialDays}}-day free trial at {{priceAfterTrial}}/mo after {{trialDays}} days',
    );
    assert.equal(result, '30-day free trial at $9.99/mo after 30 days');
  });

  await test('large trialDays + non-USD price renders verbatim (no formatting applied by helper)', () => {
    // The helper does NO number / currency formatting — it just does
    // the token substitution. The caller (PaywallScreen) renders
    // trialDays as-is (it's an integer) and priceAfterTrial as already-
    // formatted by the SDK (e.g. "€12.99" or "ARS 1.499,00").
    const result = buildIntroCaption(
      { priceAfterTrial: 'ARS 1.499,00', trialDays: 365, cycles: 1 },
      '{{trialDays}} días gratis, después {{priceAfterTrial}}/mes',
    );
    assert.equal(result, '365 días gratis, después ARS 1.499,00/mes');
  });

  console.log('\n[tests] getTrialPillState (REQ-PRO-TRIAL-PILL)\n');

  await test('null entitlement → no pill (defensive)', () => {
    assert.deepEqual(getTrialPillState(null), {
      show: false,
      trialEndsAt: null,
    });
  });

  await test('undefined entitlement → no pill', () => {
    assert.deepEqual(getTrialPillState(undefined), {
      show: false,
      trialEndsAt: null,
    });
  });

  await test('active + TRIAL + expirationDate → pill (the primary contract)', () => {
    assert.deepEqual(
      getTrialPillState({
        isActive: true,
        periodType: 'TRIAL',
        expirationDate: '2026-10-25T00:00:00.000Z',
      }),
      { show: true, trialEndsAt: '2026-10-25T00:00:00.000Z' },
    );
  });

  await test('active + NORMAL + expirationDate → no pill (paid subscriber)', () => {
    assert.deepEqual(
      getTrialPillState({
        isActive: true,
        periodType: 'NORMAL',
        expirationDate: '2026-11-25T00:00:00.000Z',
      }),
      { show: false, trialEndsAt: null },
    );
  });

  await test('active + INTRO → no pill (introductory-price phase, not free trial)', () => {
    // The pill is SPECIFICALLY for free trials (periodType === 'TRIAL').
    // An introductory-price phase (periodType === 'INTRO') is a
    // discounted first period — different UX surface (the paywall intro
    // caption), different pill semantics.
    assert.deepEqual(
      getTrialPillState({
        isActive: true,
        periodType: 'INTRO',
        expirationDate: '2026-10-25T00:00:00.000Z',
      }),
      { show: false, trialEndsAt: null },
    );
  });

  await test('inactive + TRIAL → no pill (trial expired, entitlement not active anymore)', () => {
    // The user upgraded or the trial ended. isActive=false means the
    // entitlement doesn't grant access — no pill should show even if
    // the SDK still carries the historical periodType === 'TRIAL' state.
    assert.deepEqual(
      getTrialPillState({
        isActive: false,
        periodType: 'TRIAL',
        expirationDate: '2026-10-25T00:00:00.000Z',
      }),
      { show: false,      trialEndsAt: null },
    );
  });

  await test('active + TRIAL + null expirationDate → no pill (defensive)', () => {
    // The SDK normally always populates expirationDate for an active
    // entitlement, but the contract is defensive: a null expirationDate
    // means "we can't display a date", which collapses to no pill.
    assert.deepEqual(
      getTrialPillState({
        isActive: true,
        periodType: 'TRIAL',
        expirationDate: null,
      }),
      { show: false,      trialEndsAt: null },
    );
  });

  await test('active + TRIAL + empty expirationDate string → no pill (defensive)', () => {
    // Same as above but with an empty string — TypeScript-wise the
    // field is `string | null` so an empty string is a runtime guard
    // case. The helper explicitly rejects empty strings to avoid
    // rendering "Trial · Ends " (empty date) in the UI.
    assert.deepEqual(
      getTrialPillState({
        isActive: true,
        periodType: 'TRIAL',
        expirationDate: '',
      }),
      { show: false,      trialEndsAt: null },
    );
  });

  console.log('\n[tests] deriveCustomerInfoSnapshot (REQ-PRO-TRIAL-PILL source)\n');

  // Reusable fixtures — the SDK's entitlement shape is consistent
  // across Android + iOS per the SDK's CustomerInfo contract.
  const ENT_TRIAL = {
    isActive: true,
    periodType: 'TRIAL',
    expirationDate: '2026-10-25T00:00:00.000Z',
  };
  const ENT_NORMAL = {
    isActive: true,
    periodType: 'NORMAL',
    expirationDate: '2026-11-25T00:00:00.000Z',
  };
  const ENT_INTRO = {
    isActive: true,
    periodType: 'INTRO',
    expirationDate: '2026-10-25T00:00:00.000Z',
  };
  const ENT_INACTIVE_TRIAL = {
    isActive: false,
    periodType: 'TRIAL',
    expirationDate: '2026-10-25T00:00:00.000Z',
  };

  await test('null customerInfo → isPro=false, trialEndsAt=null (safe default)', () => {
    assert.deepEqual(deriveCustomerInfoSnapshot(null), {
      isPro: false,
      trialEndsAt: null,
    });
  });

  await test('customerInfo without the pro entitlement → isPro=false, trialEndsAt=null', () => {
    assert.deepEqual(
      deriveCustomerInfoSnapshot({
        entitlements: { all: { other: { isActive: true } } },
      }),
      { isPro: false, trialEndsAt: null },
    );
  });

  await test('active TRIAL entitlement → isPro=true, trialEndsAt=expirationDate (PRIMARY)', () => {
    assert.deepEqual(
      deriveCustomerInfoSnapshot({
        entitlements: { all: { pro: ENT_TRIAL } },
      }),
      { isPro: true, trialEndsAt: '2026-10-25T00:00:00.000Z' },
    );
  });

  await test('active NORMAL entitlement → isPro=true, trialEndsAt=null (paid subscriber)', () => {
    assert.deepEqual(
      deriveCustomerInfoSnapshot({
        entitlements: { all: { pro: ENT_NORMAL } },
      }),
      { isPro: true, trialEndsAt: null },
    );
  });

  await test('active INTRO entitlement → isPro=true, trialEndsAt=null (introductory-price phase, not free trial)', () => {
    assert.deepEqual(
      deriveCustomerInfoSnapshot({
        entitlements: { all: { pro: ENT_INTRO } },
      }),
      { isPro: true, trialEndsAt: null },
    );
  });

  await test('inactive TRIAL entitlement → isPro=false, trialEndsAt=null (defensive — expired)', () => {
    assert.deepEqual(
      deriveCustomerInfoSnapshot({
        entitlements: { all: { pro: ENT_INACTIVE_TRIAL } },
      }),
      { isPro: false, trialEndsAt: null },
    );
  });

  await test('customerInfo with completely missing entitlements → isPro=false, trialEndsAt=null (defensive)', () => {
    assert.deepEqual(
      deriveCustomerInfoSnapshot({}),
      { isPro: false, trialEndsAt: null },
    );
  });

  console.log('\n[tests] getOfferings() integration (REQ-PRO-INTRO-CAPTION — paywall caption consumer)\n');

  // Reset the mock's offerings fixture to null before each integration
  // test. The SDK module's `getOfferings()` returns whatever the
  // current `offeringsFixture` is at call time, so the tests just swap
  // the fixture and assert the snapshot. (No need to re-import the
  // revenuecat module — the require hook bound it to the mock at load.)

  await test('SDK returns null (no offerings) → snapshot has both fields null', async () => {
    MockPurchases.__setOfferings(null);
    const result = await getOfferings();
    // The wrapper doesn't return null when the SDK returns null — it
    // returns a snapshot with `monthly: null` and `annual: null`. The
    // null-return path is reserved for "Purchases unavailable" or
    // "SDK threw" (defensive catch above).
    assert.deepEqual(result, { monthly: null, annual: null });
  });

  await test('offerings.current is null → monthly/annual are null, introPhase is null', async () => {
    MockPurchases.__setOfferings({ current: null });
    const result = await getOfferings();
    assert.deepEqual(result, { monthly: null, annual: null });
  });

  await test('current with only monthly (Android FREE_TRIAL) → monthly.introPhase projected', async () => {
    MockPurchases.__setOfferings({
      current: {
        monthly: {
          identifier: '$rc_monthly',
          product: {
            priceString: '$5.99',
            defaultOption: {
              pricingPhases: [
                {
                  offerPaymentMode: 'FREE_TRIAL',
                  billingPeriod: { iso8601: 'P1W' },
                  billingCycleCount: 1,
                  price: { formatted: '$5.99' },
                },
              ],
            },
          },
        },
        annual: null,
      },
    });
    const result = await getOfferings();
    assert.equal(result.monthly?.identifier, '$rc_monthly');
    assert.equal(result.monthly?.priceString, '$5.99');
    assert.deepEqual(result.monthly?.introPhase, {
      priceAfterTrial: '$5.99',
      trialDays: 7,
      cycles: 1,
    });
    assert.equal(result.annual, null);
  });

  await test('current with only annual (iOS introPrice) → annual.introPhase projected from product.priceString', async () => {
    MockPurchases.__setOfferings({
      current: {
        monthly: null,
        annual: {
          identifier: '$rc_annual',
          product: {
            priceString: '$49.99',
            introPrice: {
              cycles: 1,
              periodUnit: 'MONTH',
              periodNumberOfUnits: 1,
            },
          },
        },
      },
    });
    const result = await getOfferings();
    assert.equal(result.annual?.identifier, '$rc_annual');
    assert.equal(result.annual?.priceString, '$49.99');
    assert.deepEqual(result.annual?.introPhase, {
      // iOS uses the package's product.priceString as the post-trial
      // price (introPrice doesn't carry it).
      priceAfterTrial: '$49.99',
      trialDays: 30,
      cycles: 1,
    });
    assert.equal(result.monthly, null);
  });

  await test('Android package without FREE_TRIAL phase → monthly.introPhase === null', async () => {
    MockPurchases.__setOfferings({
      current: {
        monthly: {
          identifier: '$rc_monthly',
          product: {
            priceString: '$5.99',
            defaultOption: {
              // Only a recurring paid phase — no FREE_TRIAL.
              pricingPhases: [
                {
                  offerPaymentMode: null,
                  billingPeriod: { iso8601: 'P1M' },
                  billingCycleCount: null,
                  price: { formatted: '$5.99' },
                },
              ],
            },
          },
        },
        annual: null,
      },
    });
    const result = await getOfferings();
    assert.equal(result.monthly?.introPhase, null);
  });

  await test('iOS package without introPrice → annual.introPhase === null', async () => {
    MockPurchases.__setOfferings({
      current: {
        monthly: null,
        annual: {
          identifier: '$rc_annual',
          product: {
            priceString: '$49.99',
            // No introPrice field — no intro offer configured.
          },
        },
      },
    });
    const result = await getOfferings();
    assert.equal(result.annual?.introPhase, null);
  });

  await test('SDK throws → getOfferings returns null (defensive, no crash)', async () => {
    // Swap the mock's getOfferings method to throw on the next call.
    // The wrapper's try/catch in `getOfferings` MUST swallow the
    // error and return null (otherwise the bootstrap crashes).
    const original = MockPurchases.getOfferings;
    MockPurchases.getOfferings = async () => {
      throw new Error('network down');
    };
    try {
      const result = await getOfferings();
      assert.equal(result, null);
    } finally {
      MockPurchases.getOfferings = original;
    }
  });

  await test('current with both monthly + annual (mixed: Android monthly + iOS annual) — both introPhases projected', async () => {
    MockPurchases.__setOfferings({
      current: {
        monthly: {
          identifier: '$rc_monthly',
          product: {
            priceString: '$5.99',
            defaultOption: {
              pricingPhases: [
                {
                  offerPaymentMode: 'FREE_TRIAL',
                  billingPeriod: { iso8601: 'P1W' },
                  billingCycleCount: 1,
                  price: { formatted: '$5.99' },
                },
              ],
            },
          },
        },
        annual: {
          identifier: '$rc_annual',
          product: {
            priceString: '$49.99',
            introPrice: {
              cycles: 1,
              periodUnit: 'MONTH',
              periodNumberOfUnits: 1,
            },
          },
        },
      },
    });
    const result = await getOfferings();
    assert.deepEqual(
      result.monthly?.introPhase,
      { priceAfterTrial: '$5.99', trialDays: 7, cycles: 1 },
    );
    assert.deepEqual(
      result.annual?.introPhase,
      { priceAfterTrial: '$49.99', trialDays: 30, cycles: 1 },
    );
  });

  // Reset the mock so any later code in the same process starts clean.
  MockPurchases.__reset();

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
