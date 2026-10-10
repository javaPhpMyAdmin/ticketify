# Currency Universality Specification

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
`PEN` → `S/`, and `PYG` → `₲` (U+20B2) unconditionally. No runtime code-as-symbol
fallback for `₲` exists and none SHALL be introduced: the app bundles no font
asset, so the symbol is painted by the platform-resolved font, and neither
supported platform exposes a glyph-availability signal at runtime — a fallback
would push the branch into the view layer and make `formatCurrency`
environment-dependent instead of pure. Platform coverage of U+20B2 is an
acceptance-time verification (scenario 7) that SHALL be repeated whenever the
platform font changes rather than assumed to hold; a platform found without
coverage is handled by scenario 5's same-change rule, where the
`CURRENCY_SYMBOL` entry and the `scripts/test-format-currency.mjs` pin that
asserts it move together. `ZERO_DECIMAL_CURRENCIES` SHALL be exported and
SHALL contain `CLP`, `JPY`, `PEN`, and `PYG` — every code this capability pins
whole-amount output for in scenarios 1, 2, 3, 4 and 5 below — and no code the
recorded scope decision excludes (`COP`, see Non-Goals); `formatCurrency` MUST
render a zero-decimal code as a whole amount rounded to the nearest unit and
MUST NOT emit a decimal separator for it, regardless of the active UI locale.

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
7. Given the app bundles no font asset, When the platform-resolved font that
   paints `formatCurrency` output is checked for U+20B2 coverage, Then the glyph
   is present. Coverage SHALL be verified programmatically through the platform's
   glyph-resolution API — for iOS, use CoreText (e.g. `CTFontGetGlyphsForCharacters`
   against the system font); for Android, verify via the render/test artifact used
   to validate the symbol. Scanning standalone font `.ttf` files is NOT a valid
   probe on iOS, because the system font is not a loose file in the runtime's
   font tree and a cmap scan yields false negatives. Font files change across OS
   versions, so this check SHALL be repeated whenever the platform font changes
   instead of being assumed to hold forever.

### REQ-3: Region-derived default currency

`detectDefaultCurrency(languageTag?, regionCode?)` SHALL be exported from
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

### REQ-7: Write-side money input parsing (fixed separator rule)

Every decimal money input in the app SHALL parse user text through one pure
helper `parseMoney(input, currencyCode)` instead of bare `parseFloat`. The
interpretation is FIXED: it MUST NOT vary with the UI locale, the device
region, or the `currencyCode` argument. The rule: when the input contains both
`.` and `,`, the rightmost separator is the decimal separator and all others
are grouping ("last separator wins"); when the input contains only ONE
separator type, the separator is a thousands separator exactly when three
digits follow it and a decimal separator otherwise — the same symmetric rule
for `.` and `,` (`1.234` → `1234`, `1,234` → `1234`, `45.99` → `45.99`,
`47.5` → `47.5`). `currencyCode` is accepted only for zero-decimal rounding
and never selects a convention. Input that yields no finite amount MUST
NOT pass money validation. Digit-filtered integer inputs (budget fields) are
NOT parsed by this helper — that contract is unchanged and is owned by
`category-budgets`.

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/currency-universality/spec.md`.

**Given/When/Then**:

1. Given `parseMoney('1.234,56')`, When it runs, Then it returns `1234.56`.
2. Given `parseMoney('1,234.56')`, When it runs, Then it returns `1234.56`.
3. Given `parseMoney('1234,56')`, When it runs, Then it returns `1234.56`.
4. Given `parseMoney('1.234')`, When it runs, Then it returns `1234` — a lone
   `.` followed by exactly three digits groups thousands.
5. Given the item editor opened for an existing item priced `45.99`, When the
   user saves without touching the price, Then the saved unit price is still
   `45.99` — a lone `.` with two digits is decimal, so raw numeric seeds
   round-trip untouched.
6. Given the input string `'1.234,56'`, When parsed once as `'ARS'` under
   `es-AR` and once as `'USD'` under `en`, Then both calls return `1234.56`
   (neither locale nor code moves the result).
7. Given an input with no digits (e.g. `''`, `'abc'`), When it is parsed, Then
   no finite amount is produced and the save action stays disabled.
8. Given the input string `'1,234'`, When parsed once as `'ARS'` under `es-AR`
   and once as `'USD'` under `en`, Then both calls return `1234` — a lone `,`
   with exactly three digits following groups thousands under the symmetric
   rule, in both currencies.
9. Given the inputs `45.99`, `47.5`, and `1.234`, When each is parsed as
   `'USD'` under `en` and as `'ARS'` under `es-AR`, Then `45.99` returns
   `45.99` and `47.5` returns `47.5` (fewer than three digits follow →
   decimal) while `1.234` returns `1234` (exactly three digits follow →
   grouping) under every combination — the three-digit boundary is what
   separates decimal from grouping.

> Decision 10 — rationale: the previous rule made a lone `,` always decimal,
> so an `en`-keyboard user typing `1,234` got `1.234` — a 1000× error. The
> symmetric rule serves `en` and `es-AR`/`es-ES`/`pt-BR` equally and depends
> on no code and no locale.
>
> Accepted trade-off: an input with exactly three decimal places (e.g.
> `45.999`) parses as grouping → `45999`. Money in this app is never recorded
> to three decimals, so it is accepted, not guarded.

> Closed: the display→input round-trip hypothesis (that `formatCurrency`
> output re-enters a parser) was disproved in exploration — every input seed is
> raw `String(number)`, never formatted output. Recorded here so it is not
> re-litigated: REQ-7 governs typed and seeded raw input only.

### REQ-8: Receipt denomination — every row carries its own unit

Each `purchases` row SHALL store the ISO 4217 unit its amounts were recorded
in, carried end-to-end from scan output through the review draft to
`save_receipt`. The unit SHALL be validated against `SUPPORTED_CURRENCIES`
(REQ-1) before persistence; a code outside the catalog MUST NOT be stored —
consumers fall back to the viewer's profile currency for that receipt. Amounts
are recorded, never converted (no FX). No migration SHALL backfill existing
rows: legacy rows stay unit-less and keep rendering with the viewer's profile
currency exactly as today. Changing `profiles.currency` MUST NOT rewrite any
stored row's unit — rows keep the currency they were recorded in. On the
review screen the user MAY correct the detected unit; a correction relabels
only — no amount on the row changes. The same correction is available when
EDITING an existing receipt: the switcher renders in edit mode too, and the
correction persists through the update write path with the same catalog rule
as `save_receipt` (out-of-catalog → stored as no unit, never a failed edit).

> Source: change `money-integrity` (archived 2026-10-09). Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/currency-universality/spec.md`.

