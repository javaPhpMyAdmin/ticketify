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

Decision needed before apply: **Resolved at apply** — see `## Archive reconciliation`.
Chained PRs recommended: Yes
Chain strategy: **taken — 3 stacked slices, all merged**
400-line budget risk: High (measured against the 400 SDD default; the declared budget was 800)

> **The `High` is measured against the SDD default 400-line guard.** Against
> the **800-line** budget you declared, ~600 lines is LOW risk and fits one PR
> (~75% utilization). Decide before apply: **(a)** single PR + `size:exception`
> against the 800 budget, or **(b)** the 2-PR chain below. Nothing else blocks.
>
> **Outcome:** (b) was chosen and then subdivided further — three stacked
> slices, each with a recorded `size:exception`. See the work-unit table.

### Suggested Work Units

Forecast at task-planning time; the `Shipped in` column is what actually landed
on `main`. Plan and reality are kept side by side rather than rewritten, so the
forecast this artifact recorded stays auditable.

| Unit | Tasks | Likely PR | Shipped in | Notes |
|------|-------|-----------|------------|-------|
| 1 | T-1, T-2, T-3 | PR 1 — "catalog, formatting, region default" | **#128** (`740feb4`, slice A of 3) | 478 insertions / 39 deletions. No profile write, no DB, no selector. `size:exception` recorded. |
| 2 | T-4, T-5, T-6, T-10 | PR 2 — "region seed, USD default" | **#130** (`a6c0747`, slice B of 3) | 1224 lines, ~590 of them harness pins. Added the fail-closed currency-symbol gate beyond the forecast scope — see T-6. `size:exception` recorded. |
| 3 | T-7, T-8, T-9 | PR 2 (cont.) — "catalog copy, selector, single-source harness" | **#133** (`2b97961`, slice C of 3) | The 14-key catalogs and the 787 → 797 pin stayed inseparable, as T-7 required. |

Finer alternative (5 slices, all < 300): T-1+T-2 / T-3 / T-4+T-5+T-6 / T-7+T-8+T-9 / T-10+T-11.
Not taken — T-10 shipped inside slice B and T-7/T-8/T-9 inside slice C.

---

## Phase 1 — Catalog foundation (`src/lib/format.ts`)

### T-1 — Catalog reshape: 14 codes, compile-enforced symbols (AD-1)
**Status** **DONE** — shipped in #128 (`740feb4`).
**Does** `src/lib/format.ts` L39-80: `LATAM_CURRENCY_CODES` (ARS BRL CLP COP MXN PEN PYG UYU) +
`INTL_CURRENCY_CODES` (AUD CAD EUR GBP JPY USD) as `as const`; `SupportedCurrency`;
`SUPPORTED_CURRENCIES` (14, LATAM-then-INTL, code order so rows never reshuffle);
Sets re-derived; `CURRENCY_SYMBOL: Record<SupportedCurrency,string>` += `CLP '$'`, `PEN 'S/'`,
`PYG '₲'`. **Zero runtime imports added** (header contract).
**Accept** `pnpm test:format-currency` → 13 passed; `pnpm test:features` green; `pnpm typecheck` clean.
**Deps** — · **→** REQ-1.1, REQ-1.3, REQ-2.1–2.3

### T-2 — Zero-decimal rendering + `formatCurrency` pins (AD-5)
**Status** **DONE, with one deliberate widening** — shipped in #128 (`740feb4`). `ZERO_DECIMAL_CURRENCIES` shipped as `{CLP, JPY, PEN, PYG}`, not the `{JPY, PYG}` written below; see `## Archive reconciliation` → *Resolved deviations*. Every pin in **Accept** is present in `scripts/test-format-currency.mjs`.
**Does** export `ZERO_DECIMAL_CURRENCIES = new Set(['JPY','PYG'])`; `formatCurrency` L741-742 →
`toFixed(isZeroDecimal ? 0 : 2)` + `decPart = ''`. `formatCurrencyWhole` untouched. **Same
change**: `scripts/test-format-currency.mjs` L90-91 JPY pin → `¥ 1,235`, header L12-13, plus pins
CLP `$ 1.235` / PEN `S/ 1.235` / PYG `₲ 1.235` / `₲ 100` / legacy `'usd'` → `US$ 1,234.56` /
`XYZ` kept / loop asserting all 14 codes render symbol-prefixed.
**Accept** `pnpm test:format-currency` → 13+N passed, 0 failed (no commit may ship the old JPY pin).
**Deps** T-1 · **→** REQ-1.4, REQ-2.1–2.6, REQ-4.4, gate 2, NFR-3

