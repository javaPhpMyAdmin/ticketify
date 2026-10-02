/**
 * Locale-aware legal URL map (REQ-2 / AD-7).
 *
 * Exactly two documents — privacy and terms — each mapping the FIVE
 * `SupportedLocale` tags to a hosted URL. `legalUrlFor` falls back to the
 * `en` URL for any missing or unsupported locale (mirrors the app-i18n
 * fallback policy).
 *
 * The fallback moved from `es-AR` to `en` deliberately. `es-AR` is now a
 * SPARSE regional override: it inherits the legal copy from `es-419` and
 * resolves nothing of its own here. Pointing the fallback at a locale
 * that regionalizes differently than the reader's device would send a
 * Brazilian or Mexican reader to an Argentine document — the one outcome
 * a legal URL must never produce. `en` is the locale every other chain
 * terminates in, so it is the only correct terminus.
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
    'es-419': `${LEGAL_PAGES_BASE}/es-419/privacy/`,
    'es-AR': `${LEGAL_PAGES_BASE}/es-AR/privacy/`,
    'es-ES': `${LEGAL_PAGES_BASE}/es-ES/privacy/`,
    en: `${LEGAL_PAGES_BASE}/en/privacy/`,
    'pt-BR': `${LEGAL_PAGES_BASE}/pt-BR/privacy/`,
  },
  terms: {
    'es-419': `${LEGAL_PAGES_BASE}/es-419/terms/`,
    'es-AR': `${LEGAL_PAGES_BASE}/es-AR/terms/`,
    'es-ES': `${LEGAL_PAGES_BASE}/es-ES/terms/`,
    en: `${LEGAL_PAGES_BASE}/en/terms/`,
    'pt-BR': `${LEGAL_PAGES_BASE}/pt-BR/terms/`,
  },
};

export function legalUrlFor(document: LegalDocument, locale: string): string {
  // Own-property guards: `??` alone cannot detect inherited `Object.prototype`
  // members ('constructor', '__proto__', 'toString', …) because they are
  // non-null — without the guard the resolver would return a function or
  // prototype object instead of the `en` fallback (REQ-2). An unknown
  // document falls back to the default document's `en` URL instead of
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
