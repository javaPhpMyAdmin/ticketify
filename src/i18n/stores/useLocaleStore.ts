/**
 * Locale store — the single source of truth for the active UI language
 * and the user's manual override (REQ-3 / AD-1).
 *
 * Lifecycle:
 *
 *   1. The store starts with `override: 'auto'`, `activeLocale: 'es-419'`
 *      — the neutral Spanish BASE, chosen because it is the only Spanish
 *      locale every other Spanish locale inherits from, so a render that
 *      happens before hydration reads as correct Spanish rather than as
 *      a regional variant the reader did not ask for. `en` is the global
 *      fallback per REQ-1; the two are different jobs and this comment
 *      used to conflate them.
 *
 *   2. `<I18nProvider>` calls `hydrate()` once on mount. Hydration reads
 *      `expo-secure-store` for the override and, on `'auto'`, derives
 *      `activeLocale` from `expo-localization.getLocales()[0].languageTag`
 *      via `detectLocale()` (which also receives `regionCode`, so a
 *      Spanish device resolves to `es-AR`, `es-ES` or the `es-419` base).
 *      A stored override of `'en' | 'es-419' | 'es-AR' | 'es-ES' |
 *      'pt-BR'` wins outright.
 *
 *   3. The user picks a language in `Settings → Idioma`. `setOverride()`
 *      writes the new value to secure-store, swaps the in-memory
 *      `override` + `activeLocale`, and calls `i18next.changeLanguage()`
 *      so every `useTranslation()` subscriber re-renders live without an
 *      app restart (REQ-3 scenario 2).
 *
 * Why a separate store (not extending `useSettingsStore`): the override
 * is client-only persistence decoupled from the server `profiles` row
 * (REQ-3). Coupling it to the profile mirror would conflate two
 * lifecycles and force every selector to await a profile write — see
 * AD-1 in design.md.
 */
import { create } from 'zustand';
import i18next from 'i18next';
import { getLocales } from 'expo-localization';

import { detectLocale, type SupportedLocale } from '../detector';
import { getStoredOverride, setStoredOverride } from '../storage/localeSecureStore';

/**
 * The SIX legal override values, matching `LocaleOverride` in this store
 * and the `ALLOWED` set in `localeSecureStore`.
 *
 * `'auto'` is not a locale — it defers to the device. The other five are
 * exactly the five catalogs `config.ts` bundles; adding a locale to the
 * catalog REQUIRES adding it here, or a user's pick would be discarded
 * on the next cold start as an unknown value.
 */
export type LocaleOverride =
  | 'auto'
  | 'en'
  | 'es-419'
  | 'es-AR'
  | 'es-ES'
  | 'pt-BR';

interface LocaleState {
  /** User's manual override; `'auto'` defers to the device locale. */
  override: LocaleOverride;
  /** The locale i18next is currently rendering. Mirrors `i18next.language`. */
  activeLocale: SupportedLocale;
  /**
   * Pick a new language and persist it. Updates the in-memory state
   * synchronously and triggers an `i18next.changeLanguage()` so every
   * `useTranslation()` subscriber re-renders. The secure-store write is
   * awaited but its failure is swallowed inside the adapter — the live
   * UI update is the source of truth, the next cold start retries.
   */
  setOverride: (value: LocaleOverride) => Promise<void>;
  /**
   * Read the persisted override once at boot and compute `activeLocale`.
   * Safe to call repeatedly — it does not mutate state on a second call,
   * only on the first hydration.
   */
  hydrate: () => Promise<void>;
}

/**
 * Initial state — `'auto'` means "follow device locale" before hydrate.
 *
 * `activeLocale` is the Spanish BASE (`es-419`), NOT `es-AR`: the base is
 * the only Spanish catalog guaranteed to answer every key, so a pre-
 * hydration render paints complete neutral Spanish. It is also NOT `en`:
 * `en` is the fallback for an UNCLASSIFIABLE device, while this value is
 * the placeholder for a device whose locale has not been read yet, and
 * the product's primary audience is Spanish-speaking.
 */
const INITIAL: Pick<LocaleState, 'override' | 'activeLocale'> = {
  override: 'auto',
  activeLocale: 'es-419',
};

/**
 * Resolve the active locale from a stored override. On `'auto'`, read
 * the first device locale via `expo-localization` and map it through
 * `detectLocale`. On any explicit value, that value wins — the user
 * opted out of device detection.
 */
async function resolveActiveLocale(
  override: LocaleOverride,
): Promise<SupportedLocale> {
  if (override === 'auto') {
    try {
      const locales = getLocales();
      const first = locales[0];
      // `regionCode` is passed alongside the tag: on iOS the platform's
      // own region answer is more reliable than parsing the tag, and it
      // is the only way to tell `es-ES` from `es-419` when the tag is a
      // bare `es`.
      return detectLocale(first?.languageTag, first?.regionCode);
    } catch {
      // `getLocales()` can throw on rare simulator configs. Fall through
      // to the hard-coded default rather than leaving the user staring
      // at a broken UI.
      return detectLocale(undefined);
    }
  }
  return override;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  ...INITIAL,

  setOverride: async (value) => {
    const next = await resolveActiveLocale(value);
    set({ override: value, activeLocale: next });
    // `changeLanguage` is synchronous in i18next v26 (no network fetch);
    // awaiting here keeps a single async boundary at the call site and
    // keeps the contract obvious for callers that need to await.
    try {
      await i18next.changeLanguage(next);
    } catch (err) {
      // eslint-disable-next-line no-console -- boot-path diagnostic only
      console.warn('[i18n] changeLanguage failed', err);
    }
    // Persist after the live UI update — if the write fails the user
    // still sees the change now; the next cold start re-reads whatever
    // is on disk.
    await setStoredOverride(value);
  },

  hydrate: async () => {
    // Idempotent: re-hydration (e.g. from a manual call) does not stomp
    // an in-memory override that the user just picked.
    if (get().override !== INITIAL.override) return;

    const stored = await getStoredOverride();
    const effective = stored ?? 'auto';
    const next = await resolveActiveLocale(effective);
    set({ override: effective, activeLocale: next });
  },
}));