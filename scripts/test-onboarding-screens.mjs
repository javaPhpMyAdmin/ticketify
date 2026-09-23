#!/usr/bin/env node
/**
 * Node harness for the onboarding screen source-pin contracts
 * (`src/app/onboarding/{step-1,step-2,step-3}.tsx`).
 *
 * Each step renders its own hero mockup + copy block + CTA. The
 * harness asserts that the screen files reference the i18n keys
 * exactly — this catches a future inline-string refactor that would
 * silently regress the localization, mirroring the
 * `test-paywall-model.mjs` source-pin pattern for the kinetic-finance
 * paywall rewrite.
 *
 * Asserted contracts (per step):
 *
 *   - Each step renders its `step<N>.headline` + `step<N>.body` keys.
 *   - Each step has its expected CTA (`continue` for 1-2,
 *     `startNow` for 3).
 *   - Sub-header back-arrow + setup pill on step-2 / step-3,
 *     NOT on step-1.
 *   - Pagination dots rendered (3 dots, active prop matches current
 *     step).
 *   - Hero mockup data strings for each step
 *     (`step1.storeName`, `step2.used`, `step3.weekTotal` etc.).
 *   - The legal copy on step-3 (`legalPrefix` + `legalTermsLink` +
 *     `legalPrivacyLink` linking to `/legal/terms` and
 *     `/legal/privacy`).
 *
 * Plus model contract pins (the screens MUST consume the model
 * helpers — `isLastStep`, `getStepIndex`, `getPreviousStep` — so a
 * future refactor that hardcodes step numbers fails loudly).
 *
 * Usage: pnpm test:onboarding-screens
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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

function readScreen(stepFile) {
  return readFileSync(join(root, 'src/app/onboarding', stepFile), 'utf8');
}

function readComponent(filePath) {
  return readFileSync(join(root, filePath), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────
// Step 1 — Scanner
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] step-1 — Scanner hero\n');

const step1 = readScreen('step-1.tsx');

test('step-1 renders the step1.headline + step1.body keys', () => {
  assert.ok(
    /t\(['"]step1\.headline['"]\s*\)/.test(step1),
    'step-1 screen must render t(\'step1.headline\')',
  );
  assert.ok(
    /t\(['"]step1\.body['"]\s*\)/.test(step1),
    'step-1 screen must render t(\'step1.body\')',
  );
});

test('step-1 CTA is "continue" (no SALTAR on this screen, no "startNow")', () => {
  assert.ok(
    /t\(['"]continue['"]/.test(step1),
    'step-1 must reference the continue CTA key',
  );
  assert.ok(
    !/t\(['"]startNow['"]/.test(step1),
    'step-1 must NOT reference startNow — only the terminal step uses Empezar ahora',
  );
  assert.ok(
    !/Empezar ahora/.test(step1),
    'step-1 must not hardcode "Empezar ahora"',
  );
});

test('step-1 has NO sub-header (the kiosk chrome is skipped on the entry point)', () => {
  // The shell renders the sub-header only when `showSubHeader` is true.
  // Step 1 passes `showSubHeader={false}` explicitly.
  assert.ok(
    /showSubHeader=\{false\}/.test(step1),
    'step-1 must pass showSubHeader={false} to OnboardingShell',
  );
  // It also shouldn't reference the setup pill key — that's a sub-header
  // detail. (Skip button text from `skip` key is referenced indirectly
  // through the shell, but we only assert via the prop wiring.)
});

test('step-1 uses PaginationDots with active=0 (first slide)', () => {
  assert.ok(
    /<PaginationDots\s+[^>]*total=\{TOTAL_STEPS\}[\s\S]*?active=\{0\}/.test(step1),
    'step-1 must render <PaginationDots total={TOTAL_STEPS} active={0} /> (first slide)',
  );
});

test('step-1 imports + renders the ScannerHeroMockup (the scanner card)', () => {
  assert.ok(
    /import\s*\{[^}]*ScannerHeroMockup[^}]*\}\s*from\s*['"]@\/features\/onboarding\/components\/ScannerHeroMockup['"]/.test(
      step1,
    ),
    'step-1 must import ScannerHeroMockup from @/features/onboarding/components/ScannerHeroMockup',
  );
  assert.ok(
    /<ScannerHeroMockup\s*\/>/.test(step1),
    'step-1 must render <ScannerHeroMockup />',
  );
});

test('step-1 secondary "Iniciar sesión" link routes to /sign-in', () => {
  // The handleSignIn closure in step-1 calls router.replace to /sign-in.
  // We assert the path literal appears alongside an a11y role="link"
  // for the secondary action so a future refactor that swaps the
  // target for the auth-deep-link route fails loudly.
  assert.ok(
    /router\.replace\(['"]\/sign-in['"]/.test(step1),
    'step-1 must call router.replace("/sign-in") for the secondary link',
  );
  assert.ok(
    /hasAccountPrompt/.test(step1) && /signInLink/.test(step1),
    'step-1 secondary link must reference hasAccountPrompt + signInLink i18n keys',
  );
});

// ─────────────────────────────────────────────────────────────────────
// Step 2 — Budget
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] step-2 — Budget hero\n');

const step2 = readScreen('step-2.tsx');

test('step-2 renders the step2.headline + step2.body keys', () => {
  assert.ok(
    /t\(['"]step2\.headline['"]\s*\)/.test(step2),
    'step-2 screen must render t(\'step2.headline\')',
  );
  assert.ok(
    /t\(['"]step2\.body['"]\s*\)/.test(step2),
    'step-2 screen must render t(\'step2.body\')',
  );
});

test('step-2 CTA is "continue" (intermediate step → push to step-3)', () => {
  assert.ok(
    /t\(['"]continue['"]/.test(step2),
    'step-2 must reference the continue CTA key',
  );
  assert.ok(
    /router\.push\(['"]\/onboarding\/step-3['"]/.test(step2),
    'step-2 CONTINUAR must router.push("/onboarding/step-3")',
  );
  assert.ok(
    !/t\(['"]startNow['"]/.test(step2),
    'step-2 must NOT reference startNow (terminal CTA is reserved for step-3)',
  );
});

test('step-2 has the sub-header with the back arrow + setup pill + SALTAR', () => {
  // Sub-header is enabled by default; only the explicit {false} form
  // disables it.
  assert.equal(
    /showSubHeader=\{false\}/.test(step2),
    false,
    'step-2 must NOT pass showSubHeader={false} — the default-true branch is enabled',
  );
  assert.equal(
    /showSkip=\{false\}/.test(step2),
    false,
    'step-2 must NOT pass showSkip={false} — SALTAR is present on the sub-header',
  );
});

test('step-2 uses PaginationDots with active=1 (middle slide)', () => {
  assert.ok(
    /<PaginationDots[\s\S]*?total=\{TOTAL_STEPS\}[\s\S]*?active=\{1\}/.test(step2),
    'step-2 must render <PaginationDots total={TOTAL_STEPS} active={1} />',
  );
});

test('step-2 imports + renders the BudgetHeroMockup', () => {
  assert.ok(
    /import\s*\{[^}]*BudgetHeroMockup[^}]*\}\s*from\s*['"]@\/features\/onboarding\/components\/BudgetHeroMockup['"]/.test(
      step2,
    ),
    'step-2 must import BudgetHeroMockup',
  );
  assert.ok(
    /<BudgetHeroMockup\s*\/>/.test(step2),
    'step-2 must render <BudgetHeroMockup />',
  );
});

test('step-2 SALTAR marks complete + replaces to /sign-in', () => {
  // The shell's SALTAR button is internal — we verify the secondary
  // sign-in link in step-2 marks complete (the shell's internal
  // Saltar is tested via the OnboardingShell source pin below).
  assert.ok(
    /markOnboardingCompleted/.test(step2),
    'step-2 must call markOnboardingCompleted somewhere (secondary "Iniciar sesión" link)',
  );
  assert.ok(
    /router\.replace\(['"]\/sign-in['"]/.test(step2),
    'step-2 secondary link must router.replace("/sign-in")',
  );
});

// ─────────────────────────────────────────────────────────────────────
// Step 3 — Insights
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] step-3 — Insights hero (terminal)\n');

const step3 = readScreen('step-3.tsx');

test('step-3 renders the step3.headline + step3.body keys', () => {
  assert.ok(
    /t\(['"]step3\.headline['"]\s*\)/.test(step3),
    'step-3 screen must render t(\'step3.headline\')',
  );
  assert.ok(
    /t\(['"]step3\.body['"]\s*\)/.test(step3),
    'step-3 screen must render t(\'step3.body\')',
  );
});

test('step-3 CTA is "startNow" (terminal — Empezar ahora)', () => {
  assert.ok(
    /t\(['"]startNow['"]/.test(step3),
    'step-3 must reference the startNow CTA key (Empezar ahora)',
  );
  assert.ok(
    !/t\(['"]continue['"]/.test(step3),
    'step-3 must NOT reference continue (terminal CTA is startNow, not continue)',
  );
  assert.ok(
    /router\.replace\(['"]\/sign-up['"]/.test(step3),
    'step-3 EMPEZAR must router.replace("/sign-up")',
  );
});

test('step-3 EMPEZAR marks complete (terminal CTA writes the flag)', () => {
  assert.ok(
    /markOnboardingCompleted\(\)/.test(step3),
    'step-3 EMPEZAR must call markOnboardingCompleted() before replacing to /sign-up',
  );
});

test('step-3 has the sub-header with back arrow + stepBadge pill (no SALTAR on terminal)', () => {
  // Sub-header is enabled by default; only the explicit {false} form
  // disables it. The regex is intentionally non-greedy on the trailing
  // boundary because `=` is not a word character (so `\b` after `{false}`
  // never matches — match the literal substring instead).
  assert.equal(
    /showSubHeader=\{false\}/.test(step3),
    false,
    'step-3 must NOT pass showSubHeader={false} — the default-true branch is enabled',
  );
  assert.equal(
    /showSkip=\{false\}/.test(step3),
    true,
    'step-3 must skip the Saltar button — the terminal CTA owns the flow exit',
  );
});

test('step-3 uses PaginationDots with active=2 (last slide)', () => {
  assert.ok(
    /<PaginationDots[\s\S]*?total=\{TOTAL_STEPS\}[\s\S]*?active=\{2\}/.test(step3),
    'step-3 must render <PaginationDots total={TOTAL_STEPS} active={2} />',
  );
});

test('step-3 imports + renders the InsightsHeroMockup', () => {
  assert.ok(
    /import\s*\{[^}]*InsightsHeroMockup[^}]*\}\s*from\s*['"]@\/features\/onboarding\/components\/InsightsHeroMockup['"]/.test(
      step3,
    ),
    'step-3 must import InsightsHeroMockup',
  );
  assert.ok(
    /<InsightsHeroMockup\s*\/>/.test(step3),
    'step-3 must render <InsightsHeroMockup />',
  );
});

test('step-3 legal footer wires terms + privacy routes through openLegalDocument', () => {
  assert.ok(
    /openLegalDocument\(['"]terms['"]\)/.test(step3),
    'step-3 must call openLegalDocument(\'terms\') for the Términos link',
  );
  assert.ok(
    /openLegalDocument\(['"]privacy['"]\)/.test(step3),
    'step-3 must call openLegalDocument(\'privacy\') for the Política link',
  );
  // The three i18n keys must be referenced in the legal footer block.
  assert.ok(
    /legalPrefix/.test(step3) &&
      /legalTermsLink/.test(step3) &&
      /legalPrivacyLink/.test(step3),
    'step-3 must reference legalPrefix + legalTermsLink + legalPrivacyLink keys',
  );
});

// ─────────────────────────────────────────────────────────────────────
// Hero mockup data strings (smoke test — assert the i18n keys reach
// the mockup files, so a future refactor that drops a label breaks
// the harness loudly).
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] hero mockup wiring\n');

const scanner = readComponent(
  'src/features/onboarding/components/ScannerHeroMockup.tsx',
);
const budget = readComponent(
  'src/features/onboarding/components/BudgetHeroMockup.tsx',
);
const insights = readComponent(
  'src/features/onboarding/components/InsightsHeroMockup.tsx',
);

test('ScannerHeroMockup renders the ticket + chip + AUTO-ENFOQUE keys', () => {
  for (const key of [
    'step1.aiSyncBadge',
    'step1.storeName',
    'step1.storeRef',
    'step1.total',
    'step1.item1',
    'step1.item2',
    'step1.item3',
    'step1.item1Price',
    'step1.item2Price',
    'step1.item3Price',
    'step1.chipCategory',
    'step1.chipTax',
    'step1.autoFocus',
  ]) {
    assert.ok(
      scanner.includes(`'${key}'`) || scanner.includes(`"${key}"`),
      `ScannerHeroMockup must reference the i18n key "${key}"`,
    );
  }
});

test('BudgetHeroMockup renders the limit active pill + total + safeToSpend + categories + auto-cat', () => {
  for (const key of [
    'step2.limitActive',
    'step2.monthPill',
    'step2.used',
    'step2.total',
    'step2.safeToSpend',
    'step2.usedLabel',
    'step2.daysLeft',
    'step2.catHomeLabel',
    'step2.catFoodLabel',
    'step2.catSuperLabel',
    'step2.catLeisureLabel',
    'step2.catHomeAmount',
    'step2.catFoodAmount',
    'step2.catSuperAmount',
    'step2.catLeisureAmount',
    'step2.autoCatTitle',
    'step2.autoCatSubtitle',
  ]) {
    assert.ok(
      budget.includes(`'${key}'`) || budget.includes(`"${key}"`),
      `BudgetHeroMockup must reference the i18n key "${key}"`,
    );
  }
});

test('InsightsHeroMockup renders the week header + total + delta + labels + milestone + perf', () => {
  for (const key of [
    'step3.weekHeader',
    'step3.weekTotal',
    'step3.weekDelta',
    'step3.dayLabels',
    'step3.dayHigh',
    'step3.milestone',
    'step3.perfLabel',
    'step3.perfValue',
  ]) {
    assert.ok(
      insights.includes(`'${key}'`) || insights.includes(`"${key}"`),
      `InsightsHeroMockup must reference the i18n key "${key}"`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// Model helper consumption — every screen must reach into the model
// (no hardcoded `1`/`2`/`3` constants for step identity).
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] model helper consumption (no hardcoded step indices)\n');

const shell = readComponent(
  'src/features/onboarding/components/OnboardingShell.tsx',
);
const model = readComponent('src/features/onboarding/onboarding-model.ts');

test('OnboardingShell imports the model helpers it uses (getPreviousStep, Step)', () => {
  assert.ok(
    /import\s*\{[^}]*getPreviousStep[^}]*\}\s*from/.test(shell) &&
      /getPreviousStep\(step\)/.test(shell),
    'OnboardingShell must consume getPreviousStep from the model',
  );
  // The Step type can be imported two ways: `import { Step } from ...`
  // or `import { type Step } from ...`. Both are valid TS / eslint; the
  // latter is the modern inline-type-modifier form.
  assert.ok(
    /import\s*(?:\{[^}]*\bStep\b[^}]*\}|\{[^}]*type\s+Step\b[^}]*\})\s*from/.test(
      shell,
    ) ||
      /\btype\s+Step\b/.test(shell),
    'OnboardingShell must import the Step type from the model',
  );
});

test('TOTAL_STEPS is exported by the model and consumed by every screen', () => {
  assert.ok(
    /export\s+const\s+TOTAL_STEPS\s*=/.test(model),
    'model must export TOTAL_STEPS = 3',
  );
  for (const file of [step1, step2, step3]) {
    assert.ok(
      /TOTAL_STEPS/.test(file),
      `screen must reference TOTAL_STEPS (PaginationDots total prop)`,
    );
  }
});

test('step-2 + step-3 use getStepIndex instead of hardcoded numbers', () => {
  assert.ok(
    /getStepIndex\(['"]step-2['"]\)/.test(step2),
    'step-2 must call getStepIndex(\'step-2\') for the badge (no hardcoded 2)',
  );
  assert.ok(
    /getStepIndex\(['"]step-3['"]\)/.test(step3),
    'step-3 must call getStepIndex(\'step-3\') for the badge',
  );
  // Defensive: no literal `> {2}<` etc. floats in the badge prop.
  assert.ok(
    !/StepBadge[^>]*step=\{2\}/.test(step3),
    'step-3 must not hardcode step={2} — it must come from getStepIndex',
  );
});

test('step-3 wires `isLastStep` (the model helper that drives terminal semantics)', () => {
  // The terminal CTA calls router.replace("/sign-up") instead of
  // push, and the source pin asserts the import surface.
  assert.ok(
    /import\s*\{[^}]*isLastStep[^}]*\}\s+from\s*['"]@\/features\/onboarding\/onboarding-model['"]/.test(
      step3,
    ) ||
      /isLastStep/.test(step3),
    'step-3 must import the isLastStep helper',
  );
});

// ─────────────────────────────────────────────────────────────────────
// OnboardingShell wiring — the shared chrome is the source of truth
// for the SALTAR skip button + back arrow.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] OnboardingShell wiring\n');

test('OnboardingShell renders the SALTAR skip button (router.replace to /sign-in)', () => {
  assert.ok(
    /router\.replace\(['"]\/sign-in['"]/.test(shell),
    'OnboardingShell must router.replace("/sign-in") for SALTAR',
  );
  assert.ok(
    /t\(['"]skip['"]/.test(shell),
    'OnboardingShell must render the SALTAR label via t(\'skip\')',
  );
});

test('OnboardingShell renders the back arrow via the arrow_back icon', () => {
  assert.ok(
    /<Icon\s+name=['"]arrow_back['"]/.test(shell),
    'OnboardingShell must render the back-arrow Icon',
  );
  assert.ok(
    /t\(['"]backA11y['"]/.test(shell),
    'OnboardingShell must label the back arrow with t(\'backA11y\')',
  );
});

test('OnboardingShell renders the setup pill (onboardingSetupBadge key)', () => {
  assert.ok(
    /t\(['"]onboardingSetupBadge['"]/.test(shell),
    'OnboardingShell must render the setup pill via t(\'onboardingSetupBadge\')',
  );
});

// ─────────────────────────────────────────────────────────────────────
// Root layout gate (source-pin) — onboarding preview override
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] root layout gate (onboarding preview override)\n');

const layout = readComponent('src/app/_layout.tsx');

test('root layout reads EXPO_PUBLIC_ONBOARDING_PREVIEW env', () => {
  assert.ok(
    /process\.env\.EXPO_PUBLIC_ONBOARDING_PREVIEW\s*===\s*['"]true['"]/.test(layout),
    'root layout must derive onboardingPreview from process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW === "true"',
  );
});

test('signed-in early return is conditioned on !onboardingPreview', () => {
  assert.ok(
    /session\s+!=\s*null\s+&&\s*!onboardingPreview/.test(layout),
    'signed-in early return must be `if (session != null && !onboardingPreview)`',
  );
});

test('completed early return is conditioned on !onboardingPreview', () => {
  assert.ok(
    /completed\s+&&\s*!onboardingPreview/.test(layout),
    'completed-flag early return must be `if (completed && !onboardingPreview)`',
  );
});

test('inOnboarding is unconditional early return before allowlist', () => {
  // Ensure the shape: `if (inOnboarding) return;` appears before the
  // allowlist check (the spec keeps inOnboarding FIRST and unconditional,
  // ahead of `if (allowlisted && !onboardingPreview) return;`).
  const idxInOnboardingReturn = layout.indexOf('if (inOnboarding) return;');
  const idxAllowlistCheck = layout.indexOf(
    'if (allowlisted && !onboardingPreview) return;',
  );
  assert.ok(
    idxInOnboardingReturn > -1,
    'root layout must have `if (inOnboarding) return;` as an unconditional early return',
  );
  assert.ok(
    idxAllowlistCheck > -1,
    'root layout must keep `if (allowlisted && !onboardingPreview) return;`',
  );
  assert.ok(
    idxInOnboardingReturn < idxAllowlistCheck,
    '`if (inOnboarding) return;` must appear BEFORE the allowlist check',
  );
});

test('allowlist guard is bypassed under preview', () => {
  assert.ok(
    /allowlisted\s+&&\s*!onboardingPreview/.test(layout),
    'allowlist bypass must be conditioned with `!onboardingPreview`',
  );
});

test('root layout redirects to the wizard via router.replace("/onboarding/step-1")', () => {
  // The pins above cover env read, conditions and ordering but NOT the
  // redirect itself: deleting this router.replace call leaves every other
  // gate test green. Pin the literal so a removed or mis-targeted redirect
  // (e.g. `/onboarding/step-2`) fails loudly.
  assert.ok(
    /router\.replace\(\s*['"]\/onboarding\/step-1['"]/.test(layout),
    'the onboarding gate must router.replace("/onboarding/step-1") — deleting the redirect keeps every other pin green',
  );
  // The literal must live inside the onboarding gate effect (after the
  // onboardingChecked ref) — not in the session-nav effect above it, which
  // also calls router.replace (with `decision.target`).
  const refIdx = layout.indexOf('const onboardingChecked = useRef(false);');
  const step1Idx = layout.indexOf("'/onboarding/step-1'");
  assert.ok(
    refIdx > -1 && step1Idx > refIdx,
    "the '/onboarding/step-1' literal must appear inside the onboarding gate effect (after the onboardingChecked ref)",
  );
});

test('signed-in branch marks the check complete (onboardingChecked.current = true)', () => {
  // Removing `onboardingChecked.current = true;` from the signed-in guard
  // body would leave the `session != null && !onboardingPreview` pin green
  // while re-entering signed-in users into the wizard on preview-OFF. The
  // async IIFE below re-assigns the same flag, so the pin must prove the
  // guard-body occurrence exists BEFORE the IIFE.
  const guardIdx = layout.indexOf(
    'if (session != null && !onboardingPreview) {',
  );
  const iifeIdx = layout.indexOf('(async () => {', guardIdx);
  const flagIdx = layout.indexOf('onboardingChecked.current = true;', guardIdx);
  assert.ok(
    guardIdx > -1,
    'signed-in guard `if (session != null && !onboardingPreview) {` must exist',
  );
  assert.ok(
    flagIdx > -1 && flagIdx < iifeIdx,
    'signed-in guard body must set onboardingChecked.current = true BEFORE the async IIFE (the IIFE assignment alone is a false positive)',
  );
});

console.log('');
if (failed > 0) {
  console.error(`[tests] ${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`[tests] all ${passed} tests passed`);
}

