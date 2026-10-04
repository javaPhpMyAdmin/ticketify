# App i18n Specification

## Purpose

Ticketify mobile ships multilingual UI copy and locale-aware formatters across **five** locales in a base + sparse-override hierarchy: `en` (generic English), `es-419` (neutral Latin-American Spanish — the Spanish **base, source of truth, and runtime default**), `es-AR` (Rioplatense Spanish voseo override), `es-ES` (Peninsular Spanish `vosotros` override), and `pt-BR` (Brazilian Portuguese). `es-AR` and `es-ES` carry only the leaves that genuinely diverge from `es-419`; the catalog shape is specified by `locale-catalog-hierarchy`, and device-tag resolution by `spanish-regional-detection`. The capability covers device locale detection via `expo-localization`, a manual override persisted in `expo-secure-store` and surfaced through a Settings selector, CLDR `_one` / `_other` plural keys via i18next v26, and locale-aware formatters for dates, months, weekdays, time, percentages, and currency. Currency formatting follows a **hybrid policy**: the **currency code** drives the number grouping, decimals, and symbol (so `ARS`/`UYU` always render with LATAM grouping `.` thousands + `,` decimals, `USD`/`EUR` always render with international grouping `,` thousands + `.` decimals), while the **user's UI locale** drives string-based labels and any auxiliary text — `formatCurrency` is independent of `i18next.language` and takes the currency code as the formatting authority.

Out of scope (recap): grammatical-gender selectors; backend strings (none exist); locales beyond the five shipped (en / es-419 / es-AR / es-ES / pt-BR); right-to-left languages; `dayjs` / `date-fns` / `Intl` adoption; server-side locale-aware RPCs; a first-run onboarding language picker; a `profiles.locale` column; changing the default currency code — the default is `USD` and stays independent of UI language (NFR-7), and the seed, the region-derived default, and the no-backfill rule are owned by `currency-universality` REQ-3 / REQ-4 / REQ-5.

## Requirements

### REQ-1: Locale catalog and namespace structure

The system SHALL ship five locales — `en`, `es-419`, `es-AR`, `es-ES`, `pt-BR` — declared in i18next as `supportedLngs`. `es-419` SHALL be the Spanish base and the runtime default active locale on first launch (with `override: 'auto'`), and the per-language `fallbackLng` map SHALL route `es-AR`/`es-ES` through `es-419` before `en` for any missing key (see `locale-catalog-hierarchy` REQ-3). Locale files SHALL live under `src/i18n/locales/{en,es-419,es-AR,es-ES,pt-BR}/` as nested JSON organized by namespace, **18** namespaces per locale: `common`, `tabs`, `settingsLanguage`, `auth`, `settings`, `tickets`, `receipts`, `household`, `analytics`, `errors`, `a11y`, `currency`, `date`, `pro`, `legal`, `onboarding`, `bootSplash`, and `categories`. Key naming SHALL be namespace-scoped and dotted (e.g. `tabs.home`, `errors.network`). Plural keys SHALL follow the i18next CLDR suffix convention (`key_one`, `key_other`); `_zero` SHALL NOT be used.

**Given/When/Then**:

1. Given a fresh install with `override === 'auto'` on a device whose Spanish tag is `es-MX`, When the app boots, Then the active language is `es-419` (the Spanish base and runtime default).
2. Given `i18n.init()` runs the per-language `fallbackLng` map and a key is missing in `es-ES`, When `t(key)` is called, Then i18next walks `es-419` before `en` and does not throw.
3. Given a request for `t('tabs.home')`, When the call runs, Then i18next resolves to the value defined under `tabs.home` in the active locale file.
4. Given the five locale directories `en`, `es-419`, `es-AR`, `es-ES`, `pt-BR`, When each is listed, Then it contains the same 18 namespace files.

### REQ-2: Device locale detection and fallback mapping

