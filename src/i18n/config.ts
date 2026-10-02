/**
 * i18next initialization — bundles the locale catalogs and configures
 * the runtime.
 *
 * Call once at boot from `<I18nProvider>`. The function:
 *
 *   1. Resolves the active locale from the hydrated `useLocaleStore`
 *      (which has already read the secure-store override + device
 *      locale by the time the provider mounts).
 *   2. Bundles the namespaces for each of `en` / `es-419` / `es-AR` /
 *      `es-ES` / `pt-BR` from the JSON files. Metro packs the JSON via
 *      `resolveJsonModule` so there is no network fetch at boot (NFR-6).
 *   3. Configures the PER-LANGUAGE `fallbackLng` map (REQ-1) and
 *      `supportedLngs` matching the five catalogs.
 *
 * `react.useSuspense: false` is mandatory: Expo's runtime does not
 * suspend at this layer and would otherwise throw on first render. The
 * default `keySeparator: '.'` lets `t('tabs.home')` reach the
 * nested `tabs.home` JSON path via the registered namespace prefix.
 *
 * `interpolation.escapeValue: false` is also intentional — we render
 * translations as native RN text, not as HTML. Escaping would mangle
 * legitimate punctuation like `…` and `'` that appears in our copy.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enTabs from './locales/en/tabs.json';
import enSettingsLanguage from './locales/en/settingsLanguage.json';
import enAuth from './locales/en/auth.json';
import enSettings from './locales/en/settings.json';
import enTickets from './locales/en/tickets.json';
import enReceipts from './locales/en/receipts.json';
import enHousehold from './locales/en/household.json';
import enAnalytics from './locales/en/analytics.json';
import enErrors from './locales/en/errors.json';
import enA11y from './locales/en/a11y.json';
import enCurrency from './locales/en/currency.json';
import enDate from './locales/en/date.json';
import enPro from './locales/en/pro.json';
import enLegal from './locales/en/legal.json';
import enOnboarding from './locales/en/onboarding.json';
import enBootSplash from './locales/en/bootSplash.json';
import enCategories from './locales/en/categories.json';
import es419Common from './locales/es-419/common.json';
import es419Tabs from './locales/es-419/tabs.json';
import es419SettingsLanguage from './locales/es-419/settingsLanguage.json';
import es419Auth from './locales/es-419/auth.json';
import es419Settings from './locales/es-419/settings.json';
import es419Tickets from './locales/es-419/tickets.json';
import es419Receipts from './locales/es-419/receipts.json';
import es419Household from './locales/es-419/household.json';
import es419Analytics from './locales/es-419/analytics.json';
import es419Errors from './locales/es-419/errors.json';
import es419A11y from './locales/es-419/a11y.json';
import es419Currency from './locales/es-419/currency.json';
import es419Date from './locales/es-419/date.json';
import es419Pro from './locales/es-419/pro.json';
import es419Legal from './locales/es-419/legal.json';
import es419Onboarding from './locales/es-419/onboarding.json';
import es419BootSplash from './locales/es-419/bootSplash.json';
import es419Categories from './locales/es-419/categories.json';
import esARCommon from './locales/es-AR/common.json';
import esARTabs from './locales/es-AR/tabs.json';
import esARSettingsLanguage from './locales/es-AR/settingsLanguage.json';
import esARAuth from './locales/es-AR/auth.json';
import esARSettings from './locales/es-AR/settings.json';
import esARTickets from './locales/es-AR/tickets.json';
import esARReceipts from './locales/es-AR/receipts.json';
import esARHousehold from './locales/es-AR/household.json';
import esARAnalytics from './locales/es-AR/analytics.json';
import esARErrors from './locales/es-AR/errors.json';
import esARA11y from './locales/es-AR/a11y.json';
import esARCurrency from './locales/es-AR/currency.json';
import esARDate from './locales/es-AR/date.json';
import esARPro from './locales/es-AR/pro.json';
import esARLegal from './locales/es-AR/legal.json';
import esAROnboarding from './locales/es-AR/onboarding.json';
import esARBootSplash from './locales/es-AR/bootSplash.json';
import esARCategories from './locales/es-AR/categories.json';
import esESCommon from './locales/es-ES/common.json';
import esESTabs from './locales/es-ES/tabs.json';
import esESSettingsLanguage from './locales/es-ES/settingsLanguage.json';
import esESAuth from './locales/es-ES/auth.json';
import esESSettings from './locales/es-ES/settings.json';
import esESTickets from './locales/es-ES/tickets.json';
import esESReceipts from './locales/es-ES/receipts.json';
import esESHousehold from './locales/es-ES/household.json';
import esESAnalytics from './locales/es-ES/analytics.json';
import esESErrors from './locales/es-ES/errors.json';
import esESA11y from './locales/es-ES/a11y.json';
import esESCurrency from './locales/es-ES/currency.json';
import esESDate from './locales/es-ES/date.json';
import esESPro from './locales/es-ES/pro.json';
import esESLegal from './locales/es-ES/legal.json';
import esESOnboarding from './locales/es-ES/onboarding.json';
import esESBootSplash from './locales/es-ES/bootSplash.json';
import esESCategories from './locales/es-ES/categories.json';
import ptBRCommon from './locales/pt-BR/common.json';
import ptBRTabs from './locales/pt-BR/tabs.json';
import ptBRSettingsLanguage from './locales/pt-BR/settingsLanguage.json';
import ptBRAuth from './locales/pt-BR/auth.json';
import ptBRSettings from './locales/pt-BR/settings.json';
import ptBRTickets from './locales/pt-BR/tickets.json';
import ptBRReceipts from './locales/pt-BR/receipts.json';
import ptBRHousehold from './locales/pt-BR/household.json';
import ptBRAnalytics from './locales/pt-BR/analytics.json';
import ptBRErrors from './locales/pt-BR/errors.json';
import ptBRA11y from './locales/pt-BR/a11y.json';
import ptBRCurrency from './locales/pt-BR/currency.json';
import ptBRDate from './locales/pt-BR/date.json';
import ptBRPro from './locales/pt-BR/pro.json';
import ptBRLegal from './locales/pt-BR/legal.json';
import ptBROnboarding from './locales/pt-BR/onboarding.json';
import ptBRBootSplash from './locales/pt-BR/bootSplash.json';
import ptBRCategories from './locales/pt-BR/categories.json';
import { useLocaleStore } from './stores/useLocaleStore';

/** Every locale the catalog ships, in `lng` form (matches JSON folder names). */
export const SUPPORTED_LOCALE_TAGS = [
  'en',
  'es-419',
  'es-AR',
  'es-ES',
  'pt-BR',
] as const;
export type SupportedLocaleTag = (typeof SUPPORTED_LOCALE_TAGS)[number];

