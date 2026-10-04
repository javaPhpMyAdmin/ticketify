# Design — currency universality

Change: `currency-universality` · Mode: hybrid (file canonical, Engram working record)
Spec: `openspec/specs/currency-universality/spec.md` (6 REQ / 3 NFR / 6 gates / 33 scenarios)

## Technical approach

One catalog lives in the module that already owns money formatting, the selector
reads it instead of declaring its own list, one pure region→code function runs
once at profile-row *creation* through a create-only INSERT that is structurally
inc incapable of overwriting a row, and the DB default flips case without
touching data. The only user-visible behavior change is JPY/PYG losing a
fabricated decimal.

```
                  src/lib/format.ts  (zero imports, single owner)
  LATAM_CURRENCY_CODES ┐
  INTL_CURRENCY_CODES  ┴─→ SupportedCurrency ─→ SUPPORTED_CURRENCIES (14)
                             │        └─→ CURRENCY_SYMBOL (Record<SupportedCurrency,string>)
                             │        └─→ ZERO_DECIMAL_CURRENCIES {JPY,PYG}
                             └─(import type, erased)─→ src/i18n/detector.ts
                                                         detectDefaultCurrency(tag, region?)
                       settings/currency.tsx ──reads── SUPPORTED_CURRENCIES
                       currency.json (en/es-419/pt-BR) ──keyof── selector label type

  first launch only:  device-currency.ts → ensureProfileCurrency(id, code)   [INSERT, 23505 on existing]
  every sign-in:      ensureProfile(user)                                   [upsert, NO currency key]
```

## Architecture Decisions

### AD-1 — The catalog stays inside `src/lib/format.ts`

| Option | Tradeoff | Decision |
|---|---|---|
| Keep in `format.ts` | Selector imports a lib module (already the format authority); harness tsconfig unchanged | **Chosen** |
| New `src/lib/currencies.ts` | Cleaner naming, but `scripts/tsconfig.format-currency-test.json` has `include: ["../src/lib/format.ts"]` — a single root file. A second module means widening that config or adding the first runtime import to a module whose header documents "zero imports". | Rejected |
| `src/features/…/currencies.ts` | Formatter would import from `features/` — inverts the dependency direction | Rejected |

Mechanics — LATAM/INTL become the source, the Sets become derived:

```ts
export const LATAM_CURRENCY_CODES = ['ARS','BRL','CLP','COP','MXN','PEN','PYG','UYU'] as const;
export const INTL_CURRENCY_CODES  = ['AUD','CAD','EUR','GBP','JPY','USD'] as const;
export type SupportedCurrency =
  (typeof LATAM_CURRENCY_CODES)[number] | (typeof INTL_CURRENCY_CODES)[number];
export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] =
  [...LATAM_CURRENCY_CODES, ...INTL_CURRENCY_CODES];           // 14, fixed order
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['JPY', 'PYG']);
export const CURRENCY_SYMBOL: Record<SupportedCurrency, string> = { /* all 14 */ };
export const LATAM_CURRENCIES: ReadonlySet<string> = new Set(LATAM_CURRENCY_CODES);
export const INTL_CURRENCIES:  ReadonlySet<string> = new Set(INTL_CURRENCY_CODES);
```

`Record<SupportedCurrency, string>` makes a missing symbol a **`tsc` error**, not a
runtime `code-as-symbol` fallback — REQ-1.3 becomes compile-enforced. The Set
exports stay because they are the grouping lookup `formatCurrency` uses
(verified: no consumer outside `format.ts`; only a doc comment in the harness
mentions them). Order is LATAM-then-INTL by **code**, not by localized name, so
rows do not reshuffle when the user switches language.

### AD-2 — `detectDefaultCurrency` in `detector.ts`, seeded by a create-only INSERT

Spec REQ-3 pins the export location, and `detector.ts` already owns mapping
tables (`SUPPORTED_LOCALES`, `FALLBACK_CHAIN`) and is dependency-free so its
isolated tsconfig harness keeps working. It references the catalog **type only**
(`import type` — erased at runtime, no new edge in the compiled graph).

