/**
 * Test double for `react-i18next` used by the household-category-items
 * harness. The screen migrated to `useTranslation(['analytics', 'common'])`
 * in PR 3 (`app-i18n`) — without an i18next runtime in the test, `t()`
 * would return its key and the literal-string assertions would fail. The
 * stub maps the keys the screen calls back to their es-AR values so the
 * harness keeps its existing byte-identical contract.
 *
 * Only the keys the screen actually consumes are mapped. Adding a new
 * `t(...)` call on the screen without updating this stub will surface as
 * a missing translation in the test output.
 */

type TFunction = (
  key: string,
  options?: Record<string, unknown>,
) => string;

const TRANSLATIONS: Record<string, string> = {
  // analytics — category drill-down
  'analytics:totalKicker': 'TOTAL DEL MES',
  'analytics:loadingHousehold': 'Cargando datos del hogar…',
  'analytics:noCategories': 'Sin categorías este mes.',
  'analytics:noCategoriesHousehold': 'Sin categorías este mes en el hogar.',
  'analytics:drillDownItemEmpty': 'Sin gastos en esta categoría este mes.',
  // common
  'common:back': 'Volver',
  'common:retry': 'Reintentar',
};

const t: TFunction = (key, options) => {
  const raw = TRANSLATIONS[key];
  if (raw) {
    // Minimal interpolation for the household category items fixtures.
    if (options && typeof options.category === 'string') {
      return raw.replace('{{category}}', options.category);
    }
    return raw;
  }
  return key;
};

export function useTranslation(namespaces: string[] | string) {
  void namespaces;
  return { t, i18n: { language: 'es-AR' } };
}

export function useScreenTitle(key: string): string {
  return TRANSLATIONS[key] ?? key;
}

export const I18nextProvider = ({ children }: { children: unknown }) => children;

export const initReactI18next = {
  type: '3rdParty',
  init: () => undefined,
} as const;