/**
 * Every namespace the catalog ships — EIGHTEEN of them, not seventeen.
 *
 * The seventeenth namespace the change documents kept listing was
 * `categories`, which arrived with the `category-display-i18n` work
 * (the 13 system category labels). All five locales ship exactly 18
 * `.json` files; the harness pins that count, so a namespace added to
 * one locale and not the others fails loudly instead of silently
 * resolving through the fallback chain.
 *
 * `common` / `tabs` / `settingsLanguage` are the original PR 1 set;
 * `auth` / `settings` / `tickets` / `receipts` / `household` /
 * `analytics` / `errors` / `a11y` / `currency` came with PR 2;
 * `date` (single locale-aware source for the calendar / weekday /
 * month arrays, per AD-12) and `pro` with PR 3; `legal` /
 * `onboarding` / `bootSplash` with the compliance and splash work;
 * `categories` with `category-display-i18n`.
 *
 * The `legal` namespace (legal-compliance U2) bundles the Privacy Policy
 * and Terms documents as section arrays for the in-app `/legal/*`
 * screens (AD-1 static RN text, no runtime fetch — REQ-4).
 * `es-419` is the source of truth for the legal copy; `es-ES` carries
 * a full **Peninsular-register override** (singular `tú`, the perfect
 * compounds Spain writes where LATAM uses a bare preterite, and the
 * `utilizar` / `galería` / `importe` / `periodo` lexicon). There is
 * deliberately NO `vosotros` here: legal register is `usted`/impersonal
 * and the deck has no plural-addressee slot, so the app's one genuine
 * `vosotros` badge is `household.youSuffix`. en/pt-BR are best-effort
 * parsed translations.
 */
