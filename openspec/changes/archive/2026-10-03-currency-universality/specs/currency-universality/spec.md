# Delta — currency-universality (ADDED capability)

> New capability. 6 requirements + 3 NFRs + 6 acceptance gates, 33 scenarios.
> The proposal listed "New Capabilities: None" and folded the catalog, symbol
> table, default, and seeding rules into `app-i18n` + `spanish-regional-detection`.
> That is declined: those two capabilities own *labels* and *locales*; neither
> owns a currency CODE, a symbol table, or a profile write. The rationale and
> the split are recorded in the proposal's Capabilities section and in this
> change's `spec-decision.md`.

## Currency Universality Specification

## Purpose

One capability that owns what money the app can speak: the fourteen ISO 4217
codes a user may pick, how each one groups and renders, which code a device
region implies on first launch, and the rules that put a code into a profile
exactly once without ever overwriting a choice the user made.

The catalog copy for those codes is owned by `app-i18n` REQ-8; the language the
UI paints is orthogonal — the currency code, never the active locale, is the
authority of format (`app-i18n` REQ-4). This capability owns the code, not the
label.

## Requirements

### REQ-1: One supported-currency source of truth

The system SHALL expose exactly one exported ordered set `SUPPORTED_CURRENCIES`
from `src/lib/format.ts`, derived from the LATAM and INTL grouping sets,
containing these fourteen ISO 4217 codes: `ARS`, `AUD`, `BRL`, `CAD`, `CLP`,
`COP`, `EUR`, `GBP`, `JPY`, `MXN`, `PEN`, `PYG`, `USD`, `UYU`. Every code in the
set MUST have both a grouping rule and a symbol. The currency selector SHALL
render exactly this set and MUST NOT declare a second hardcoded array or a
hand-written union of catalog keys; the catalog key type SHALL derive from the
shipped `currency.json` keys.

**Given/When/Then**:

1. Given `SUPPORTED_CURRENCIES`, When it is enumerated, Then it holds exactly
   those fourteen codes with no duplicates.
2. Given the currency selector screen, When its rows render, Then the row count
   and the code list equal `SUPPORTED_CURRENCIES` (no locally declared list).
3. Given every code in `SUPPORTED_CURRENCIES`, When `formatCurrency` runs with
   it, Then the output is prefixed by a symbol from `CURRENCY_SYMBOL`, never by
   the bare code.
4. Given a code absent from `SUPPORTED_CURRENCIES` (e.g. `XYZ`), When
   `formatCurrency` runs, Then it renders `XYZ 1,234.56` — INTL grouping, code
   as symbol (unchanged behavior).

### REQ-2: Complete symbol table and zero-decimal minor units

`CURRENCY_SYMBOL` SHALL cover all fourteen supported codes, adding `CLP` → `$`,
`PEN` → `S/`, and `PYG` → `₲` (U+20B2). Where the `₲` glyph is not covered by
the platform font, the PYG symbol MUST degrade to the code as symbol (`PYG`),
never to a missing-glyph box. `ZERO_DECIMAL_CURRENCIES` SHALL be exported and
SHALL contain `JPY` and `PYG`; `formatCurrency` MUST render a zero-decimal code
as a whole amount rounded to the nearest unit and MUST NOT emit a decimal
separator for it, regardless of the active UI locale.

**Given/When/Then**:

1. Given `formatCurrency(1234.56, 'CLP')`, When it runs, Then the output is
   `$ 1.235` (LATAM grouping, whole amount).
2. Given `formatCurrency(1234.56, 'PEN')`, When it runs, Then the output is
   `S/ 1.235`.
3. Given `formatCurrency(1234.56, 'PYG')`, When it runs, Then the output is
   `₲ 1.235`.
4. Given `formatCurrency(100.4, 'PYG')`, When it runs, Then the output is
   `₲ 100` (the sub-unit fraction is rounded away).
5. Given `formatCurrency(1234.56, 'JPY')`, When it runs, Then the output is
   `¥ 1,235` — a deliberate change from the shipped `¥ 1,234.56`, and the
   `scripts/test-format-currency.mjs` pin MUST be updated in the same change.
6. Given a zero-decimal code, When `formatCurrency` runs under `es-419` and
   under `en`, Then both outputs are identical (no locale branch).
7. Given a device font with no U+20B2 coverage, When the PYG symbol renders,
   Then it reads `PYG` (code-as-symbol fallback), never an empty glyph.

