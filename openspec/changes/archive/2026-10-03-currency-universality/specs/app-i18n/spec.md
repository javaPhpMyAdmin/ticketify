# Delta — app-i18n

> Change: `currency-universality`. 3 requirements modified (REQ-4, REQ-8,
> NFR-7), 1 acceptance gate added. Capability ownership moved: the currency
> CODE (catalog set, symbols, default, seeding) is now `currency-universality`;
> this capability keeps the LABELS and the hybrid format policy.

## MODIFIED Requirements

### REQ-4: Locale-aware formatters (hybrid policy)

The system SHALL expose locale-aware formatters operating per the hybrid policy: the **currency code** drives the number grouping, decimals, and symbol (LATAM currencies `ARS`/`UYU`/`BRL`/`MXN` always render with `.` thousands + `,` decimals; international currencies `USD`/`EUR`/`GBP` always render with `,` thousands + `.` decimals), while the **user's UI locale** drives string-based labels and any auxiliary text. The formatter surface SHALL include `formatDate`, `formatShortDate`, `formatMonthFull`, `formatMonthAbbr`, `formatWeekday`, `formatRelativeDay`, `formatTime`, `formatPercent`, and `formatCurrency`. `formatCurrency(value, currencyCode)` SHALL be independent of `i18next.language` — its signature takes the currency code as the formatting authority and reads the UI locale internally only for label choices. `formatRelativeDay` SHALL produce `Hoy` / `Today` / `Hoje` for today, `Ayer` / `Yesterday` / `Ontem` for yesterday, and `formatShortDate` output otherwise. `formatTime` SHALL use `a. m.` / `p. m.` meridiem in es-AR and 24-hour notation (`14:30`) in pt-BR and en. PR 2 SHALL ship these as wrappers that accept a `locale` argument and keep legacy es-AR behavior on no-locale call sites; PR 3 SHALL consolidate into a single locale-aware implementation.

(Previously: scenario 9 stated `formatCurrency(1234.56, 'ARS')` → `ARS 1.234,56`. The shipped formatter has always rendered `$ 1.234,56` (`CURRENCY_SYMBOL.ARS = '$'`) and `scripts/test-format-currency.mjs` pins that string. This delta aligns the spec with the code — no behavior change — and is required because this change touches the symbol table.)

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

### REQ-8: Currency label translation (`currency.*` namespace)

The system SHALL expose currency display names as i18n keys under the `currency.*` namespace, NOT as hardcoded strings, for exactly the fourteen codes in `currency-universality` REQ-1 (`ARS`, `AUD`, `BRL`, `CAD`, `CLP`, `COP`, `EUR`, `GBP`, `JPY`, `MXN`, `PEN`, `PYG`, `USD`, `UYU`). The three full locales (`en`, `es-419`, `pt-BR`) SHALL each carry all fourteen keys — including the existing `UYU` / `USD` / `ARS` / `BRL` names (`Peso uruguayo` / `Uruguayan peso` / `Peso uruguaio`; `Dólar estadounidense` / `US dollar` / `Dólar americano`; `Peso argentino` / `Argentine peso` / `Peso argentino`; `Real brasileño` / `Brazilian real` / `Real brasileiro`). `es-AR` and `es-ES` SHALL keep the namespace empty (`{}`) and inherit the Spanish base: a currency name is region-neutral catalog copy, not a formatting concern. The catalog key type SHALL derive from the shipped `currency.json` keys rather than a hand-written union. These labels SHALL appear in `src/app/settings/currency.tsx` and any other selector that surfaces currency names.

(Previously: "At minimum the catalog SHALL cover `UYU`, `USD`, `ARS`, `BRL`". The four-code floor is replaced by the fourteen-code supported set; the `es-AR`/`es-ES` empty-override decision is now stated explicitly instead of being implied by the parity harness.)

**Given/When/Then**:

1. Given locale is `es-AR`, When the currency selector renders the UYU row, Then the label is `Peso uruguayo` (resolved through `es-419`, not empty).
2. Given locale is `en`, When the currency selector renders the UYU row, Then the label is `Uruguayan peso`.
3. Given locale is `pt-BR`, When the currency selector renders the BRL row, Then the label is `Real brasileiro`.
4. Given locale is `es-ES` and the row is `MXN`, When the label resolves, Then it comes from `es-419` (sparse-override inheritance) and is never an empty string or a raw key.
5. Given a supported code with no matching key in `es-419`, When the selector source is type-checked, Then `pnpm typecheck` fails rather than the row rendering a raw key at runtime.

### NFR-7: Currency default and locale independence

The default currency code SHALL be `USD` and SHALL stay independent of UI language. Changing the active language SHALL NOT change the persisted currency, and `formatCurrency` SHALL continue to use the currency code's symbol and grouping regardless of which UI locale is active. The seed, the region-derived default, and the no-backfill rule are owned by `currency-universality` REQ-3 / REQ-4 / REQ-5.

(Previously: "The default currency code (`UYU`) SHALL stay independent of UI language", with a matching Purpose out-of-scope line asserting "`UYU` stays default". Both now say `USD`, and the region-derived default is a separate capability rather than an unstated exception.)

## ADDED Requirements

### Requirement: Currency catalog acceptance gate

The catalog-parity acceptance criteria SHALL cover the extended `currency.*`
namespace: the three full locales ship all fourteen keys, the two regional
Spanish overrides ship `{}`, and the selector renders exactly the
`currency-universality` supported set with no second hardcoded list.

**Given/When/Then**:

1. Given `scripts/test-i18n-catalog-parity.mjs` runs after this change, When its full-completeness check executes, Then it reports 18 namespace files and 797 leaves per full locale.
2. Given `es-AR/currency.json` and `es-ES/currency.json`, When they are read, Then both are `{}` and `currency` is still a named member of both the `EMPTY_FILES` set and the `PENINSULAR_EMPTY_NAMESPACES` map.
3. Given the currency selector source, When it is read, Then no second currency-code array and no hand-written `as 'currency:…' | …` union exists.

## Acceptance Gates

8. Currency format: `formatCurrency(1234.56, 'USD')` = `US$ 1,234.56` regardless of UI locale (USD drives international grouping: `,` thousands + `.` decimals); `formatCurrency(1234.56, 'ARS')` = `$ 1.234,56` regardless of UI locale (ARS drives LATAM grouping: `.` thousands + `,` decimals); `formatCurrency(1234.56, 'BRL')` = `R$ 1.234,56` regardless of UI locale.
11. Currency catalog: the three full locales each ship all fourteen `currency.*` keys, `es-AR` / `es-ES` ship `{}` for that namespace, and the selector renders exactly the `currency-universality` supported set (no second hardcoded list).