Signature reconciliation (the trap): REQ-3 scenario 1 passes a bare region
(`'MX'`), scenario 5 / spanish REQ-7 scenario 7 pass a *tag* (`'es_MX'`). One
two-arg signature serves both, mirroring `detectLocale`:

```ts
export function resolveRegionCode(languageTag?: string | null,
                                  regionCode?: string | null): string | null;
export function detectDefaultCurrency(languageTag?: string | null,
                                      regionCode?: string | null): SupportedCurrency;
```

`resolveRegionCode` normalizes (`trim`, `_`→`-`, upper-case), then takes the
**last** segment matching `/^[A-Z]{2}$|^\d{3}$/`; an explicit non-empty
`regionCode` wins outright. "Last" is what makes a bare `'MX'` resolve to `MX`
(only segment) while `'es-MX'` resolves to `MX` and not `ES`. `splitTag` delegates
its region field to this one function, so there is exactly one normalizer
(spanish NFR-3). The only semantic delta vs today is first-match→last-match; the
24 existing `test-detector-regional` cases re-run unchanged as the proof.
`REGION_DEFAULT_CURRENCY` is keyed by uppercase ISO regions exactly as the spec
table reads; anything absent → `USD`.

Write path — the no-clobber trap:

| Option | Tradeoff | Decision |
|---|---|---|
| `currency` key added to `ensureProfile`'s upsert payload | Rejected outright: the upsert runs on **every** sign-in, so it would overwrite the user's choice forever | — |
| Conditional `update().is('currency', <column default>)` | Looks write-once, but rewrites a user who *deliberately* picked `USD` on an `MX` device | Rejected |
| Postgres RPC `seed_profile_currency` | New migration, grants, `SECURITY DEFINER` surface, a new SQL test file — for behavior a plain INSERT already gives | Rejected |
| **`ensureProfileCurrency` = plain INSERT, run before `ensureProfile`** | First launch: row created with the region code. Later: Postgres rejects with 23505, which is swallowed like every other `ensureProfile` failure. Clobbering is *unrepresentable*, not merely avoided. | **Chosen** |

```ts
// src/lib/auth/profile-sync.ts  — NO new imports (supabase only)
export async function ensureProfileCurrency(userId: string, currency: string): Promise<void> {
  // INSERT (never upsert). An existing row → 23505 → swallowed → zero writes.
}
export async function ensureProfile(user: AuthUser): Promise<void> { /* unchanged, no currency key */ }
```

Order matters: the seed must precede the upsert, or the upsert creates the row
first and the seed can never fire. `profiles_insert_own` (`0001:126-127`,
`with check (auth.uid() = id)`) already permits the client-side insert.
`getLocales()` stays out of `profile-sync.ts` (supabase-only, compiled by
`tsconfig.profile-hook-test.json` with stubs) and out of `detector.ts` (NFR-2
purity): a new 6-line `src/i18n/device-currency.ts` is the single native
adapter, mirroring `src/i18n/storage/localeSecureStore.ts`.

### AD-3 — Default drift: flip the default only, never `UPDATE` rows

| Option | Tradeoff | Decision |
|---|---|---|
| `0041` `alter … set default 'USD'` | Affects new rows only; `'usd'` legacy rows survive | **Chosen** |
| `0041` also `update … set currency='USD' where currency='usd'` | Violates REQ-4 ("no migration SHALL UPDATE"), gate 5, and REQ-4.3. Indistinguishable from a user choice — it rewrites data on a guess | Rejected |
| App-layer canonicalization on *read* | Adds a silent write to every read path and a second currency authority | Rejected as the default mechanism |
| App-layer canonicalization at the *write boundary* | 1 line in `setProfileCurrency` (`.toUpperCase()`), satisfies NFR-1 for every future write, zero migration | **Chosen alongside the migration** |

`0040` is immutable history; `0041` supersedes it. Legacy `'usd'` rows render
identically because `formatCurrency` case-folds (REQ-4.4), and no harness may
assert they were rewritten. **NFR-7 needs no edit**: `openspec/specs/app-i18n/spec.md:189`
already reads `USD` — verified, not assumed.

### AD-4 — 14 catalog keys × 3 locales; pin 787 → 797

