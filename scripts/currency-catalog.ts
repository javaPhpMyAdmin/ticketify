/**
 * Canonical currency catalog — the single source of truth for the widened
 * Tier-A set (123 codes). The generator (`scripts/generate-currency-catalog.mjs`)
 * renders every derived artifact from this module:
 *
 *   - `src/lib/format.ts`          (LATAM/INTL/ZERO/THREE/SEPARATOR/SYMBOL blocks)
 *   - `supabase/functions/parse-ticket/lib/parse.ts` (SUPPORTED_CURRENCIES)
 *   - `supabase/migrations/0047_widen_currency_catalog.sql` (NOT IN literal)
 *   - `src/i18n/locales/{en,es-419,pt-BR}/currency.json` (labels)
 *
 * Grouping rule (locked): LATAM = the 15 pre-change LATAM codes plus VES and CUP
 * (17). INTL = the 13 pre-change INTL codes plus the remaining 93 additions
 * (106). Order is alphabetical by code within each group so UI rows never
 * reshuffle when the display language changes.
 *
 * Deferred: XCG (Caribbean guilder) — out of scope for this change.
 *
 * This module has NO runtime imports and NO TypeScript features that require
 * code generation, so Node >= 22.18 can load it directly via type stripping.
 */

export type CurrencyGroup = 'LATAM' | 'INTL';

export type MinorUnit = 0 | 2 | 3;

export interface CurrencyEntry {
  code: string; // ISO 4217 alpha-3 UPPERCASE
  group: CurrencyGroup;
  minorUnit: MinorUnit; // 0 | 2 | 3
  symbol: string;
  symbolVerified: boolean; // false => glyph needs CLDR/Wikipedia confirmation
  separatorOverride: boolean; // true => INTL grouping despite LATAM group
  labels: { en: string; 'es-419': string; 'pt-BR': string };
}

