#!/usr/bin/env node
/**
 * Node harness for the auth screen source-pin contracts
 * (`src/app/(auth)/sign-up.tsx`, `src/app/(auth)/sign-in.tsx` and the
 * shared `src/lib/auth/validation.ts` helper).
 *
 * Mirrors `scripts/test-onboarding-screens.mjs`: pure source pins via
 * readFileSync, no compile step. The screens are NOT covered by any
 * behavioral harness (they are not in tsconfig.auth-test.json), so this
 * harness pins the source shapes that carry the auth-screen slice:
 *
 *   A. Legal consent dedup (sign-up): the consent sentence
 *      (auth:signUpLegalPrefix + auth:signUpLegalAnd) must appear
 *      EXACTLY ONCE as RENDERED text — inside the consent row label,
 *      where the two document names are REAL inline in-app links
 *      (openLegalDocument('privacy'|'terms')). The checkbox's
 *      accessibility label reuses the same composition (it is
 *      invisible, so it must NOT count as a second rendering). The
 *      legal footer keeps only bare document chips and must NOT
 *      repeat the sentence.
 *   B. Validation module: EMAIL_REGEX (RFC-lite), the min-8 password
 *      constant, and the guards that use them, must exist with the
 *      exact pinned shapes — no trivial regex, no hardcoded 8.
 *   C. Screen wiring: both screens import the validators, set per-field
 *      errors (setEmailFieldError / setPasswordFieldError) BEFORE any
 *      network call, surface them inline through FieldGroup's `error`
 *      prop, and the sign-up silent <8-char guard is gone (submit
 *      gates no longer block on field content — validation owns it).
 *   D. i18n: the new validation keys exist in all three locale
 *      catalogs with non-empty values, passwordMinLength stays aligned
 *      with the existing newPasswordHelper copy, and the auth key sets
 *      remain identical across es-AR / en / pt-BR.
 *   E. Single-provider contract: the Apple UI entry point is gone —
 *      sign-in has exactly ONE provider button (Google), references
 *      neither handleProvider('apple') nor t('auth:continueWithApple'),
 *      and auth.json drops the continueWithApple key in all three
 *      locales while keeping continueWithGoogle. The oauth.ts module
 *      capability ('apple' in OAuthProvider) stays untouched — it is
 *      pinned by scripts/test-auth.mjs.
 *   F. Brand header contract: BOTH screens render the shared Logo atom
 *      (`src/components/atoms/Logo/Logo.tsx`) as the FIRST child of the
 *      heading block — order logo → title → subtitle, NO standalone
 *      kicker (the wordmark now lives INSIDE the logo; the auth:kicker
 *      key survives on forgot/reset only) — imported from the
 *      `@/components` barrel. The atom itself is pinned to the
 *      react-native-svg EMERALD port of the ticket mark (masked side
 *      notches, white T monogram + QR glyph, perforation line AND the
 *      white TICKETIFY wordmark), a 120-160pt default size prop, and a
 *      reanimated entrance that opts into ReduceMotion.System so the
 *      animation dies under OS reduced motion.
 *   G. Google provider on BOTH auth screens: the GoogleG glyph is a
 *      SHARED atom (src/components/atoms/GoogleG, exported via the
 *      @/components barrel — no inline duplicates); sign-in AND sign-up
 *      render the same divider + "Continue with Google" button wired to
 *      handleProvider('google') with the same providerBusy logic; sign-up
 *      gates its form on providerBusy exactly like sign-in.
 *   H. Auth form UX: password fields on BOTH screens are the shared
 *      PasswordField molecule (exported via the @/components barrel),
 *      which owns a `visible` state driving secureTextEntry={!visible}
 *      and an inline eye/eye.slash toggle button with the localized
 *      show/hidePassword labels; Icon.tsx carries the eye glyphs; the
 *      sign-up form gains a confirm-password field validated by
 *      validateConfirmPassword(confirm, original) with the
 *      passwordMismatch key; email/password/confirm validate on BLUR
 *      (only when the field has content); the new i18n keys exist in
 *      all three locales.
 *
 * Usage: pnpm test:auth-screens
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

function readAuthScreen(file) {
  return readFileSync(join(root, 'src/app/(auth)', file), 'utf8');
}

function readComponent(filePath) {
  return readFileSync(join(root, filePath), 'utf8');
}

const LOCALES_ROOT = join(root, 'src', 'i18n', 'locales');
const LOCALE_TAGS = ['es-AR', 'en', 'pt-BR'];
const readAuth = (locale) =>
  JSON.parse(readFileSync(join(LOCALES_ROOT, locale, 'auth.json'), 'utf8'));
const keySet = (catalog) => Object.keys(catalog).sort().join(',');

// ─────────────────────────────────────────────────────────────────────
// A. Sign-up legal consent dedup — sentence EXACTLY ONCE, links IN
// the consent row, footer reduced to bare chips.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] sign-up legal consent dedup\n');

const signUp = readAuthScreen('sign-up.tsx');
const consentStart = signUp.indexOf('{/* Explicit legal consent');
const consentEnd = signUp.indexOf('{consentError ?', consentStart);
const consentBlock =
  consentStart > -1 && consentEnd > consentStart
    ? signUp.slice(consentStart, consentEnd)
    : '';
const footerStart = signUp.indexOf('styles.legalFooter');
const footerEnd = signUp.indexOf('</ScrollView>', footerStart);
const footerBlock =
  footerStart > -1 && footerEnd > footerStart
    ? signUp.slice(footerStart, footerEnd)
    : '';
const visibleSentenceStart = signUp.indexOf('<Text style={styles.consentText}>');
const visibleSentenceBlock =
  visibleSentenceStart > -1 && consentEnd > visibleSentenceStart
    ? signUp.slice(visibleSentenceStart, consentEnd)
    : '';

test('sign-up renders the legal consent sentence exactly once in the VISIBLE label (signUpLegalPrefix count === 1 in the rendered sentence)', () => {
  const count = (visibleSentenceBlock.match(/signUpLegalPrefix/g) ?? []).length;
  assert.equal(
    count,
    1,
    'signUpLegalPrefix must appear exactly once as RENDERED text — the checkbox accessibility label reuses the same composition without duplicating the visible sentence',
  );
});

test('sign-up renders the consent connector exactly once in the VISIBLE label (signUpLegalAnd count === 1 in the rendered sentence)', () => {
  const count = (visibleSentenceBlock.match(/signUpLegalAnd/g) ?? []).length;
  assert.equal(
    count,
    1,
    'signUpLegalAnd must appear exactly once as RENDERED text — the checkbox accessibility label reuses the same composition',
  );
});

test('sign-up consent row embeds a real in-app privacy link (openLegalDocument("privacy"))', () => {
  assert.ok(
    /openLegalDocument\(['"]privacy['"]\)/.test(consentBlock),
    'the consent row block must call openLegalDocument(\'privacy\')',
  );
});

test('sign-up consent row embeds a real in-app terms link (openLegalDocument("terms"))', () => {
  assert.ok(
    /openLegalDocument\(['"]terms['"]\)/.test(consentBlock),
    'the consent row block must call openLegalDocument(\'terms\')',
  );
});

test('sign-up consent row: checkbox keeps role=checkbox; document names are role=link with settings a11y labels', () => {
  assert.ok(
    /accessibilityRole="checkbox"/.test(consentBlock) &&
      /accessibilityState=\{\{ checked: consentAccepted \}\}/.test(consentBlock),
    'the consent checkbox Pressable must keep accessibilityRole="checkbox" with the checked state',
  );
  const links = (consentBlock.match(/accessibilityRole="link"/g) ?? []).length;
  assert.equal(links, 2, 'exactly two inline document links must render in the consent row');
  assert.ok(
    consentBlock.includes("t('settings:privacyPolicy')") &&
      consentBlock.includes("t('settings:termsConditions')"),
    'the inline links must be labelled with the settings privacy/terms keys',
  );
});

test('sign-up consent row: the full row AND the checkbox box both toggle consent (handleConsentToggle x2)', () => {
  const count = (consentBlock.match(/onPress=\{handleConsentToggle\}/g) ?? []).length;
  assert.equal(
    count,
    2,
    'both the row container and the checkbox box must toggle consent — the whole row is the touch target, not just the 24x24 box',
  );
});

test('sign-up checkbox a11y label composes the consent sentence (prefix + privacy + and + terms, not the error copy)', () => {
  assert.ok(
    consentBlock.includes(
      "accessibilityLabel={`${t('auth:signUpLegalPrefix')}${t('settings:privacyPolicy')}${t('auth:signUpLegalAnd')}${t('settings:termsConditions')}`}",
    ),
    'the checkbox accessibility label must compose the consent sentence from the four keys',
  );
  assert.ok(
    !consentBlock.includes("accessibilityLabel={t('legal:signUpConsentRequired')}"),
    'the checkbox accessibility label must NOT reuse the consent-required error copy — that stays display-only error text',
  );
});

test('sign-up legal footer drops the repeated sentence (no signUpLegalPrefix/signUpLegalAnd in the footer block)', () => {
  assert.ok(
    !footerBlock.includes('signUpLegalPrefix'),
    'the legal footer must NOT repeat signUpLegalPrefix — the consent row owns the sentence',
  );
  assert.ok(
    !footerBlock.includes('signUpLegalAnd'),
    'the legal footer must NOT repeat signUpLegalAnd',
  );
});

test('sign-up legal footer keeps bare privacy + terms chips with the dot separator', () => {
  assert.ok(
    /openLegalDocument\(['"]privacy['"]\)/.test(footerBlock) &&
      /openLegalDocument\(['"]terms['"]\)/.test(footerBlock),
    'the footer chips must still open the in-app documents',
  );
  const links = (footerBlock.match(/accessibilityRole="link"/g) ?? []).length;
  assert.equal(links, 2, 'exactly two bare document chips must remain in the footer');
  assert.ok(
    footerBlock.includes('·'),
    'the footer chips must be separated by the "·" separator',
  );
});

// ─────────────────────────────────────────────────────────────────────
// B. Validation module — the pure helpers the screens consume.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] validation module (src/lib/auth/validation.ts)\n');

const validation = readComponent('src/lib/auth/validation.ts');

test('EMAIL_REGEX is exported with the exact RFC-lite pattern', () => {
  assert.ok(
    validation.includes(
      'export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$/;',
    ),
    'validation.ts must export EMAIL_REGEX with the pinned RFC-lite pattern',
  );
});

test('SIGN_UP_MIN_PASSWORD_LENGTH is exported as exactly 8', () => {
  assert.ok(
    validation.includes('export const SIGN_UP_MIN_PASSWORD_LENGTH = 8;'),
    'validation.ts must export SIGN_UP_MIN_PASSWORD_LENGTH = 8 as a named constant',
  );
});

test('validateEmail tests against EMAIL_REGEX and validateSignUpPassword uses the min-length constant', () => {
  assert.ok(
    /function validateEmail[\s\S]{0,300}?EMAIL_REGEX\.test/.test(validation),
    'validateEmail must run the value through EMAIL_REGEX.test',
  );
  assert.ok(
    /function validateSignUpPassword[\s\S]{0,200}?SIGN_UP_MIN_PASSWORD_LENGTH/.test(validation),
    'validateSignUpPassword must compare against SIGN_UP_MIN_PASSWORD_LENGTH (no hardcoded 8)',
  );
});

// ─────────────────────────────────────────────────────────────────────
// C. Screen wiring — imports, per-field errors, guards.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] screen validation wiring\n');

const signIn = readAuthScreen('sign-in.tsx');

test('sign-in imports validateEmail + validateSignInPassword from @/lib/auth/validation', () => {
  assert.ok(
    /import\s*\{[\s\S]{0,200}?validateEmail[\s\S]{0,200}?validateSignInPassword[\s\S]{0,200}?\}\s*from\s*['"]@\/lib\/auth\/validation['"]/.test(
      signIn,
    ),
    'sign-in must import validateEmail + validateSignInPassword from @/lib/auth/validation',
  );
});

test('sign-up imports validateEmail + validateSignUpPassword from @/lib/auth/validation', () => {
  assert.ok(
    /import\s*\{[\s\S]{0,200}?validateEmail[\s\S]{0,200}?validateSignUpPassword[\s\S]{0,200}?\}\s*from\s*['"]@\/lib\/auth\/validation['"]/.test(
      signUp,
    ),
    'sign-up must import validateEmail + validateSignUpPassword from @/lib/auth/validation',
  );
});

test('sign-in: invalid email → setEmailFieldError before the network call (guard returns)', () => {
  assert.ok(
    /const emailErr = validateEmail\(email\);/.test(signIn),
    'sign-in must compute the email error via validateEmail(email)',
  );
  assert.ok(
    /setEmailFieldError\(emailErr\);/.test(signIn),
    'sign-in must set the email field error from the validator result',
  );
  assert.ok(
    /if \(emailErr \|\| passwordErr\) return;/.test(signIn),
    'sign-in must return early when either field is invalid BEFORE calling signInWithEmail',
  );
});

test('sign-in: empty password → setPasswordFieldError (non-empty rule)', () => {
  assert.ok(
    /const passwordErr = validateSignInPassword\(password\);/.test(signIn),
    'sign-in must compute the password error via validateSignInPassword(password)',
  );
  assert.ok(
    /setPasswordFieldError\(passwordErr\);/.test(signIn),
    'sign-in must set the password field error from the validator result',
  );
});

test('sign-in passes the TRIMMED email to the store call (signInWithEmail(email.trim(), password))', () => {
  assert.ok(
    /signInWithEmail\(email\.trim\(\), password\)/.test(signIn),
    'sign-in must pass the trimmed email to signInWithEmail — the validators trim, so the server must receive the trimmed value, not the raw input',
  );
});

test('sign-in submit gate no longer blocks on field content (canSubmit = !pending && !providerBusy)', () => {
  assert.ok(
    /const canSubmit = !pending && !providerBusy;/.test(signIn),
    'sign-in canSubmit must only gate on pending/providerBusy so pressing surfaces inline errors',
  );
});

test('sign-in submit disabled simplifies to !canSubmit (providerBusy already inside canSubmit)', () => {
  assert.ok(
    /disabled=\{!canSubmit\}/.test(signIn),
    'the submit button must gate on !canSubmit only',
  );
  assert.ok(
    !/disabled=\{!canSubmit \|\| providerBusy\}/.test(signIn),
    'the redundant providerBusy condition must be GONE — canSubmit already includes providerBusy, and the double condition invites a future "fix" that reintroduces the busy race',
  );
});

test('sign-up: validation guard runs BEFORE the consent gate (no silent return)', () => {
  // Tolerant of the confirm-password error (added with the form-UX change):
  // `if (emailErr || passwordErr) return;` and
  // `if (emailErr || passwordErr || confirmErr) return;` both satisfy it.
  const guardMatch = signUp.match(
    /if \(emailErr \|\| passwordErr(?:\s*\|\|\s*confirmErr)?\) return;/,
  );
  const guardIdx = guardMatch ? guardMatch.index : -1;
  const consentIdx = signUp.indexOf('if (!consentAccepted) {');
  assert.ok(
    guardIdx > -1 && consentIdx > -1 && guardIdx < consentIdx,
    'sign-up must validate fields (email + password + confirm) and return BEFORE the consent gate',
  );
});

test('sign-up: consent gate sets the consent error BEFORE returning (U5/AD-10)', () => {
  const consentIdx = signUp.indexOf('if (!consentAccepted) {');
  const callIdx = signUp.indexOf('signUpWithEmail(', consentIdx);
  const gateBlock =
    consentIdx > -1 && callIdx > consentIdx
      ? signUp.slice(consentIdx, callIdx)
      : '';
  const errIdx = gateBlock.indexOf('setConsentError(');
  const retIdx = gateBlock.indexOf('return;');
  assert.ok(
    consentIdx > -1 && errIdx > -1 && retIdx > -1 && errIdx < retIdx,
    'the consent gate must set the consent error BEFORE the return — removing the return (sign-up proceeds despite the error) must fail this harness',
  );
});

test('sign-up: consent gate precedes signUpWithEmail in source (U5/AD-10)', () => {
  const consentIdx = signUp.indexOf('if (!consentAccepted) {');
  const callIdx = signUp.indexOf('signUpWithEmail(');
  assert.ok(
    consentIdx > -1 && callIdx > -1 && consentIdx < callIdx,
    'the consent gate must appear BEFORE the signUpWithEmail call in the source — sign-up must never reach the network call on an unchecked box',
  );
});

test('sign-up: silent <8-char guard removed (validateSignUpPassword replaces it)', () => {
  assert.ok(
    /const passwordErr = validateSignUpPassword\(password\);/.test(signUp),
    'sign-up must compute the password error via validateSignUpPassword(password)',
  );
  assert.ok(
    /setPasswordFieldError\(passwordErr\);/.test(signUp),
    'sign-up must set the password field error from the validator result',
  );
  assert.ok(
    !/if \(email\.trim\(\)\.length === 0 \|\| password\.length < 8/.test(signUp),
    'the old silent guard (email empty || password < 8 → return) must be GONE',
  );
});

test('sign-up passes the TRIMMED email to the store call (signUpWithEmail(email.trim(), password))', () => {
  assert.ok(
    /signUpWithEmail\(email\.trim\(\), password\)/.test(signUp),
    'sign-up must pass the trimmed email to signUpWithEmail — the validators trim, so the server must receive the trimmed value, not the raw input',
  );
});

test('sign-up submit gate no longer blocks on field content (canSubmit = !pending && !providerBusy)', () => {
  assert.ok(
    /const canSubmit = !pending && !providerBusy;/.test(signUp),
    'sign-up canSubmit must gate on pending/providerBusy only (mirrors sign-in) so pressing surfaces inline errors regardless of field content',
  );
});

test('sign-in renders per-field errors via the FieldGroup error prop (email + password)', () => {
  assert.ok(
    /error=\{\s*emailFieldError \? t\(`auth:\$\{emailFieldError\}`\) : undefined\s*\}/.test(signIn),
    'sign-in email FieldGroup must render the inline email error via the error prop',
  );
  assert.ok(
    /error=\{\s*passwordFieldError \? t\(`auth:\$\{passwordFieldError\}`\) : undefined\s*\}/.test(signIn),
    'sign-in password FieldGroup must render the inline password error via the error prop',
  );
});

test('sign-up renders per-field errors via the FieldGroup error prop (email + password)', () => {
  assert.ok(
    /error=\{\s*emailFieldError \? t\(`auth:\$\{emailFieldError\}`\) : undefined\s*\}/.test(signUp),
    'sign-up email FieldGroup must render the inline email error via the error prop',
  );
  assert.ok(
    /error=\{\s*passwordFieldError \? t\(`auth:\$\{passwordFieldError\}`\) : undefined\s*\}/.test(signUp),
    'sign-up password FieldGroup must render the inline password error via the error prop',
  );
});

// ─────────────────────────────────────────────────────────────────────
// D. i18n — new validation keys, aligned copy, identical key sets.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] auth catalog validation keys\n');

const VALIDATION_KEYS = [
  'emailRequired',
  'emailInvalid',
  'passwordRequired',
  'passwordMinLength',
];

test('auth.json validation keys exist with non-empty values in all three locales', () => {
  for (const locale of LOCALE_TAGS) {
    const auth = readAuth(locale);
    for (const key of VALIDATION_KEYS) {
      const where = `${locale}/auth.json:${key}`;
      assert.ok(key in auth, `missing validation key ${where}`);
      assert.equal(typeof auth[key], 'string', `${where} must be a string`);
      assert.ok(auth[key].length > 0, `${where} must be non-empty`);
    }
  }
});

test('passwordMinLength aligns with newPasswordHelper in each locale', () => {
  for (const locale of LOCALE_TAGS) {
    const auth = readAuth(locale);
    assert.equal(
      auth.passwordMinLength,
      auth.newPasswordHelper,
      `${locale}/auth.json: passwordMinLength must match the existing newPasswordHelper copy`,
    );
  }
});

test('auth.json key sets stay identical across the three locales', () => {
  const esAr = readAuth('es-AR');
  const en = readAuth('en');
  const ptBr = readAuth('pt-BR');
  assert.equal(keySet(en), keySet(esAr), 'auth parity: en vs es-AR');
  assert.equal(keySet(ptBr), keySet(esAr), 'auth parity: pt-BR vs es-AR');
});

// ─────────────────────────────────────────────────────────────────────
// E. Single-provider contract — the Apple UI entry point is removed,
// Google stays as the only provider button, and the i18n key follows.
// The oauth.ts capability MUST survive (test-auth.mjs pins
// signInWithProvider('apple')) — only the UI/screen and catalogs change.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] sign-in single-provider contract (Apple UI entry removed)\n');

const APPLE_LABEL_KEY = 'continueWithApple';

test('sign-in drops the Apple provider button (no handleProvider(\'apple\'), no providerPending === \'apple\')', () => {
  assert.ok(
    !/handleProvider\(\s*['"]apple['"]\s*\)/.test(signIn),
    'sign-in must no longer call handleProvider(\'apple\') — the Apple UI entry point is removed',
  );
  assert.ok(
    !signIn.includes("providerPending === 'apple'"),
    'sign-in must no longer branch on providerPending === \'apple\'',
  );
});

test('sign-in no longer renders the continueWithApple label (no t(\'auth:continueWithApple\'))', () => {
  assert.ok(
    !signIn.includes(`t('auth:${APPLE_LABEL_KEY}')`),
    'sign-in must not render the Apple label — t(\'auth:continueWithApple\') must be gone from the screen',
  );
});

test('sign-in keeps the Google button as the single provider (exactly one handleProvider call)', () => {
  assert.ok(
    /handleProvider\(\s*['"]google['"]\s*\)/.test(signIn),
    'sign-in must keep the Google provider button (handleProvider(\'google\'))',
  );
  assert.ok(
    signIn.includes("t('auth:continueWithGoogle')"),
    'sign-in must keep the Google label t(\'auth:continueWithGoogle\')',
  );
  const providerCalls = (
    signIn.match(/handleProvider\(\s*['"][^'"]+['"]\s*\)/g) ?? []
  ).length;
  assert.equal(
    providerCalls,
    1,
    'sign-in must have exactly ONE provider handler call — Google is the only provider button',
  );
});

test('auth.json drops continueWithApple in all three locales but keeps continueWithGoogle (non-empty)', () => {
  for (const locale of LOCALE_TAGS) {
    const auth = readAuth(locale);
    const where = `${locale}/auth.json`;
    assert.ok(
      !(APPLE_LABEL_KEY in auth),
      `${where} must no longer contain the ${APPLE_LABEL_KEY} key`,
    );
    assert.equal(
      typeof auth.continueWithGoogle,
      'string',
      `${where}:continueWithGoogle must still exist as a string`,
    );
    assert.ok(
      auth.continueWithGoogle.length > 0,
      `${where}:continueWithGoogle must be non-empty`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// F. Brand header contract — the Logo atom on BOTH auth screens. The
// atom source is pinned (react-native-svg EMERALD ticket port INCLUDING
// the TICKETIFY wordmark, entrance animation, size default) and the
// screens are pinned to the heading order logo → title → subtitle with
// NO standalone kicker (the wordmark lives inside the mark now),
// imported via the `@/components` barrel.
//
// Pin discipline: the entrance pins are VALUE-SHAPE assertions, not byte
// sequences. They tolerate whitespace/reformatting differences (a prettier
// reflow of the config or transform object must not false-fail) but MUST
// catch contract regressions — e.g. a `duration: 50`, a dropped easing
// curve, a missing scale/translateY dimension, an orange #FF5500 body,
// a fallback to the old glow PNG, or a DROPPED wordmark ships red.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] brand header contract (Logo atom + heading order)\n');

const logo = readComponent('src/components/atoms/Logo/Logo.tsx');

/**
 * The auth screens' heading block, anchored from the shared JSX open tag
 * to the form that follows it. `lastIndexOf` skips sign-up's
 * confirmation-state branch (it uses `styles.confirmation`, never
 * `styles.heading`), and the `styles.form` end anchor avoids the nested
 * `logoWrap` close tag that the first `</View>` would hit.
 */
