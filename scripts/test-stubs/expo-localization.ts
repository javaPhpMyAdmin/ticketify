/**
 * Test stub for `expo-localization` used by the i18n init harness.
 * Returns a deterministic en-US locale so the detector contract
 * (`detectLocale('en-US') → 'en'`) is exercised in tests.
 */

export interface Locale {
  languageTag: string;
  languageCode: string;
  regionCode: string | null;
  currencyCode: string | null;
  languageTagBCP47?: string;
}

export function getLocales(): Locale[] {
  return [
    {
      languageTag: 'en-US',
      languageCode: 'en',
      regionCode: 'US',
      currencyCode: 'USD',
    },
  ];
}