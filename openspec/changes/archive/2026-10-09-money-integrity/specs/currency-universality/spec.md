# Delta — currency-universality

> Change: `money-integrity`. Adds the two requirements this capability recorded
> as Non-Goals when it shipped (write-side parsing, receipt denomination) and
> replaces the Non-Goals section so no archived text denies behavior the code
> now has. FX conversion and `COP` zero-decimal stay Non-Goals.

## ADDED Requirements

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

## Non-Goals (replaced)

> Archive action: swap this section in for the main spec's
> `## Non-Goals (recorded, not fixed in this change)` section. A Non-Goals list
> that still denies per-receipt currency or write-side parsing after this
> change ships would contradict shipped code — the drift this delta exists to
> prevent. No previous delta has replaced a Non-Goals section; archive MUST
> apply it, not only merge requirement blocks.

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