export const CURRENCIES: readonly CurrencyEntry[] = [
  // ---------------------------------------------------------------------------
  // LATAM (17) — thousands `.`, decimals `,` except the separator overrides.
  // ---------------------------------------------------------------------------
  { code: 'ARS', group: 'LATAM', minorUnit: 2, symbol: '$', symbolVerified: true, separatorOverride: false, labels: { en: 'Argentine peso', 'es-419': 'Peso argentino', 'pt-BR': 'Peso argentino' } },
  { code: 'BOB', group: 'LATAM', minorUnit: 2, symbol: 'Bs', symbolVerified: true, separatorOverride: false, labels: { en: 'Bolivian boliviano', 'es-419': 'Boliviano', 'pt-BR': 'Boliviano' } },
  { code: 'BRL', group: 'LATAM', minorUnit: 2, symbol: 'R$', symbolVerified: true, separatorOverride: false, labels: { en: 'Brazilian real', 'es-419': 'Real brasileño', 'pt-BR': 'Real brasileiro' } },
  { code: 'CLP', group: 'LATAM', minorUnit: 0, symbol: '$', symbolVerified: true, separatorOverride: false, labels: { en: 'Chilean peso', 'es-419': 'Peso chileno', 'pt-BR': 'Peso chileno' } },
  { code: 'COP', group: 'LATAM', minorUnit: 2, symbol: '$', symbolVerified: true, separatorOverride: false, labels: { en: 'Colombian peso', 'es-419': 'Peso colombiano', 'pt-BR': 'Peso colombiano' } },
  { code: 'CRC', group: 'LATAM', minorUnit: 2, symbol: '₡', symbolVerified: true, separatorOverride: false, labels: { en: 'Costa Rican colón', 'es-419': 'Colón costarricense', 'pt-BR': 'Colón costarriquenho' } },
  { code: 'CUP', group: 'LATAM', minorUnit: 2, symbol: '$', symbolVerified: true, separatorOverride: false, labels: { en: 'Cuban peso', 'es-419': 'Peso cubano', 'pt-BR': 'Peso cubano' } },
  { code: 'DOP', group: 'LATAM', minorUnit: 2, symbol: 'RD$', symbolVerified: true, separatorOverride: true, labels: { en: 'Dominican peso', 'es-419': 'Peso dominicano', 'pt-BR': 'Peso dominicano' } },
  { code: 'GTQ', group: 'LATAM', minorUnit: 2, symbol: 'Q', symbolVerified: true, separatorOverride: true, labels: { en: 'Guatemalan quetzal', 'es-419': 'Quetzal guatemalteco', 'pt-BR': 'Quetzal guatemalteco' } },
  { code: 'HNL', group: 'LATAM', minorUnit: 2, symbol: 'L', symbolVerified: true, separatorOverride: true, labels: { en: 'Honduran lempira', 'es-419': 'Lempira hondureño', 'pt-BR': 'Lempira hondurenha' } },
  { code: 'MXN', group: 'LATAM', minorUnit: 2, symbol: '$', symbolVerified: true, separatorOverride: true, labels: { en: 'Mexican peso', 'es-419': 'Peso mexicano', 'pt-BR': 'Peso mexicano' } },
  { code: 'NIO', group: 'LATAM', minorUnit: 2, symbol: 'C$', symbolVerified: true, separatorOverride: true, labels: { en: 'Nicaraguan córdoba', 'es-419': 'Córdoba nicaragüense', 'pt-BR': 'Córdoba nicaraguense' } },
  { code: 'PAB', group: 'LATAM', minorUnit: 2, symbol: 'B/.', symbolVerified: true, separatorOverride: true, labels: { en: 'Panamanian balboa', 'es-419': 'Balboa panameño', 'pt-BR': 'Balboa panamenho' } },
  { code: 'PEN', group: 'LATAM', minorUnit: 2, symbol: 'S/', symbolVerified: true, separatorOverride: false, labels: { en: 'Peruvian sol', 'es-419': 'Sol peruano', 'pt-BR': 'Sol peruano' } },
  { code: 'PYG', group: 'LATAM', minorUnit: 0, symbol: '₲', symbolVerified: true, separatorOverride: false, labels: { en: 'Paraguayan guaraní', 'es-419': 'Guaraní paraguayo', 'pt-BR': 'Guarani' } },
  { code: 'UYU', group: 'LATAM', minorUnit: 2, symbol: '$U', symbolVerified: true, separatorOverride: false, labels: { en: 'Uruguayan peso', 'es-419': 'Peso uruguayo', 'pt-BR': 'Peso uruguaio' } },
  { code: 'VES', group: 'LATAM', minorUnit: 2, symbol: 'Bs.', symbolVerified: true, separatorOverride: false, labels: { en: 'Venezuelan bolívar', 'es-419': 'Bolívar venezolano', 'pt-BR': 'Bolívar venezuelano' } },

  // ---------------------------------------------------------------------------
  // INTL (106) — thousands `,`, decimals `.`.
  // ---------------------------------------------------------------------------
  { code: 'AED', group: 'INTL', minorUnit: 2, symbol: 'د.إ', symbolVerified: true, separatorOverride: false, labels: { en: 'United Arab Emirates dirham', 'es-419': 'Dírham de los Emiratos Árabes Unidos', 'pt-BR': 'Dirrã dos Emirados Árabes Unidos' } },
  { code: 'AFN', group: 'INTL', minorUnit: 2, symbol: '؋', symbolVerified: true, separatorOverride: false, labels: { en: 'Afghan afghani', 'es-419': 'Afgani afgano', 'pt-BR': 'Afegane afegão' } },
  { code: 'ALL', group: 'INTL', minorUnit: 2, symbol: 'L', symbolVerified: true, separatorOverride: false, labels: { en: 'Albanian lek', 'es-419': 'Lek albanés', 'pt-BR': 'Lek albanês' } },
  { code: 'AMD', group: 'INTL', minorUnit: 2, symbol: '֏', symbolVerified: true, separatorOverride: false, labels: { en: 'Armenian dram', 'es-419': 'Dram armenio', 'pt-BR': 'Dram armênio' } },
  { code: 'AOA', group: 'INTL', minorUnit: 2, symbol: 'Kz', symbolVerified: true, separatorOverride: false, labels: { en: 'Angolan kwanza', 'es-419': 'Kwanza angolano', 'pt-BR': 'Kwanza angolano' } },
  { code: 'AUD', group: 'INTL', minorUnit: 2, symbol: 'A$', symbolVerified: true, separatorOverride: false, labels: { en: 'Australian dollar', 'es-419': 'Dólar australiano', 'pt-BR': 'Dólar australiano' } },
  { code: 'AZN', group: 'INTL', minorUnit: 2, symbol: '₼', symbolVerified: true, separatorOverride: false, labels: { en: 'Azerbaijani manat', 'es-419': 'Manat azerbaiyano', 'pt-BR': 'Manat azerbaijano' } },
  { code: 'BAM', group: 'INTL', minorUnit: 2, symbol: 'KM', symbolVerified: true, separatorOverride: false, labels: { en: 'Bosnia-Herzegovina convertible mark', 'es-419': 'Marco convertible de Bosnia y Herzegovina', 'pt-BR': 'Marco conversível da Bósnia e Herzegovina' } },
  { code: 'BDT', group: 'INTL', minorUnit: 2, symbol: '৳', symbolVerified: true, separatorOverride: false, labels: { en: 'Bangladeshi taka', 'es-419': 'Taka bangladesí', 'pt-BR': 'Taka bengali' } },
  { code: 'BGN', group: 'INTL', minorUnit: 2, symbol: 'лв', symbolVerified: true, separatorOverride: false, labels: { en: 'Bulgarian lev', 'es-419': 'Lev búlgaro', 'pt-BR': 'Lev búlgaro' } },
  { code: 'BIF', group: 'INTL', minorUnit: 0, symbol: 'FBu', symbolVerified: true, separatorOverride: false, labels: { en: 'Burundian franc', 'es-419': 'Franco burundés', 'pt-BR': 'Franco burundês' } },
  { code: 'BWP', group: 'INTL', minorUnit: 2, symbol: 'P', symbolVerified: true, separatorOverride: false, labels: { en: 'Botswana pula', 'es-419': 'Pula botsuana', 'pt-BR': 'Pula botsuanesa' } },
  { code: 'BYN', group: 'INTL', minorUnit: 2, symbol: 'Br', symbolVerified: false, separatorOverride: false, labels: { en: 'Belarusian ruble', 'es-419': 'Rublo bielorruso', 'pt-BR': 'Rublo bielorrusso' } },
  { code: 'CAD', group: 'INTL', minorUnit: 2, symbol: 'CA$', symbolVerified: true, separatorOverride: false, labels: { en: 'Canadian dollar', 'es-419': 'Dólar canadiense', 'pt-BR': 'Dólar canadense' } },
  { code: 'CDF', group: 'INTL', minorUnit: 2, symbol: 'FC', symbolVerified: true, separatorOverride: false, labels: { en: 'Congolese franc', 'es-419': 'Franco congoleño', 'pt-BR': 'Franco congolês' } },
  { code: 'CHF', group: 'INTL', minorUnit: 2, symbol: 'CHF', symbolVerified: true, separatorOverride: false, labels: { en: 'Swiss franc', 'es-419': 'Franco suizo', 'pt-BR': 'Franco suíço' } },
  { code: 'CNY', group: 'INTL', minorUnit: 2, symbol: 'CN¥', symbolVerified: true, separatorOverride: false, labels: { en: 'Chinese yuan', 'es-419': 'Yuan chino', 'pt-BR': 'Yuan chinês' } },
  { code: 'CZK', group: 'INTL', minorUnit: 2, symbol: 'Kč', symbolVerified: true, separatorOverride: false, labels: { en: 'Czech koruna', 'es-419': 'Corona checa', 'pt-BR': 'Coroa tcheca' } },
  { code: 'DKK', group: 'INTL', minorUnit: 2, symbol: 'kr', symbolVerified: true, separatorOverride: false, labels: { en: 'Danish krone', 'es-419': 'Corona danesa', 'pt-BR': 'Coroa dinamarquesa' } },
  { code: 'DZD', group: 'INTL', minorUnit: 2, symbol: 'د.ج', symbolVerified: true, separatorOverride: false, labels: { en: 'Algerian dinar', 'es-419': 'Dinar argelino', 'pt-BR': 'Dinar argelino' } },
  { code: 'EGP', group: 'INTL', minorUnit: 2, symbol: 'E£', symbolVerified: true, separatorOverride: false, labels: { en: 'Egyptian pound', 'es-419': 'Libra egipcia', 'pt-BR': 'Libra egípcia' } },
  { code: 'ERN', group: 'INTL', minorUnit: 2, symbol: 'Nfk', symbolVerified: true, separatorOverride: false, labels: { en: 'Eritrean nakfa', 'es-419': 'Nakfa eritreo', 'pt-BR': 'Nakfa eritreia' } },
  { code: 'ETB', group: 'INTL', minorUnit: 2, symbol: 'Br', symbolVerified: true, separatorOverride: false, labels: { en: 'Ethiopian birr', 'es-419': 'Birr etíope', 'pt-BR': 'Birr etíope' } },
  { code: 'EUR', group: 'INTL', minorUnit: 2, symbol: '€', symbolVerified: true, separatorOverride: false, labels: { en: 'Euro', 'es-419': 'Euro', 'pt-BR': 'Euro' } },
  { code: 'GBP', group: 'INTL', minorUnit: 2, symbol: '£', symbolVerified: true, separatorOverride: false, labels: { en: 'British pound sterling', 'es-419': 'Libra esterlina', 'pt-BR': 'Libra esterlina' } },
  { code: 'GEL', group: 'INTL', minorUnit: 2, symbol: '₾', symbolVerified: false, separatorOverride: false, labels: { en: 'Georgian lari', 'es-419': 'Lari georgiano', 'pt-BR': 'Lari georgiano' } },
  { code: 'GHS', group: 'INTL', minorUnit: 2, symbol: '₵', symbolVerified: true, separatorOverride: false, labels: { en: 'Ghanaian cedi', 'es-419': 'Cedi ghanés', 'pt-BR': 'Cedi ganês' } },
  { code: 'GMD', group: 'INTL', minorUnit: 2, symbol: 'D', symbolVerified: true, separatorOverride: false, labels: { en: 'Gambian dalasi', 'es-419': 'Dalasi gambiano', 'pt-BR': 'Dalasi gambiano' } },
  { code: 'GNF', group: 'INTL', minorUnit: 0, symbol: 'FG', symbolVerified: true, separatorOverride: false, labels: { en: 'Guinean franc', 'es-419': 'Franco guineano', 'pt-BR': 'Franco guineano' } },
  { code: 'HKD', group: 'INTL', minorUnit: 2, symbol: 'HK$', symbolVerified: true, separatorOverride: false, labels: { en: 'Hong Kong dollar', 'es-419': 'Dólar de Hong Kong', 'pt-BR': 'Dólar de Hong Kong' } },
  { code: 'HTG', group: 'INTL', minorUnit: 2, symbol: 'G', symbolVerified: true, separatorOverride: false, labels: { en: 'Haitian gourde', 'es-419': 'Gourde haitiano', 'pt-BR': 'Gourde haitiano' } },
  { code: 'HUF', group: 'INTL', minorUnit: 2, symbol: 'Ft', symbolVerified: true, separatorOverride: false, labels: { en: 'Hungarian forint', 'es-419': 'Forinto húngaro', 'pt-BR': 'Forint húngaro' } },
  { code: 'IDR', group: 'INTL', minorUnit: 2, symbol: 'Rp', symbolVerified: true, separatorOverride: false, labels: { en: 'Indonesian rupiah', 'es-419': 'Rupia indonesia', 'pt-BR': 'Rupia indonésia' } },
  { code: 'ILS', group: 'INTL', minorUnit: 2, symbol: '₪', symbolVerified: true, separatorOverride: false, labels: { en: 'Israeli new shekel', 'es-419': 'Nuevo séquel israelí', 'pt-BR': 'Novo shekel israelense' } },
  { code: 'INR', group: 'INTL', minorUnit: 2, symbol: '₹', symbolVerified: true, separatorOverride: false, labels: { en: 'Indian rupee', 'es-419': 'Rupia india', 'pt-BR': 'Rupia indiana' } },
  { code: 'IQD', group: 'INTL', minorUnit: 3, symbol: 'ع.د', symbolVerified: true, separatorOverride: false, labels: { en: 'Iraqi dinar', 'es-419': 'Dinar iraquí', 'pt-BR': 'Dinar iraquiano' } },
  { code: 'IRR', group: 'INTL', minorUnit: 2, symbol: '﷼', symbolVerified: true, separatorOverride: false, labels: { en: 'Iranian rial', 'es-419': 'Rial iraní', 'pt-BR': 'Rial iraniano' } },
  { code: 'JMD', group: 'INTL', minorUnit: 2, symbol: 'J$', symbolVerified: true, separatorOverride: false, labels: { en: 'Jamaican dollar', 'es-419': 'Dólar jamaiquino', 'pt-BR': 'Dólar jamaicano' } },
  { code: 'JOD', group: 'INTL', minorUnit: 3, symbol: 'د.ا', symbolVerified: true, separatorOverride: false, labels: { en: 'Jordanian dinar', 'es-419': 'Dinar jordano', 'pt-BR': 'Dinar jordaniano' } },
  { code: 'JPY', group: 'INTL', minorUnit: 0, symbol: '¥', symbolVerified: true, separatorOverride: false, labels: { en: 'Japanese yen', 'es-419': 'Yen japonés', 'pt-BR': 'Iene japonês' } },
  { code: 'KES', group: 'INTL', minorUnit: 2, symbol: 'KSh', symbolVerified: true, separatorOverride: false, labels: { en: 'Kenyan shilling', 'es-419': 'Chelín keniano', 'pt-BR': 'Xelim queniano' } },
  { code: 'KGS', group: 'INTL', minorUnit: 2, symbol: '⃀', symbolVerified: true, separatorOverride: false, labels: { en: 'Kyrgyzstani som', 'es-419': 'Som kirguís', 'pt-BR': 'Som quirguiz' } },
  { code: 'KHR', group: 'INTL', minorUnit: 2, symbol: '៛', symbolVerified: true, separatorOverride: false, labels: { en: 'Cambodian riel', 'es-419': 'Riel camboyano', 'pt-BR': 'Riel cambojano' } },
  { code: 'KPW', group: 'INTL', minorUnit: 2, symbol: '₩', symbolVerified: true, separatorOverride: false, labels: { en: 'North Korean won', 'es-419': 'Won norcoreano', 'pt-BR': 'Won norte-coreano' } },
  { code: 'KRW', group: 'INTL', minorUnit: 0, symbol: '₩', symbolVerified: true, separatorOverride: false, labels: { en: 'South Korean won', 'es-419': 'Won surcoreano', 'pt-BR': 'Won sul-coreano' } },
  { code: 'KWD', group: 'INTL', minorUnit: 3, symbol: 'KD', symbolVerified: false, separatorOverride: false, labels: { en: 'Kuwaiti dinar', 'es-419': 'Dinar kuwaití', 'pt-BR': 'Dinar kuwaitiano' } },
  { code: 'KZT', group: 'INTL', minorUnit: 2, symbol: '₸', symbolVerified: true, separatorOverride: false, labels: { en: 'Kazakhstani tenge', 'es-419': 'Tenge kazajo', 'pt-BR': 'Tenge cazaque' } },
  { code: 'LAK', group: 'INTL', minorUnit: 2, symbol: '₭', symbolVerified: true, separatorOverride: false, labels: { en: 'Lao kip', 'es-419': 'Kip laosiano', 'pt-BR': 'Kip laosiano' } },
  { code: 'LBP', group: 'INTL', minorUnit: 2, symbol: 'L£', symbolVerified: true, separatorOverride: false, labels: { en: 'Lebanese pound', 'es-419': 'Libra libanesa', 'pt-BR': 'Libra libanesa' } },
  { code: 'LKR', group: 'INTL', minorUnit: 2, symbol: 'Rs', symbolVerified: true, separatorOverride: false, labels: { en: 'Sri Lankan rupee', 'es-419': 'Rupia de Sri Lanka', 'pt-BR': 'Rupia cingalesa' } },
  { code: 'LRD', group: 'INTL', minorUnit: 2, symbol: 'L$', symbolVerified: true, separatorOverride: false, labels: { en: 'Liberian dollar', 'es-419': 'Dólar liberiano', 'pt-BR': 'Dólar liberiano' } },
  { code: 'LSL', group: 'INTL', minorUnit: 2, symbol: 'L', symbolVerified: true, separatorOverride: false, labels: { en: 'Lesotho loti', 'es-419': 'Loti lesotense', 'pt-BR': 'Loti do Lesoto' } },
  { code: 'LYD', group: 'INTL', minorUnit: 3, symbol: 'LD', symbolVerified: true, separatorOverride: false, labels: { en: 'Libyan dinar', 'es-419': 'Dinar libio', 'pt-BR': 'Dinar líbio' } },
  { code: 'MAD', group: 'INTL', minorUnit: 2, symbol: 'DH', symbolVerified: true, separatorOverride: false, labels: { en: 'Moroccan dirham', 'es-419': 'Dírham marroquí', 'pt-BR': 'Dirrã marroquino' } },
  { code: 'MDL', group: 'INTL', minorUnit: 2, symbol: 'L', symbolVerified: true, separatorOverride: false, labels: { en: 'Moldovan leu', 'es-419': 'Leu moldavo', 'pt-BR': 'Leu moldavo' } },
  { code: 'MGA', group: 'INTL', minorUnit: 2, symbol: 'Ar', symbolVerified: true, separatorOverride: false, labels: { en: 'Malagasy ariary', 'es-419': 'Ariary malgache', 'pt-BR': 'Ariary malgaxe' } }, // ISO 1/5-subunit quirk intentionally not modeled
  { code: 'MKD', group: 'INTL', minorUnit: 2, symbol: 'ден', symbolVerified: true, separatorOverride: false, labels: { en: 'Macedonian denar', 'es-419': 'Denar macedonio', 'pt-BR': 'Denar macedônio' } },
  { code: 'MMK', group: 'INTL', minorUnit: 2, symbol: 'K', symbolVerified: true, separatorOverride: false, labels: { en: 'Myanmar kyat', 'es-419': 'Kyat birmano', 'pt-BR': 'Kyat birmanês' } },
  { code: 'MNT', group: 'INTL', minorUnit: 2, symbol: '₮', symbolVerified: true, separatorOverride: false, labels: { en: 'Mongolian tögrög', 'es-419': 'Tugrik mongol', 'pt-BR': 'Tugrik mongol' } },
  { code: 'MRU', group: 'INTL', minorUnit: 2, symbol: 'UM', symbolVerified: true, separatorOverride: false, labels: { en: 'Mauritanian ouguiya', 'es-419': 'Uguiya mauritana', 'pt-BR': 'Ouguiya mauritana' } }, // ISO 1/5-subunit quirk intentionally not modeled
  { code: 'MWK', group: 'INTL', minorUnit: 2, symbol: 'MK', symbolVerified: true, separatorOverride: false, labels: { en: 'Malawian kwacha', 'es-419': 'Kwacha malauí', 'pt-BR': 'Kwacha malauiano' } },
  { code: 'MYR', group: 'INTL', minorUnit: 2, symbol: 'RM', symbolVerified: true, separatorOverride: false, labels: { en: 'Malaysian ringgit', 'es-419': 'Ringgit malasio', 'pt-BR': 'Ringgit malaio' } },
  { code: 'MZN', group: 'INTL', minorUnit: 2, symbol: 'MT', symbolVerified: true, separatorOverride: false, labels: { en: 'Mozambican metical', 'es-419': 'Metical mozambiqueño', 'pt-BR': 'Metical moçambicano' } },
  { code: 'NAD', group: 'INTL', minorUnit: 2, symbol: 'N$', symbolVerified: true, separatorOverride: false, labels: { en: 'Namibian dollar', 'es-419': 'Dólar namibio', 'pt-BR': 'Dólar namibiano' } },
  { code: 'NGN', group: 'INTL', minorUnit: 2, symbol: '₦', symbolVerified: true, separatorOverride: false, labels: { en: 'Nigerian naira', 'es-419': 'Naira nigeriana', 'pt-BR': 'Naira nigeriana' } },
  { code: 'NOK', group: 'INTL', minorUnit: 2, symbol: 'kr', symbolVerified: true, separatorOverride: false, labels: { en: 'Norwegian krone', 'es-419': 'Corona noruega', 'pt-BR': 'Coroa norueguesa' } },
  { code: 'NPR', group: 'INTL', minorUnit: 2, symbol: 'Rs', symbolVerified: true, separatorOverride: false, labels: { en: 'Nepalese rupee', 'es-419': 'Rupia nepalí', 'pt-BR': 'Rupia nepalesa' } },
  { code: 'NZD', group: 'INTL', minorUnit: 2, symbol: 'NZ$', symbolVerified: true, separatorOverride: false, labels: { en: 'New Zealand dollar', 'es-419': 'Dólar neozelandés', 'pt-BR': 'Dólar neozelandês' } },
  { code: 'OMR', group: 'INTL', minorUnit: 3, symbol: 'ر.ع.', symbolVerified: true, separatorOverride: false, labels: { en: 'Omani rial', 'es-419': 'Rial omaní', 'pt-BR': 'Rial omanense' } },
  { code: 'PGK', group: 'INTL', minorUnit: 2, symbol: 'K', symbolVerified: true, separatorOverride: false, labels: { en: 'Papua New Guinean kina', 'es-419': 'Kina papú', 'pt-BR': 'Kina papuense' } },
  { code: 'PHP', group: 'INTL', minorUnit: 2, symbol: '₱', symbolVerified: true, separatorOverride: false, labels: { en: 'Philippine peso', 'es-419': 'Peso filipino', 'pt-BR': 'Peso filipino' } },
  { code: 'PKR', group: 'INTL', minorUnit: 2, symbol: 'Rs', symbolVerified: true, separatorOverride: false, labels: { en: 'Pakistani rupee', 'es-419': 'Rupia pakistaní', 'pt-BR': 'Rupia paquistanesa' } },
  { code: 'PLN', group: 'INTL', minorUnit: 2, symbol: 'zł', symbolVerified: true, separatorOverride: false, labels: { en: 'Polish złoty', 'es-419': 'Esloti polaco', 'pt-BR': 'Zlóti polonês' } },
  { code: 'QAR', group: 'INTL', minorUnit: 2, symbol: 'QR', symbolVerified: true, separatorOverride: false, labels: { en: 'Qatari riyal', 'es-419': 'Riyal catarí', 'pt-BR': 'Riyal catariano' } },
  { code: 'RON', group: 'INTL', minorUnit: 2, symbol: 'lei', symbolVerified: true, separatorOverride: false, labels: { en: 'Romanian leu', 'es-419': 'Leu rumano', 'pt-BR': 'Leu romeno' } },
  { code: 'RSD', group: 'INTL', minorUnit: 2, symbol: 'дин', symbolVerified: true, separatorOverride: false, labels: { en: 'Serbian dinar', 'es-419': 'Dinar serbio', 'pt-BR': 'Dinar sérvio' } },
  { code: 'RUB', group: 'INTL', minorUnit: 2, symbol: '₽', symbolVerified: true, separatorOverride: false, labels: { en: 'Russian ruble', 'es-419': 'Rublo ruso', 'pt-BR': 'Rublo russo' } },
  { code: 'RWF', group: 'INTL', minorUnit: 0, symbol: 'RF', symbolVerified: true, separatorOverride: false, labels: { en: 'Rwandan franc', 'es-419': 'Franco ruandés', 'pt-BR': 'Franco ruandês' } },
  { code: 'SAR', group: 'INTL', minorUnit: 2, symbol: 'SR', symbolVerified: true, separatorOverride: false, labels: { en: 'Saudi riyal', 'es-419': 'Riyal saudí', 'pt-BR': 'Riyal saudita' } },
  { code: 'SDG', group: 'INTL', minorUnit: 2, symbol: 'ج.س.', symbolVerified: true, separatorOverride: false, labels: { en: 'Sudanese pound', 'es-419': 'Libra sudanesa', 'pt-BR': 'Libra sudanesa' } },
  { code: 'SEK', group: 'INTL', minorUnit: 2, symbol: 'kr', symbolVerified: true, separatorOverride: false, labels: { en: 'Swedish krona', 'es-419': 'Corona sueca', 'pt-BR': 'Coroa sueca' } },
  { code: 'SGD', group: 'INTL', minorUnit: 2, symbol: 'S$', symbolVerified: true, separatorOverride: false, labels: { en: 'Singapore dollar', 'es-419': 'Dólar de Singapur', 'pt-BR': 'Dólar de Singapura' } },
  { code: 'SLE', group: 'INTL', minorUnit: 2, symbol: 'Le', symbolVerified: true, separatorOverride: false, labels: { en: 'Sierra Leonean leone', 'es-419': 'Leone sierraleonés', 'pt-BR': 'Leone serra-leonês' } },
  { code: 'SOS', group: 'INTL', minorUnit: 2, symbol: 'Sh', symbolVerified: true, separatorOverride: false, labels: { en: 'Somali shilling', 'es-419': 'Chelín somalí', 'pt-BR': 'Xelim somali' } },
  { code: 'SSP', group: 'INTL', minorUnit: 2, symbol: 'SS£', symbolVerified: true, separatorOverride: false, labels: { en: 'South Sudanese pound', 'es-419': 'Libra sursudanesa', 'pt-BR': 'Libra sul-sudanesa' } },
  { code: 'SYP', group: 'INTL', minorUnit: 2, symbol: 'S£', symbolVerified: true, separatorOverride: false, labels: { en: 'Syrian pound', 'es-419': 'Libra siria', 'pt-BR': 'Libra síria' } },
  { code: 'THB', group: 'INTL', minorUnit: 2, symbol: '฿', symbolVerified: true, separatorOverride: false, labels: { en: 'Thai baht', 'es-419': 'Baht tailandés', 'pt-BR': 'Baht tailandês' } },
  { code: 'TJS', group: 'INTL', minorUnit: 2, symbol: 'ЅМ', symbolVerified: true, separatorOverride: false, labels: { en: 'Tajikistani somoni', 'es-419': 'Somoni tayiko', 'pt-BR': 'Somoni tadjique' } },
  { code: 'TMT', group: 'INTL', minorUnit: 2, symbol: 'm', symbolVerified: true, separatorOverride: false, labels: { en: 'Turkmenistani manat', 'es-419': 'Manat turcomano', 'pt-BR': 'Manat turcomeno' } },
  { code: 'TND', group: 'INTL', minorUnit: 3, symbol: 'DT', symbolVerified: true, separatorOverride: false, labels: { en: 'Tunisian dinar', 'es-419': 'Dinar tunecino', 'pt-BR': 'Dinar tunisiano' } },
  { code: 'TRY', group: 'INTL', minorUnit: 2, symbol: '₺', symbolVerified: true, separatorOverride: false, labels: { en: 'Turkish lira', 'es-419': 'Lira turca', 'pt-BR': 'Lira turca' } },
  { code: 'TWD', group: 'INTL', minorUnit: 2, symbol: 'NT$', symbolVerified: true, separatorOverride: false, labels: { en: 'New Taiwan dollar', 'es-419': 'Dólar taiwanés', 'pt-BR': 'Dólar taiwanês' } },
  { code: 'TZS', group: 'INTL', minorUnit: 2, symbol: 'TSh', symbolVerified: true, separatorOverride: false, labels: { en: 'Tanzanian shilling', 'es-419': 'Chelín tanzano', 'pt-BR': 'Xelim tanzaniano' } },
  { code: 'UAH', group: 'INTL', minorUnit: 2, symbol: '₴', symbolVerified: true, separatorOverride: false, labels: { en: 'Ukrainian hryvnia', 'es-419': 'Grivna ucraniana', 'pt-BR': 'Hryvnia ucraniana' } },
  { code: 'UGX', group: 'INTL', minorUnit: 0, symbol: 'USh', symbolVerified: true, separatorOverride: false, labels: { en: 'Ugandan shilling', 'es-419': 'Chelín ugandés', 'pt-BR': 'Xelim ugandês' } },
  { code: 'USD', group: 'INTL', minorUnit: 2, symbol: 'US$', symbolVerified: true, separatorOverride: false, labels: { en: 'US dollar', 'es-419': 'Dólar estadounidense', 'pt-BR': 'Dólar americano' } },
  { code: 'UZS', group: 'INTL', minorUnit: 2, symbol: "so'm", symbolVerified: true, separatorOverride: false, labels: { en: 'Uzbekistani soʻm', 'es-419': 'Som uzbeko', 'pt-BR': 'Som uzbeque' } },
  { code: 'VND', group: 'INTL', minorUnit: 0, symbol: '₫', symbolVerified: true, separatorOverride: false, labels: { en: 'Vietnamese đồng', 'es-419': 'Dong vietnamita', 'pt-BR': 'Dong vietnamita' } },
  { code: 'XAF', group: 'INTL', minorUnit: 0, symbol: 'FCFA', symbolVerified: true, separatorOverride: false, labels: { en: 'Central African CFA franc', 'es-419': 'Franco CFA de África Central', 'pt-BR': 'Franco CFA da África Central' } },
  { code: 'XCD', group: 'INTL', minorUnit: 2, symbol: 'EC$', symbolVerified: true, separatorOverride: false, labels: { en: 'East Caribbean dollar', 'es-419': 'Dólar del Caribe Oriental', 'pt-BR': 'Dólar do Caribe Oriental' } },
  { code: 'XOF', group: 'INTL', minorUnit: 0, symbol: 'CFA', symbolVerified: true, separatorOverride: false, labels: { en: 'West African CFA franc', 'es-419': 'Franco CFA de África Occidental', 'pt-BR': 'Franco CFA da África Ocidental' } },
  { code: 'XPF', group: 'INTL', minorUnit: 0, symbol: 'CFPF', symbolVerified: true, separatorOverride: false, labels: { en: 'CFP franc', 'es-419': 'Franco CFP', 'pt-BR': 'Franco CFP' } },
  { code: 'YER', group: 'INTL', minorUnit: 2, symbol: '﷼', symbolVerified: true, separatorOverride: false, labels: { en: 'Yemeni rial', 'es-419': 'Rial yemení', 'pt-BR': 'Rial iemenita' } },
  { code: 'ZAR', group: 'INTL', minorUnit: 2, symbol: 'R', symbolVerified: true, separatorOverride: false, labels: { en: 'South African rand', 'es-419': 'Rand sudafricano', 'pt-BR': 'Rand sul-africano' } },
  { code: 'ZMW', group: 'INTL', minorUnit: 2, symbol: 'ZK', symbolVerified: true, separatorOverride: false, labels: { en: 'Zambian kwacha', 'es-419': 'Kwacha zambiano', 'pt-BR': 'Kwacha zambiano' } },
  { code: 'ZWG', group: 'INTL', minorUnit: 2, symbol: 'ZiG', symbolVerified: true, separatorOverride: false, labels: { en: 'Zimbabwe Gold', 'es-419': 'ZiG zimbabuense', 'pt-BR': 'ZiG zimbabuano' } },
];

