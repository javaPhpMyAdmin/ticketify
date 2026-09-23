#!/usr/bin/env node
/**
 * Node harness for the paywall pure model
 * (`src/features/pro/paywall-model.ts` → `isPlanBusy`, `getCtaCopy`).
 *
 * Compiles the module with an isolated tsconfig (the ONLY imports are
 * `@/theme/colors`, which is pure TS — no react-native) and asserts the
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
 * Plus source-pin contracts against the real screen file
 * (`src/app/pro/index.tsx`) and the model file itself:
 *
 *   - The kinetic-finance rewrite wiring (hero / features / plans / CTA /
 *     trust / legal i18n keys, `t(cta.key, cta.values)`).
 *   - The paywall-polish contracts: unified emphasis trial chip (the
 *     annual gray chip + its `planCaptionColor` model helper are gone),
 *     Play-sourced trial-day copy (no hardcoded day counts), exactly one
 *     close button in the header (no account icon).
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
  const { isPlanBusy, getCtaCopy } = await import(
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

  console.log('\n[tests] getCtaCopy — dynamic CTA copy per plan\n');

  await test('annual plan with trialDays → ctaStartTrialWithDays interpolation token', () => {
    // The new paywall flips the CTA copy based on the selected plan
    // (annual → "Comenzar N días gratis", monthly → "Continuar con PRO").
    // The trialDays value comes from the RevenueCat offering's introPhase.
    const result = getCtaCopy('annual', 14);
    assert.equal(result.key, 'ctaStartTrialWithDays');
    assert.equal(result.values?.trialDays, 14);
  });

  await test('annual plan with null trialDays → falls back to ctaContinuePro', () => {
    // No intro offer configured on annual → no free-trial copy, the CTA
    // matches the monthly branch (no trial available = no "free days" claim).
    const result = getCtaCopy('annual', null);
    assert.equal(result.key, 'ctaContinuePro');
    assert.equal(result.values, undefined);
  });

  await test('annual plan with 0 trialDays → falls back to ctaContinuePro', () => {
    // Defensive: a 0 trialDays is treated as "no trial configured"
    // (introPhase.trialDays > 0 is the source-of-truth precondition).
    const result = getCtaCopy('annual', 0);
    assert.equal(result.key, 'ctaContinuePro');
  });

  await test('monthly plan → ALWAYS ctaContinuePro (monthly has no free-trial CTA)', () => {
    // The trial CTA is reserved for the annual plan; monthly always
    // shows the "Continuar con PRO" copy regardless of any trialDays.
    const withDays = getCtaCopy('monthly', 14);
    assert.equal(withDays.key, 'ctaContinuePro');
    assert.equal(withDays.values, undefined);
    const withoutDays = getCtaCopy('monthly', null);
    assert.equal(withoutDays.key, 'ctaContinuePro');
  });

  await test('getCtaCopy is pure (re-call returns the same result)', () => {
    const a = getCtaCopy('annual', 14);
    const b = getCtaCopy('annual', 14);
    assert.deepEqual(a, b);
    const c = getCtaCopy('monthly', null);
    const d = getCtaCopy('monthly', null);
    assert.deepEqual(c, d);
  });

  // Triangulation: prove the function distinguishes inputs rather than
  // returning a hardcoded constant (Fake-It guard).
  await test('getCtaCopy branches on plan key (annual ≠ monthly for the same trialDays)', () => {
    const annualResult = getCtaCopy('annual', 14);
    const monthlyResult = getCtaCopy('monthly', 14);
    assert.notEqual(
      annualResult.key,
      monthlyResult.key,
      'annual + trialDays must NOT collapse to the no-trial branch',
    );
  });

  await test('getCtaCopy trialDays value flows through to the values object verbatim', () => {
    // The model returns the EXACT trialDays number it was given — it
    // does NOT clamp, round, or transform. The screen renders it via
    // i18next's `{{trialDays}}` token, and i18next coerces to string.
    const seven = getCtaCopy('annual', 7);
    assert.equal(seven.values?.trialDays, 7);
    const thirty = getCtaCopy('annual', 30);
    assert.equal(thirty.values?.trialDays, 30);
  });

  console.log('\n[tests] trial chip — unified emphasis style (paywall polish)\n');

  // Paywall-polish contract: BOTH plan cards render the trial chip with
  // the SAME emphasis style (solid emerald background + onPrimary text).
  // The annual card used to branch to a neutral gray chip
  // (`planTrialChipNeutral`); that branching is gone. The
  // `planCaptionColor` model helper existed solely for that branch and
  // is REMOVED with it. Source-level pins, the same convention the
  // rewrite-wiring tests below use (assert against the real files so a
  // future refactor that reintroduces the branch fails loudly).
  const proScreen = readFileSync(
    join(root, 'src', 'app', 'pro', 'index.tsx'),
    'utf8',
  );
  const modelFile = readFileSync(
    join(root, 'src', 'features', 'pro', 'paywall-model.ts'),
    'utf8',
  );

  await test('paywall-model.ts no longer exports planCaptionColor (dead constant removed)', () => {
    assert.ok(
      !/\bplanCaptionColor\b/.test(modelFile),
      'planCaptionColor must be gone from paywall-model.ts (it only served the removed chip branch)',
    );
  });

  await test('pro/index.tsx does not reference planTrialChipNeutral (no annual gray chip)', () => {
    assert.ok(
      !/planTrialChipNeutral/.test(proScreen),
      'pro screen must not reference planTrialChipNeutral — both chips use the emphasis style',
    );
  });

  await test('trial chip applies the emphasis style unconditionally (no isAnnual style branch)', () => {
    assert.ok(
      /styles\.planTrialChipEmphasis/.test(proScreen),
      'pro screen must reference styles.planTrialChipEmphasis for the trial chip',
    );
    assert.ok(
      !/planTrialChip[^;\n]*\?\s*styles\./.test(proScreen),
      'the trial chip must not branch its styles on the plan kind',
    );
  });

  await test('trial chip label keeps the emphasis text style', () => {
    assert.ok(
      /styles\.planTrialChipText/.test(proScreen),
      'pro screen must apply styles.planTrialChipText to the trial chip label',
    );
  });

  console.log('\n[tests] US$ price labels — toUsdLabel at every pricing consumer (paywall polish)\n');

  // Paywall-polish contract (CHANGE 1): every pricing string rendered on
  // the paywall goes through the pure `toUsdLabel` helper in
  // `src/lib/revenuecat.ts` so a bare "$49.99" from the store formats
  // as "US$49.99" on device. Three consumers: the plan-card price
  // display, the monthly trial caption's {{price}} value, and the
  // equivalent-monthly subline's {{price}} value (from
  // `introPhase.priceAfterTrial`). Source-level pins, the same
  // convention as the other wiring tests below.

  await test('plan card price display passes pkg.priceString through toUsdLabel', () => {
    assert.ok(
      /toUsdLabel\(\s*pkg\.priceString\s*\)/.test(proScreen),
      'the plan card price must render toUsdLabel(pkg.priceString) — bare "$" becomes "US$"',
    );
  });

  await test('monthly trial caption price passes pkg.priceString through toUsdLabel', () => {
    assert.ok(
      /price:\s*toUsdLabel\(\s*pkg\.priceString\s*\)/.test(proScreen),
      'planMonthlyTrialCaption must receive price: toUsdLabel(pkg.priceString)',
    );
  });

  await test('equivalent-monthly subline price passes priceAfterTrial through toUsdLabel', () => {
    assert.ok(
      /price:\s*toUsdLabel\(\s*introPhase\.priceAfterTrial\s*\)/.test(proScreen),
      'planAnnualEquivalentMonthly must receive price: toUsdLabel(introPhase.priceAfterTrial)',
    );
  });

  await test('toUsdLabel is imported from the revenuecat wrapper', () => {
    const importBlock =
      proScreen.match(/import \{[\s\S]*?\} from ['"]@\/lib\/revenuecat['"];/)?.[0] ??
      '';
    assert.ok(
      importBlock.length > 0,
      'sanity: the revenuecat import block must exist',
    );
    assert.ok(
      /\btoUsdLabel\b/.test(importBlock),
      'pro screen must import toUsdLabel from @/lib/revenuecat',
    );
  });

  console.log('\n[tests] trial-day copy — Play-sourced day counts (paywall polish)\n');

  // Paywall-polish contract (CHANGE 4): ALL day-count copy on the plan
  // cards comes from the RevenueCat introPhase (`pkg.introPhase.trialDays`),
  // NOT from hardcoded i18n strings. The old planAnnualTrialChip /
  // planMonthlyTrialChip keys ("14 DÍAS GRATIS" / "7 DÍAS GRATIS") and
  // the hardcoded day counts inside planAnnualBillCaption /
  // planMonthlyTrialCaption are gone — the templates interpolate
  // {{trialDays}} now. The chip hides entirely when introPhase is null
  // (no invented day counts) and the day-less fallback captions take
  // the annual body / monthly caption slots.

  await test('trial chip renders the unified planTrialChipDays key with the introPhase trialDays', () => {
    assert.ok(
      /\bt\(\s*['"]planTrialChipDays['"]\s*,\s*\{\s*trialDays:\s*introPhase\.trialDays,?\s*\}/.test(
        proScreen,
      ),
      'pro screen must render the trial chip via t(\'planTrialChipDays\', { trialDays: introPhase.trialDays })',
    );
  });

  await test('planAnnualTrialChip / planMonthlyTrialChip are gone from the screen (single day-count source)', () => {
    assert.ok(
      !/planAnnualTrialChip/.test(proScreen),
      'pro screen must NOT reference planAnnualTrialChip — the day count comes from introPhase now',
    );
    assert.ok(
      !/planMonthlyTrialChip/.test(proScreen),
      'pro screen must NOT reference planMonthlyTrialChip — the day count comes from introPhase now',
    );
  });

  await test('chip is guarded on introPhase (null → hidden, no numeric fallback)', () => {
    const chipBlock =
      proScreen.match(/\{introPhase \?[\s\S]*?:\s*null\s*\}/)?.[0] ?? '';
    assert.ok(
      chipBlock.includes('planTrialChipDays'),
      'the planTrialChipDays render must live inside the introPhase ? … : null branch (chip hidden when no intro offer)',
    );
  });

  await test('planAnnualBillCaption interpolates {{trialDays}} from introPhase', () => {
    assert.ok(
      /\bt\(\s*['"]planAnnualBillCaption['"]\s*,\s*\{\s*trialDays:\s*introPhase\.trialDays\s*\}/.test(
        proScreen,
      ),
      'planAnnualBillCaption must receive { trialDays: introPhase.trialDays }',
    );
  });

  await test('planMonthlyTrialCaption interpolates {{trialDays}} + {{price}} from introPhase', () => {
    assert.ok(
      /trialDays:\s*introPhase\.trialDays[\s\S]{0,160}price:\s*toUsdLabel\(\s*pkg\.priceString\s*\)/.test(
        proScreen,
      ),
      'planMonthlyTrialCaption must receive { trialDays: introPhase.trialDays, price: toUsdLabel(pkg.priceString) }',
    );
  });

  await test('day-less fallback captions are referenced (introPhase-null path)', () => {
    for (const key of [
      'planAnnualBillCaptionPlain',
      'planMonthlyTrialCaptionPlain',
    ]) {
      assert.ok(
        new RegExp(`\\bt\\(\\s*['"]${key}['"]`).test(proScreen),
        `pro screen must reference ${key} (day-less caption when introPhase is null)`,
      );
    }
  });

  await test('no hardcoded trial-day literals in the screen (14/7 días/days/gratis/free must come from the template)', () => {
    assert.ok(
      !/\b(14|7)\s+(d[ií]as|days|dias|gratis|free|grátis)\b/i.test(proScreen),
      'pro screen must not hardcode trial-day counts — they come from t(\'planTrialChipDays\', { trialDays })',
    );
  });

  console.log('\n[tests] paywall rewrite wiring — hero / features / plans / CTA / trust / legal\n');

  // Source-pin contracts for the kinetic-finance paywall rewrite. Each pin
  // asserts that the screen references the i18n key for the visible copy
  // so a future refactor that inlines a string instead of using the i18n
  // catalog breaks the harness loudly (instead of silently regressing the
  // localization).

  await test('hero eyebrow text is sourced from the i18n catalog (heroEyebrow)', () => {
    assert.ok(
      /\bt\(\s*['"]heroEyebrow['"]\s*\)/.test(proScreen),
      'pro screen must render the hero eyebrow via t(\'heroEyebrow\') — the "TICKETIFY PRO" pill is i18n-sourced',
    );
  });

  await test('hero headline is sourced from the i18n catalog (heroHeadline)', () => {
    assert.ok(
      /\bt\(\s*['"]heroHeadline['"]\s*\)/.test(proScreen),
      'pro screen must render the hero headline via t(\'heroHeadline\')',
    );
  });

  await test('hero subtitle is sourced from the i18n catalog (heroSubtitle)', () => {
    assert.ok(
      /\bt\(\s*['"]heroSubtitle['"]\s*\)/.test(proScreen),
      'pro screen must render the hero subtitle via t(\'heroSubtitle\')',
    );
  });

  await test('every feature title AND its description are referenced together (5 features × 2 keys)', () => {
    // Each benefit row must consume BOTH the existing title key and the
    // new description sibling — a feature row with a title but no
    // description (or vice versa) regresses the layout.
    //
    // The screen sources the keys from a data-driven FEATURE_ROWS
    // array (so the order + keys live in one place); the literal
    // `'benefitUnlimitedScans'` token only appears in that array, not
    // in a `t(...)` call site. We assert the token appears at least
    // once (in the array) AND that `t(row.titleKey)` / `t(row.descriptionKey)`
    // are called via the FEATURE_ROWS pattern.
    const titles = [
      'benefitUnlimitedScans',
      'benefitAdvancedStats',
      'benefitExportTickets',
      'benefitPriceAlerts',
      'benefitHousehold5',
    ];
    const descriptions = titles.map((t) => `${t}Description`);
    for (const title of titles) {
      assert.ok(
        proScreen.includes(`'${title}'`),
        `pro screen must list ${title} (feature title key, in FEATURE_ROWS array)`,
      );
    }
    for (const description of descriptions) {
      assert.ok(
        proScreen.includes(`'${description}'`),
        `pro screen must list ${description} (feature description key, in FEATURE_ROWS array)`,
      );
    }
    // And the screen actually renders the keys via t(row.titleKey) /
    // t(row.descriptionKey) somewhere in the FEATURE_ROWS map call site.
    assert.ok(
      /\bt\(\s*row\.titleKey\s*\)/.test(proScreen),
      'pro screen must call t(row.titleKey) in the FEATURE_ROWS render',
    );
    assert.ok(
      /\bt\(\s*row\.descriptionKey\s*\)/.test(proScreen),
      'pro screen must call t(row.descriptionKey) in the FEATURE_ROWS render',
    );
  });

  await test('annual plan card references the unified trial chip + day-template billing caption + equivalent monthly', () => {
    // The annual card body line ("Facturado anualmente (N días de
    // prueba gratis)…") + the green subline ("Equivale a solo
    // US$4.16 / mes") both come from the i18n catalog, NOT hardcoded
    // English/Spanish strings. The chip key is the unified
    // planTrialChipDays template (day count from introPhase) and the
    // day-less fallback planAnnualBillCaptionPlain covers the
    // introPhase-null path.
    for (const key of [
      'planTrialChipDays',
      'planAnnualBillCaption',
      'planAnnualBillCaptionPlain',
      'planAnnualEquivalentMonthly',
      'planBadgeSavings',
    ]) {
      assert.ok(
        new RegExp(`\\bt\\(\\s*['"]${key}['"]`).test(proScreen),
        `pro screen must reference ${key} (annual plan card copy)`,
      );
    }
  });

  await test('monthly plan card references the unified trial chip + caption + cancellation note', () => {
    for (const key of [
      'planTrialChipDays',
      'planMonthlyTrialCaption',
      'planMonthlyTrialCaptionPlain',
      'planMonthlyCancellationNote',
    ]) {
      assert.ok(
        new RegExp(`\\bt\\(\\s*['"]${key}['"]`).test(proScreen),
        `pro screen must reference ${key} (monthly plan card copy)`,
      );
    }
  });

  await test('CTA interpolates trialDays via the ctaStartTrialWithDays key (annual)', () => {
    // The screen renders the CTA copy via the model — `t(cta.key, cta.values)`,
    // where `cta.key` is one of `'ctaStartTrialWithDays'` or `'ctaContinuePro'`
    // (returned by `getCtaCopy`). The two literal key tokens MUST exist in
    // the model file so the source-pin on `cta.key` resolves.
    const modelFile = readFileSync(
      join(root, 'src', 'features', 'pro', 'paywall-model.ts'),
      'utf8',
    );
    assert.ok(
      /['"]ctaStartTrialWithDays['"]/.test(modelFile),
      'paywall model must reference ctaStartTrialWithDays (the key returned by getCtaCopy for the trial branch)',
    );
    assert.ok(
      /trialDays:\s*number/.test(modelFile),
      'paywall model\'s ctaStartTrialWithDays shape must carry trialDays in its values type',
    );
    // And the screen actually wires the model output through i18next —
    // `t(cta.key, cta.values)` keeps a single source of truth for the
    // interpolation contract.
    assert.ok(
      /\bt\(\s*cta\.key\s*,\s*cta\.values\s*\)/.test(proScreen),
      'pro screen must render the CTA via t(cta.key, cta.values) — single source of truth for interpolation',
    );
  });

  await test('CTA references the ctaContinuePro key (monthly branch)', () => {
    // Same model-pin contract: the no-trial branch's key token must live
    // in the model so `getCtaCopy(plan, null)` resolves to a renderable key.
    const modelFile = readFileSync(
      join(root, 'src', 'features', 'pro', 'paywall-model.ts'),
      'utf8',
    );
    assert.ok(
      /['"]ctaContinuePro['"]/.test(modelFile),
      'paywall model must reference ctaContinuePro (the key returned by getCtaCopy for the no-trial branch)',
    );
  });

  await test('getCtaCopy is wired into the screen (single source of truth for CTA copy)', () => {
    // The CTA copy decision MUST come from the pure model — the screen
    // renders the result via `t(cta.key, cta.values)`, never by branching
    // on plan === 'annual' inline.
    assert.ok(
      /\bgetCtaCopy\s*\(/.test(proScreen),
      'pro screen must call getCtaCopy(...) to resolve the CTA copy',
    );
  });

  await test('trust strip references all three microcopy keys', () => {
    for (const key of [
      'trustSecurePayment',
      'trustCancelAnytime',
      'trustSupport247',
    ]) {
      assert.ok(
        new RegExp(`\\bt\\(\\s*['"]${key}['"]`).test(proScreen),
        `pro screen must reference ${key} (trust strip microcopy)`,
      );
    }
  });

  await test('legal footer reuses the existing autoRenewalNotice + legalPrefix + termsAndConditionsLink + privacyPolicyLink', () => {
    // The legal footer is the SAME block as before — we don't add new
    // keys for the renewal/cancellation/links copy. Reuse the existing
    // keys to avoid orphan regression in test-i18n-pro-keys.mjs.
    for (const key of [
      'autoRenewalNotice',
      'legalPrefix',
      'termsAndConditionsLink',
      'privacyPolicyLink',
    ]) {
      assert.ok(
        new RegExp(`\\bt\\(\\s*['"]${key}['"]`).test(proScreen),
        `pro screen must reference ${key} (legal footer)`,
      );
    }
  });

  await test('pro screen has NO inline hardcoded "Suscripción PRO" string (must come from i18n)', () => {
    // Defensive: the screen title must come from the new
    // paywallProTitle key, not from a hardcoded "Suscripción PRO" string
    // that the i18n harness would miss.
    assert.ok(
      !/['"]Suscripci[oó]n PRO['"]/.test(proScreen),
      'pro screen must not hardcode "Suscripción PRO" — render it via t(paywallProTitle)',
    );
  });

  await test('pro screen header uses the paywallProTitle key (native Stack header title)', () => {
    assert.ok(
      /\bt\(\s*['"]paywallProTitle['"]\s*\)/.test(proScreen),
      'pro screen must render the header title via t(paywallProTitle)',
    );
  });

  await test('header a11y: only the close button label is referenced (account icon removed)', () => {
    assert.ok(
      /\bt\(\s*['"]closePaywallA11y['"]/.test(proScreen),
      'pro screen must reference closePaywallA11y (a11y label for the header close button)',
    );
    assert.ok(
      !/\bt\(\s*['"]accountA11y['"]/.test(proScreen),
      'pro screen must NOT reference accountA11y — the header account icon is removed',
    );
  });

  await test('headerRight renders exactly ONE IconButton (the xmark close button only)', () => {
    // Paywall polish: the header used to render two IconButtons
    // (person.fill → profile, xmark → back). On device both read as
    // "close this screen", so the account icon is gone. The header
    // right side must contain exactly one IconButton using xmark and
    // no person.fill anywhere in the headerRight block.
    const headerRightBlock =
      proScreen.match(/headerRight: \(\) => \([\s\S]*?\),\s*\n\s*\}/)?.[0] ??
      '';
    assert.ok(
      headerRightBlock.length > 0,
      'sanity: headerRight render-block must exist',
    );
    const iconButtons = headerRightBlock.match(/<IconButton/g) ?? [];
    assert.equal(
      iconButtons.length,
      1,
      'headerRight must render exactly one IconButton',
    );
    assert.ok(
      /icon="xmark"/.test(headerRightBlock),
      'the single headerRight IconButton must be the xmark close button',
    );
    assert.ok(
      !/person\.fill/.test(headerRightBlock),
      'headerRight must not reference the person.fill account icon',
    );
  });

  await test('pro screen references the cancelOrFreeTier secondary action', () => {
    assert.ok(
      /\bt\(\s*['"]cancelOrFreeTier['"]\s*\)/.test(proScreen),
      'pro screen must reference cancelOrFreeTier (secondary dismiss / free-tier button)',
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