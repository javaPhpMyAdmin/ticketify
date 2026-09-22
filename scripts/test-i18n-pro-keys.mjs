#!/usr/bin/env node
/**
 * Node harness for the `pro` namespace i18n key set
 * (revenuecat-trial-migration slice C).
 *
 * Asserts three contracts on the pro namespace catalogs read directly
 * from disk (`src/i18n/locales/{es-AR,en,pt-BR}/pro.json`):
 *
 *   1. PARITY — the three locales have IDENTICAL key sets (REQ-1: locale
 *      parity across the i18n catalogs).
 *   2. PRESENCE — the slice C ADDED keys (intro caption, trial pill,
 *      benefit labels) exist in every locale as non-empty strings.
 *   3. ABSENCE — the slice C REMOVED keys don't linger in any locale
 *      (defensive: the trial CTA / countdown / error keys are gone
 *      forever — slice A's R1-2 + slice C keep them out).
 *
 * The settings namespace gets a parallel ABSENCE check for the
 * slice-C-removed 5-branch-source keys (`trialActive`, `trialExpired`,
 * `startFreeTrial`). The settings parity primitive lives in
 * `scripts/test-legal-links.mjs` (asserts `keySet(en) === keySet(es-AR)`
 * for `settings`); the absence check below complements it by ensuring
 * the obsolete keys don't sneak back into any locale individually.
 *
 * Usage: pnpm test:i18n-pro-keys
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const LOCALES_ROOT = join(root, 'src', 'i18n', 'locales');
const LOCALES = ['es-AR', 'en', 'pt-BR'];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(String((err && err.stack) || err));
  }
}

function readCatalog(locale, namespace) {
  return JSON.parse(
    readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8'),
  );
}

function keySet(obj) {
  return Object.keys(obj).sort().join(',');
}

const ADDED_PRO_KEYS = [
  // Slice C REQ-PRO-INTRO-CAPTION — paywall intro-offer caption.
  'planIntroCaption',
  // Slice C REQ-PRO-TRIAL-PILL — profile trial-pill badge.
  'trialPill',
  // Slice C — paywall benefits card (legal-compliance rewrite WIP
  // that got partially lost during Slice A's R1-2 stash dance; this
  // re-adds the keys so the paywall can i18n the benefits).
  'benefitUnlimitedScans',
  'benefitAdvancedStats',
  'benefitExportTickets',
  'benefitPriceAlerts',
  // Slice E — kinetic-finance paywall rewrite. New i18n keys for the
  // hero block, the 5th benefit, plan-card chip/caption strings, the
  // dynamic CTA, the trust strip, and the legal footer a11y labels.
  // The legacy titles above stay — the description siblings are new.
  'paywallProTitle',
  'closePaywallA11y',
  'accountA11y',
  'heroEyebrow',
  'heroHeadline',
  'heroSubtitle',
  'heroMockAiSync',
  'heroMockTotalLabel',
  'heroMockTotalValue',
  'heroMockUnlimited',
  'heroMockSavingLabel',
  'heroMockSavingValue',
  'benefitHousehold5',
  'benefitUnlimitedScansDescription',
  'benefitAdvancedStatsDescription',
  'benefitExportTicketsDescription',
  'benefitPriceAlertsDescription',
  'benefitHousehold5Description',
  'planBadgeSavings',
  'planAnnualTrialChip',
  'planAnnualBillCaption',
  'planAnnualEquivalentMonthly',
  'planMonthlyTrialChip',
  'planMonthlyTrialCaption',
  'planMonthlyCancellationNote',
  'ctaStartTrialWithDays',
  'ctaContinuePro',
  'cancelOrFreeTier',
  'trustSecurePayment',
  'trustCancelAnytime',
  'trustSupport247',
  'planSelectedA11y',
  // Slice E follow-up: the legal footer interpolates {{period}} into
  // autoRenewalNotice — the period word is locale-dependent
  // (año / year / ano) so it gets its own keys rather than being
  // hardcoded inside the renewal template.
  'autoRenewalPeriodAnnual',
  'autoRenewalPeriodMonthly',
];

const REMOVED_SETTINGS_KEYS = [
  // Slice C — 5-branch source keys for the pre-cutover trial/error
  // surfaces. The trial + frozen lifecycle is gone (migration 0039);
  // the post-cutover paywall never references these.
  'trialActive',
  'trialExpired',
  'startFreeTrial',
];

// Pre-cutover pro namespace keys that were removed during slices A and
// B (the trial CTA, the trial countdown, the trial-expired surfaces).
// Slice D adds an orphan-regression check to prevent these keys from
// silently creeping back into any locale (e.g. via a stray revert or
// a partial re-merge). The keys are gone from the production code
// AND from every locale's pro.json; this check makes "gone" explicit.
const REMOVED_PRO_KEYS = [
  'trialBannerDays_one',
  'trialBannerDays_other',
  'trialStartCTA',
  'trialStartSubtitle',
  'trialStartBillingNote',
  'trialExpiredTitle',
  'trialExpiredSubtitle',
  'errorTrialAlreadyUsed',
  'errorTrialStartFailed',
  'trialActiveDays_one',
  'trialActiveDays_other',
];

console.log('\n[tests] section 1 — pro.json catalog parity (REQ-1)\n');

test('pro.json key sets are identical across the three locales', () => {
  const catalogs = Object.fromEntries(
    LOCALES.map((l) => [l, readCatalog(l, 'pro')]),
  );
  assert.equal(
    keySet(catalogs.en),
    keySet(catalogs['es-AR']),
    'pro parity: en vs es-AR',
  );
  assert.equal(
    keySet(catalogs['pt-BR']),
    keySet(catalogs['es-AR']),
    'pro parity: pt-BR vs es-AR',
  );
});

console.log('\n[tests] section 2 — slice-C ADDED pro keys present in all locales\n');

test('every added pro key exists as a non-empty string in all three locales', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'pro');
    for (const key of ADDED_PRO_KEYS) {
      const where = `${locale}/pro.json:${key}`;
      assert.ok(key in catalog, `missing ${where}`);
      assert.equal(
        typeof catalog[key],
        'string',
        `${where} must be a string`,
      );
      assert.ok(
        catalog[key].length > 0,
        `${where} must be a non-empty string`,
      );
    }
  }
});

test('planIntroCaption contains both {{trialDays}} and {{priceAfterTrial}} interpolation tokens (all locales)', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'pro');
    const caption = catalog.planIntroCaption;
    assert.ok(
      caption.includes('{{trialDays}}'),
      `${locale}/pro.json:planIntroCaption must include {{trialDays}} token`,
    );
    assert.ok(
      caption.includes('{{priceAfterTrial}}'),
      `${locale}/pro.json:planIntroCaption must include {{priceAfterTrial}} token`,
    );
  }
});

test('trialPill contains the {{date}} interpolation token (all locales)', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'pro');
    const pill = catalog.trialPill;
    assert.ok(
      pill.includes('{{date}}'),
      `${locale}/pro.json:trialPill must include {{date}} token`,
    );
  }
});

console.log('\n[tests] section 3 — settings obsolete keys ABSENT in all locales\n');

test('the 5-branch-source keys are absent in every locale (slice C cleanup)', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'settings');
    for (const key of REMOVED_SETTINGS_KEYS) {
      const where = `${locale}/settings.json:${key}`;
      assert.ok(
        !(key in catalog),
        `${where} should be removed (post-cutover the trial lifecycle is gone)`,
      );
    }
  }
});

console.log('\n[tests] section 4 — pro orphan regression (slice D)\n');

test('pre-cutover pro trial keys never leak back into any locale', () => {
  // Defensive: the slice A R1-2 + slice B collateral removed every
  // pre-cutover trial surface from production code. If a future revert
  // or partial merge accidentally re-introduces one of these keys,
  // this test catches it before the paywall renders a dead label.
  // 11 keys covers the full pre-cutover trial lifecycle surface
  // (trialBannerDays_one/_other, trialStartCTA / trialStartSubtitle /
  // trialStartBillingNote, trialExpiredTitle / trialExpiredSubtitle,
  // errorTrialAlreadyUsed / errorTrialStartFailed,
  // trialActiveDays_one/_other).
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale, 'pro');
    for (const key of REMOVED_PRO_KEYS) {
      const where = `${locale}/pro.json:${key}`;
      assert.ok(
        !(key in catalog),
        `${where} should be absent (post-cutover the trial lifecycle is gone)`,
      );
    }
  }
});

console.log(`\n[tests] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