`es-AR`/`es-ES` stay `{}` (product decision 5). `currency` stays named in both
`EMPTY_FILES` (L43) and `PENINSULAR_EMPTY_NAMESPACES` (L50-60) — the harness
asserts those two sets are deepEqual (L259). The `currency` reason string at
**L55 is now factually wrong** ("Currency formatting is an Intl concern, not
catalog copy") — the namespace holds names, and names *are* catalog copy. Rewrite
to: *"Currency names are region-neutral catalog copy; the CODE owns formatting
(`src/lib/format.ts`), so no Peninsular override exists."*

| Code | en | es-419 | pt-BR |
|---|---|---|---|
| ARS | Argentine peso | Peso argentino | Peso argentino |
| AUD | Australian dollar | Dólar australiano | Dólar australiano |
| BRL | Brazilian real | Real brasileño | Real brasileiro |
| CAD | Canadian dollar | Dólar canadiense | Dólar canadense |
| CLP | Chilean peso | Peso chileno | Peso chileno |
| COP | Colombian peso | Peso colombiano | Peso colombiano |
| EUR | Euro | Euro | Euro |
| GBP | British pound sterling | Libra esterlina | Libra esterlina |
| JPY | Japanese yen | Yen japonés | Iene japonês |
| MXN | Mexican peso | Peso mexicano | Peso mexicano |
| PEN | Peruvian sol | Sol peruano | Sol peruano |
| PYG | Paraguayan guaraní | Guaraní paraguayo | Guarani paraguaio |
| USD | US dollar | Dólar estadounidense | Dólar americano |
| UYU | Uruguayan peso | Peso uruguayo | Peso uruguaio |

`es-419` wording is region-neutral (no voseo, no `libra` alone). GBP's genuine
Peninsular divergence (`libra` vs `libra esterlina`) is **suppressed, not
resolved**: honoring it means removing `currency` from both empty sets with a
stated reason plus a `42`-pin / `42`-divergent bump. Recorded as a follow-up.

Pin mechanics in `test-i18n-catalog-parity.mjs`: **L235** `assert.equal(leaves.size, 787, …)` → `797`; **L230** test name string `… 18 files / 787 leaves` → `797`; header comments **L8** and **L14**; **L55** reason string. `es-AR` (65) and `es-ES` (122) leaf counts are untouched.

### AD-5 — Zero-decimal rendering inside `formatCurrency`

Three lines at `format.ts:741-742`; nothing else in the function changes:

```ts
const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(upperCode);
const fixed = Math.abs(value).toFixed(isZeroDecimal ? 0 : 2);
const [intPart, decPart = ''] = fixed.split('.');
```

With `decPart = ''`, the existing `hasNonZeroDecimal` guard is falsy and no
decimal separator is emitted; grouping still runs on `intPart`
(`1234.56 → "1235" → "1.235"`, `100.4 → "100"`). Sign handling at L755 is
untouched. `formatCurrencyWhole` (L766) is already `toFixed(0)` — **no change**.

Behavior change: `¥ 1,234.56` → `¥ 1,235`. Pin at
`test-format-currency.mjs:90-91` updated in the same change; the harness header
(L12-13) is updated to say JPY is zero-decimal. `COP` is deliberately *not* in
the set (recorded scope decision).

### AD-6 — Scenario → harness coverage (33/33)

New: **`scripts/test-currency-catalog.mjs`** + `scripts/tsconfig.currency-catalog-test.json`
(include `src/lib/format.ts`, reuse the `test-format-currency` compile pattern)
+ `package.json` `test:currency-catalog`, wired into the `pnpm test` chain.
It compiles `format.ts`, reads the catalogs with `fs`, and **statically scans**
`src/app/settings/currency.tsx`, `src/stores/use-settings-store.ts` and
`src/lib/auth/profile-sync.ts` — the same source-scan technique the parity
harness already uses on `detector.ts` (L298). Compiling the screen would drag in
the entire component barrel; scanning it is proportionate and pins the
"no second list" rule textually.

| Scenario | Harness | Assertion |
|---|---|---|
| REQ-1.1 set is 14, no dupes | **test-currency-catalog** (new) | `SUPPORTED_CURRENCIES.length === 14`, `Set` size equal, sorted set equals the spec list |
| REQ-1.2 selector renders that set, no local list | **test-currency-catalog** | source scan: no `CURRENCY_CODES`-style array literal, no `as 'currency:…'` union, imports `SUPPORTED_CURRENCIES` |
| REQ-1.3 every code has symbol + grouping | **test-currency-catalog** + **test-format-currency** | every code resolves in `CURRENCY_SYMBOL` and renders symbol-prefixed (never bare code) |
| REQ-1.4 `XYZ → XYZ 1,234.56` | test-format-currency (L124-131, kept) | unchanged |
| REQ-2.1-2.3 CLP/PEN/PYG symbols | test-format-currency | `$ 1.235` / `S/ 1.235` / `₲ 1.235` |
| REQ-2.4 `PYG 100.4 → ₲ 100` | test-format-currency | rounding-away |
| REQ-2.5 JPY → `¥ 1,235` | test-format-currency (**L90-91 edited**) | the authorized behavior change |
| REQ-2.6 locale independence | test-format-currency | `formatCurrency` takes no locale arg; output identical for a zero-decimal code regardless of UI language (asserted as purity, not by a locale param that does not exist) |
| REQ-2.7 `₲` font fallback | **manual on-device** | see verification plan — the only non-automated scenario |
| REQ-3.1-3.3 all 14 regions | test-detector-regional (extended) | table-driven |
| REQ-3.4 `XX`/`undefined`/`''` → USD | test-detector-regional | fallback |
| REQ-3.5 `'mx'` and `es_MX` → MXN | test-detector-regional | case + underscore + tag |
| REQ-3.6 language-independence | test-detector-regional | `en-GB` + region `GB` → `GBP` while `detectLocale` still returns `en` |
| REQ-3.7 `detectLocale` unchanged | test-detector-regional (existing 24 cases, unedited) | regression proof |
| REQ-3.8 determinism / no state | test-detector-regional | two calls equal |
| REQ-4.1 store seed `'USD'` | **test-currency-catalog** | source scan of `use-settings-store.ts` |
| REQ-4.2 new row born `'USD'` | supabase/tests/currency-default.sql §1+§2 | `'USD'` uppercase in `pg_get_expr`; insert-without-currency |
| REQ-4.3 existing `'UYU'` untouched | currency-default.sql §2 | + migration 0041 contains no `UPDATE` (review-pinned, per the file's own LIMITATION note) |
| REQ-4.4 legacy `'usd'` renders `US$ 1,234.56` | test-format-currency | case-fold preserved |
| REQ-5.1 existing `UYU` survives sign-in | **test-currency-catalog** | seed call site is `.insert(`, never `.upsert(` |
| REQ-5.2/5.3 first sign-in seeds MXN / USD | test-currency-catalog + test-detector-regional | insert carries the derived code |
| REQ-5.4 explicit choice wins | static (unchanged `setProfileCurrency` path) + REQ-4.3 | no regression path introduced |
| REQ-5.5 written at most once | **test-currency-catalog** | create-only insert ⇒ 23505 on every later sign-in |
| REQ-5.6 `ensureProfile` payload has no `currency` | **test-currency-catalog** | source scan of `profile-sync.ts` |
| REQ-6.1 18 files / 797 leaves | test-i18n-catalog-parity (L230/L235) | the CRITICAL pin |
| REQ-6.2 `es-AR`/`es-ES` stay `{}`, still named | test-i18n-catalog-parity (L257-280) | existing sparse-shape test |
| REQ-6.3 identical 14-key sets | test-i18n-catalog-parity (L239-244) + test-currency-catalog | cross-locale identity |
| REQ-6.4 no invented keys | test-i18n-catalog-parity R-4 (L247-254) | existing |

Gates 1-6 map onto the rows above; gate 6 is `pnpm test && pnpm typecheck`.

### AD-7 — Selector UI: single-source rows, no provenance copy

`CURRENCY_CODES` (L18-23) is deleted; `.map` runs over `SUPPORTED_CURRENCIES`.
The label cast (L82-86) becomes catalog-derived — no hand-written union:

```ts
import type es419Currency from '@/i18n/locales/es-419/currency.json';
type CurrencyKey = keyof typeof es419Currency;
const label = t(`currency:${code}` as `currency:${CurrencyKey}`);
```

Row layout, `saving` guard, active-code no-op, inline error, `router.back()`
post-success and the whole persistence chain are **unchanged**. 14 rows fit the
existing `ScrollView`; no virtualization, no `SectionList`.

**Open Q3 decision — no region-default copy in v1.** Three reasons: (1) the seed
is written at row creation, so by the time the screen opens the row already
carries it and the row is simply *selected* — a "default for your region" badge
would assert provenance the app cannot prove (a user who deliberately picked
`MXN` looks identical to a seeded one), i.e. it would lie to exactly the users
who chose; (2) the string costs 1 key × 3 full locales and reopens the parity
pin for zero functional gain; (3) the honest, free affordance already exists —
the checkmark on the active row. If provenance is ever wanted, the correct
carrier is a boolean column written by the *same* create-only insert, never a UI
guess. Recorded as a follow-up, not a task.

## Data flow — first launch vs every later sign-in

```
first launch (MX device)                     every later sign-in
─────────────────────────                    ──────────────────────
detectDeviceDefaultCurrency()                 detectDeviceDefaultCurrency()  (computed, discarded)
  getLocales()[0] → ('es-MX','MX')              │
  detectDefaultCurrency → 'MXN'                 ├─ ensureProfileCurrency(id,'MXN')
        │                                        │    INSERT → 23505 → swallowed → 0 writes ✅
        ▼                                        └─ ensureProfile(user)
ensureProfileCurrency(id,'MXN')                    upsert {id, full_name, avatar_url}
  INSERT (id, MXN) → row created ✅                          no `currency` key → row untouched ✅
        │
        ▼
ensureProfile(user) → identity only
```

## File changes

| File | Action | Change |
|---|---|---|
| `src/lib/format.ts` | Modify | AD-1 catalog + AD-5 zero-decimal (L39-80, L741-742). Stays import-free. |
| `src/app/settings/currency.tsx` | Modify | AD-7: delete L18-23, import `SUPPORTED_CURRENCIES`, catalog-derived label type. |
| `src/i18n/detector.ts` | Modify | AD-2: export `resolveRegionCode`, `REGION_DEFAULT_CURRENCY`, `detectDefaultCurrency`; `splitTag` delegates; `detectLocale` lowercases its switch input. |
| `src/i18n/device-currency.ts` | Create | `detectDeviceDefaultCurrency()` — sole `getLocales()` reader for currency. |
| `src/lib/auth/profile-sync.ts` | Modify | Add `ensureProfileCurrency` (INSERT only). `ensureProfile` byte-unchanged. |
| `src/features/auth/use-session-store.ts` | Modify | Chain the seed **before** `ensureProfile` at L193 and L402. |
| `src/features/profile/api.ts` | Modify | `setProfileCurrency`: `.toUpperCase()` at the write boundary (NFR-1). |
| `src/stores/use-settings-store.ts` | Modify | Seed `'UYU'` → `'USD'` (L54). |
| `src/i18n/locales/{en,es-419,pt-BR}/currency.json` | Modify | 4 → 14 keys (existing per-file indentation kept). |
| `supabase/migrations/0041_currency_default_usd_upper.sql` | Create | `alter … set default 'USD'`. Header states: default only, no `UPDATE`. |
| `supabase/tests/currency-default.sql` | Modify | §1 + §2 expect `'USD'`; header comment updated from 0040. |
| `scripts/test-i18n-catalog-parity.mjs` | Modify | L235 pin 787→797; L230 name; L8/L14 header; L55 reason string. |
| `scripts/test-format-currency.mjs` | Modify | L90-91 JPY pin; + CLP/PEN/PYG/zero-decimal/symbol-coverage/legacy-case pins; L12-13 header. |
| `scripts/test-detector-regional.mjs` | Modify | Resolver cases, 14-region table, USD fallback, language-independence. |
| `scripts/test-currency-catalog.mjs`, `scripts/tsconfig.currency-catalog-test.json` | Create | AD-6 single-source-of-truth harness. |
| `package.json` | Modify | `test:currency-catalog` script + one link in the `pnpm test` chain. |
| `openspec/specs/app-i18n/spec.md` | Verify only | NFR-7 already reads `USD` (L189) — **no edit**. |
| `openspec/specs/spanish-regional-detection/spec.md` | Verify only | REQ-7 delta exists in the change folder; archived at archive time. |

~17 files, ~340 changed lines — over the 400-line review budget is unlikely but
` sdd-tasks` MUST forecast (15 store reads + 37 prop-carrying files untouched).

## Edge cases handled explicitly

| Edge | Handling |
|---|---|
| `'mx'` lowercase region | resolver upper-cases → `MXN` (REQ-3.5) |
| `es_MX` underscore tag, no explicit region | resolver `_`→`-`, last regionish segment = `MX` → `MXN` |
| `es-419` (3-digit M.49) as a region | `419` is regionish, absent from the map → `USD` (never `EUR`) |
| `'es-Ar-x-private'` singleton skip | `x` (1 alpha) / `private` (7) are not regionish → `AR` |
| Unmapped / `undefined` / `''` region | `USD` — universal, not regional |
| iOS reports `es-MX` on a `UY` device | explicit `regionCode` wins → `UYU` |
| Legacy `'usd'` row | case-folds to `US$ 1,234.56`; never rewritten |
| Existing `UYU` row on sign-in | INSERT rejects (23505); no write |
| Wrong device region → wrong seed | default only, user-editable, fail-closed symbol gate; no data loss |
| `XYZ` unknown code | `XYZ 1,234.56` unchanged (no new throw path) |
| Symbol gate shut during hydration | `formatCurrency` withholds only the symbol; zero-decimal grouping still renders |

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Parity pin `787` goes red — any `currency.json` key breaks `pnpm test` | **CRITICAL** | Bump L235 in the same change; the new harness re-derives the count so a later bump needs no magic number |
| Region seed clobbers a chosen currency | **CRITICAL** | Create-only INSERT (23505), separate function from the upsert, pinned by source scan in the new harness |
| `₲` U+20B2 renders tofu on iOS/Android | **HIGH** | On-device verify step; fallback `PYG` code-as-symbol is a one-line table change (the `?? rawCode` path already exists) |
| Shipped JPY output changes | **MED** | Authorized + pinned at L90-91; JPY is factually zero-decimal |
| `es-ES` GBP divergence silently suppressed (`libra` never appears) | **MED** | Recorded; removing `currency` from the empty sets needs a stated reason + 42-pin churn |
| `detector.ts` gains an import on the type of `format.ts` | **MED** | `import type` is erased; `tsconfig.i18n-detector-test.json` compiles one root file and the full 24-case harness must stay green |
| `setCurrencySymbolGate` fail-closed window briefly shows a symbol-less seeded amount | **LOW** | Already the designed behavior; the seed only ever affects new rows |

## Verification plan

```bash
cd mobile
pnpm test:currency-catalog        # new — single-source-of-truth, seed call site, store seed
pnpm test:format-currency         # JPY/CLP/PEN/PYG pins + symbol coverage
pnpm test:detector-regional       # 14 regions + shared resolver + detectLocale regression
pnpm test:i18n-catalog-parity     # 18 files / 797 leaves; es-AR + es-ES still {}
pnpm test:profile-hook            # profile-sync still compiles + stubs hold
pnpm test                        # full chain
pnpm typecheck                    # Record<SupportedCurrency,string> + catalog key type
pnpm lint
```

Database (scratch/CI only, never production):
`supabase db query --local --file supabase/tests/currency-default.sql` — §1/§2
assert the `'USD'` uppercase default fires and an explicit `'UYU'` survives.

Manual (the only non-automated scenario, REQ-2.7): render
`formatCurrency(1234.56, 'PYG')` on a real iOS **and** Android device and confirm
`₲` is a glyph, not a tofu box; if not, set `CURRENCY_SYMBOL.PYG = 'PYG'` and
re-run the harness (the pin is `'PYG 1.235'` in that case).

## Open Questions

None blocking. Deferred, recorded, not designed here: `es-ES`/`es-AR` GBP
divergence; selector provenance copy (needs a real `seeded_from_region` boolean);
per-receipt currency / FX; household cross-currency sums; locale-aware input
parsing; `CHECK (currency IN (...))`.