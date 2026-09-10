/**
 * i18next initialization — bundles the locale catalogs and configures
 * the runtime.
 *
 * Call once at boot from `<I18nProvider>`. The function:
 *
 *   1. Resolves the active locale from the hydrated `useLocaleStore`
 *      (which has already read the secure-store override + device
 *      locale by the time the provider mounts).
 *   2. Bundles the PR 2 namespaces for each of `en` / `es-AR` / `pt-BR`
 *      from the JSON files. Metro packs the JSON via
 *      `resolveJsonModule` so there is no network fetch at boot (NFR-6).
 *   3. Configures `fallbackLng: 'es-AR'` (REQ-1) and `supportedLngs`
 *      matching the three catalogs.
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
import { useLocaleStore } from './stores/useLocaleStore';

/** Every locale the catalog ships, in `lng` form (matches JSON folder names). */
export const SUPPORTED_LOCALE_TAGS = ['en', 'es-AR', 'pt-BR'] as const;
export type SupportedLocaleTag = (typeof SUPPORTED_LOCALE_TAGS)[number];

/**
 * Every namespace the catalog ships for PR 2. PR 1 only shipped
 * `common`, `tabs`, `settingsLanguage`; PR 2 widens with the rest of
 * the user-facing strings (`auth`, `settings`, `tickets`, `receipts`,
 * `household`, `analytics`, `errors`, `a11y`, `currency`).
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
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Bundled resources — keyed by locale then namespace. */
export const RESOURCES = {
  en: {
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
  },
} as const;

/**
 * Initialize i18next with the bundled catalogs.
 *
 * Idempotent — `init()` is safe to call after the first successful
 * init (i18next no-ops the second call). We pull the active locale
 * from the store rather than from `getLocales()` directly so the
 * manual override (if any) wins at boot.
 */
export async function initI18n(): Promise<void> {
  const { activeLocale } = useLocaleStore.getState();

  await i18next.use(initReactI18next).init({
    resources: RESOURCES,
    lng: activeLocale,
    fallbackLng: 'es-AR',
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