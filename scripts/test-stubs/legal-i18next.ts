/**
 * Test double for `react-i18next` in the legal-content harness section 3.
 *
 * `LegalScreen` reads the ACTIVE locale's legal document through
 * `useTranslation(['legal', 'common'])`: dotted keys ('legal:privacy.title')
 * plus `{ returnObjects: true }` for the sections array. The stub resolves
 * `legal:` keys against a catalog INJECTED by the harness — the SAME
 * in-memory catalogs the parity/coverage sections assert over, read from
 * the real on-disk legal.json files. A render test therefore pins the REAL
 * shipped copy, and `__setActiveLegalCatalog(...)` swaps the active bundle
 * between renders so a test can prove the screen follows the CURRENT locale
 * (es-AR → pt-BR) instead of hardcoding content.
 *
 * `common:back` resolves against a common catalog injected the same way —
 * the harness passes the SHIPPED es-AR common.json (F1), so the rendered
 * back label can never silently drift from the disk copy (a hardcoded
 * label here would fail the harness's catalog-backed assertion).
 */
type TFunction = (key: string, options?: Record<string, unknown>) => unknown;

/** Only reached when the harness forgets to inject the common catalog. */
const FALLBACK_COMMON: Record<string, string> = {
  back: 'Volver',
};

let activeCatalog: Record<string, unknown> | null = null;
let activeLocale = 'es-AR';
let activeCommon: Record<string, string> = FALLBACK_COMMON;

/**
 * Swaps the active legal bundle + locale + common catalog the stub
 * resolves against. `commonCatalog` defaults to a fallback so the stub
 * stays usable in isolation; the content harness always passes the
 * shipped es-AR common.json.
 */
export function __setActiveLegalCatalog(
  catalog: Record<string, unknown> | null,
  locale = 'es-AR',
  commonCatalog: Record<string, string> = FALLBACK_COMMON,
): void {
  activeCatalog = catalog;
  activeLocale = locale;
  activeCommon = commonCatalog;
}

function resolvePath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
}

export function useTranslation(_namespaces: string[] | string) {
  const t: TFunction = (key, options) => {
    if (typeof key !== 'string') return key;
    const colon = key.indexOf(':');
    const ns = colon === -1 ? '' : key.slice(0, colon);
    const dotted = colon === -1 ? key : key.slice(colon + 1);
    if (ns === 'common') return activeCommon[dotted] ?? key;
    if (ns === 'legal') {
      if (options && options.returnObjects === true) {
        return resolvePath(activeCatalog, dotted) ?? key;
      }
      const resolved = resolvePath(activeCatalog, dotted);
      return typeof resolved === 'string' ? resolved : key;
    }
    return key;
  };
  return { t, i18n: { language: activeLocale } };
}