// ---------------------------------------------------------------------------
// Derived exports — computed once from CURRENCIES (never re-listed by hand).
// ---------------------------------------------------------------------------

/** LATAM codes (17), alphabetical by code. */
export const LATAM_CODES: readonly string[] = CURRENCIES.filter(
  (c) => c.group === 'LATAM',
)
  .map((c) => c.code)
  .sort();

/** INTL codes (106), alphabetical by code. */
export const INTL_CODES: readonly string[] = CURRENCIES.filter(
  (c) => c.group === 'INTL',
)
  .map((c) => c.code)
  .sort();

/** Every supported code: LATAM first, then INTL (123). */
export const SUPPORTED: readonly string[] = [...LATAM_CODES, ...INTL_CODES];

/**
 * ISO 4217 zero-decimal currencies that are NOT Tier-A catalog members (their
 * countries fall below the catalog's population threshold): Djibouti (DJF),
 * Iceland (ISK), Comoros (KMF) and Vanuatu (VUV). REQ-003 fixes the
 * zero-decimal set at exactly 16 codes, so these documented ISO-only codes are
 * unioned with the catalog-derived subset below.
 */
const ISO_ONLY_ZERO_DECIMAL: readonly string[] = ['DJF', 'ISK', 'KMF', 'VUV'];