The system SHALL detect the device locale on first launch via `expo-localization.getLocales()[0].languageTag` (and its `regionCode` when present). The detector MUST map `pt-*` (any Portuguese tag) to `pt-BR` and `en-*` (any English tag) to `en`; for `es-*` it SHALL resolve region `AR` to `es-AR`, region `ES` to `es-ES`, and **every other Spanish tag** — `es-419`, any other Latin-American region, a bare `es`, or an unknown region — to the `es-419` base. Any unsupported language tag — including but not limited to `fr-FR`, `de-DE`, `it-IT`, an empty string, or a missing locale array — SHALL fall back to `en`. The full mapping contract lives in `spanish-regional-detection`; the detector SHALL be a pure function exported from `src/i18n/detector.ts` and unit-testable independent of React.

**Given/When/Then**:

1. Given the device language tag is `es-AR`, When `detectLocale()` runs, Then it returns `'es-AR'`.
2. Given the device language tag is `pt-BR` (or any `pt-*`), When `detectLocale()` runs, Then it returns `'pt-BR'`.
3. Given the device language tag is `en-US` (or any `en-*`), When `detectLocale()` runs, Then it returns `'en'`.
4. Given the device language tag is `es-ES`, When `detectLocale()` runs, Then it returns `'es-ES'`.
5. Given the device language tag is `es-MX` (or a bare `es`), When `detectLocale()` runs, Then it returns `'es-419'` (the Spanish base).
6. Given the device language tag is `fr-FR` (or any non-supported tag), When `detectLocale()` runs, Then it returns `'en'` (global fallback).
7. Given `getLocales()` returns an empty array, When `detectLocale()` runs, Then it returns `'en'` (global fallback).

### REQ-3: Manual override, persistence, and active language resolution

The system SHALL provide a Settings selector screen (`src/app/settings/language.tsx`, mirroring the shape of `src/app/settings/currency.tsx`) with exactly six options in this fixed order: `Automático`, `English`, `Español (Latinoamérica)`, `Español (Argentina)`, `Español (España)`, `Português (Brasil)`, sourced from `settingsLanguage` keys (`auto`, `en`, `es-419`, `es-AR`, `es-ES`, `pt-BR`). The selection SHALL persist in `expo-secure-store` under key `ticketify.locale.override` with value `'auto' | 'en' | 'es-419' | 'es-AR' | 'es-ES' | 'pt-BR'`. The active language SHALL resolve as: the override value when it is a concrete locale; otherwise the detected locale from REQ-2. A stored value outside that union SHALL read back as "no override" (`null`) so the device locale wins. Selecting a new value SHALL call `i18next.changeLanguage()` synchronously and re-render SHALL propagate through `useTranslation` subscribers without an app restart.

**Given/When/Then**:

1. Given the user has `ticketify.locale.override === 'auto'`, When the active language is resolved, Then it equals the device-locale detection result.
2. Given the user is in `en` (auto-detected) and picks `Português (Brasil)` in Settings, When selection is committed, Then `ticketify.locale.override === 'pt-BR'` is persisted and the active language becomes `pt-BR` live without app restart.
3. Given the user picks `Español (España)`, When selection is committed, Then `ticketify.locale.override === 'es-ES'` is persisted and the active language becomes `es-ES` live.
4. Given the user has a manual override and now picks `Automático`, When selection is committed, Then `ticketify.locale.override === 'auto'` is persisted and the active language reverts to the device locale.
5. Given the user has `ticketify.locale.override === 'pt-BR'` and kills the app, When the app cold-starts, Then the active language is `pt-BR` (override persists across restarts).
6. Given the stored override is a tampered value such as `'de-DE'`, When the store hydrates, Then it reads back as no override and the device locale wins (no raw keys).

### REQ-4: Locale-aware formatters (hybrid policy)