**Given/When/Then**:

1. Given a user whose profile currency is `UYU`, When a receipt denominated
   `CLP 5000` is scanned and saved, Then the stored row's unit is `CLP` and it
   renders as CLP, not as `UYU`.
2. Given a scan result whose detected code is outside `SUPPORTED_CURRENCIES`,
   When the catalog check runs, Then that code is not persisted and the
   receipt falls back to the viewer's profile currency.
3. Given rows written before this change, When the column migration runs, Then
   no existing row gains a unit and those rows render as they do today.
4. Given rows recorded in `CLP`, When the user changes their profile currency
   to `UYU`, Then the CLP rows still read `CLP` and only newly saved rows
   carry `UYU`.
5. Given a receipt detected as `CLP`, When the user corrects the unit to `UYU`
   on review and saves, Then the stored unit is `UYU` and every amount on the
   row is unchanged.
6. Given a stored receipt whose unit is `CLP`, When the user edits the
   receipt, switches the unit to `UYU` on review and confirms, Then the stored
   unit becomes `UYU` with every amount on the row unchanged; and if the edit
   payload carries a code outside `SUPPORTED_CURRENCIES`, the row stores no
   unit (viewer fallback) and the edit still succeeds — it never fails on the
   unit.

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
leaves. `scripts/test-currency-catalog.mjs` SHALL pin the single-source-of-truth
invariants that no per-file harness can reach: that the compiled
`SUPPORTED_CURRENCIES` holds exactly the fourteen codes above with no duplicates
and that the three full-locale `currency` key sets equal it, that the selector
references that set instead of declaring its own, and that the create-only seed
(`ensureProfileCurrency` uses `.insert(`, never `.upsert(`/`.update(`) and the
`USD` store seed hold. It SHALL NOT restate the 797 leaf count — that pin
belongs to the parity harness alone. `pnpm test` and `pnpm typecheck` MUST pass.

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

## Non-Goals (replaced)

> Source: change `money-integrity` (archived 2026-10-09). Swapped in for the pre-change
> `## Non-Goals (recorded, not fixed in this change)` section per the delta's archive
> instruction — a Non-Goals list denying per-receipt currency or write-side parsing after
> this change ships would contradict shipped code. Merged from delta `openspec/changes/archive/2026-10-09-money-integrity/specs/currency-universality/spec.md`.

- **FX conversion.** Amounts are never converted; every figure keeps the unit
  it was recorded in. This change groups by unit, it does not apply rates.
- **`COP` as zero-decimal.** Factually zero-decimal in circulation, but
  excluded from `ZERO_DECIMAL_CURRENCIES` by the recorded scope decision.
  (unchanged)
- **`CHECK (currency IN (...))` hardening** of the free-text column.
  (unchanged)

Flipped into requirements by `money-integrity`: per-receipt currency is now
REQ-8; locale-aware input parsing is now REQ-7; household cross-currency sums
are corrected by the unit-correct aggregation requirement in
`household-sharing`.
