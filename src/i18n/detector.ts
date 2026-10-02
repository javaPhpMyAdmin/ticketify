/**
 * Pure device-locale detector (REQ-2, NFR-4).
 *
 * Maps a BCP-47 language tag emitted by `expo-localization.getLocales()`
 * to one of the five locales the app ships:
 *
 *   pt-*      → 'pt-BR'   (any Portuguese tag, including pt-PT)
 *   en-*      → 'en'      (any English tag, including en-GB)
 *   es-AR     → 'es-AR'   (Rioplatense: the voseo override)
 *   es-ES     → 'es-ES'   (Peninsular: the vosotros / perfect-compound override)
 *   es-*      → 'es-419'  (neutral Latin-American Spanish — THE SPANISH BASE)
 *   anything else → 'en' (the global fallback per REQ-1)
 *
 * `undefined`, empty string, and unknown tags all collapse to `'en'`.
 * The function is pure (no module-level state, no `Intl`) so it is
 * unit-testable independent of React or the native bridge.
 *
 * ── Why three Spanish locales ──────────────────────────────────────────────
 * `es-419` is the *unsuffixed* UN M.49 region code for "Latin America,
 * Spanish". It is the base every Spanish locale inherits from, so a
 * device set to `es-MX`, `es-CO`, `es-AR`-less `es`, `es-US` or a bare
 * `es` resolves to it rather than to a region it does not speak for.
 * `es-AR` and `es-ES` are then *sparse overrides* on top of that base:
 * they carry only the leaves that genuinely diverge (voseo in the first
 * case, Peninsular register in the second), never a full copy. See
 * `locale-catalog-hierarchy` for the contract this detector feeds.
 *
 * ── Underscore tags (Apple) ────────────────────────────────────────────────
 * Apple's `CFBundle`/NSLocale family emits `es_ES`, `pt_BR`, `en_US` —
 * underscore-separated, and NOT valid BCP-47. Normalizing the separator
 * first means one code path handles both dialects, and the region segment
 * is compared case-insensitively (`es_es` and `es-ES` both hit `ES`).
 *
 * The function is deliberately region-aware for Spanish ONLY: `pt-PT` must
 * still land on `pt-BR` (we ship no European Portuguese) and `en-GB` on `en`.
 */
export type SupportedLocale =
  | 'en'
  | 'es-419'
  | 'es-AR'
  | 'es-ES'
  | 'pt-BR';

/** Every shipped locale, in the order `config.ts` registers them. */
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  'en',
  'es-419',
  'es-AR',
  'es-ES',
  'pt-BR',
] as const;

/**
 * Default locale — used when the input is empty, missing, or an
 * unsupported tag. Mirrors the GLOBAL fallback in `config.ts`'s
 * per-language `fallbackLng` map so the detector and the i18next init
 * agree. This is the hard guarantee the design names: an app that cannot
 * classify a device locale paints ENGLISH, never a regional variant the
 * reader does not speak.
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Regionalization viability thresholds.
 *
 * Switching from `es-419` to a regional variant is only worth the bundle
 * bytes and the reader's relearning when the variant actually reads
 * differently. The picker offers a region only when the override clears
 * BOTH bars:
 *
 *   - `REGIONAL_NAMESPACE_VIABILITY` (75%) — at least this share of the
 *     shipped namespaces must carry at least one diverging leaf. Below
 *     that, the override is indistinguishable from the base for most of
 *     the app and the bundle cost buys nothing.
 *   - `REGIONAL_LEAF_VIABILITY` (65%) — at least this share of all
 *     Spanish leaves must diverge. A region that differs in one onboarding
 *     line but nowhere else will read as an inconsistent half-translation.
 *
 * Both are intentionally conservative: a false negative costs the reader
 * an accurate label on the picker row, while a false positive ships a
 * region that is a full second translation for a handful of words.
 */
export const REGIONAL_NAMESPACE_VIABILITY = 0.75;
export const REGIONAL_LEAF_VIABILITY = 0.65;

/** The neutral Spanish base every other Spanish locale inherits from. */
export const SPANISH_BASE: SupportedLocale = 'es-419';

/** Every Spanish locale the app ships, base first. */
export const SPANISH_LOCALES: readonly SupportedLocale[] = [
  'es-419',
  'es-AR',
  'es-ES',
] as const;

/** The Spanish locale that carries a plural second-person form. */
export const PLURAL_SECOND_PERSON: Readonly<
  Record<'es-AR' | 'es-ES', string>
> = {
  'es-AR': ' (vos)',
  'es-ES': ' (vosotros)',
} as const;

/**
 * Normalize an Apple-style or BCP-47 tag into `[language, region]`.
 * Underscores become hyphens, everything is lowercased, and a
 * single-segment tag yields `null` for the region.
 */
