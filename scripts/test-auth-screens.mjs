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
  const guardIdx = signUp.indexOf('if (emailErr || passwordErr) return;');
  const consentIdx = signUp.indexOf('if (!consentAccepted) {');
  assert.ok(
    guardIdx > -1 && consentIdx > -1 && guardIdx < consentIdx,
    'sign-up must validate fields and return BEFORE the consent gate',
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

test('sign-up submit gate no longer blocks on field content (canSubmit = !pending)', () => {
  assert.ok(
    /const canSubmit = !pending;/.test(signUp),
    'sign-up canSubmit must only gate on pending so pressing surfaces inline errors',
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

console.log('');
if (failed > 0) {
  console.error(`[tests] ${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`[tests] all ${passed} tests passed`);
}