### REQ-3: Region-derived default currency

`detectDefaultCurrency(regionCode?)` SHALL be exported from
`src/i18n/detector.ts` as a pure function over a region code and SHALL always
return a supported code, never `null`. Its mapping SHALL be: `AR`→`ARS`,
`AU`→`AUD`, `BR`→`BRL`, `CA`→`CAD`, `CL`→`CLP`, `CO`→`COP`, `ES`→`EUR`,
`GB`→`GBP`, `JP`→`JPY`, `MX`→`MXN`, `PE`→`PEN`, `PY`→`PYG`, `US`→`USD`,
`UY`→`UYU`; an absent, empty, or unmapped region SHALL resolve to `USD`. It
SHALL consume the same region-resolution contract as `detectLocale`
(`spanish-regional-detection` REQ-7). It SHALL be region-driven regardless of
the device language, and it MUST NOT change — or be influenced by —
`detectLocale`.

**Given/When/Then**:

1. Given `detectDefaultCurrency('MX')`, When it runs, Then it returns `'MXN'`.
2. Given `detectDefaultCurrency('CO')` and `detectDefaultCurrency('PY')`, When
   they run, Then they return `'COP'` and `'PYG'`.
3. Given regions `'GB'`, `'UY'`, `'BR'`, `'ES'`, `'JP'`, `'AU'`, `'CA'`,
   `'CL'`, `'PE'`, `'AR'`, `'US'`, When each runs, Then it returns `'GBP'`,
   `'UYU'`, `'BRL'`, `'EUR'`, `'JPY'`, `'AUD'`, `'CAD'`, `'CLP'`, `'PEN'`,
   `'ARS'`, `'USD'`.
4. Given `'XX'`, `undefined`, or `''`, When `detectDefaultCurrency` runs, Then
   it returns `'USD'` — every supported code is reachable and every miss is
   universal, not regional.
5. Given `'mx'` (lowercase), When `detectDefaultCurrency` runs, Then it returns
   `'MXN'`; given a device tag `es_MX` with no explicit region, When the shared
   region resolver normalizes it, Then the region is `MX` and the result is
   `'MXN'`.
6. Given a device whose `detectLocale` resolves `en` from `en-GB`, When the
   default currency is derived, Then it is `'GBP'` (region-driven, not
   language-driven).
7. Given `detectLocale('en-GB', 'GB')`, When it runs, Then it still returns
   `'en'` — adding currency detection does not regionalize English.
8. Given the same input, When `detectDefaultCurrency` runs twice, Then both
   calls return the same code (no module-level state).

### REQ-4: USD as the single universal default, canonical uppercase, no backfill

The settings store seed SHALL be `'USD'`, and the `profiles.currency` column
DEFAULT SHALL be `'USD'` — uppercase ISO 4217, superseding migration `0040`'s
lowercase `'usd'`. `formatCurrency` SHALL continue to case-fold the code, so a
legacy lowercase row renders identically. No migration in this change SHALL
`UPDATE` existing `profiles.currency` rows.

**Given/When/Then**:

1. Given a cold boot before the profile row has been read, When the settings
   store is inspected, Then `currency === 'USD'`.
2. Given the column-default migration has run, When a new `profiles` row is
   inserted without an explicit `currency`, Then the stored value is `'USD'`
   (uppercase).
3. Given an existing row holding `'UYU'`, When the default migration runs, Then
   the row still reads `'UYU'` — a default migration stays a default migration
   (the `0007` backfill is the precedent this rule exists to prevent repeating).
4. Given a legacy row holding `'usd'`, When `formatCurrency(1234.56, 'usd')`
   runs, Then the output is `US$ 1,234.56`.

### REQ-5: Region seed is written at row creation only and never clobbers

The region-derived code SHALL be written only when the user's profile row is
created. `ensureProfile` MUST NOT include a `currency` key in its upsert
payload, and a sign-in MUST NOT change the currency of an existing profile row;
the seed write MUST be structurally distinct from the identity-backfill upsert
so the invariant is assertable. A user SHALL always be able to change the
seeded value in Settings afterwards, and that explicit choice SHALL win.

**Given/When/Then**:

1. Given an existing profile row with `currency = 'UYU'`, When the user signs
   in again, Then the row's currency is still `'UYU'`.
2. Given a first sign-in on a device whose region is `MX`, When the profile row
   is created, Then the row's currency is `'MXN'`.
