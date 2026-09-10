/**
 * Persists the locale override (`ticketify.locale.override`) in
 * `expo-secure-store`. The override is a four-value union:
 *
 *   - `'auto'`      → defer to the device-locale detector
 *   - `'en'`        → force English
 *   - `'es-AR'`     → force Rioplatense Spanish
 *   - `'pt-BR'`     → force Brazilian Portuguese
 *
 * Anything else stored under the key is treated as missing by the
 * selector — `getStoredOverride` returns `null` for unknown values so
 * the store can fall back to the device locale rather than crashing.
 *
 * The adapter is intentionally thin. The actual `expo-secure-store`
 * call is the only place that knows the key name and value shape;
 * `useLocaleStore` consumes the typed Promise API below and stays free
 * of the native module. Mirrors the chunked adapter at
 * `src/lib/supabase/storage-adapter.ts` for the value shape, but skips
 * the chunking layer — a single locale code is always under the 2 KB
 * SecureStore limit.
 */
import * as SecureStore from 'expo-secure-store';

import type { LocaleOverride } from '../stores/useLocaleStore';

/** Storage key for the locale override. Public so tests can assert on it. */
export const LOCALE_OVERRIDE_KEY = 'ticketify.locale.override';

/** Set of every legal override value; mirrors `LocaleOverride` in the store. */
const ALLOWED: ReadonlySet<LocaleOverride> = new Set([
  'auto',
  'en',
  'es-AR',
  'pt-BR',
]);

/**
 * Read the persisted override, or `null` when no value is stored or the
 * stored value is not one of the legal four. The adapter never throws —
 * callers can rely on `null` meaning "use the detected locale" and treat
 * any thrown error from the native module as a separate failure (logged
 * by `useLocaleStore.hydrate`).
 */
export async function getStoredOverride(): Promise<LocaleOverride | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(LOCALE_OVERRIDE_KEY);
  } catch {
    // Native module unavailable / locked — surface as "no override" so
    // the store falls back to the device locale.
    return null;
  }
  if (raw == null) return null;
  // Guard against values written by an older or newer app version that
  // don't match the current union — falling back to `'auto'` semantics
  // is safer than throwing inside the boot path.
  return ALLOWED.has(raw as LocaleOverride) ? (raw as LocaleOverride) : null;
}

/**
 * Persist the override. No-op on `null` (treated as a delete). Failures
 * are swallowed and logged; the in-memory store still updates the live
 * UI even when secure-store write fails, and the next cold start retries.
 */
export async function setStoredOverride(
  value: LocaleOverride,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(LOCALE_OVERRIDE_KEY, value);
  } catch (err) {
    // eslint-disable-next-line no-console -- boot-path diagnostic only
    console.warn('[i18n] failed to persist locale override', err);
  }
}