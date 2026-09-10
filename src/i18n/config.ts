/**
 * i18next initialization — bundles the three locale catalogs and
 * configures the runtime.
 *
 * Call once at boot from `<I18nProvider>`. The function:
 *
 *   1. Resolves the active locale from the hydrated `useLocaleStore`
 *      (which has already read the secure-store override + device
 *      locale by the time the provider mounts).
 *   2. Bundles the three namespaces (`common`, `tabs`) for each of
 *      `en` / `es-AR` / `pt-BR` from the JSON files. Metro packs the
 *      JSON via `resolveJsonModule` so there is no network fetch at
 *      boot (NFR-6).
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
import esARCommon from './locales/es-AR/common.json';
import esARTabs from './locales/es-AR/tabs.json';
import esARSettingsLanguage from './locales/es-AR/settingsLanguage.json';
import ptBRCommon from './locales/pt-BR/common.json';
import ptBRTabs from './locales/pt-BR/tabs.json';
import ptBRSettingsLanguage from './locales/pt-BR/settingsLanguage.json';
import { useLocaleStore } from './stores/useLocaleStore';

/** Every locale the catalog ships, in `lng` form (matches JSON folder names). */
export const SUPPORTED_LOCALE_TAGS = ['en', 'es-AR', 'pt-BR'] as const;
export type SupportedLocaleTag = (typeof SUPPORTED_LOCALE_TAGS)[number];

/** Every namespace the catalog ships for PR 1. */
export const NAMESPACES = ['common', 'tabs', 'settingsLanguage'] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Bundled resources — keyed by locale then namespace. */
export const RESOURCES = {
  en: { common: enCommon, tabs: enTabs, settingsLanguage: enSettingsLanguage },
  'es-AR': {
    common: esARCommon,
    tabs: esARTabs,
    settingsLanguage: esARSettingsLanguage,
  },
  'pt-BR': {
    common: ptBRCommon,
    tabs: ptBRTabs,
    settingsLanguage: ptBRSettingsLanguage,
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