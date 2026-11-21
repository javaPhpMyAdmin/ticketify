/**
 * Test double for `@/i18n/stores/useLocaleStore` in the charts render
 * harness. The real store imports i18next + expo-secure-store; the hero
 * only reads `activeLocale` to build locale-aware weekday initials, so a
 * fixed locale is enough for the header layout guard.
 */
type LocaleState = { activeLocale: 'es-AR' };

export function useLocaleStore<T>(selector: (state: LocaleState) => T): T {
  return selector({ activeLocale: 'es-AR' });
}
