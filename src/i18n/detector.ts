/**
 * Pure device-locale detector (REQ-2, NFR-4).
 *
 * Maps a BCP-47 language tag emitted by `expo-localization.getLocales()`
 * to one of the three locales the app actually ships:
 *
 *   pt-*      → 'pt-BR'   (any Portuguese tag, including pt-PT)
 *   en-*      → 'en'      (any English tag, including en-GB)
 *   es-AR     → 'es-AR'   (the app's primary locale)
 *   es-*      → 'es-AR'   (safety fallback — voseo is Argentina-only,
 *                          but shipping es-MX as es-AR is a closer match
 *                          than shipping nothing)
 *   anything else → 'es-AR' (the fallback per REQ-1)
 *
 * `undefined`, empty string, and unknown tags all collapse to `'es-AR'`.
 * The function is pure (no module-level state, no `Intl`) so it is
 * unit-testable independent of React or the native bridge.
 *
 * The `languageTag` is expected to be the first segment of an IETF tag,
 * possibly hyphenated with a region (`pt-BR`, `en-GB`, `es-AR`, …). The
 * region segment is ignored for the `pt-*` and `en-*` prefixes because
 * Brazilian Portuguese is the only Portuguese we ship; for Spanish, the
 * `es-AR` form is the target — any other `es-*` falls back to es-AR.
 */
export type SupportedLocale = 'en' | 'es-AR' | 'pt-BR';

/**
 * Default locale — used when the input is empty, missing, or an
 * unsupported tag. Mirrors `fallbackLng` in `config.ts` so the detector
 * and the i18next init agree.
 */
export const DEFAULT_LOCALE: SupportedLocale = 'es-AR';

/**
 * Detect the app locale from a device language tag.
 *
 * @param languageTag - The first entry from `getLocales()`, or any BCP-47
 *   tag-like string. `undefined` and empty string are accepted and fall
 *   back to `DEFAULT_LOCALE`.
 * @returns One of `'en' | 'es-AR' | 'pt-BR'`.
 */
export function detectLocale(
  languageTag: string | undefined,
): SupportedLocale {
  if (!languageTag) return DEFAULT_LOCALE;
  // Normalize: trim whitespace, lowercase. Region stays as-is for the
  // `es-AR` equality check below — `'es-AR'.toLowerCase() === 'es-ar'`.
  const normalized = languageTag.trim().toLowerCase();
  if (!normalized) return DEFAULT_LOCALE;

  // Split on the hyphen so we can match the language subtag alone.
  // `pt-BR-x-private` → ['pt', 'br', 'x', 'private']; the first segment
  // is the language we care about.
  const language = normalized.split('-')[0];

  switch (language) {
    case 'pt':
      return 'pt-BR';
    case 'en':
      return 'en';
    case 'es':
      // The app ships Rioplatense Spanish only — keep es-AR as the sole
      // Spanish locale. Any other Spanish tag (es-MX, es-ES, es) maps
      // to es-AR per REQ-2.
      return 'es-AR';
    default:
      return DEFAULT_LOCALE;
  }
}