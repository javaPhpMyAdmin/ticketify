/**
 * Test stub for `expo-localization`.
 *
 * Used by the i18n init harness (a deterministic en-US locale so the detector
 * contract `detectLocale('en-US') → 'en'` is exercised) and by the
 * profile-hook harness, which drives `detectDeviceDefaultCurrency` through
 * `__setDeviceLocales` / `__setDeviceLocalesThrow`.
 */
export interface Locale {
  languageTag: string;
  languageCode: string;
  regionCode: string | null;
  currencyCode: string | null;
  languageTagBCP47?: string;
}

const DEFAULT_LOCALE: Locale = {
  languageTag: 'en-US',
  languageCode: 'en',
  regionCode: 'US',
  currencyCode: 'USD',
};

let locales: Locale[] = [DEFAULT_LOCALE];
let throws = false;

export function getLocales(): Locale[] {
  if (throws) throw new Error('expo-localization unavailable');
  return locales;
}

/** Replaces the device locale list (harness seam). */
export function __setDeviceLocales(next: Partial<Locale>[]): void {
  locales = next.map((l) => ({ ...DEFAULT_LOCALE, ...l }));
  throws = false;
}

/** Makes `getLocales()` throw, pinning the adapter's fail-soft branch. */
export function __setDeviceLocalesThrow(value: boolean): void {
  throws = value;
}