The system SHALL expose locale-aware formatters operating per the hybrid policy: the **currency code** drives the number grouping, decimals, and symbol (LATAM currencies `ARS`/`UYU`/`BRL`/`MXN` always render with `.` thousands + `,` decimals; international currencies `USD`/`EUR`/`GBP` always render with `,` thousands + `.` decimals), while the **user's UI locale** drives string-based labels and any auxiliary text. The formatter surface SHALL include `formatDate`, `formatShortDate`, `formatMonthFull`, `formatMonthAbbr`, `formatWeekday`, `formatRelativeDay`, `formatTime`, `formatPercent`, and `formatCurrency`. `formatCurrency(value, currencyCode)` SHALL be independent of `i18next.language` — its signature takes the currency code as the formatting authority and reads the UI locale internally only for label choices. `formatRelativeDay` SHALL produce `Hoy` / `Today` / `Hoje` for today, `Ayer` / `Yesterday` / `Ontem` for yesterday, and `formatShortDate` output otherwise. `formatTime` SHALL use `a. m.` / `p. m.` meridiem in es-AR and 24-hour notation (`14:30`) in pt-BR and en. PR 2 SHALL ship these as wrappers that accept a `locale` argument and keep legacy es-AR behavior on no-locale call sites; PR 3 SHALL consolidate into a single locale-aware implementation.

(Previously: scenario 9 stated `formatCurrency(1234.56, 'ARS')` → `ARS 1.234,56`. The shipped formatter has always rendered `$ 1.234,56` (`CURRENCY_SYMBOL.ARS = '$'`) and `scripts/test-format-currency.mjs` pins that string. This delta aligns the spec with the code — no behavior change — and is required because this change touches the symbol table.)

> Source: change `currency-universality` (archived 2026-10-03). Merged from delta `openspec/changes/archive/2026-10-03-currency-universality/specs/app-i18n/spec.md`.

**Given/When/Then**:

1. Given locale is `en` and the input date is today, When `formatRelativeDay(today)` runs, Then output is `Today`.
2. Given locale is `es-AR` and the input date is one day before today, When `formatRelativeDay(yesterday)` runs, Then output is `Ayer`.
3. Given locale is `pt-BR` and `'2027-02-12'`, When `formatShortDate('2027-02-12')` runs, Then output is `12 de fev. de 2027`.
4. Given locale is `en` and `'2027-02-12'`, When `formatShortDate('2027-02-12')` runs, Then output is `Feb 12, 2027`.
5. Given locale is `es-AR` and `'2027-02-12T14:30'`, When `formatTime` runs, Then output is `02:30 p. m.`.
6. Given locale is `pt-BR` and `'2027-02-12T14:30'`, When `formatTime` runs, Then output is `14:30`.
7. Given currency code is `USD` and the UI locale is `es-AR`, When `formatCurrency(1234.56, 'USD')` runs, Then output is `US$ 1,234.56` (USD drives international grouping: `,` thousands + `.` decimals — the UI locale does not change the number shape).
8. Given currency code is `USD` and the UI locale is `en`, When `formatCurrency(1234.56, 'USD')` runs, Then output is `US$ 1,234.56` (USD drives international grouping: `,` thousands + `.` decimals).
9. Given currency code is `ARS` and the UI locale is `en`, When `formatCurrency(1234.56, 'ARS')` runs, Then output is `$ 1.234,56` (ARS drives LATAM grouping: `.` thousands + `,` decimals, and the `CURRENCY_SYMBOL` entry for ARS is `$`, regardless of the UI locale).
10. Given currency code is `UYU` and the UI locale is `pt-BR`, When `formatCurrency(1234.56, 'UYU')` runs, Then output is `$U 1.234,56` (UYU drives LATAM grouping: `.` thousands + `,` decimals).
11. Given currency code is `BRL` and the UI locale is `en`, When `formatCurrency(1234.56, 'BRL')` runs, Then output is `R$ 1.234,56` (BRL drives LATAM grouping regardless of the UI locale).

