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
 *
 * ── Currency (REQ-3) ──────────────────────────────────────────────────────
 * This module also owns the region's DEFAULT CURRENCY, via the same
 * `resolveRegionCode` normalizer. The catalog type comes from
 * `src/lib/format.ts` with `import type` ONLY — erased at compile time, so
 * this module keeps zero runtime imports and its single-root harness
 * (`tsconfig.i18n-detector-test.json`) keeps working untouched. `getLocales()`
 * is deliberately absent here (NFR-2 purity): the native adapter lives in
 * `src/i18n/device-currency.ts`.
 */
import type { SupportedCurrency } from '@/lib/format';

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
 *
 * The region field is NOT parsed here — it is delegated to
 * `resolveRegionCode`, the single region normalizer this module exposes to
 * `detectDefaultCurrency` as well.
 */
function splitTag(languageTag: string): {
  language: string;
  region: string | null;
} {
  const normalized = languageTag.trim().toLowerCase().replace(/_/g, '-');
  const [language = '', ...rest] = normalized.split('-');
  return {
    language,
    // The language subtag is excluded from the hunt: a bare `es` carries NO
    // region, and letting it be read as one would resolve every region-less
    // Spanish device to the Peninsular override.
    region: resolveRegionCode(rest.join('-'), null),
  };
}

/**
 * Resolve the region a device is IN, from a tag that may carry it INLINE
 * (`es-AR`, `es_ES`, `es-Ar-x-private`) or from the platform's own answer in
 * `getLocales()[i].regionCode`.
 *
 * Contract (shared by `detectLocale` AND `detectDefaultCurrency` — one
 * implementation, so the locale and the currency can never disagree about
 * which country a device is in):
 *
 *   1. trim, `_` → `-`, upper-case. Case and separator are normalized away.
 *   2. An explicit non-empty `regionCode` wins OUTRIGHT — it is the
 *      platform's own answer, and on iOS it beats parsing the tag.
 *   3. Otherwise take the LAST segment that is regionish: two alpha
 *      characters (`AR`) or a three-digit UN M.49 code (`419`). "Last" is what
 *      makes a bare `'MX'` resolve to `MX` (it is the only segment) while
 *      `es-419-MX` resolves to `MX`, not to the macro-region.
 *   4. Variant and private-use subtags (`x`, `private`, `POSIX`) are skipped:
 *      they are neither two alpha nor three digits.
 *
 * Pure: no `Intl`, no clock, no native bridge, no module-level state.
 *
 * @param languageTag A BCP-47 / Apple tag, a bare region code, or empty.
 * @param regionCode Optional `getLocales()[i].regionCode`.
 * @returns An UPPERCASE region (`'MX'`, `'419'`), or `null` when there is none.
 */
