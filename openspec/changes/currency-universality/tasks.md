# Tasks: Currency Universality

11 tasks · 19 files (13 modify, 4 create, 2 SQL) · change-local spec deltas in
`openspec/changes/currency-universality/specs/` + canonical `openspec/specs/currency-universality/spec.md`.

TDD discipline: write the harness assertion before the code **inside** the same
task; every task ends task-local green (`pnpm test` scoped to its touched area).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | **~560–640** (design said ~340; it did not count the NEW harness `scripts/test-currency-catalog.mjs` ~150 + tsconfig ~20, nor ~190 lines of added pins) |
| Estimated changed files | 19 |
| 400-line budget risk | **High** (~600 vs the 400 SDD default) |
| Chained PRs recommended | **Yes** (2 slices) |
| Delivery strategy | `ask-on-risk` |
| Chain strategy | `pending` |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

> **The `High` is measured against the SDD default 400-line guard.** Against
> the **800-line** budget you declared, ~600 lines is LOW risk and fits one PR
> (~75% utilization). Decide before apply: **(a)** single PR + `size:exception`
> against the 800 budget, or **(b)** the 2-PR chain below. Nothing else blocks.

### Suggested Work Units

| Unit | Tasks | Likely PR | Notes |
|------|-------|-----------|-------|
| 1 | T-1, T-2, T-3 | PR 1 — "catalog, formatting, region default" | ~265 lines. No profile write, no DB, no selector. Base = feature/tracker branch. |
| 2 | T-4…T-11 | PR 2 — "region seed, selector, catalog copy, USD default" | ~340 lines. Base = PR 1 branch. T-11 closes gates. |

Finer alternative (5 slices, all < 300): T-1+T-2 / T-3 / T-4+T-5+T-6 / T-7+T-8+T-9 / T-10+T-11.

---

## Phase 1 — Catalog foundation (`src/lib/format.ts`)

### T-1 — Catalog reshape: 14 codes, compile-enforced symbols (AD-1)
**Does** `src/lib/format.ts` L39-80: `LATAM_CURRENCY_CODES` (ARS BRL CLP COP MXN PEN PYG UYU) +
`INTL_CURRENCY_CODES` (AUD CAD EUR GBP JPY USD) as `as const`; `SupportedCurrency`;
`SUPPORTED_CURRENCIES` (14, LATAM-then-INTL, code order so rows never reshuffle);
Sets re-derived; `CURRENCY_SYMBOL: Record<SupportedCurrency,string>` += `CLP '$'`, `PEN 'S/'`,
`PYG '₲'`. **Zero runtime imports added** (header contract).
**Accept** `pnpm test:format-currency` → 13 passed; `pnpm test:features` green; `pnpm typecheck` clean.
**Deps** — · **→** REQ-1.1, REQ-1.3, REQ-2.1–2.3

### T-2 — Zero-decimal rendering + `formatCurrency` pins (AD-5)
**Does** export `ZERO_DECIMAL_CURRENCIES = new Set(['JPY','PYG'])`; `formatCurrency` L741-742 →
`toFixed(isZeroDecimal ? 0 : 2)` + `decPart = ''`. `formatCurrencyWhole` untouched. **Same
change**: `scripts/test-format-currency.mjs` L90-91 JPY pin → `¥ 1,235`, header L12-13, plus pins
CLP `$ 1.235` / PEN `S/ 1.235` / PYG `₲ 1.235` / `₲ 100` / legacy `'usd'` → `US$ 1,234.56` /
`XYZ` kept / loop asserting all 14 codes render symbol-prefixed.
**Accept** `pnpm test:format-currency` → 13+N passed, 0 failed (no commit may ship the old JPY pin).
**Deps** T-1 · **→** REQ-1.4, REQ-2.1–2.6, REQ-4.4, gate 2, NFR-3

## Phase 2 — Region-derived default