const headingBlock = (source) => {
  const start = source.lastIndexOf('<View style={styles.heading}>');
  const end = source.indexOf('<View style={styles.form}>', start);
  return start > -1 && end > start ? source.slice(start, end) : '';
};
const signInHeading = headingBlock(signIn);
const signUpHeading = headingBlock(signUp);

test('Logo renders the ticket mark via react-native-svg (Svg from react-native-svg, 512 viewBox)', () => {
  assert.ok(
    /import\s*\{[\s\S]*?\bSvg\b[\s\S]*?\}\s*from\s*['"]react-native-svg['"]/.test(logo),
    'Logo.tsx must import Svg (and friends) from react-native-svg — no new image-rendering dependency',
  );
  assert.ok(
    /viewBox\s*=\s*['"]0\s+0\s+512\s+512['"]/.test(logo),
    'Logo.tsx must render the 512x512 mark via a 0 0 512 512 viewBox (whitespace-tolerant)',
  );
});

test('Logo ticket body is EMERALD (colors.primary), not the orange #FF5500', () => {
  assert.ok(
    /fill=\{\s*colors\.primary\s*\}/.test(logo),
    'Logo.tsx must fill the ticket body with colors.primary (#10B981 emerald) — the brand-mandated recolor',
  );
  assert.ok(
    !/FF5500/.test(logo),
    'the old orange #FF5500 from the source SVG must be GONE from Logo.tsx',
  );
});

test('Logo keeps the side notches as real cutouts (mask circles at cx 64 / 448, cy 220, r 28)', () => {
  assert.ok(
    /<\s*Mask\b/.test(logo),
    'Logo.tsx must define a Mask (or equivalent) so the notches punch real cutouts',
  );
  assert.ok(
    /\bcx\s*=\s*\{\s*64\s*\}/.test(logo) && /\bcx\s*=\s*\{\s*448\s*\}/.test(logo),
    'the mask must place the left/right bite circles at cx 64 and cx 448 (the ticket edge centers)',
  );
  assert.ok(
    /cy\s*=\s*\{\s*220\s*\}/.test(logo) && /r\s*=\s*\{\s*28\s*\}/.test(logo),
    'the bite circles must keep the source geometry (cy 220, r 28)',
  );
});

test('White T monogram + QR glyph preserved (faithful path data + perforation line)', () => {
  assert.ok(
    /M\s*200\s*130\s*H\s*312/.test(logo),
    'the white bold "T" monogram must keep its source path (M 200 130 H 312 ...) — whitespace-tolerant fragment',
  );
  assert.ok(
    /M\s*0\s*12\s*V\s*4/.test(logo),
    'the QR glyph must keep its corner-bracket geometry (M 0 12 V 4 ...)',
  );
  assert.ok(
    /strokeLinecap\s*=\s*['"]round['"]/.test(logo),
    'the QR bracket strokes must keep round caps (quote-tolerant)',
  );
  assert.ok(
    /\bstrokeDasharray\s*=/.test(logo),
    'the perforation line must keep its dashed stroke (strokeDasharray)',
  );
});

test('Old brand artifacts REMOVED: no logo-glow.png, no expo-image, no contentFit in Logo.tsx', () => {
  assert.ok(
    !/logo-glow/.test(logo),
    'the rejected glow PNG must be GONE from Logo.tsx — the mark is rendered in SVG now',
  );
  assert.ok(
    !/expo-image/.test(logo),
    'expo-image must be GONE from Logo.tsx — the mark is rendered in SVG now',
  );
  assert.ok(
    !/contentFit/.test(logo),
    'the expo-image contentFit prop must be GONE (it belongs to the old image render path)',
  );
});

test('Logo carries the white TICKETIFY wordmark INSIDE the mark (SvgText, 900 weight, middle-anchored)', () => {
  assert.ok(
    /import\s*\{[\s\S]*?Text as SvgText[\s\S]*?\}\s*from\s*['"]react-native-svg['"]/.test(logo),
    'Logo.tsx must import the react-native-svg SVG text element as SvgText (or Text)',
  );
  assert.ok(
    /TICKETIFY/.test(logo),
    'the TICKETIFY wordmark literal must be present in Logo.tsx (port of the source <text>)',
  );
  assert.ok(
    /fontWeight\s*=\s*\{\s*900\s*\}/.test(logo),
    'the wordmark must keep the source font-weight 900',
  );
  assert.ok(
    /fill\s*=\s*['"]#(?:FFF|FFFFFF)['"]/.test(logo),
    'the wordmark must be white (fill #FFFFFF or #FFF, quote-tolerant)',
  );
  assert.ok(
    /textAnchor\s*=\s*['"]middle['"]/.test(logo),
    'the wordmark must stay centered on x=256 (text-anchor middle, quote-tolerant)',
  );
});

test('Logo entrance animation: withTiming/withSpring + ReduceMotion.System, ~600ms ease-out to resting values', () => {
  assert.ok(
    /withTiming|withSpring/.test(logo),
    'Logo.tsx must drive the entrance with withTiming or withSpring (no hardcoded Animated.timing)',
  );
  assert.ok(
    /ReduceMotion\.System/.test(logo),
    'Logo.tsx must pass ReduceMotion.System so the animation respects the OS reduced-motion setting',
  );
  // Value-shape pins (whitespace-tolerant): a `duration: 50`, a dropped
  // easing curve, or a wrong resting target must fail here while a
  // reformat of the config object must not.
  assert.ok(
    /Easing\.out/.test(logo),
    'the entrance must decelerate via Easing.out — the documented contract is a ~600ms ease-OUT, not a linear/jump timing',
  );
  assert.ok(
    /duration\s*:\s*600/.test(logo),
    'the entrance duration must stay ~600ms (whitespace-tolerant; a `duration: 50` regression fails)',
  );
  assert.ok(
    /withTiming\(\s*1\s*,/.test(logo),
    'fade and scale must settle at 1 (targets drive opacity 0->1 and scale 0.9->1)',
  );
  assert.ok(
    /withTiming\(\s*0\s*,/.test(logo),
    'the rise must settle at 0 (target drives translateY 8->0)',
  );
});

test('Logo entrance contract: the animated style drives opacity, scale AND translateY', () => {
  // Shape-level pins for the animated style object: assert the keys exist
  // rather than the exact layout, so a prettier reflow does not false-fail
  // while DROPPING any entrance dimension (fade / scale / rise) fails here.
  assert.ok(
    /\bopacity\s*:\s*opacity\.value/.test(logo),
    'the animated style must drive opacity from the shared value (the fade dimension)',
  );
  assert.ok(
    /transform\s*:\s*\[/.test(logo),
    'the animated style must animate a transform (scale + rise live there)',
  );
  assert.ok(
    /\{\s*scale\s*:/.test(logo),
    'the transform must include the scale key (scale 0.9->1 dimension)',
  );
  assert.ok(
    /\{\s*translateY\s*:/.test(logo),
    'the transform must include the translateY key (rise 8->0 dimension)',
  );
});

test('Logo exposes a size prop with a 120-160pt default', () => {
  assert.ok(
    /size\s*=\s*(1[2-5]\d|160)(?!\d)/.test(logo),
    'Logo.tsx must default `size` inside 120-160pt (trailing-digit guard: 1200 must not match 120)',
  );
});

test('sign-in imports Logo from the @/components barrel', () => {
  assert.ok(
    /import\s*\{[\s\S]*?\bLogo\b[\s\S]*?\}\s*from\s*['"]@\/components['"]/.test(signIn),
    'sign-in must import Logo from the @/components barrel (the convention these screens already use)',
  );
});

test('sign-up imports Logo from the @/components barrel', () => {
  assert.ok(
    /import\s*\{[\s\S]*?\bLogo\b[\s\S]*?\}\s*from\s*['"]@\/components['"]/.test(signUp),
    'sign-up must import Logo from the @/components barrel (the convention these screens already use)',
  );
});

test('sign-in heading renders logo BEFORE title, keeps title → subtitle order, and has NO kicker', () => {
  const logoIdx = signInHeading.indexOf('<Logo');
  const kickerIdx = signInHeading.indexOf('styles.kicker');
  const titleIdx = signInHeading.indexOf('styles.title');
  const subtitleIdx = signInHeading.indexOf('styles.subtitle');
  assert.ok(
    kickerIdx === -1 && !signInHeading.includes("t('auth:kicker')"),
    'sign-in must NOT render the kicker — the wordmark now lives inside the logo (auth:kicker survives only on forgot/reset)',
  );
  assert.ok(
    logoIdx > -1 && titleIdx > -1 && logoIdx < titleIdx,
    'sign-in must render <Logo /> BEFORE title in the heading block',
  );
  assert.ok(
    titleIdx > -1 && subtitleIdx > -1 && titleIdx < subtitleIdx,
    'sign-in must keep the title → subtitle order inside the heading block',
  );
  assert.ok(
    signInHeading.includes("t('auth:signIn')") &&
      signInHeading.includes("t('auth:tagline')"),
    'sign-in must keep the title (auth:signIn) and subtitle (auth:tagline) after the logo insertion',
  );
});

test('sign-up heading renders logo BEFORE title, keeps title → subtitle order, and has NO kicker', () => {
  const logoIdx = signUpHeading.indexOf('<Logo');
  const kickerIdx = signUpHeading.indexOf('styles.kicker');
  const titleIdx = signUpHeading.indexOf('styles.title');
  const subtitleIdx = signUpHeading.indexOf('styles.subtitle');
  assert.ok(
    kickerIdx === -1 && !signUpHeading.includes("t('auth:kicker')"),
    'sign-up must NOT render the kicker — the wordmark now lives inside the logo (auth:kicker survives only on forgot/reset)',
  );
  assert.ok(
    logoIdx > -1 && titleIdx > -1 && logoIdx < titleIdx,
    'sign-up must render <Logo /> BEFORE title in the heading block',
  );
  assert.ok(
    titleIdx > -1 && subtitleIdx > -1 && titleIdx < subtitleIdx,
    'sign-up must keep the title → subtitle order inside the heading block',
  );
  assert.ok(
    signUpHeading.includes("t('auth:signUp')") &&
      signUpHeading.includes("t('auth:signUpTagline')"),
    'sign-up must keep the title (auth:signUp) and subtitle (auth:signUpTagline) after the logo insertion',
  );
});

// ─────────────────────────────────────────────────────────────────────
// G. Google provider on BOTH auth screens. The GoogleG glyph is a SHARED
// atom (src/components/atoms/GoogleG) exported through the @/components
// barrel — neither screen may carry an inline duplicate. sign-up mirrors
// sign-in's provider block exactly (divider → Google button) with the
// same handleProvider('google') wiring and providerBusy gating.
// ─────────────────────────────────────────────────────────────────────

console.log('\n[tests] Google provider path (shared GoogleG atom + sign-up parity)\n');

const googleG = readComponent('src/components/atoms/GoogleG/GoogleG.tsx');
const atomsBarrel = readComponent('src/components/atoms/index.ts');
const componentsBarrel = readComponent('src/components/index.ts');

test('GoogleG is a shared atom with a 20x20 default and the canonical 48 viewBox (decorative)', () => {
  assert.ok(
    /size\s*=\s*20/.test(googleG),
    'GoogleG.tsx must default the glyph to 20pt (whitespace-tolerant) — the size the auth screens rendered before extraction',
  );
  assert.ok(
    /viewBox\s*=\s*['"]0\s+0\s+48\s+48['"]/.test(googleG),
    'GoogleG.tsx must keep the canonical 48x48 viewBox (whitespace-tolerant)',
  );
  assert.ok(
    /accessible\s*=\s*\{\s*false\s*\}/.test(googleG),
    'GoogleG.tsx must be decorative (accessible={false}) — the button carries the label',
  );
  assert.ok(
    /fill="#EA4335"/.test(googleG) && /fill="#4285F4"/.test(googleG) &&
      /fill="#FBBC05"/.test(googleG) && /fill="#34A853"/.test(googleG),
    'GoogleG.tsx must keep the exact official 4-color G paths',
  );
});

test('GoogleG is exported through the atoms AND @/components barrels', () => {
  assert.ok(
    /GoogleG/.test(atomsBarrel) && /from '\.\/GoogleG'/.test(atomsBarrel),
    'the atoms barrel must re-export GoogleG from ./GoogleG (the atom lives in src/components/atoms/GoogleG/)',
  );
  assert.ok(
    /GoogleG/.test(componentsBarrel),
    'the @/components barrel must re-export GoogleG so screens import one shared glyph',
  );
});

test('sign-in uses the barrel GoogleG and has NO inline duplicate (function GoogleG + react-native-svg gone)', () => {
  assert.ok(
    /import\s*\{[\s\S]*?\bGoogleG\b[\s\S]*?\}\s*from\s*['"]@\/components['"]/.test(signIn),
    'sign-in must import GoogleG from the @/components barrel',
  );
  assert.ok(
    !/function\s+GoogleG\b/.test(signIn),
    'sign-in must NOT declare its own GoogleG component — the inline duplicate must be gone',
  );
  assert.ok(
    !/react-native-svg/.test(signIn),
    'sign-in must no longer import react-native-svg at all — the inline Svg glyph was the only consumer',
  );
});

test('sign-up mirrors the Google provider path: handleProvider(google), providerBusy gating, divider → providers → footer → legalFooter', () => {
  assert.ok(
    /handleProvider\(['"]google['"]\)/.test(signUp),
    'sign-up must wire the Google button to handleProvider(\'google\')',
  );
  assert.ok(
    /providerPending\s*===\s*['"]google['"]/.test(signUp),
    'sign-up must show the Spinner via providerPending === \'google\' (same busy UX as sign-in)',
  );
  assert.ok(
    /const canSubmit = !pending && !providerBusy;/.test(signUp),
    'sign-up must gate submit on pending AND providerBusy (mirrors sign-in)',
  );
  assert.ok(
    /import\s*\{[\s\S]*?\bGoogleG\b[\s\S]*?\}\s*from\s*['"]@\/components['"]/.test(signUp),
    'sign-up must import GoogleG from the @/components barrel — no inline duplicate',
  );
  assert.ok(
    /t\(['"]auth:or['"]\)/.test(signUp),
    'sign-up must render the divider label via t(\'auth:or\') (existing key, no new i18n)',
  );
  assert.ok(
    /t\(['"]auth:continueWithGoogle['"]\)/.test(signUp),
    'sign-up must label the button via t(\'auth:continueWithGoogle\') (existing key)',
  );
  const dividerIdx = signUp.indexOf('styles.dividerRow');
  const providersIdx = signUp.indexOf('styles.providers');
  const footerIdx = signUp.indexOf('styles.footer');
  const legalFooterIdx = signUp.indexOf('styles.legalFooter');
  assert.ok(
    dividerIdx > -1 && providersIdx > -1 && footerIdx > -1 &&
      legalFooterIdx > -1 &&
      dividerIdx < providersIdx && providersIdx < footerIdx &&
      footerIdx < legalFooterIdx,
    'sign-up must render divider → providers → footer → legalFooter (provider block between the form and the legal footer)',
  );
  assert.ok(
    /t\(['"]auth:couldNotStartSession['"]\)/.test(signUp),
    'sign-up must surface provider start failures with the same anti-enumeration copy as sign-in (couldNotStartSession)',
  );
});

// ─────────────────────────────────────────────────────────────────────
// H. Auth form UX — password visibility toggle (eye), confirm-password
// field + mismatch validation, and per-field BLUR validation.
// ─────────────────────────────────────────────────────────────────────
console.log(
  '\n[tests] auth form UX (PasswordField molecule, eye icons, confirm + blur validation)\n',
);

const passwordField = readComponent(
  'src/components/molecules/PasswordField/PasswordField.tsx',
);
const iconsSource = readComponent('src/components/atoms/Icon/Icon.tsx');

test('PasswordField is the shared password input on BOTH screens via the @/components barrel, with secureTextEntry={!visible}', () => {
  for (const [screenName, screen] of [
    ['sign-in', signIn],
    ['sign-up', signUp],
  ]) {
    assert.ok(
      /import\s*\{[\s\S]*?\bPasswordField\b[\s\S]*?\}\s*from\s*['"]@\/components['"]/.test(
        screen,
      ),
      `${screenName} must import PasswordField from the @/components barrel`,
    );
  }
  assert.ok(
    /secureTextEntry\s*=\s*\{!visible\}/.test(passwordField),
    "PasswordField must drive secureTextEntry from a local `visible` state (secureTextEntry={!visible})",
  );
  assert.ok(
    /useState\(false\)/.test(passwordField),
    'PasswordField must own the visibility state (useState(false) — starts hidden)',
  );
});

test('PasswordField owns the toggle: eye/eye.slash icon inside an accessibility button with the localized show/hide labels', () => {
  assert.ok(
    /name=\{visible \? 'eye\.slash' : 'eye'\}/.test(passwordField),
    "PasswordField must swap the icon via name={visible ? 'eye.slash' : 'eye'}",
  );
  assert.ok(
    /accessibilityRole="button"/.test(passwordField),
    'the toggle must be a real accessibility button',
  );
  assert.ok(
    /t\(['"]auth:(showPassword|hidePassword)['"]\)/.test(passwordField),
    'the toggle must use the localized showPassword/hidePassword a11y labels',
  );
  assert.ok(
    /onPress=\{\(\) => setVisible/.test(passwordField),
    'the toggle must flip the local visible state on press',
  );
});

test('Icon.tsx carries the eye glyphs: eye and eye.slash in IconName, mapped to MaterialIcons visibility / visibility-off', () => {
  assert.ok(
    /\| 'eye'/.test(iconsSource) && /\| 'eye\.slash'/.test(iconsSource),
    "IconName must include 'eye' and 'eye.slash' (SF Symbol names for the toggle)",
  );
  assert.ok(
    /eye:\s*'visibility'/.test(iconsSource) &&
      /'eye\.slash':\s*'visibility-off'/.test(iconsSource),
    'materialMap must map eye → visibility and eye.slash → visibility-off for the Android glyphs',
  );
});

test('validation.ts exports validateConfirmPassword and PasswordErrorKey includes passwordMismatch', () => {
  assert.ok(
    /export function validateConfirmPassword\(/.test(validation),
    'validation.ts must export validateConfirmPassword(value, original)',
  );
  // Signature tolerant of the nullish-guard widening (value: string |
  // null | undefined, original: string) — flagged in pre-commit fix
  // (CRITICAL: validateConfirmPassword had no nullish guard, only
  // behavioral shape was tested). The behavioral table is enforced by
  // the dedicated scripts/test-auth-validation.mjs harness.
  assert.ok(
    /validateConfirmPassword\(\s*\n?\s*value:\s*string[^,]*,\s*\n?\s*original:\s*string/.test(
      validation,
    ),
    'validation.ts must export validateConfirmPassword(value: string…, original: string) (nullish widening tolerated via `[^,]*`)',
  );
  assert.ok(
    /'passwordMismatch'/.test(validation),
    'PasswordErrorKey must include passwordMismatch',
  );
});

test('sign-up wires the confirm field: state, validator in submit + blur, guard includes confirmErr', () => {
  assert.ok(
    /setConfirmPassword\b/.test(signUp) && /setConfirmPasswordFieldError/.test(signUp),
    'sign-up must own confirmPassword value/error state',
  );
  assert.ok(
    /validateConfirmPassword\(confirmPassword,\s*password\)/.test(signUp),
    'sign-up must validate the confirmation against the password value',
  );
  assert.ok(
    /t\(['"]auth:confirmPassword['"]\)/.test(signUp),
    'the confirm field must use the localized confirmPassword label',
  );
  assert.ok(
    /if \(emailErr \|\| passwordErr(?:\s*\|\|\s*confirmErr)?\) return;/.test(
      signUp,
    ),
    'the sign-up guard must include the confirm error alongside email/password',
  );
});

test('blur validation is wired on BOTH screens (email + password blur handlers with a non-empty gate)', () => {
  const signInBlurs = (signIn.match(/\bonBlur=/g) || []).length;
  const signUpBlurs = (signUp.match(/\bonBlur=/g) || []).length;
  assert.ok(
    signInBlurs >= 2,
    `sign-in must blur-validate email + password (found ${signInBlurs} onBlur props, expected >= 2)`,
  );
  assert.ok(
    signUpBlurs >= 3,
    `sign-up must blur-validate email + password + confirm (found ${signUpBlurs} onBlur props, expected >= 3)`,
  );
  assert.ok(
    /if \(email\.trim\(\)\.length > 0\) setEmailFieldError\(validateEmail\(email\)\)/.test(
      signIn,
    ) &&
      /if \(password\.length > 0\)/.test(signIn),
    'sign-in blur handlers must validate only when the field has content (no errors on untouched-empty blur)',
  );
  assert.ok(
    /if \(email\.trim\(\)\.length > 0\) setEmailFieldError\(validateEmail\(email\)\)/.test(
      signUp,
    ) &&
      /if \(confirmPassword\.length > 0\)/.test(signUp),
    'sign-up blur handlers must validate only when the field has content (confirm included)',
  );
});

test('new i18n keys exist with non-empty values in all three locales (showPassword, hidePassword, confirmPassword, passwordMismatch)', () => {
  const NEW_KEYS = [
    'showPassword',
    'hidePassword',
    'confirmPassword',
    'passwordMismatch',
  ];
  for (const locale of LOCALE_TAGS) {
    const auth = readAuth(locale);
    for (const key of NEW_KEYS) {
      const where = `${locale}/auth.json:${key}`;
      assert.ok(key in auth, `missing key ${where}`);
      assert.equal(typeof auth[key], 'string', `${where} must be a string`);
      assert.ok(auth[key].length > 0, `${where} must be non-empty`);
    }
  }
});

console.log('');
if (failed > 0) {
  console.error(`[tests] ${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`[tests] all ${passed} tests passed`);
}