export const NAMESPACES = [
  'common',
  'tabs',
  'settingsLanguage',
  'auth',
  'settings',
  'tickets',
  'receipts',
  'household',
  'analytics',
  'errors',
  'a11y',
  'currency',
  'date',
  'pro',
  'legal',
  'onboarding',
  'bootSplash',
  'categories',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Per-language fallback chain (REQ-1).
 *
 * The two regional Spanish overrides inherit the NEUTRAL BASE
 * (`es-419`) before falling back to `en`, so a key the region
 * legitimately omits still reads as neutral Spanish instead of English.
 * `es-AR` and `es-ES` are sparse overrides and are EXPECTED to be
 * missing most keys — that is the design, not a defect.
 *
 * Mirrored in `detector.ts` as `FALLBACK_CHAIN`; the init harness
 * pins the two against each other.
 */
export const FALLBACK_LNG: Readonly<Record<SupportedLocaleTag, readonly string[]>> =
  {
    en: ['en'],
    'es-419': ['en'],
    'es-AR': ['es-419', 'en'],
    'es-ES': ['es-419', 'en'],
    'pt-BR': ['en'],
  } as const;

/** Bundled resources — keyed by locale then namespace. */
export const RESOURCES = {
  'en': {
    common: enCommon,
    tabs: enTabs,
    settingsLanguage: enSettingsLanguage,
    auth: enAuth,
    settings: enSettings,
    tickets: enTickets,
    receipts: enReceipts,
    household: enHousehold,
    analytics: enAnalytics,
    errors: enErrors,
    a11y: enA11y,
    currency: enCurrency,
    date: enDate,
    pro: enPro,
    legal: enLegal,
    onboarding: enOnboarding,
    bootSplash: enBootSplash,
    categories: enCategories,
  },
  'es-419': {
    common: es419Common,
    tabs: es419Tabs,
    settingsLanguage: es419SettingsLanguage,
    auth: es419Auth,
    settings: es419Settings,
    tickets: es419Tickets,
    receipts: es419Receipts,
    household: es419Household,
    analytics: es419Analytics,
    errors: es419Errors,
    a11y: es419A11y,
    currency: es419Currency,
    date: es419Date,
    pro: es419Pro,
    legal: es419Legal,
    onboarding: es419Onboarding,
    bootSplash: es419BootSplash,
    categories: es419Categories,
  },
  'es-AR': {
    common: esARCommon,
    tabs: esARTabs,
    settingsLanguage: esARSettingsLanguage,
    auth: esARAuth,
    settings: esARSettings,
    tickets: esARTickets,
    receipts: esARReceipts,
    household: esARHousehold,
    analytics: esARAnalytics,
    errors: esARErrors,
    a11y: esARA11y,
    currency: esARCurrency,
    date: esARDate,
    pro: esARPro,
    legal: esARLegal,
    onboarding: esAROnboarding,
    bootSplash: esARBootSplash,
    categories: esARCategories,
  },
  'es-ES': {
    common: esESCommon,
    tabs: esESTabs,
    settingsLanguage: esESSettingsLanguage,
    auth: esESAuth,
    settings: esESSettings,
    tickets: esESTickets,
    receipts: esESReceipts,
    household: esESHousehold,
    analytics: esESAnalytics,
    errors: esESErrors,
    a11y: esESA11y,
    currency: esESCurrency,
    date: esESDate,
    pro: esESPro,
    legal: esESLegal,
    onboarding: esESOnboarding,
    bootSplash: esESBootSplash,
    categories: esESCategories,
  },
  'pt-BR': {
    common: ptBRCommon,
    tabs: ptBRTabs,
    settingsLanguage: ptBRSettingsLanguage,
    auth: ptBRAuth,
    settings: ptBRSettings,
    tickets: ptBRTickets,
    receipts: ptBRReceipts,
    household: ptBRHousehold,
    analytics: ptBRAnalytics,
    errors: ptBRErrors,
    a11y: ptBRA11y,
    currency: ptBRCurrency,
    date: ptBRDate,
    pro: ptBRPro,
    legal: ptBRLegal,
    onboarding: ptBROnboarding,
    bootSplash: ptBRBootSplash,
    categories: ptBRCategories,
  },
} as const;

/**
 * Initialize i18next with the bundled catalogs.
 *
 * Idempotent — `init()` is safe to call after the first successful
 * init (i18next no-ops the second call). We pull the active locale
 * from the store rather than from `getLocales()` directly so the
 * manual override (if any) wins at boot.
 *
 * `forceLocale` is the hard-failure fallback: the provider's catch
 * path re-initializes with `'en'` — the GLOBAL fallback, not a
 * regional variant — so the boot gate never opens with an
 * un-initialized instance (which would paint raw keys) and never
 * paints a Spanish variant the reader did not ask for.
 */
export async function initI18n(
  forceLocale?: SupportedLocaleTag,
): Promise<void> {
  const { activeLocale } = useLocaleStore.getState();
  const lng = forceLocale ?? activeLocale;

  await i18next.use(initReactI18next).init({
    resources: RESOURCES,
    lng,
    fallbackLng: { ...FALLBACK_LNG },
    supportedLngs: [...SUPPORTED_LOCALE_TAGS],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: {
      // RN renders strings as native text, not HTML — escaping would
      // corrupt punctuation (e.g. the trailing `…` in `Loading…`).
      escapeValue: false,
    },
    react: {
      // Expo's render pipeline does not suspend at this layer — any
      // hook that suspends here would crash the root layout. The
      // `I18nProvider` already gates the boot on `i18n.isInitialized`.
      useSuspense: false,
    },
    returnNull: false,
  });
}