### T-3 — One region resolver + `detectDefaultCurrency` (AD-2)
**Does** `src/i18n/detector.ts`: export `resolveRegionCode(tag?, region?)` (trim, `_`→`-`,
upper-case, **last** segment matching `/^[A-Z]{2}$|^\d{3}$/`, explicit region wins outright);
`splitTag` delegates its region field; `detectLocale` lower-cases the resolver output before its
switch; `REGION_DEFAULT_CURRENCY` (14, uppercase); `detectDefaultCurrency(tag?, region?):
SupportedCurrency` via `import type` only (erased). Extend `scripts/test-detector-regional.mjs`
with — **keeping all 23 existing cases unedited** — the 6 resolver cases (`es_ES`, `es`, `es-419`,
`es-Ar-x-private`, `es-MX`+`AR`, `undefined`), the 14-region table, `XX`/`undefined`/`''`/`es-419`
→ `USD`, `'mx'` + `es_MX` → `MXN`, `en-GB`+`GB` → `GBP` while `detectLocale` → `en`, double-call determinism.
**Accept** `pnpm test:detector-regional` → 23+N passed, 0 failed; `pnpm test:i18n-detector` green
(mapping table byte-identical); the harness still compiles `detector.ts` as its single root — no
`format.js` needed at runtime.
**Deps** T-1 · **→** REQ-3.1–3.8, spanish REQ-7.1–7.7 + NFR-3, gate 3

## Phase 3 — Seeding path (never clobbers)

### T-4 — Create-only `ensureProfileCurrency` (AD-2)
**Does** `src/lib/auth/profile-sync.ts`: new `ensureProfileCurrency(userId, currency)` =
`.from('profiles').insert({ id, currency })` — **never upsert** — swallowing the 23505 on an
existing row with a `console.warn`. `ensureProfile` byte-unchanged, no `currency` key. Supabase-only
imports (no `getLocales()`). `profiles_insert_own` already permits this insert.
**Accept** `pnpm test:profile-hook` green; `grep -c upsert src/lib/auth/profile-sync.ts` → 1 (only `ensureProfile`).
**Deps** — · **→** REQ-5.1, REQ-5.5, REQ-5.6

### T-5 — Device adapter + seed chained BEFORE `ensureProfile` (AD-2)
**Does** NEW `src/i18n/device-currency.ts` (~6 lines, mirrors `src/i18n/stores/useLocaleStore.ts:106`):
`detectDeviceDefaultCurrency()` = `getLocales()[0]` → `detectDefaultCurrency(tag, regionCode)`,
try/catch → `detectDefaultCurrency(undefined)`. In `src/features/auth/use-session-store.ts` chain
`detectDeviceDefaultCurrency() → ensureProfileCurrency → ensureProfile` at **both** call sites
(L193 restore, L402 SIGNED_IN) — the seed must precede the upsert or it can never fire.
**Harness plumbing (do not skip — this file is compiled by the profile-hook harness)**: add
`"expo-localization": ["./scripts/test-stubs/expo-localization.ts"]` to
`scripts/tsconfig.profile-hook-test.json` `paths` and add `../src/i18n/device-currency.ts` +
`../scripts/test-stubs/expo-localization.ts` to its `include`; add an `expo-localization` branch to
the `Module._resolveFilename` hook in `scripts/test-profile-hook.mjs` (precedent: `test-i18n-init.mjs:84`).
**Accept** `pnpm test:profile-hook` green (use-session-store compiles + loads against the stub);
`pnpm typecheck` clean.
**Deps** T-3, T-4 · **→** REQ-5.2, REQ-5.3, NFR-2

### T-6 — Uppercase write boundary + store seed (AD-3 / NFR-1)
**Does** `src/features/profile/api.ts` `setProfileCurrency` → `.update({ currency: currency.toUpperCase() })`;
`src/stores/use-settings-store.ts` L54 seed `'UYU'` → `'USD'`. No `CHECK` constraint anywhere (NFR-1).
**Accept** `pnpm test:features` green (payload pin `{ currency: 'USD' }`); `pnpm test:profile-hook` green;
`pnpm typecheck` clean.
**Deps** — · **→** REQ-4.1, REQ-5.4, NFR-1

## Phase 4 — Selector, catalog copy, single-source harness

### T-7 — 14 catalog keys × 3 locales + parity pin 787 → 797 (AD-4) — **CRITICAL**
**Does** `src/i18n/locales/{en,es-419,pt-BR}/currency.json` 4 → 14 keys from the AD-4 table,
keeping each file's existing indentation (en + pt-BR 2-space, es-419 4-space). **Same change**,
`scripts/test-i18n-catalog-parity.mjs`: L235 `787` → `797`, L230 test name, header L8/L14, and the
factually-wrong L55 reason → *"Currency names are region-neutral catalog copy; the CODE owns
formatting (`src/lib/format.ts`), so no Peninsular override exists."* `es-AR`/`es-ES` stay `{}`;
`currency` stays in `EMPTY_FILES` **and** `PENINSULAR_EMPTY_NAMESPACES` (deepEqual at L259).
**Accept** `pnpm test:i18n-catalog-parity` green — 18 files / **797** leaves ×3, es-ES 122, es-AR 65,
42 value pins intact. **This task and the pin bump are inseparable** — any split turns `pnpm test` red.
**Deps** T-1 · **→** REQ-6.1–6.4, app-i18n REQ-8.1–8.4 + gates 11.1/11.2, gate 1