## Phase 2 — Region-derived default

### T-3 — One region resolver + `detectDefaultCurrency` (AD-2)
**Status** **DONE** — shipped in #128 (`740feb4`). The two-argument `detectDefaultCurrency(languageTag?, regionCode?)` written below is what shipped; all 23 pre-existing `detectLocale` cases survive unedited.
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
**Status** **DONE** — shipped in #130 (`a6c0747`). `ensureProfile` byte-unchanged; no `currency` key in its payload.
**Does** `src/lib/auth/profile-sync.ts`: new `ensureProfileCurrency(userId, currency)` =
`.from('profiles').insert({ id, currency })` — **never upsert** — swallowing the 23505 on an
existing row with a `console.warn`. `ensureProfile` byte-unchanged, no `currency` key. Supabase-only
imports (no `getLocales()`). `profiles_insert_own` already permits this insert.
**Accept** `pnpm test:profile-hook` green; `grep -c upsert src/lib/auth/profile-sync.ts` → 1 (only `ensureProfile`).
**Deps** — · **→** REQ-5.1, REQ-5.5, REQ-5.6

### T-5 — Device adapter + seed chained BEFORE `ensureProfile` (AD-2)
**Status** **DONE** — shipped in #130 (`a6c0747`). Both call sites chained `detectDeviceDefaultCurrency() → ensureProfileCurrency → ensureProfile`.
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
**Status** **DONE** — shipped in #130 (`a6c0747`), hardened in #133 (`2b97961`). #133 added two guards this task did not ask for: an out-of-catalog rejection (`SUPPORTED_CURRENCIES.includes(...)`) at `setProfileCurrency`, and uppercase normalization of `profiles.currency` at the `useProfile` hydration boundary. It also widened the fail-closed gate from "withhold the symbol" to "withhold the whole unit convention" (symbol AND separators) — necessary because moving the seed from LATAM `UYU` to INTL `USD` would otherwise print a LATAM user's balance with INTL grouping before hydration. See `## Archive reconciliation` → *Resolved deviations*.
**Does** `src/features/profile/api.ts` `setProfileCurrency` → `.update({ currency: currency.toUpperCase() })`;
`src/stores/use-settings-store.ts` L54 seed `'UYU'` → `'USD'`. No `CHECK` constraint anywhere (NFR-1).
**Accept** `pnpm test:features` green (payload pin `{ currency: 'USD' }`); `pnpm test:profile-hook` green;
`pnpm typecheck` clean.
**Deps** — · **→** REQ-4.1, REQ-5.4, NFR-1

## Phase 4 — Selector, catalog copy, single-source harness

