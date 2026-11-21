/**
 * Test double for `react-i18next` used by the household-category-items
 * harness. The screen migrated to `useTranslation(['analytics', 'common'])`
 * in PR 3 (`app-i18n`) — without an i18next runtime in the test, `t()`
 * would return its key and the literal-string assertions would fail. The
 * stub maps the keys the screen calls back to their es-419 base catalog
 * values so the harness keeps its existing byte-identical contract.
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
  // analytics — InsightHeroCard header (charts render guard). Byte-identical
  // to the es-419 base catalog: a divergence here would hide a shipped
  // translation regression behind a passing render pin.
  'analytics:heroKicker': 'Gastado este mes',
  'analytics:overviewBadge': 'vs {{month}}',
  'analytics:heroMostExpensiveDay':
    'Tu día más caro fue el {{weekday}} {{day}} ({{amount}} · {{multiple}}x tu promedio)',
  'analytics:heroEmpty': 'Sin gastos este mes',
  // analytics — InsightBanner copy. Unprefixed keys because the component
  // calls `useTranslation('analytics')` then `t('insightMore' | ... )`.
  // Byte-identical to the es-419 base catalog; the charts render pin compares
  // the mounted text against the catalog read from disk, so drift fails here.
  insightMore: 'Gastaste un {{pct}}% más que en {{month}}.',
  insightLess: 'Gastaste un {{pct}}% menos que en {{month}}.',
  insightSame: 'Gastaste lo mismo que en {{month}}.',
  // analytics — price-alert receipt-detail reference section. Unprefixed
  // because the section/card call `useTranslation('analytics')` then `t(...)`
  // with the bare leaf name (same pattern as the insight copy above).
  // Byte-identical to the es-419 base catalog.
  priceAlertReferenceTitle: 'Tickets de referencia',
  priceAlertReferenceMissing: 'Ticket no disponible',
  priceAlertReferenceTotal: 'Total de un ticket',
  // The detail section calls `useTranslation(['analytics', 'common'])` and
  // uses prefixed keys; keep both spellings so either call site resolves to
  // the es-419 value instead of leaking the raw key into the render tree.
  'analytics:priceAlertReferenceTitle': 'Tickets de referencia',
  'analytics:priceAlertReferenceMissing': 'Ticket no disponible',
  'analytics:priceAlertPreviousMonth': 'MES ANTERIOR',
  'analytics:priceAlertCurrentMonth': 'ESTE MES',
  // common
  'common:back': 'Volver',
  'common:retry': 'Reintentar',
};

const t: TFunction = (key, options) => {
  const raw = TRANSLATIONS[key];
  if (raw) {
    if (!options) return raw;
    // Interpolate every supplied option, not a hardcoded allowlist: the hero
    // template uses {{weekday}}/{{day}}/{{amount}}/{{multiple}} as well.
    return Object.entries(options).reduce(
      (text, [name, value]) =>
        value == null ? text : text.split(`{{${name}}}`).join(String(value)),
      raw,
    );
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