### T-8 — Selector reads the catalog (AD-7)
**Does** `src/app/settings/currency.tsx`: delete `CURRENCY_CODES` (L18-23); import
`SUPPORTED_CURRENCIES` from `@/lib/format` and `.map` over it; label type becomes
`type CurrencyKey = keyof typeof es419Currency` (from `@/i18n/locales/es-419/currency.json`) and
`t(\`currency:${code}\` as \`currency:${CurrencyKey}\`)` replaces the hand-written 4-way union
(L82-86). Row layout, `saving` guard, active-code no-op, inline error, `router.back()`,
persistence chain all **unchanged**. No region-default badge (AD-7 open Q3). 14 rows fit the `ScrollView`.
**Accept** `pnpm typecheck` clean (a code with no catalog key fails the build, not the render);
`pnpm lint` clean.
**Deps** T-1, T-7 · **→** REQ-1.2, app-i18n REQ-8.5 + gate 11.3

### T-9 — Single-source-of-truth harness (AD-6)
**Does** NEW `scripts/test-currency-catalog.mjs` + `scripts/tsconfig.currency-catalog-test.json`
(include `../src/lib/format.ts`, copy the `format-currency-test` compile pattern). Asserts:
`SUPPORTED_CURRENCIES.length === 14`, `Set` size equal, sorted set === the spec list, every code
resolves a symbol, the three full-locale `currency.json` key sets === the format list, and — using
the parity harness's source-scan technique (L298) — `currency.tsx` declares no currency-code array
and no `as 'currency:…'` union and imports `SUPPORTED_CURRENCIES`; `ensureProfileCurrency` uses
`.insert(` and never `.upsert(`; `ensureProfile`'s payload carries no `currency`; `use-settings-store.ts`
seeds `'USD'`. Add `"test:currency-catalog"` to `package.json` + one link in the `pnpm test` chain.
**Accept** `pnpm test:currency-catalog` green; `pnpm test` green.
**Deps** T-1, T-4, T-6, T-7, T-8 · **→** REQ-1.1/1.2/1.3, REQ-4.1, REQ-5.1/5.2/5.5/5.6, REQ-6.3, NFR-3

## Phase 5 — Database default

### T-10 — Migration `0041` (default only) + SQL smoke test (AD-3)
**Does** NEW `supabase/migrations/0041_currency_default_usd_upper.sql`:
`alter table public.profiles alter column currency set default 'USD';` — **no `UPDATE` of rows, no
`CHECK`**; header states the default-only scope and cites the `0007` backfill precedent.
`supabase/tests/currency-default.sql`: §1 + §2 expect `'USD'`. **Gotcha**: the current assertion uses
`~*` (case-INSENSITIVE), so it cannot prove uppercase — assert with a case-sensitive
`v_default_expr ~ '''USD'''` plus a lowercase-only negative check. Header re-pointed 0040 → 0041.
**Accept** `pnpm test:sql` green (Docker Desktop must be running; `test:sql` is inside `pnpm test` and
resets a local scratch DB from all migrations); `grep -vi '^\s*--' 0041*.sql | grep -ci update` → 0.
**Deps** T-4 · **→** REQ-4.2, REQ-4.3, REQ-5.4, NFR-1, gate 5

## Phase 6 — Full verification

