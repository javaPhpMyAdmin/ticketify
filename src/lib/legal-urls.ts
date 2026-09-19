/**
 * Locale-aware legal URL map (REQ-2 / AD-7).
 *
 * Exactly two documents — privacy and terms — each mapping the three
 * `SupportedLocale` tags to a hosted URL. `legalUrlFor` falls back to the
 * `es-AR` URL for any missing or unsupported locale (mirrors the app-i18n
 * fallback policy).
 *
 * Hosting contract (REQ-7): the documents are the committed mirrors pushed
 * with `docs/` (GitHub Pages, `main` branch, `/docs` source) — the path
 * below mirrors the mirror layout `docs/legal/{locale}/{document}.md`, so
 * each URL resolves to the rendered page for that document. Pages
 * enablement is OWNER-GATED: until it is enabled the URLs 404, which is
 * EXPECTED and not a defect of this ship (in-app LegalScreen keeps the
 * documents reachable meanwhile). The automated harness pins these EXACT
 * values — `example.com` anywhere in this map fails the links suite, and
 * the generator keeps the mirrors byte-stable with the shipped version
 * (test:legal-content F6/F7).
 */
import { DEFAULT_LOCALE, type SupportedLocale } from '@/i18n/detector';

export type LegalDocument = 'privacy' | 'terms';

/** Default document used when the requested document is unknown (REQ-2). */
const DEFAULT_DOCUMENT: LegalDocument = 'privacy';

/** GitHub Pages base for the legal mirror (REQ-7, `docs/` on `main`). */
const LEGAL_PAGES_BASE = 'https://javaPhpMyAdmin.github.io/ticketify/legal';

export const LEGAL_URLS: Record<LegalDocument, Record<SupportedLocale, string>> = {
  privacy: {
    'es-AR': `${LEGAL_PAGES_BASE}/es-AR/privacy/`,
    en: `${LEGAL_PAGES_BASE}/en/privacy/`,
    'pt-BR': `${LEGAL_PAGES_BASE}/pt-BR/privacy/`,
  },
  terms: {
    'es-AR': `${LEGAL_PAGES_BASE}/es-AR/terms/`,
    en: `${LEGAL_PAGES_BASE}/en/terms/`,
    'pt-BR': `${LEGAL_PAGES_BASE}/pt-BR/terms/`,
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