function splitTag(languageTag: string): {
  language: string;
  region: string | null;
} {
  const normalized = languageTag.trim().toLowerCase().replace(/_/g, '-');
  const [language = '', ...rest] = normalized.split('-');
  // BCP-47 allows a 3-digit UN M.49 region (`es-419`). A subtags-looking
  // segment that is neither 2 alpha nor 3 digits is a variant/singleton
  // (`es-Ar-x-private`) — skip it when hunting for the region.
  const region = rest.find(
    (seg) => /^[a-z]{2}$/.test(seg) || /^\d{3}$/.test(seg),
  );
  return { language, region: region ?? null };
}

/**
 * Resolve the region for a tag that may carry it INLINE (`es-AR`,
 * `es_ES`) or arrive separately from `getLocales()[i].regionCode`.
 * The explicit `regionCode` argument wins when present and non-empty —
 * it is the platform's own answer, and on iOS it is more reliable than
 * parsing the tag.
 */
function resolveRegion(
  inlineRegion: string | null,
  regionCode?: string | null,
): string | null {
  const explicit = regionCode?.trim().toLowerCase().replace(/_/g, '-');
  if (explicit) {
    const [head = ''] = explicit.split('-');
    if (head) return head;
  }
  return inlineRegion;
}

/**
 * Detect the app locale from a device language tag.
 *
 * @param languageTag - The first entry from `getLocales()`, or any BCP-47 /
 *   Apple tag-like string. `undefined` and empty string are accepted and
 *   fall back to `DEFAULT_LOCALE`.
 * @param regionCode - Optional `getLocales()[i].regionCode`. Used to
 *   disambiguate Spanish (`es-AR` vs `es-ES` vs `es-419`); ignored for
 *   `pt-*` and `en-*`, which have a single shipped variant each.
 * @returns One of `'en' | 'es-419' | 'es-AR' | 'es-ES' | 'pt-BR'`.
 */
export function detectLocale(
  languageTag: string | undefined,
  regionCode?: string | null,
): SupportedLocale {
  if (!languageTag) return DEFAULT_LOCALE;
  const { language, region } = splitTag(languageTag);
  if (!language) return DEFAULT_LOCALE;

  switch (language) {
    case 'pt':
      // Brazilian Portuguese is the only Portuguese we ship, so every
      // Portuguese tag — `pt`, `pt-BR`, `pt-PT` — lands here.
      return 'pt-BR';
    case 'en':
      return 'en';
    case 'es':
      switch (resolveRegion(region, regionCode)) {
        case 'ar':
          return 'es-AR';
        case 'es':
          return 'es-ES';
        default:
          // `es-419` inline, any other Latin-American region, a bare
          // `es`, or an unknown region — all resolve to the base.
          return SPANISH_BASE;
      }
    default:
      return DEFAULT_LOCALE;
  }
}

/**
 * Is the requested language one the app regionalizes at all? A picker row
 * for a language the catalog does not ship would resolve every key through
 * `en`, which is a worse outcome than leaving the device locale alone.
 */
export function isRegionalizable(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Does a candidate regional locale clear BOTH viability bars relative to
 * the Spanish base?
 *
 * @param candidate  The regional override being considered (`es-AR`/`es-ES`).
 * @param namespaces Number of namespaces the base ships.
 * @param divergentNamespaces Namespaces with at least one diverging leaf.
 * @param leaves Number of Spanish leaves the base ships.
 * @param divergentLeaves Leaves that differ from the base.
 */
export function meetsRegionalViability(
  candidate: SupportedLocale,
  namespaces: number,
  divergentNamespaces: number,
  leaves: number,
  divergentLeaves: number,
): boolean {
  if (candidate === SPANISH_BASE) return true;
  if (!SPANISH_LOCALES.includes(candidate)) return false;
  if (namespaces <= 0 || leaves <= 0) return false;
  return (
    divergentNamespaces / namespaces >= REGIONAL_NAMESPACE_VIABILITY &&
    divergentLeaves / leaves >= REGIONAL_LEAF_VIABILITY
  );
}

/**
 * The per-locale fallback chain i18next walks when a key is missing from
 * the active locale. Mirrored verbatim in `config.ts`'s `initI18n` — a
 * divergence between the two is a bug the init harness pins.
 *
 * The two regional overrides inherit the BASE (not `en`) before falling
 * all the way back, so a key the region legitimately omits still reads as
 * neutral Spanish instead of English.
 */
export const FALLBACK_CHAIN: Readonly<Record<SupportedLocale, readonly string[]>> =
  {
    en: ['en'],
    'es-419': ['en'],
    'es-AR': ['es-419', 'en'],
    'es-ES': ['es-419', 'en'],
    'pt-BR': ['en'],
  } as const;