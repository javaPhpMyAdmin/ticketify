# Proposal: Currency Universality

## Intent

A Colombian, Mexican, Paraguayan or British user cannot select their own money — the selector offers 4 codes (`src/app/settings/currency.tsx:18`) while `format.ts` already formats 13. Worse, a new user on `es-MX` is born `UYU`/`usd` by accident, not by choice. The app should feel native wherever the user is: correct symbol, correct grouping, correct default on first launch.

## Scope

### In Scope

| # | Deliverable |
|---|---|
| a | Selector driven by one source of truth: `format.ts` exports `SUPPORTED_CURRENCIES` derived from the LATAM/INTL lists; the hand-written `as 'currency:UYU'\|...` union (`currency.tsx:82-86`) becomes `keyof typeof es419Currency`. 14 codes: ARS BRL CLP COP MXN PEN PYG UYU USD EUR GBP CAD AUD JPY. Names in `en`/`es-419`/`pt-BR` `currency.json`; **`es-ES`/`es-AR` stay `{}`** (see Risks) |
| b | `format.ts`: `PYG → LATAM`; `ZERO_DECIMAL_CURRENCIES = {JPY, PYG}` (no set exists today — `toFixed(2)` is the only path); `CURRENCY_SYMBOL` += `CLP '$'`, `PEN 'S/'`, `PYG '₲'` |
| c | `detectDefaultCurrency(regionCode): SupportedCurrency \| null` — pure sibling to `detectLocale` (`detector.ts`), extended in `scripts/test-detector-regional.mjs`. Writes once at profile-row creation |
| d | Default drift: `USD` uppercase in store seed + DB default (new migration flips `0040`'s lowercase `'usd'`) + NFR-7 rewrite. Uppercase because `format.ts` keys uppercase, the selector submits uppercase, and ISO 4217 canonical is uppercase |
| e | Bump `test-i18n-catalog-parity.mjs` pin **787 → 797** (+10 codes). Add pins to `test-format-currency.mjs` |

### Out of Scope

- **Per-receipt currency / FX / multi-currency totals.** "£100 shows as US$100" is theoretical here (all scanned tickets are UYU). Known limitation → follow-up change.
- **Household cross-currency sums** — `monthly_purchases_total` (0026), `monthly_category_totals`, `get_household_feed` already `sum()` across mixed currencies. Pre-existing latent bug; documented, not fixed.
- **Input parsing** — `parseFloat('1.234,56') → 1.234` (`ItemEditorModal.tsx:115`). Pre-existing write-side gap; documented, not fixed.
- `CHECK (currency IN (...))` hardening.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `app-i18n`: REQ-8 (catalog covers 14 codes), NFR-7 (UYU → USD + region-derived seed), scenario 9 ARS `$` vs `ARS` symbol drift.
- `spanish-regional-detection`: new REQ for region → default currency.

## Approach

Invert the dependency: the LATAM/INTL lists become `as const` arrays; `SUPPORTED_CURRENCIES` is their concatenation; the selector and the catalog type derive from it. `format.ts` stays the formatting authority — a code that cannot format must never be selectable.

Region seeding lands at profile-row creation. `ensureProfile()` (`src/lib/auth/profile-sync.ts:40`) upserts and **must not** gain a `currency` key — that would clobber a chosen value on every sign-in. No backfill: a stored `UYU` is a value the user chose; `0007` backfilled it away and `0040` exists to undo that.

## Affected Areas

| Area | Impact | Files |
|------|--------|-------|
| Formatter | Modified | `src/lib/format.ts`, `scripts/test-format-currency.mjs` |
| Selector | Modified | `src/app/settings/currency.tsx` |
| Store / seed | Modified | `src/stores/use-settings-store.ts`, `src/lib/auth/profile-sync.ts` |
| i18n | New / Modified | `src/i18n/detector.ts`, 3 `currency.json`, `scripts/test-detector-regional.mjs` |
| Harness | Modified | `scripts/test-i18n-catalog-parity.mjs` (CRITICAL pin) |
| DB | New / Modified | `0041_*.sql`, `supabase/tests/currency-default.sql` |
| Specs | Modified | `app-i18n`, `spanish-regional-detection` |

**~17 files.** 15 store reads + 37 prop-carrying files are untouched — the thread does not change. ~300 changed lines: borderline against the 400-line PR budget; `sdd-tasks` must forecast.

## Risks

| Risk | Sev | Mitigation |
|------|-----|-----------|
| Parity pin `787` goes red | CRITICAL | Bump to 797 in the same change |
| `₲` U+20B2 tofu on iOS/Android | HIGH | On-device verify task; fallback `PYG: 'PYG'` (code-as-symbol) |
| `es-ES`/`es-AR` `currency.json` must stay `{}` — `currency` is in `EMPTY_FILES` + `PENINSULAR_EMPTY_NAMESPACES` | HIGH | Keep `{}`. `GBP` genuinely diverges (`libra` vs `libra esterlina`) — moving it out needs a stated reason + `42`-pin/`42`-divergent bump |
| Adding JPY to zero-decimal changes shipped JPY output | MED | Explicit harness pin; JPY is factually zero-decimal |
| Region seed writes over a chosen value | MED | Write only at row creation; `ensureProfile` upsert untouched |

## Rollback Plan

Revert the migration (`set default 'UYU'`), restore `format.ts` sets/symbols, revert the 3 catalogs and the `797` pin. No data migration ran — every existing row keeps its currency.

## Success Criteria

- [ ] All 14 codes selectable; `es-ES`/`es-AR` still `{}`
- [ ] `formatCurrency(1234.56,'PYG')` → `₲ 1.235`; `formatCurrency(100.4,'PYG')` → `₲ 100`
- [ ] `es-MX` first launch → MXN; `en-GB` → GBP; unknown region → USD
- [ ] `pnpm test` and `pnpm typecheck` green; parity harness reports 797

## Open Questions

1. Backfill existing profiles? **Recommend no.**
2. Case: **recommend uppercase** everywhere.
3. Selector copy — surface the region default explicitly?