### T-7 — 14 catalog keys × 3 locales + parity pin 787 → 797 (AD-4) — **CRITICAL**
**Status** **DONE** — shipped in #133 (`2b97961`) as one atomic unit with the pin bump, exactly as **Accept** required. Nine of the fourteen `pt-BR` labels additionally shipped translated out of English, and the factually-wrong `PENINSULAR_EMPTY_NAMESPACES` reason was rewritten.
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
**Status** **DONE** — shipped in #133 (`2b97961`), with the type-guard form corrected from `as` to `satisfies` and the selected-row decision extracted to `src/lib/currency-selection.ts`. The `as` form written below typechecks clean against a bogus catalog code, so it would have been a decorative guard; `satisfies` raises TS1360, which is what REQ-8 scenario 5 requires. No region-default badge shipped, per AD-7. One behavior of the shipped selector is **outside** this task and tracked: a stored currency outside the 14-code catalog renders zero selected rows → **#134**.
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
**Status** **DONE** — shipped in #133 (`2b97961`). 16 tests; `test:currency-catalog` is linked third in the `pnpm test` chain, right after the two format harnesses it complements. All seven source pins were mutation-probed before the commit. §3b pins the selected-row decision behaviorally via `src/lib/currency-selection.ts` (the pure module extracted for exactly that purpose) — and that pin is what surfaced **#134**.
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
**Status** **DONE** — shipped in #130 (`a6c0747`). The `~*` → `~` gotcha below was resolved as written (case-sensitive positive plus a case-sensitive lowercase negative); #133 (`2b97961`) later added a §4 `unique_violation` / 23505 anti-clobber section and softened the 0040 history claim in the migration header. The file's own LIMITATION note stands: a post-migration smoke test cannot observe a one-time backfill, so "declares a default, rewrites nothing" is pinned by review, not by this SQL.
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
**Status** **PARTIALLY OPEN — one scenario cannot close without physical devices.** Every automated gate command below exited 0 against the merged slices (#128 `740feb4`, #130 `a6c0747`, #133 `2b97961`), each PR recording `typecheck` clean, `lint` clean, and a full `pnpm test` chain green; #130 additionally ran `test:sql` against real Docker (8/8). **REQ-2.7 — the `₲` (U+20B2) glyph on a real iOS and Android device — remains OPEN and is blocked on hardware.** It is not waived, not softened, and not inferred from the passing string pin. Tracked in `## Archive reconciliation` → *Open by construction*. The `pnpm test:sql` command's coverage has one unrelated hole → **#135**.
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

---

## Archive reconciliation

Recorded at archive time (2026-10-03) against `main` @ `2b97961`, which carries
all three merged slices of this change: **#128** `740feb4`, **#130** `a6c0747`,
**#133** `2b97961`. Ten of eleven tasks shipped complete. T-11 is partially open
by construction and is recorded as such rather than closed.

Statuses are per-task `**Status**` lines above. This section carries only what a
per-task line cannot: what is still open, what moved to a tracked issue, what
shipped differently from the plan, and what was deliberately never designed.

### Open by construction — hardware-gated

| Item | State | Why it cannot close without hardware | How it closes | Owner |
|---|---|---|---|---|
| **T-11 / REQ-2.7** — `₲` (U+20B2) renders as a glyph, not tofu, on a real iOS **and** Android device | **OPEN** | Requires two physical devices. `scripts/test-format-currency.mjs` pins the *string* `'₲ 1.235'`; a Node harness cannot observe a font's glyph coverage, and a simulator run is not the evidence this scenario asks for. Nothing in the merged slices substitutes. | Render `formatCurrency(1234.56, 'PYG')` on one iOS and one Android device. If `₲` is tofu, set `CURRENCY_SYMBOL.PYG = 'PYG'`, update the harness pin to `'PYG 1.235'` **in the same commit**, and re-run `pnpm test:format-currency`. | Change author — needs device access; no automated substitute. |

Not waived, not estimated, not inferred from the passing string pin. Until it
closes, `currency-universality` REQ-2 scenario 7 is an unverified requirement.

### Tracked follow-ups

| Item | Issue | State |
|---|---|---|
| The settings picker renders **no** selected row when the stored currency is outside the 14-code catalog (e.g. a legacy `CHF` row: `isCurrencySelected` returns `false` for all 14 rows). Deliberately pinned rather than papered over with a synthetic row — see the `isCurrencySelected` doc comment in `src/lib/currency-selection.ts`. | **#134** | Pinned by `scripts/test-currency-catalog.mjs` §3b. Blocked on a product decision: whether an out-of-catalog stored value earns a fallback row, a visible "unavailable" row, or neither. |
| `supabase/tests/recalculate-on-purchase-items-update.sql` is named in the header comment of `scripts/test-db-smoke.mjs` but has no `run([...])` call in the executable list, so it never runs. Pre-existing and unrelated to this change. | **#135** | Open. It means the `pnpm test:sql` gate command in T-11 asserts less than its header claims — the gap is in coverage, not in a failure. |

### Resolved deviations from the task text

The task text above is left as written. What actually shipped:

| Task said | Shipped | Why |
|---|---|---|
| T-2: `ZERO_DECIMAL_CURRENCIES = new Set(['JPY','PYG'])` | `new Set(['CLP','JPY','PEN','PYG'])` | `CLP` and `PEN` are factually zero-decimal, and this change's own REQ-2 scenarios 1–2 and acceptance gate 2 pin whole-amount output for them (`$ 1.235`, `S/ 1.235`) — a two-code set would have contradicted its own pins. The constant's header records the reasoning and the deliberate `COP` exclusion. |
| T-8: label type via ``as `currency:${CurrencyKey}` `` | ``satisfies `currency:${CurrencyKey}` `` | An `as` assertion between two unions needs only ONE direction of assignability, so a 15-member union narrows to 14 and typechecks clean — the guard was decorative, and exactly the failure REQ-8 scenario 5 forbids (a supported code with no catalog key, painted as a raw key) would still have shipped behind a type-level comment claiming otherwise. `satisfies` raises TS1360. Mutation-probed in #133. |
| T-8: rows map over `SUPPORTED_CURRENCIES`, nothing else | plus `isCurrencySelected(code, currency)` from a new `src/lib/currency-selection.ts` | The selected-row decision case-folds, so a stored lowercase `'usd'` still selects its row instead of leaving all 14 unselected. Extracted as a dependency-free pure module so it could be pinned behaviorally rather than by regex over the component's source. |
| T-6: `setProfileCurrency` upper-cases and updates | same, plus an out-of-catalog rejection and hydration-time normalization | #133 added `SUPPORTED_CURRENCIES.includes(...)` so an unsupported code can no longer be persisted from the selector, and normalized `profiles.currency` to uppercase in `useProfile` so a legacy lowercase row hydrates canonically. |
| T-6: store seed `'UYU'` → `'USD'`, nothing else about the gate | the fail-closed gate widened to withhold separators as well as the symbol | Moving the seed from LATAM `UYU` to INTL `USD` made a shut gate that still grouped print a LATAM user's balance as `1,234.56` — a 1000× misread presented with total confidence. Recorded in #130 and in the `currencySymbolGateOpen` doc comment. |

### Deferred and deliberately not designed here

Each is recorded, not fixed. None is an incomplete implementation task; none
blocks the archive. All but the last two are carried as `## Non-Goals` in
`openspec/specs/currency-universality/spec.md`.

| Item | Owner / reason |
|---|---|
| Per-receipt currency, FX conversion, multi-currency aggregation | Needs an explicit product answer for budgets that span currencies. A follow-up change, not a bug fix. Canonical Non-Goal. |
| Household cross-currency sums (`monthly_purchases_total`, `monthly_category_totals`, `get_household_feed`) | Pre-existing latent bug, documented only — this change touches none of those RPCs. Canonical Non-Goal. |
| Locale-aware input parsing (bare `parseFloat` misreads `1.234,56` as `1.234`) | Write-side gap, out of scope for a display-side change. Canonical Non-Goal. |
| `COP` as zero-decimal | Excluded by the recorded scope decision: widening the set changes what every existing COP balance looks like, which is a separate product call. Canonical Non-Goal. |
| `CHECK (currency IN (...))` hardening of the free-text column | NFR-1 forbids it in this change. The column stays free text so a future catalog addition needs no migration. Canonical Non-Goal. |
| `es-ES`/`es-AR` `GBP` label divergence (`libra` vs `libra esterlina`) | Deliberately SUPPRESSED, not resolved: honoring it means dropping `currency` from both `EMPTY_FILES` and `PENINSULAR_EMPTY_NAMESPACES` with a stated reason, plus a 42-pin / 42-divergent bump. Recorded in #133 and in the proposal's Risks table. A copy decision, not a defect — no issue filed. |
| Selector provenance copy (a visible "default from your region" badge) | Not implemented by decision (AD-7 — "single-source rows, no provenance copy"). A correct badge needs a real `seeded_from_region` boolean the profile row does not carry; asserting provenance the app cannot prove would be a lie in the UI. |