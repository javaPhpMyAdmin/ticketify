/**
 * Locale-aware legal URL map (REQ-2 / AD-7).
 *
 * Exactly two documents — privacy and terms — each mapping the three
 * `SupportedLocale` tags to a hosted URL. `legalUrlFor` falls back to the
 * `es-AR` URL for any missing or unsupported locale (mirrors the app-i18n
 * fallback policy).
 *
 * Hosting is user-owned: the URLs below are `example.com` placeholders and
 * MUST be swapped for the real hosted pages before release (REQ-7). Each one
 * carries a `TODO(user): real URL` marker so the swap is grep-able. The
 * automated harness does not assert the domain — placeholders render and open
 * normally during development.
 */
import { DEFAULT_LOCALE, type SupportedLocale } from '@/i18n/detector';

export type LegalDocument = 'privacy' | 'terms';

/** Default document used when the requested document is unknown (REQ-2). */
const DEFAULT_DOCUMENT: LegalDocument = 'privacy';

export const LEGAL_URLS: Record<LegalDocument, Record<SupportedLocale, string>> = {
  privacy: {
    'es-AR': 'https://example.com/privacy/es-AR', // TODO(user): real URL
    en: 'https://example.com/privacy/en', // TODO(user): real URL
    'pt-BR': 'https://example.com/privacy/pt-BR', // TODO(user): real URL
  },
  terms: {
    'es-AR': 'https://example.com/terms/es-AR', // TODO(user): real URL
    en: 'https://example.com/terms/en', // TODO(user): real URL
    'pt-BR': 'https://example.com/terms/pt-BR', // TODO(user): real URL
  },
};

export function legalUrlFor(document: LegalDocument, locale: string): string {
  // Own-property guards: `??` alone cannot detect inherited `Object.prototype`
  // members ('constructor', '__proto__', 'toString', …) because they are
  // non-null — without the guard the resolver would return a function or
  // prototype object instead of the es-AR fallback (REQ-2). An unknown
  // document falls back to the default document's es-AR URL instead of
  // throwing.
  const urls = Object.prototype.hasOwnProperty.call(LEGAL_URLS, document)
    ? LEGAL_URLS[document]
    : undefined;
  if (urls === undefined) {
    return LEGAL_URLS[DEFAULT_DOCUMENT][DEFAULT_LOCALE];
  }
  return Object.prototype.hasOwnProperty.call(urls, locale)
    ? urls[locale as SupportedLocale]
    : urls[DEFAULT_LOCALE];
}