NOTE: scenarios 7-11 demonstrate that **currency code is the formatting authority**. The UI locale does not affect the number shape. `ARS`/`UYU`/`BRL`/`MXN` and other LATAM currencies always use `.` thousands + `,` decimals; `USD`/`EUR`/`GBP` always use `,` thousands + `.` decimals. The locale only changes the symbol form (e.g. `US$` vs `$US`) and any auxiliary copy.

### REQ-5: Pluralization (CLDR `_one` / `_other`)

The system SHALL use i18next's built-in `_one` / `_other` CLDR suffix scheme for plural keys. Zero SHALL match `_other`. Plural keys SHALL be nested under their parent namespace (e.g. `subscription.daysRemaining_one`, `subscription.daysRemaining_other`). The system SHALL NOT add `i18next-icu` or any ICU plugin; `_zero`, `_two`, `_few`, `_many` keys SHALL NOT be used in any locale file.

**Given/When/Then**:

1. Given `daysRemaining === 1` and locale is `es-AR`, When `t('subscription.daysRemaining', { count: 1 })` runs, Then output is `Queda 1 día`.
2. Given `daysRemaining === 5` and locale is `es-AR`, When `t('subscription.daysRemaining', { count: 5 })` runs, Then output is `Quedan 5 días`.
3. Given `daysRemaining === 0` and locale is `en`, When `t('subscription.daysRemaining', { count: 0 })` runs, Then output is `0 days left` (`_other` covers zero).
4. Given `daysRemaining === 1` and locale is `pt-BR`, When `t('subscription.daysRemaining', { count: 1 })` runs, Then output is `Resta 1 dia`.

### REQ-6: Boot integrity and language-ready gate

The system SHALL NOT fade out `BootSplash` (or call `setBooted(true)`) until `i18n.isInitialized === true`. On cold start, the first rendered frame MUST display locale-correct labels — never raw key names like `t('tabs.home')`. If `i18n.init()` fails (corrupt JSON, resource error), the system SHALL log the error and fall back to `es-AR` instead of crashing.

**Given/When/Then**:

1. Given `i18n.init()` is in flight at boot, When `BootSplash` is mounted, Then the splash stays visible and `setBooted(true)` is not called.
2. Given `i18n.isInitialized === true` after init resolves, When `BootSplash` fades out, Then the first frame shows localized tab labels (`Inicio` / `Home` / `Início`), never raw keys.
3. Given `i18n.init()` throws (corrupt locale JSON), When the error propagates, Then the system logs the error and the active language becomes `es-AR`; the app does not crash.

### REQ-7: Per-screen stack titles (no root-layout titles)

The system SHALL set each screen's title via `<Stack.Screen options={{ title }} />` declared INSIDE the screen component, NOT in the root layout (`src/app/_layout.tsx`). Each screen SHALL read its title from `t('namespace.title')` so titles remain locale-aware. The root layout SHALL NOT contain hardcoded `Stack.Screen options={{ title: 'Estadísticas Pro' }}` blocks for migrated screens — those titles move into the screen files.

**Given/When/Then**:

1. Given the Pro Charts screen renders in `pt-BR`, When the screen mounts, Then the header title is `Gráficos Pro` (the `pt-BR` translation of `pro.chartsTitle`).
2. Given the active language changes from `en` to `es-AR` while the Pro Charts screen is mounted, When re-render occurs, Then the header title updates to `Estadísticas Pro` live.

### REQ-8: Currency label translation (`currency.*` namespace)

The system SHALL expose currency display names as i18n keys under the `currency.*` namespace, NOT as hardcoded strings, for exactly the fourteen codes in `currency-universality` REQ-1 (`ARS`, `AUD`, `BRL`, `CAD`, `CLP`, `COP`, `EUR`, `GBP`, `JPY`, `MXN`, `PEN`, `PYG`, `USD`, `UYU`). The three full locales (`en`, `es-419`, `pt-BR`) SHALL each carry all fourteen keys — including the existing `UYU` / `USD` / `ARS` / `BRL` names (`Peso uruguayo` / `Uruguayan peso` / `Peso uruguaio`; `Dólar estadounidense` / `US dollar` / `Dólar americano`; `Peso argentino` / `Argentine peso` / `Peso argentino`; `Real brasileño` / `Brazilian real` / `Real brasileiro`). `es-AR` and `es-ES` SHALL keep the namespace empty (`{}`) and inherit the Spanish base: a currency name is region-neutral catalog copy, not a formatting concern. The catalog key type SHALL derive from the shipped `currency.json` keys rather than a hand-written union. These labels SHALL appear in `src/app/settings/currency.tsx` and any other selector that surfaces currency names.