/** Zero-decimal codes (minor unit 0) — 16 per REQ-003. */
export const ZERO_DECIMAL: ReadonlySet<string> = new Set(
  [
    ...CURRENCIES.filter((c) => c.minorUnit === 0).map((c) => c.code),
    ...ISO_ONLY_ZERO_DECIMAL,
  ].sort(),
);

/** Three-decimal codes (minor unit 3) — 6. BHD is deliberately absent. */
export const THREE_DECIMAL: ReadonlySet<string> = new Set(
  CURRENCIES.filter((c) => c.minorUnit === 3)
    .map((c) => c.code)
    .sort(),
);

/** LATAM codes that render with INTL grouping — 6. */
export const SEPARATOR_OVERRIDES: ReadonlySet<string> = new Set(
  CURRENCIES.filter((c) => c.separatorOverride)
    .map((c) => c.code)
    .sort(),
);

// ---------------------------------------------------------------------------
// Self-check — a structural guard the generator can call (and that runs on
// import) so a hand edit can never silently break the locked invariants.
// ---------------------------------------------------------------------------

export function assertCatalogInvariants(): void {
  const codes = CURRENCIES.map((c) => c.code);

  if (new Set(codes).size !== codes.length) {
    throw new Error('currency-catalog: duplicate codes detected');
  }
  if (codes.length !== 123) {
    throw new Error(`currency-catalog: expected 123 codes, got ${codes.length}`);
  }
  for (const code of codes) {
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error(`currency-catalog: invalid ISO code "${code}"`);
    }
  }
  if (LATAM_CODES.length !== 17) {
    throw new Error(`currency-catalog: expected 17 LATAM codes, got ${LATAM_CODES.length}`);
  }
  if (INTL_CODES.length !== 106) {
    throw new Error(`currency-catalog: expected 106 INTL codes, got ${INTL_CODES.length}`);
  }
  if (SUPPORTED.length !== 123) {
    throw new Error(`currency-catalog: expected 123 supported codes, got ${SUPPORTED.length}`);
  }
  if (ZERO_DECIMAL.size !== 16) {
    throw new Error(`currency-catalog: expected 16 zero-decimal codes, got ${ZERO_DECIMAL.size}`);
  }
  if (THREE_DECIMAL.size !== 6) {
    throw new Error(`currency-catalog: expected 6 three-decimal codes, got ${THREE_DECIMAL.size}`);
  }
  if (SEPARATOR_OVERRIDES.size !== 6) {
    throw new Error(
      `currency-catalog: expected 6 separator overrides, got ${SEPARATOR_OVERRIDES.size}`,
    );
  }
  if (new Set(codes).has('BHD')) {
    throw new Error('currency-catalog: BHD must be absent (resolved decision)');
  }
}

assertCatalogInvariants();