export function resolveRegionCode(
  languageTag?: string | null,
  regionCode?: string | null,
): string | null {
  const explicit = regionCode?.trim().replace(/_/g, '-').toUpperCase() ?? '';
  if (explicit) {
    const [head = ''] = explicit.split('-');
    if (head) return head;
  }
  const segments = (
    languageTag?.trim().replace(/_/g, '-').toUpperCase() ?? ''
  ).split('-');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i] ?? '';
    if (/^[A-Z]{2}$/.test(segment) || /^\d{3}$/.test(segment)) return segment;
  }
  return null;
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
      switch (resolveRegionCode(region, regionCode)?.toLowerCase()) {
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
 * Region → default currency, keyed by UPPERCASE ISO region exactly as
 * `resolveRegionCode` yields it.
 *
 * Keyed on the COUNTRY, never on the language: `en-GB` is `GBP` even though
 * the app speaks generic English there.
 *
 * COVERAGE POLICY — a territory is mapped iff it has a permanent population
 * AND its CIRCULATING currency is a code the catalog ships (plus the
 * user-assigned `XK`). Its devices then get the currency they actually spend;
 * every code the catalog does not cover falls through to the universal `USD`
 * default in `detectDefaultCurrency` rather than being guessed onto a
 * neighbouring currency, so the map only ever carries deliberate, justified
 * absences. The deliberately-absent ISO 3166-1 alpha-2 codes are:
 *
 *   - No circulating currency / uninhabited:
 *       AQ (Antarctica), BV (Bouvet), GS (South Georgia), HM (Heard &
 *       McDonald), TF (French Southern Territories), UM (US Outlying Islands).
 *   - Transient population only: IO (British Indian Ocean Territory).
 *   - Currency NOT in the catalog:
 *       AW BB BH BM BN BS BZ CV CW DJ FJ FK GI GY IS KM KY MO MU MV SB SC SH
 *       SR ST SX SZ TO TT VU WS.
 *
 * Note `XK` (Kosovo) is a user-assigned ISO code — not issued by UN M.49 — but
 * its 1.8M inhabitants spend the euro, so it is mapped explicitly.
 *
 * Multi-country currency unions map EVERY member to the shared code — the euro
 * area (and the non-EU euro users) to `EUR`, the West African UEMOA to `XOF`,
 * the Central African CEMAC to `XAF`, the Eastern Caribbean OECS to `XCD`, and
 * the French Pacific collectivities to `XPF` — so a device in any member country
 * still gets the currency it actually spends.
 *
 * `419` (the Latin-American macro-region) stays absent: it spans many countries
 * with different currencies, and a macro-region must never be guessed into one
 * country's currency.
 */
export const REGION_DEFAULT_CURRENCY: Readonly<
  Partial<Record<string, SupportedCurrency>>
> = {
  AD: 'EUR',
  AE: 'AED',
  AF: 'AFN',
  AG: 'XCD',
  AI: 'XCD',
  AL: 'ALL',
  AM: 'AMD',
  AO: 'AOA',
  AR: 'ARS',
  AS: 'USD',
  AT: 'EUR',
  AU: 'AUD',
  AX: 'EUR',
  AZ: 'AZN',
  BA: 'BAM',
  BD: 'BDT',
  BE: 'EUR',
  BF: 'XOF',
  BG: 'BGN',
  BI: 'BIF',
  BJ: 'XOF',
  BL: 'EUR',
  BO: 'BOB',
  BQ: 'USD',
  BR: 'BRL',
  BT: 'INR',
  BW: 'BWP',
  BY: 'BYN',
  CA: 'CAD',
  CC: 'AUD',
  CD: 'CDF',
  CF: 'XAF',
  CG: 'XAF',
  CH: 'CHF',
  CI: 'XOF',
  CK: 'NZD',
  CL: 'CLP',
  CM: 'XAF',
  CN: 'CNY',
  CO: 'COP',
  CR: 'CRC',
  CU: 'CUP',
  CX: 'AUD',
  CY: 'EUR',
  CZ: 'CZK',
  DE: 'EUR',
  DK: 'DKK',
  DM: 'XCD',
  DO: 'DOP',
  DZ: 'DZD',
  EC: 'USD',
  EE: 'EUR',
  EG: 'EGP',
  EH: 'MAD',
  ER: 'ERN',
  ES: 'EUR',
  ET: 'ETB',
  FI: 'EUR',
  FM: 'USD',
  FO: 'DKK',
  FR: 'EUR',
  GA: 'XAF',
  GB: 'GBP',
  GD: 'XCD',
  GE: 'GEL',
  GF: 'EUR',
  GG: 'GBP',
  GH: 'GHS',
  GL: 'DKK',
  GM: 'GMD',
  GN: 'GNF',
  GP: 'EUR',
  GQ: 'XAF',
  GR: 'EUR',
  GT: 'GTQ',
  GU: 'USD',
  GW: 'XOF',
  HK: 'HKD',
  HN: 'HNL',
  HR: 'EUR',
  HT: 'HTG',
  HU: 'HUF',
  ID: 'IDR',
  IE: 'EUR',
  IL: 'ILS',
  IM: 'GBP',
  IN: 'INR',
  IQ: 'IQD',
  IR: 'IRR',
  IT: 'EUR',
  JE: 'GBP',
  JM: 'JMD',
  JO: 'JOD',
  JP: 'JPY',
  KE: 'KES',
  KG: 'KGS',
  KH: 'KHR',
  KI: 'AUD',
  KN: 'XCD',
  KP: 'KPW',
  KR: 'KRW',
  KW: 'KWD',
  KZ: 'KZT',
  LA: 'LAK',
  LB: 'LBP',
  LC: 'XCD',
  LI: 'CHF',
  LK: 'LKR',
  LR: 'LRD',
  LS: 'LSL',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  LY: 'LYD',
  MA: 'MAD',
  MC: 'EUR',
  MD: 'MDL',
  ME: 'EUR',
  MF: 'EUR',
  MG: 'MGA',
  MH: 'USD',
  MK: 'MKD',
  ML: 'XOF',
  MM: 'MMK',
  MN: 'MNT',
  MP: 'USD',
  MQ: 'EUR',
  MR: 'MRU',
  MS: 'XCD',
  MT: 'EUR',
  MW: 'MWK',
  MX: 'MXN',
  MY: 'MYR',
  MZ: 'MZN',
  NA: 'NAD',
  NC: 'XPF',
  NE: 'XOF',
  NF: 'AUD',
  NG: 'NGN',
  NI: 'NIO',
  NL: 'EUR',
  NO: 'NOK',
  NP: 'NPR',
  NR: 'AUD',
  NU: 'NZD',
  NZ: 'NZD',
  OM: 'OMR',
  PA: 'PAB',
  PE: 'PEN',
  PF: 'XPF',
  PG: 'PGK',
  PH: 'PHP',
  PK: 'PKR',
  PL: 'PLN',
  PM: 'EUR',
  PN: 'NZD',
  PR: 'USD',
  PS: 'ILS',
  PT: 'EUR',
  PW: 'USD',
  PY: 'PYG',
  QA: 'QAR',
  RE: 'EUR',
  RO: 'RON',
  RS: 'RSD',
  RU: 'RUB',
  RW: 'RWF',
  SA: 'SAR',
  SD: 'SDG',
  SE: 'SEK',
  SG: 'SGD',
  SI: 'EUR',
  SJ: 'NOK',
  SK: 'EUR',
  SL: 'SLE',
  SM: 'EUR',
  SN: 'XOF',
  SO: 'SOS',
  SS: 'SSP',
  SV: 'USD',
  SY: 'SYP',
  TC: 'USD',
  TD: 'XAF',
  TG: 'XOF',
  TH: 'THB',
  TJ: 'TJS',
  TK: 'NZD',
  TL: 'USD',
  TM: 'TMT',
  TN: 'TND',
  TR: 'TRY',
  TV: 'AUD',
  TW: 'TWD',
  TZ: 'TZS',
  UA: 'UAH',
  UG: 'UGX',
  US: 'USD',
  UY: 'UYU',
  UZ: 'UZS',
  VA: 'EUR',
  VC: 'XCD',
  VE: 'VES',
  VG: 'USD',
  VI: 'USD',
  VN: 'VND',
  WF: 'XPF',
  XK: 'EUR',
  YE: 'YER',
  YT: 'EUR',
  ZA: 'ZAR',
  ZM: 'ZMW',
  ZW: 'ZWG',
};

/**
 * The currency a device region's currency should be, as a PURE function of
 * the region. Never `null`: an absent, empty or unmapped region resolves to
 * `USD`, the one code that is valid everywhere (REQ-3 scenario 4).
 *
 * @param languageTag A BCP-47 / Apple tag (`es_MX`) or a bare region (`MX`).
 * @param regionCode Optional `getLocales()[i].regionCode`; wins over the tag.
 * @returns A mapped `SUPPORTED_CURRENCIES` code, or `USD` when the region is
 *   absent, empty or unmapped.
 */
export function detectDefaultCurrency(
  languageTag?: string | null,
  regionCode?: string | null,
): SupportedCurrency {
  const region = resolveRegionCode(languageTag, regionCode);
  return (region && REGION_DEFAULT_CURRENCY[region]) || 'USD';
}

/**
 * Region-relevant currencies for the REVIEW currency subset (design §5).
 *
 * A FORWARD lookup over `REGION_DEFAULT_CURRENCY` keyed by region, returning at
 * most one code. Unlike `detectDefaultCurrency`, the fallback is an EMPTY ARRAY,
 * never `USD`: the subset chip row must not inject a currency the user never
 * chose. The M.49 macro-region `419` is absent from the map on purpose, so a
 * `419` device yields `[]` here and the subset relies on the detected + recent
 * currencies instead.
 */
export function codesForRegion(regionCode?: string | null): SupportedCurrency[] {
  if (!regionCode) return [];
  const code = REGION_DEFAULT_CURRENCY[regionCode.toUpperCase()];
  return code ? [code] : [];
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