(Previously: "At minimum the catalog SHALL cover `UYU`, `USD`, `ARS`, `BRL`". The four-code floor is replaced by the fourteen-code supported set; the `es-AR`/`es-ES` empty-override decision is now stated explicitly instead of being implied by the parity harness.)

> Source: change `currency-universality` (archived 2026-10-03). Merged from delta `openspec/changes/archive/2026-10-03-currency-universality/specs/app-i18n/spec.md`.

**Given/When/Then**:

1. Given locale is `es-AR`, When the currency selector renders the UYU row, Then the label is `Peso uruguayo` (resolved through `es-419`, not empty).
2. Given locale is `en`, When the currency selector renders the UYU row, Then the label is `Uruguayan peso`.
3. Given locale is `pt-BR`, When the currency selector renders the BRL row, Then the label is `Real brasileiro`.
4. Given locale is `es-ES` and the row is `MXN`, When the label resolves, Then it comes from `es-419` (sparse-override inheritance) and is never an empty string or a raw key.
5. Given a supported code with no matching key in `es-419`, When the selector source is type-checked, Then `pnpm typecheck` fails rather than the row rendering a raw key at runtime.

### REQ-9: Regional second-person register (voseo / vosotros / tuteo)

The system SHALL keep `es-AR` copy as Rioplatense Spanish voseo and `es-ES` copy as Peninsular Spanish (tuteo + `vosotros`), with `es-419` as neutral Latin-American Spanish. For the household member suffix, the system SHALL expose `PLURAL_SECOND_PERSON` (`src/i18n/detector.ts`) and the translation key `household.youSuffix`: ` (vos)` in `es-AR`, ` (vosotros)` in `es-ES`, ` (você)` in `pt-BR`, and ` (you)` in `en`. The hardcoded literal ` (vos)` SHALL NOT appear in source code.

**Given/When/Then**:

1. Given the household list renders in `es-AR`, When the current-user row renders, Then the label reads `Marcelo (vos)`.
2. Given the household list renders in `es-ES`, When the current-user row renders, Then the label reads `Marcelo (vosotros)`, and `PLURAL_SECOND_PERSON['es-ES'] === ' (vosotros)'`.
3. Given the household list renders in `pt-BR`, When the current-user row renders, Then the label reads `Marcelo (você)`.
4. Given the household list renders in `en`, When the current-user row renders, Then the label reads `Marcelo (you)`.`

### REQ-10: Architectural constraints (no Intl / no ICU / no dayjs; non-React helpers)

The system SHALL NOT introduce `Intl.*` usage, `i18next-icu`, `dayjs`, or `date-fns` anywhere in `src/**` or `scripts/**`. Module-level helpers that are not React components (e.g. `MANUAL_ERROR_MESSAGES` in `src/features/tickets/manual-form.ts`, the 6 user-safe error constants in `src/lib/supabase/feature-access.ts`, and the exports in `src/components/molecules/DatePickerField/calendar.ts`) MUST call `i18next.t()` directly — NOT `useTranslation()`.

**Given/When/Then**:

1. Given the codebase after PR 1, When `grep -rn 'Intl\.' src/ scripts/` runs, Then zero matches exist.
2. Given `MANUAL_ERROR_MESSAGES` is consumed in `manual-form.ts`, When the helper runs, Then it invokes `i18next.t('errors.manual.*')` directly (no `useTranslation()` hook).
3. Given `feature-access.ts` returns a user-safe error, When the error renders, Then it comes from `i18next.t('errors.featureAccess.*')` and resolves in the active locale.

### REQ-11: First-run behavior

The system SHALL NOT display a first-run language picker. The first launch SHALL use the device-locale detection result (REQ-2) as the active language. Users discover and change the language via the Settings selector (REQ-3).

**Given/When/Then**:

1. Given a fresh install on a device with locale `en-US`, When the app first launches, Then the active language is `en` and no language-picker screen is shown.
2. Given a fresh install on a device with locale `pt-BR`, When the app first launches, Then the active language is `pt-BR` (no picker).

### REQ-12: Primary-flow coverage (PR 2)

The system SHALL provide full feature parity across all five locales for the primary user journey: auth screens (`sign-in`, `sign-up`, `forgot-password`, `reset-password`), tabs (`home`, `analytics`, `history`, `profile`), settings screens (`profile-edit`, `budget`, `category-budgets`, `currency`, `household`, `export`), the ticket flow (`manual`, `review`, `camera`), `features/*` hooks, the 6 user-safe error messages in `src/lib/supabase/feature-access.ts`, the 6 `MANUAL_ERROR_MESSAGES` codes in `src/features/tickets/manual-form.ts`, and the `DatePickerField` calendar copy. PR 2 SHALL NOT include `src/app/pro/charts.tsx`, `src/app/receipts/[id].tsx`, drill-downs, or the long-tail feature components — those belong to REQ-13.

**Given/When/Then**:

1. Given PR 2 has merged, When the primary flow is walked in each locale (en, es-419, es-AR, es-ES, pt-BR), Then no raw key strings (`home.title`, `auth.signIn`) are visible anywhere on the journey.
2. Given a Supabase read fails with a user-safe error code, When the user lands on the error toast, Then the message renders in the active locale (`No se pudieron cargar los datos. Inténtalo de nuevo.` in es-AR, etc.).
3. Given the DatePickerField opens in `pt-BR`, When the calendar renders, Then month names and weekday labels render in Portuguese.

### REQ-13: Long-tail coverage and consolidations (PR 3)

The system SHALL provide full feature parity across all five locales for `src/app/pro/charts.tsx`, `src/app/receipts/[id].tsx`, drill-downs (`categories/[key]`, `items/[name]`, `stores/[name]`), and the feature components `features/analytics/**`, `features/charts/**`, `features/items/**`, `features/export/**`. PR 3 SHALL consolidate the three duplicated currency-format maps (`src/lib/format.ts:8-16`, `src/features/charts/components/CategoryDonut.tsx:78-86`, `src/features/charts/components/ChartLegend.tsx:63-81`) onto a single locale-aware `formatCurrency` exported from `src/lib/format.ts`. PR 3 SHALL consolidate the two parallel month-name arrays (`MONTHS_SHORT_ES` / `MONTHS_FULL_ES` in `format.ts` AND `MONTHS_ABBR_ES_AR` / `MONTHS_FULL_ES_AR` in `DatePickerField/calendar.ts`) onto a single locale-aware source. PR 3 SHALL rewrite `formatDateES` to clean state (no legacy es-AR-only signatures).

**Given/When/Then**:

1. Given PR 3 has merged, When `grep -rn 'CURRENCY_SYMBOL' src/features/charts/` runs, Then zero matches exist — `CategoryDonut.tsx` and `ChartLegend.tsx` import `formatCurrency` from `lib/format.ts`.
2. Given `CategoryDonut` renders a UYU slice, When the chart draws the label, Then the formatted text matches `formatCurrency(value, 'UYU', locale)` exactly.
3. Given `formatShortDate` runs for locale `en` and `'2027-02-12'`, When the output is compared to the picker internals' `formatDateES` rewrite, Then they share the same locale-keyed data source — no separate `MONTHS_*_ES` array exists in `format.ts`.

### REQ-14: Currency catalog acceptance gate

The catalog-parity acceptance criteria SHALL cover the extended `currency.*` namespace: the three full locales ship all fourteen keys, the two regional Spanish overrides ship `{}`, and the selector renders exactly the `currency-universality` supported set with no second hardcoded list.

> Source: change `currency-universality` (archived 2026-10-03). Merged from delta `openspec/changes/archive/2026-10-03-currency-universality/specs/app-i18n/spec.md`. This is the `app-i18n`-side acceptance statement for what `currency-universality` REQ-6 and REQ-1.2 own normatively; the counts themselves are restated here because the `currency` namespace is an i18n catalog and the parity harness is an i18n gate.

**Given/When/Then**:

1. Given `scripts/test-i18n-catalog-parity.mjs` runs after this change, When its full-completeness check executes, Then it reports 18 namespace files and 797 leaves per full locale.
2. Given `es-AR/currency.json` and `es-ES/currency.json`, When they are read, Then both are `{}` and `currency` is still a named member of both the `EMPTY_FILES` set and the `PENINSULAR_EMPTY_NAMESPACES` map.
3. Given the currency selector source, When it is read, Then no second currency-code array and no hand-written `as 'currency:…' | …` union exists.

## Non-Functional Requirements

### NFR-1: Bundle size

The full i18n stack SHALL stay within the bundle budget despite shipping five locales: i18next ~10 KB + react-i18next ~3 KB + `expo-localization` footprint, plus the catalogs. Because `es-AR` and `es-ES` are sparse overrides on the `es-419` base (see `locale-catalog-hierarchy` NFR-1), the two extra Spanish catalogs SHALL add only their divergent leaves — not a second and third full copy.

### NFR-2: No Intl / no ICU / no dayjs / no date-fns

The system SHALL NOT introduce `Intl.*`, `i18next-icu`, `dayjs`, or `date-fns` anywhere in `src/**` or `scripts/**`. `formatCurrency` and all other formatters SHALL stay hand-rolled; i18next's built-in CLDR suffix scheme SHALL cover plurals without any polyfill.

### NFR-3: Review budget per PR

PR 1 SHALL stay ≤ 400 lines; PR 2 and PR 3 SHALL each stay ≤ 1000 lines (binding override of the preflight 600, consistent with the `category-budgets` precedent).

### NFR-4: Typecheck and harness tests

`pnpm typecheck` MUST pass after every PR. A pure-function unit test (`scripts/test-i18n-detector.mjs`) SHALL cover the detector mapping for at least: `pt-BR` → `pt-BR`, `pt-PT` → `pt-BR`, `en-US` → `en`, `en-GB` → `en`, `es-AR` → `es-AR`, `es-ES` → `es-ES`, `es-MX` → `es-419`, `es-US` → `es-419`, bare `es` → `es-419`, `fr-FR` → `en`, empty/undefined → `en`. A catalog-parity harness (`scripts/test-i18n-catalog-parity.mjs`) SHALL pin the five-locale file set, the 18-namespace uniformity, the sparse-override invariants, and the `es-AR`/`es-ES` leaf values.

### NFR-5: Accessibility (a11y)

Every `accessibilityLabel` and `accessibilityHint` SHALL be locale-aware. VoiceOver (iOS) and TalkBack (Android) MUST read the localized string for the active locale on `ReceiptRow`, `ItemDetail`, `ChartLegendItem`, and any other labeled element. Hidden / empty states MUST NOT leave focusable empty regions.

### NFR-6: First-run offline

Locale JSON files SHALL bundle via Metro. The system SHALL function offline on first launch — no network call required to render the active locale.

### NFR-7: Currency default and locale independence

The default currency code SHALL be `USD` and SHALL stay independent of UI language. Changing the active language SHALL NOT change the persisted currency, and `formatCurrency` SHALL continue to use the currency code's symbol and grouping regardless of which UI locale is active. The seed, the region-derived default, and the no-backfill rule are owned by `currency-universality` REQ-3 / REQ-4 / REQ-5.

(Previously: "The default currency code (`UYU`) SHALL stay independent of UI language", with a matching Purpose out-of-scope line asserting "`UYU` stays default". Both now say `USD`, and the region-derived default is a separate capability rather than an unstated exception.)

> Source: change `currency-universality` (archived 2026-10-03). Merged from delta `openspec/changes/archive/2026-10-03-currency-universality/specs/app-i18n/spec.md`.

### NFR-8: Five-locale catalog integrity

Every locale SHALL ship the same 18 namespaces and the same key set (modulo the sparse-override model), and a parity harness SHALL pin it. No locale SHALL silently resolve a Spanish leaf through English while a base leaf exists.

### NFR-9: Regional register isolation

The Rioplatense register (`vos`, voseo conjugations) SHALL appear only in `es-AR`; the Peninsular register (`vosotros`, present-perfect compounds, Peninsular lexicon) SHALL appear only in `es-ES`; neither SHALL leak into `es-419`, `en`, or `pt-BR`. The parity harness SHALL assert the anti-leak both ways.

## Acceptance Gates

1. `pnpm typecheck` passes after PR 1, PR 2, and PR 3.
2. Manual — device matrix (PR 1): app launches in `es-AR` on Spanish (Argentina) simulator, `es-ES` on Spanish (Spain), `es-419` on Spanish (Mexico) and on French (global fallback: `en`), `pt-BR` on Portuguese (Brazil), and `en` on English (US). The Settings selector updates the UI live without restart. Manual override persists across cold start.
3. Manual — primary flow (PR 2): the auth + tabs + settings + ticket journey walks clean in all five locales with no raw keys visible; user-safe Supabase errors render in the active locale.
4. Manual — long tail (PR 3): pro charts + receipts + drill-downs render in all five locales; the duplicated currency maps and month arrays are gone; `formatDateES` is rewritten.
5. Unit — detector (`scripts/test-i18n-detector.mjs`): all mapping cases pass, including `es-ES → es-ES`, `es-MX → es-419`, bare `es → es-419`, and `fr-FR → en`.
5b. Unit — catalog parity (`scripts/test-i18n-catalog-parity.mjs`): five-locale file set, 18 namespaces each, sparse-override invariants, and the `es-AR`/`es-ES` leaf pins all pass.
6. a11y: VoiceOver / TalkBack reads localized strings on `ReceiptRow`, `ItemDetail`, and `ChartLegendItem`.
7. Plurals: `daysRemaining = 1` and `daysRemaining = 5` render correctly per locale (`Queda 1 día` / `1 day left` / `Resta 1 dia` and `Quedan 5 días` / `5 days left` / `Restam 5 dias`); `0` uses `_other`.
8. Currency format: `formatCurrency(1234.56, 'USD')` = `US$ 1,234.56` regardless of UI locale (USD drives international grouping: `,` thousands + `.` decimals); `formatCurrency(1234.56, 'ARS')` = `$ 1.234,56` regardless of UI locale (ARS drives LATAM grouping: `.` thousands + `,` decimals); `formatCurrency(1234.56, 'BRL')` = `R$ 1.234,56` regardless of UI locale.
9. Boot: cold start in each locale shows localized labels on the first frame — no raw-key flash.
10. Out-of-scope guarantees: `Intl.*`, `i18next-icu`, `dayjs`, `date-fns`, `_zero` plural keys, and a first-run language picker SHALL NOT appear in the codebase after this change.
11. Currency catalog: the three full locales each ship all fourteen `currency.*` keys, `es-AR` / `es-ES` ship `{}` for that namespace, and the selector renders exactly the `currency-universality` supported set (no second hardcoded list).

> Gates 8 and 11: change `currency-universality` (archived 2026-10-03). Gate 8 was corrected to the shipped `$ 1.234,56`; gate 11 is new. No existing gate was renumbered.