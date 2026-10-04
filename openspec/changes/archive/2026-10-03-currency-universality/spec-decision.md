# Spec Decision — capability selection for `currency-universality`

Written by the `spec` phase. Records a deliberate departure from the
`proposal`'s **New Capabilities: None**.

## What the proposal specified

| Capability | Kind | Deliverables the proposal assigned |
|---|---|---|
| `app-i18n` | modified | REQ-8 (catalog covers 14 codes), NFR-7 (UYU → USD + region seed), scenario 9 ARS symbol drift |
| `spanish-regional-detection` | modified | a new REQ for region → default currency |

## What the specs actually say

| Capability | Kind | Deliverables |
|---|---|---|
| `currency-universality` | **new** | supported set (14 codes, single source of truth), symbol table, zero-decimal set, region → default mapping, USD default + no backfill, seed-at-creation / no-clobber, catalog parity pin |
| `app-i18n` | modified | REQ-8 (14 labels), NFR-7 (USD), REQ-4 scenario 9 (ARS `$` drift) |
| `spanish-regional-detection` | modified (ADDED only) | REQ-7 shared region resolver, NFR-3 |

## Why the new capability

1. **Neither existing capability owns a currency code.** `app-i18n` REQ-4 owns
   the *format policy* (code drives shape); its REQ-8 owns *catalog copy*.
   `spanish-regional-detection` returns `SupportedLocale` — a language tag. A
   currency code is neither a label nor a locale, so neither capability's
   Purpose statement survives absorbing it.
2. **The region policies are opposite, and putting them together would blur a
   pinned contract.** `detectLocale` deliberately does NOT regionalize English
   or Portuguese (`scripts/test-detector-regional.mjs` pins `en-US` +
   region `AR` → `en`). `detectDefaultCurrency` MUST be region-driven regardless
   of language (`en-GB` → `GBP`, `pt-BR` → `BRL`). One function ignores the
   region, its sibling obeys it absolutely. Filing them under one requirement
   heading invites the next agent to "harmonize" them into the bug.
3. **The bulk of the change is not i18n at all.** The symbol table, the
   zero-decimal set, the store seed, the column default, the `ensureProfile`
   no-clobber invariant, and the `787 → 797` parity pin are money-model and
   data-model contracts. Under `app-i18n` they would have landed in a capability
   whose NFR-10 forbids `Intl` and whose whole subject is text catalogs.
4. **`detectDefaultCurrency` never returns `null`.** The proposal's signature
   (`SupportedCurrency | null`) contradicts its own success criteria
   ("unknown region → USD") and product decision 3 ("USD as the single
   universal default"). The spec pins one behavior: always a supported code,
   `USD` on any miss. This is a resolved proposal detail, not a new decision.

## What stayed in the existing capabilities, and why

- **`spanish-regional-detection` keeps the region *parsing*.** REQ-4 already
  states the underscore / case-insensitivity / explicit-`regionCode`-wins
  contract; those helpers (`splitTag`, `resolveRegion`) are currently private
  and would have to be duplicated for a second consumer. REQ-7 promotes that
  step to a named, assertable contract shared by both consumers (NFR-3: one
  resolver, two consumers). The *currency* mapping that consumes it lives in
  `currency-universality`.
- **`app-i18n` keeps the labels.** REQ-8 becomes the 14-key catalog contract,
  including the `es-AR` / `es-ES` stay-`{}` decision — stated in prose rather
  than left implicit in the harness — and the compile-time guard that turns a
  missing catalog key into a `pnpm typecheck` failure instead of a raw key on
  screen.

## Pre-existing spec drift resolved here

`app-i18n` REQ-4 scenario 9 and acceptance gate 8 claimed
`formatCurrency(1234.56, 'ARS')` → `ARS 1.234,56`. The shipped formatter has
always produced `$ 1.234,56` (`CURRENCY_SYMBOL.ARS = '$'`) and
`scripts/test-format-currency.mjs:105` pins that exact string. Since this change
edits the symbol table, leaving a known-false scenario in the canonical spec
would re-surface it at the next verification. The spec is corrected to the
code; **no behavior changes for ARS**.

## Behavior changes this spec DOES authorize

Exactly one, and it is deliberate: `JPY` moves into the zero-decimal set, so
`formatCurrency(1234.56, 'JPY')` changes from `¥ 1,234.56` to `¥ 1,235`. JPY
has no circulating minor unit, so the current output is a fabricated precision.
`scripts/test-format-currency.mjs:90-91` pins the old string and MUST be updated
in the same change.

## Non-goals carried in `currency-universality`

Recorded, not fixed: per-receipt currency, FX conversion, multi-currency
aggregation, household cross-currency sums (pre-existing latent bug in
`monthly_purchases_total` / `monthly_category_totals` /
`get_household_feed`), locale-aware input parsing (bare `parseFloat` on the
write side), `COP` as zero-decimal, and `CHECK (currency IN (...))` hardening.