3. Given a first sign-in on a device whose region is unmapped, When the row is
   created, Then the row's currency is `'USD'`.
4. Given a row seeded as `MXN`, When the user later picks `UYU` in Settings,
   Then the row reads `'UYU'` (explicit choice wins).
5. Given repeated sign-ins, When profile sync runs more than once, Then
   `currency` is written at most once per row.
6. Given `ensureProfile` runs, When its payload is inspected, Then it carries no
   `currency` key.

### REQ-6: Catalog parity for the extended currency namespace

`currency.json` SHALL carry all fourteen codes in the three full locales (`en`,
`es-419`, `pt-BR`) and SHALL remain an empty object (`{}`) in `es-AR` and
`es-ES`, which inherit through `es-419`. `currency` SHALL remain listed in both
the parity harness `EMPTY_FILES` set and the `PENINSULAR_EMPTY_NAMESPACES` map
with its stated reason. The full-locale leaf-count pin SHALL move from 787 to
797.

**Given/When/Then**:

1. Given the parity harness runs, When its full-completeness check executes,
   Then each of `en`, `es-419`, and `pt-BR` ships 18 namespace files and
   exactly 797 leaves.
2. Given `es-AR/currency.json` and `es-ES/currency.json`, When they are read,
   Then both are `{}` and `currency` is still a named member of both harness
   empty sets.
3. Given the three full locales, When their `currency` key sets are compared,
   Then they are identical fourteen-key sets.
4. Given `es-AR` or `es-ES`, When the sparse-override check runs, Then every key
   it defines exists in the `es-419` base (no invented keys).

## Non-Functional Requirements

### NFR-1: Canonical uppercase at every write boundary

Every code the app writes — selector submit, region seed, column default —
SHALL be uppercase ISO 4217. Display-side case folding stays in `formatCurrency`.
This change SHALL NOT introduce a `CHECK (currency IN (...))` constraint.

### NFR-2: Purity

`detectDefaultCurrency` SHALL be pure: no module-level mutable state, no
`Intl.*`, no `dayjs`, no `date-fns`, no native bridge. The same region SHALL
yield the same code in Node and on device.

### NFR-3: Harness coverage

`scripts/test-format-currency.mjs` SHALL pin every supported code's symbol and
grouping plus the zero-decimal behavior — including the JPY change from
`¥ 1,234.56` to `¥ 1,235`. `scripts/test-detector-regional.mjs` SHALL pin every
mapped region, the USD fallback, and the language-independence of
`detectDefaultCurrency`. `scripts/test-i18n-catalog-parity.mjs` SHALL pin 797
leaves. `pnpm test` and `pnpm typecheck` MUST pass.

## Acceptance Gates

1. Parity harness reports 18 files / 797 leaves per full locale, and `es-AR` /
   `es-ES` `currency.json` are still `{}`.
2. `formatCurrency` pins: `$ 1.235` (CLP), `S/ 1.235` (PEN), `₲ 1.235` (PYG),
   `₲ 100` (PYG), `¥ 1,235` (JPY), `US$ 1,234.56` (USD), `XYZ 1,234.56`
   (unknown code).
3. Detector pins: all fourteen regions map to their code; `undefined`, empty,
   and unmapped regions resolve to `USD`; `detectLocale` behavior is unchanged.
4. No-clobber: an existing `UYU` row survives sign-in; the `ensureProfile`
   payload carries no `currency` key.
5. Store seed is `'USD'`; the column default is `'USD'`; the migration contains
   no `UPDATE` of existing rows.
6. `pnpm test` and `pnpm typecheck` are green.

## Non-Goals (recorded, not fixed in this change)

- **Per-receipt currency, FX conversion, multi-currency aggregation.** A follow-up
  change requires an explicit product answer for budgets spanning currencies.
- **Household cross-currency sums.** `monthly_purchases_total`,
  `monthly_category_totals`, and `get_household_feed` already `sum()` across
  members whose `profiles.currency` differs and render in the viewer's
  currency. Pre-existing latent bug, documented only.
- **Locale-aware input parsing.** The write side still uses bare `parseFloat`,
  which silently misreads `1.234,56` as `1.234`. Display-side grouping is
  solved; write-side parsing is out of scope.
- **`COP` as zero-decimal.** Factually zero-decimal in circulation, but excluded
  from `ZERO_DECIMAL_CURRENCIES` by the recorded scope decision.
- **`CHECK (currency IN (...))` hardening** of the free-text column.