### T-11 — Gates 1–6 close (all commands exit 0)
**Does** run, and record output for, every gate command:
`pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:i18n-catalog-parity` (18/797) ·
`pnpm test:format-currency` · `pnpm test:detector-regional` · `pnpm test:currency-catalog` ·
`pnpm test:profile-hook` · `pnpm test:sql`. **Manual — the only non-automated scenario (REQ-2.7)**:
render `formatCurrency(1234.56, 'PYG')` on a real iOS **and** Android device; `₲` (U+20B2) must be a
glyph, not tofu. If it is not: set `CURRENCY_SYMBOL.PYG = 'PYG'`, update the T-2 pin to `'PYG 1.235'`,
re-run `pnpm test:format-currency`. Verify-only: the `USD` default text is in the **change-local delta**
(`openspec/changes/currency-universality/specs/app-i18n/spec.md:48`, NFR-7) — the canonical
`openspec/specs/app-i18n/spec.md` NFR-7 still reads `UYU` and is synced by the ARCHIVE phase, not here;
do NOT treat the canonical file as a precondition. `formatCurrency` still reads `i18next.language` nowhere.
**Deps** T-1…T-10 · **→** REQ-2.7, gates 1–6, spanish gate 6, NFR-3

---

## Scenario → task ownership

Every spec row is owned; nothing is orphaned.

| Spec row | Task |
|---|---|
| REQ-1.1 (14 codes, no dupes) | T-1, T-9 |
| REQ-1.2 (selector = catalog, no 2nd list) | T-8, T-9 |
| REQ-1.3 (every code has symbol + grouping) | T-1 (compile-enforced), T-2, T-9 |
| REQ-1.4 (`XYZ → XYZ 1,234.56`) | T-2 |
| REQ-2.1 / 2.2 / 2.3 (CLP / PEN / PYG symbols) | T-1, T-2 |
| REQ-2.4 (`PYG 100.4 → ₲ 100`) | T-2 |
| REQ-2.5 (`JPY → ¥ 1,235`) | T-2 |
| REQ-2.6 (locale-independent) | T-2 |
| REQ-2.7 (`₲` font fallback) | T-11 (manual on-device) |
| REQ-3.1–3.3 (14 regions) | T-3 |
| REQ-3.4 / 3.5 / 3.6 / 3.8 (fallback, case+tag, lang-indep, determinism) | T-3 |
| REQ-3.7 (`detectLocale` unchanged) | T-3 (23 cases unedited + `test:i18n-detector`) |
| REQ-4.1 (store seed `USD`) | T-6, T-9 |
| REQ-4.2 / 4.3 (default fires / `UYU` survives / no `UPDATE`) | T-10 |
| REQ-4.4 (legacy `usd` renders) | T-2 |
| REQ-5.1 / 5.5 / 5.6 (no-clobber, written once, no payload key) | T-4, T-9 |
| REQ-5.2 / 5.3 (first sign-in seeds region / unmapped) | T-3, T-5 |
| REQ-5.4 (explicit choice wins) | T-6, T-10 (§2b) |
| REQ-6.1 / 6.2 / 6.3 / 6.4 (797, `{}`, identical sets, no invented keys) | T-7, T-9 |
| NFR-1 (uppercase writes, no `CHECK`) | T-6, T-10 |
| NFR-2 (purity, no native bridge in the detector) | T-3, T-5 |
| NFR-3 (harness coverage) | T-2, T-3, T-7, T-9, T-11 |
| app-i18n REQ-4 s7–11 / REQ-8 / NFR-7 / gates 8, 11 | T-2, T-7, T-8, T-11 |
| spanish REQ-7 s1–7 + NFR-3 + gate 6 | T-3, T-11 |
| Gates 1–6 | T-7, T-2, T-3, T-4, T-10, T-11 |

## Risks for apply

| Risk | Sev | Owner task |
|---|---|---|
| Parity pin and catalog keys land in different commits → `pnpm test` red | CRITICAL | T-7 is one atomic unit |
| `use-session-store.ts` is compiled by `tsconfig.profile-hook-test.json` — `expo-localization` needs a `paths` mapping + a runtime resolve-hook branch or the harness breaks | HIGH | T-5 |
| `currency-default.sql` asserts with `~*`, which cannot distinguish `USD` from `usd` | HIGH | T-10 (use case-sensitive match) |
| `₲` (U+20B2) tofu on a device font | HIGH | T-11 (manual; one-line fallback exists) |
| Catalog JSON reindentation (en 2-space, es-419 4-space) causing a spurious 797 leaf drift | MED | T-7 |
| `pnpm test` requires Docker Desktop for `test:sql` | MED | T-10, T-11 |
| `import type` from `@/lib/format` into `detector.ts` breaking its single-root harness | MED | T-3 (verified erased at compile) |
| JPY shipped output changes (`¥ 1,234.56` → `¥ 1,235`) | MED | T-2 — authorized, pinned in the same change |