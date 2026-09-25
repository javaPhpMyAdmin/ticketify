/**
 * Client-side auth form validation (auth screens slice).
 *
 * Pure helpers shared by the sign-in and sign-up screens. Each validator
 * returns the i18n KEY of the first violation (the `auth` namespace) or
 * null when the value passes, so the screens translate the key at render
 * time and surface it inline via FieldGroup's `error` prop. No side
 * effects — the screens own the field-error state.
 */

/** Pragmatic RFC-lite email pattern (user@host.tld). */
export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Minimum password length enforced at sign-up (matches newPasswordHelper copy). */
export const SIGN_UP_MIN_PASSWORD_LENGTH = 8;

export type EmailErrorKey = 'emailRequired' | 'emailInvalid';
export type PasswordErrorKey =
  | 'passwordRequired'
  | 'passwordMinLength'
  | 'passwordMismatch';

export function validateEmail(value: string): EmailErrorKey | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'emailRequired';
  if (!EMAIL_REGEX.test(trimmed)) return 'emailInvalid';
  return null;
}

export function validateSignInPassword(value: string): PasswordErrorKey | null {
  if (value.length === 0) return 'passwordRequired';
  return null;
}

export function validateSignUpPassword(value: string): PasswordErrorKey | null {
  if (value.length < SIGN_UP_MIN_PASSWORD_LENGTH) return 'passwordMinLength';
  return null;
}

/**
 * Confirm-password check for sign-up. `original` is the password value the
 * confirmation must match.
 *
 * Param contract (verified by `scripts/test-auth-validation.mjs`):
 *   - `value` may be `string | null | undefined`. Empty / null / undefined
 *     → `passwordRequired` (a missing value is a required-field error,
 *     NOT a mismatch — different i18n copy).
 *   - A non-empty value that doesn't `===` `original` (no auto-trim) →
 *     `passwordMismatch` (whitespace differences count as a mismatch).
 *   - Equal non-empty values → `null` (passes).
 */
export function validateConfirmPassword(
  value: string | null | undefined,
  original: string,
): PasswordErrorKey | null {
  if (value == null || value.length === 0) return 'passwordRequired';
  if (value !== original) return 'passwordMismatch';
  return null;
}