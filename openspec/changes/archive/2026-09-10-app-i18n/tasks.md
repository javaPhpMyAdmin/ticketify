# Tasks: App i18n — Multilingual UI (en / es-AR / pt-BR) + Locale-Aware Formatters

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~3,800-5,200 across 3 PRs (PR 1 ~300-400, PR 2 ~2,000-2,800, PR 3 ~1,500-2,000) |
| Per-PR budget | PR 1 ≤ 400 (default), PR 2 ≤ 1000 (binding override), PR 3 ≤ 1000 (binding override) |
| Chained PRs recommended | No — user locked 3-PR incremental; all 3 chain together (stacked-to-main) |
| Largest single-file risk | `src/lib/format.ts` PR-3 rewrite (~280 LOC diff) — split into 2 commits inside PR 3 per AD-12 (consolidations first, then `formatDate` API rewrite) |
| Decision needed before apply | None — all decisions are locked in the binding table |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| WU-1.1 → WU-1.6 | deps + i18n core + minimal catalogs + tab wiring + language selector + 2 harnesses | PR 1 | base: main; standalone; first native dep |
| WU-2.1 → WU-2.11 | `formatDateES` wrapper pass + `formatCurrency` hybrid + currency harness + feature-access errors + manual-form errors + 7-namespace catalogs + auth/tabs/settings/tickets screens + DatePickerField + household voseo + profile plural | PR 2 | base: PR 1; primary flow only |
| WU-3.1 → WU-3.8 (commit A) → WU-3.3 (commit B) | currency-map consolidation + month-array consolidation → `formatDateES` rewrite + pro/charts + receipts/[id] + drill-downs + feature components + currency labels | PR 3 | base: PR 2; split into 2 commits per AD-12 |

### Flagged Decisions

- **Native dep onboarding**: `expo-localization` is the project's first native dep. PR 1 description MUST say `npx pod-install`.
- **Review budget override**: PR 2 + PR 3 use the 1000-line override per binding table (`category-budgets` precedent). Still flag hot files ≥200 LOC for split consideration.
- **`formatDateES` rewrite gate**: WU-3.3 only runs after `grep -rn 'formatDateES' src/` returns zero non-test hits.

---

## Phase 1 — Setup (PR 1, ≤ 400 LOC, fits default)

- [x] T1.1 (WU-1.1) Add `i18next@^26`, `react-i18next@^16`, `expo-localization@~17` to `package.json`; regenerate `pnpm-lock.yaml`. **Verify:** `pnpm install` clean; no peer-dep warnings.
- [x] T1.2 (WU-1.2) Create `src/i18n/config.ts` (i18next init: `supportedLngs: ['en','es-AR','pt-BR']`, `fallbackLng: 'es-AR'`, `ns: ['common','tabs']`, `resources`), `src/i18n/detector.ts` (pure `detectLocale(tag): 'en' | 'es-AR' | 'pt-BR'` per REQ-2), `src/i18n/types.ts` (module augmentation `CustomTypeOptions { resources: Catalog }`), `src/i18n/stores/useLocaleStore.ts` (Zustand: `locale`, `override: 'auto' | 'en' | 'es-AR' | 'pt-BR'`, `hydrate()`, `setLocale()` per AD-1), `src/i18n/storage/localeSecureStore.ts` (adapter for `ticketify.locale.override`), `src/i18n/components/I18nProvider.tsx` (provider `useEffect` calls `i18n.init()` once + `.catch` falls back to `es-AR` + `setBooted(true)` per AD-9). **Verify:** typecheck passes; no module-augmentation typo.
- [x] T1.3 (WU-1.3) Create `src/i18n/locales/en/common.json`, `es-AR/common.json`, `pt-BR/common.json` with keys `app.name`, `tabs.home|analytics|history|profile`, `common.ok|cancel|back|save|loading`. Each locale file COMPLETE (no empty translations). **Verify:** `t('tabs.home')` resolves typed in all 3 locales.
- [x] T1.4 (WU-1.4) Modify `src/app/_layout.tsx`: mount `<I18nProvider>` + subscribe `i18next.on('initialized', setBooted)`. Modify `src/app/(tabs)/_layout.tsx`: tab labels via `t('tabs.*')`. **Verify:** boot fade-out gates on `i18n.isInitialized`; first frame shows localized tabs.
- [x] T1.5 (WU-1.5) Create `src/app/settings/language.tsx` (4 options in fixed order: Automático (es-AR), English, Español (Argentina), Português (Brasil); mirrors `currency.tsx` shape). Modify `src/app/(tabs)/profile.tsx`: add "Idioma" row to `AccountSettingsList`. **Verify:** picking any option persists to secure-store; tab labels update live.
- [x] T1.6 (WU-1.6) Create `scripts/test-i18n-detector.mjs` (8 mapping cases per REQ-2 / NFR-4) + `scripts/test-i18n-init.mjs` (boot failure path per REQ-6: corrupt JSON → console.warn + `changeLanguage('es-AR')` + `setBooted(true)`; secure-store read error → detected locale + `setBooted(true)`). Add `test:i18n-detector` + `test:i18n-init` to `package.json` `test` chain. **Verify:** `pnpm test` chain green.

### Dependency order (PR 1)

`WU-1.1 → WU-1.2 → WU-1.3 → WU-1.4 → WU-1.5 → WU-1.6` (strict — every WU depends on the prior).

### Commit strategy (PR 1, 6 commits)

- `feat(i18n): agrega i18next, react-i18next y expo-localization al package.json`
- `feat(i18n): implementa config, detector, useLocaleStore, secure-store adapter e I18nProvider`
- `feat(i18n): catalogs mínimos para tabs y common en en/es-AR/pt-BR`
- `feat(i18n): monta I18nProvider en _layout con boot gate y tab labels como wiring proof`
- `feat(i18n): selector de idioma en Settings y row en perfil`
- `test(i18n): harness del detector (8 casos) y del init en fallo de boot (2 casos)`

---

## Phase 2 — Primary flow (PR 2, ≤ 1000 LOC, binding override)

- [x] T2.1 (WU-2.1) Modify `src/lib/format.ts`: add `formatDate(locale, iso, opts?)` as canonical API; `formatDateES(iso, opts?)` becomes one-liner wrapper `return formatDate('es-AR', iso, opts)`. Add `LATAM_CURRENCIES` / `INTL_CURRENCIES` `Set<string>` + `CURRENCY_LOCALE_SYMBOL: Record<string,string>`. Legacy call sites work unchanged. **Verify:** `pnpm typecheck` clean; `formatDateES` still imported across the repo.
- [x] T2.2 (WU-2.2) Modify `src/lib/format.ts`: implement `formatCurrency(value, currencyCode)` per AD-6 — no locale arg, reads `i18next.language` internally for label/symbol-form variants only. LATAM (ARS/UYU/BRL/MXN/CLP/COP/PEN) → `.` thousands + `,` decimals; INTL (USD/EUR/GBP/JPY/CAD/AUD) → `,` thousands + `.` decimals; unknown → INTL safer default. Verify against 5 spec scenarios (7-11). **Verify:** output matches REQ-4 scenarios for USD/ARS/UYU/BRL in en/es-AR/pt-BR.
- [x] T2.3 (WU-2.3) Create `scripts/test-format-currency.mjs`: 12+ cases (USD, ARS, UYU, BRL, EUR, GBP, JPY, MXN, CAD, AUD, unknown, zero, negative). Add `test:format-currency` to `package.json` `test` chain. **Verify:** all 12 cases pass.
- [x] T2.4 (WU-2.4) Modify `src/lib/supabase/feature-access.ts`: 6 `READ_ERROR_MESSAGE` constants → `i18next.t(\`errors.featureAccess.${code}\`)` at call time (AD-2 / REQ-10). **Verify:** Supabase read error toasts render in active locale.
- [x] T2.5 (WU-2.5) Modify `src/features/tickets/manual-form.ts`: `MANUAL_ERROR_MESSAGES` map → `i18next.t(\`errors.manualForm.${code}\`)` at call time. **Verify:** manual form validation errors localized.
- [x] T2.6 (WU-2.6) Create `src/i18n/locales/{en,es-AR,pt-BR}/{auth,tabs,settings,tickets,errors,a11y,currency}.json`. Full coverage of every string in the migrated screens (no empty translations). **Verify:** each locale file passes JSON parse; key count ≥ screen count × avg-strings-per-screen.
- [x] T2.7 (WU-2.7) Modify `src/app/(auth)/*.tsx` (sign-in, sign-up, forgot-password, reset-password) + `src/app/(tabs)/*.tsx` (index, analytics, history, profile) + `src/app/settings/*.tsx` (profile-edit, budget, category-budgets, currency, household, export). Per-tab label, per-screen text, `accessibilityLabel` props. Add per-screen `<Stack.Screen options={{ title }} />` with `useScreenTitle` hook (AD-11). **Verify:** walk primary flow in all 3 locales, no raw keys visible.
- [x] T2.8 (WU-2.8) Modify `src/app/ticket/{manual,review/[id]}.tsx` + `src/app/ticket/camera.tsx` + `src/features/tickets/**` (hooks, formatters, error messages). **Verify:** ticket flow localized.
- [x] T2.9 (WU-2.9) Modify `src/components/molecules/DatePickerField/{DatePickerField.tsx,calendar.ts}`: read month-name / weekday / `formatDateES` from `i18next.t()` directly (calendar.ts is module-level — uses `i18next.t()`, not hooks, per AD-2). `useScreenTitle` for the modal. **Verify:** DatePickerField opens with locale-correct month + weekday labels.
- [x] T2.10 (WU-2.10) Modify `src/features/household/**` + `src/app/settings/household.tsx`: voseo suffix ` (vos)` → `t('household.youSuffix')` (es-AR ` (vos)`, pt-BR ` (você)`, en ` (you)` per REQ-9). **Verify:** household list shows correct suffix in each locale.
- [x] T2.11 (WU-2.11) Modify `src/app/(tabs)/profile.tsx:197-199`: `daysRemaining` → `t('subscription.daysRemaining', { count: daysRemaining })` with `subscription.daysRemaining_one` / `_other` per locale (AD-7 / REQ-5). **Verify:** plural renders `Queda 1 día` / `Quedan 5 días` / `1 day left` / `5 days left` / `Resta 1 dia` / `Restam 5 dias`.

### Dependency order (PR 2)

`WU-2.1 → WU-2.2 → WU-2.3` (format wrapper → formatCurrency → harness). Then `WU-2.4 + WU-2.5` (error-message migration — independent). Then `WU-2.6` (catalogs — gate on 2.1 done for `formatDate` keys). Then `WU-2.7 → WU-2.8 → WU-2.9 → WU-2.10 → WU-2.11` (screen migrations).

### Commit strategy (PR 2, 8 commits)

- `feat(i18n): wrapper de formatDate con locale en lib/format.ts`
- `feat(i18n): formatCurrency híbrido (currency code manda en grouping/decimals)`
- `test(i18n): harness de formatCurrency (12 casos LATAM vs INTL)`
- `feat(i18n): migra errores de feature-access y manual-form a i18next.t`
- `feat(i18n): catalogs auth, settings, tickets, errors, a11y y currency en en/es-AR/pt-BR`
- `feat(i18n): migra auth, tabs y settings a t() con useScreenTitle por pantalla`
- `feat(i18n): migra ticket flow, DatePickerField y household voseo`
- `feat(i18n): plural de subscription.daysRemaining en profile`

### Hot file flag (PR 2)

If any of `src/features/auth/**`, `src/app/(tabs)/profile.tsx`, `src/app/(tabs)/history.tsx`, `src/app/(tabs)/analytics.tsx`, `src/app/settings/household.tsx` exceeds 200 LOC of diff, the apply executor MUST split into a helper-extraction pre-pass (commit `refactor(i18n): extrae helpers de strings de <screen>` before the migration commit).

---

## Phase 3 — Long tail + consolidations (PR 3, ≤ 1000 LOC, binding override)

### Commit A — consolidations (no signature change)

- [x] T3.1 (WU-3.1) Modify `src/features/charts/components/{CategoryDonut,ChartLegend}.tsx`: drop local `CURRENCY_SYMBOLS` maps; import `formatCurrency` from `src/lib/format.ts`. Net `−30` lines. **Verify:** Skia-rendered chart text matches `formatCurrency(value, code, locale)` exactly.
- [x] T3.2 (WU-3.2) Modify `src/components/molecules/DatePickerField/calendar.ts`: remove `MONTHS_FULL_ES_AR` / `MONTHS_ABBR_ES_AR`; single locale-aware source via `t('date.monthFull'|monthAbbr', { month })`. **Verify:** `grep -rn 'MONTHS_.*_ES_AR' src/` → 0 hits in `calendar.ts`.

### Commit B — `formatDateES` rewrite

- [x] T3.3 (WU-3.3) Modify `src/lib/format.ts`: remove `formatDateES` export. Every legacy call site in `src/**` switched to `formatDate(locale, ...)`. **Verify:** `grep -rn 'formatDateES(' src/` → 0 hits; `pnpm typecheck` clean.

### Long tail (any commit, between A and B or after B)

- [x] T3.4 (WU-3.4) Modify `src/app/pro/charts.tsx`: full string extraction (~+180/-70 LOC). Tab labels, chart titles, empty state, `accessibilityLabel` on chart text. **Verify:** no raw keys in pro/charts; pt-BR text doesn't overflow chart containers.
- [x] T3.5 (WU-3.5) Modify `src/app/receipts/[id].tsx`: full string extraction (~+180/-70 LOC). Headers, sub-headers, a11y labels. **Verify:** VoiceOver reads localized a11y label on receipt row.
- [x] T3.6 (WU-3.6) Modify drill-downs: `src/app/categories/[key].tsx`, `src/app/items/[name].tsx`, `src/app/stores/[name].tsx`. Per-screen titles via `useScreenTitle`. **Verify:** drill-downs open in active locale.
- [x] T3.7 (WU-3.7) Modify feature components: `src/features/analytics/**`, `src/features/charts/**` (after WU-3.1), `src/features/items/**`, `src/features/export/**`. Any string still hardcoded. **Verify:** no raw keys in feature components.
- [x] T3.8 (WU-3.8) Modify `src/app/settings/currency.tsx:15-20`: hardcoded "Peso uruguayo" etc. → `t('currency.UYU')` etc. (REQ-8). **Verify:** currency selector labels correct per locale.

### Dependency order (PR 3)

Commit A: `WU-3.1 → WU-3.2` (independent — both consolidate duplicates).
Commit B: `WU-3.3` (depends on A done; gate is `grep -rn 'formatDateES' src/` zero).
Long tail: `WU-3.4 → WU-3.5 → WU-3.6 → WU-3.7 → WU-3.8` (any order — independent screens; can land after B or interleaved).

### Commit strategy (PR 3, 7 commits)

- `refactor(i18n): consolida currency maps en CategoryDonut y ChartLegend`
- `refactor(i18n): consolida MONTHS_*_ES_AR en calendar.ts usando t('date.*')`
- `feat(i18n): rewrite de formatDate — formatDateES se va, formatDate(locale, ...) queda`
- `feat(i18n): migra pro/charts a t() con a11y labels`
- `feat(i18n): migra receipts/[id] a t() con a11y labels`
- `feat(i18n): migra drill-downs (categories, items, stores) y features (analytics, charts, items, export)`
- `feat(i18n): migra currency selector a t('currency.*')`

### Hot file flag (PR 3)

`src/lib/format.ts` PR-3 rewrite is split into 2 commits per AD-12 (consolidations first, then API rewrite). Apply executor MUST keep these commits in that order. If the rewrite commit alone still exceeds 200 LOC, split `formatDate` rewrite into `formatDate` rewrite + `formatCurrency` rewrite as 2 separate commits.

---

## Per-PR review budget

| PR | LOC (est.) | Files (est.) | Budget | Status |
|---|---|---|---|---|
| 1 | ~300-400 | 12-15 (8 new) | 400 (default) | fits |
| 2 | ~2,000-2,800 | 40-50 | 1000 (override) | needs size:exception |
| 3 | ~1,500-2,000 | 30-40 | 1000 (override) | needs size:exception |

Apply executor MUST flag any single-file diff ≥ 200 LOC for helper-extraction pre-pass before committing (already covered by AD-12 for `src/lib/format.ts` PR-3; apply executor watches for additional hot files in PR 2 + PR 3).

---

## Manual verification matrix (per PR)

### PR 1 — wiring proof + selector

- iOS simulator, language set to Spanish (Argentina): app launches in `es-AR`, tab labels render `Inicio / Analítica / Historial / Perfil`, boot caption in es-AR.
- iOS simulator, Portuguese (Brazil): app launches in `pt-BR`, tabs render `Início / Analítica / Histórico / Perfil`.
- iOS simulator, English (US): app launches in `en`, tabs render `Home / Analytics / History / Profile`.
- iOS simulator, French: detector maps unknown locale → `es-AR` fallback.
- Open Settings → Idioma, switch between 4 options. Tab labels update live without app restart.
- Kill + relaunch. Manual override persists.
- Disable network → relaunch. Locale JSON files bundle via Metro; works offline.

### PR 2 — primary flow

- Walk primary flow in each locale: sign-in → home → manual entry → review → analytics → settings → language selector. No raw keys visible.
- Supabase read fails with user-safe code → toast renders in active locale.
- DatePickerField opens in `pt-BR` → month names + weekday labels in Portuguese.
- Plural: `daysRemaining = 1` and `= 5` render correctly per locale.
- a11y: VoiceOver / TalkBack reads localized `accessibilityLabel` on `ReceiptRow`, `ItemDetail`.

### PR 3 — long tail + consolidations

- Walk pro flow in each locale: paywall → charts → drill-downs.
- `formatCurrency(1234.56, 'USD')` = `US$ 1,234.56` regardless of UI locale.
- `formatCurrency(1234.56, 'ARS')` = `ARS 1.234,56` regardless of UI locale.
- Chart text doesn't overflow on pt-BR (longer copy); Skia text elide works.
- Household list: `Marcelo (vos)` / `Marcelo (você)` / `Marcelo (you)` per locale.
- `grep -rn 'formatDateES' src/` → 0 hits.
- `grep -rn 'CURRENCY_SYMBOL' src/features/charts/` → 0 hits.

---

## PR description checklist (per PR)

Every PR description MUST include:

- "Closes #N" with the issue tracker (created at PR time).
- `pnpm typecheck` runs clean.
- All harnesses for the PR pass (PR 1: `test:i18n-detector`, `test:i18n-init`; PR 2 adds `test:format-currency`; PR 3 reuses).
- No new `Intl` / `i18next-icu` / `dayjs` / `date-fns` imports.

PR-specific extras:

- **PR 1**: "devs run `npx pod-install` after merge (first native dep)."
- **PR 2**: "best-effort en / pt-BR translations — review before launch. Locale JSON files are easy to update post-merge."
- **PR 3**: "currency-map and month-array consolidations landed; verify chart text rendering on pt-BR (longer copy)."
- **PR 3**: "Two-commit PR per AD-12 (consolidations → API rewrite)."

---

## Out-of-scope guards

Apply executor MUST run these grep checks before committing each PR:

| Check | Command | Expected |
|---|---|---|
| No `Intl.*` in code | `grep -rn 'Intl\.' src/ scripts/` | 0 matches |
| No `i18next-icu` | `grep -n 'i18next-icu' package.json` | absent |
| No `dayjs` | `grep -n '"dayjs"' package.json` | absent |
| No `date-fns` | `grep -n '"date-fns"' package.json` | absent |
| No `_zero` plural keys (PR 2+) | `grep -rn '_zero' src/i18n/locales/` | 0 matches |
| No first-run picker | `grep -rn 'firstRun.*language\|onboarding.*language\|pickLanguage' src/app/` | 0 matches |
| `formatDateES` clean (PR 3) | `grep -rn 'formatDateES(' src/` | 0 matches |
| Currency maps consolidated (PR 3) | `grep -rn 'CURRENCY_SYMBOL' src/features/charts/` | 0 matches |
| Month arrays consolidated (PR 3) | `grep -rn 'MONTHS_.*_ES_AR\|MONTHS_.*_ES[^_]' src/components/molecules/DatePickerField/calendar.ts` | 0 matches |

Carry-over context: `utcYearMonth` (from `category-budgets` fix) is NOT relevant to this change — it lives in `src/lib/supabase/feature-access.ts`-adjacent code and stays untouched.

---

## Acceptance gates (recap)

1. `pnpm typecheck` passes after every PR.
2. PR 1 manual matrix: 4 simulator locales + selector + offline launch + cold-start persistence.
3. PR 2 manual matrix: primary flow in all 3 locales + plural correctness + a11y on `ReceiptRow`.
4. PR 3 manual matrix: pro flow + currency format authority + household voseo suffix.
5. Unit — detector (`scripts/test-i18n-detector.mjs`): all 8 mapping cases pass.
6. Unit — formatCurrency (`scripts/test-format-currency.mjs`): all 12+ cases pass.
7. Unit — i18n init (`scripts/test-i18n-init.mjs`): corrupt JSON + secure-store failure paths.
8. Bundle stays ≤ 30 KB gz (NFR-1).
9. Out-of-scope guarantees: no `Intl.*`, no `i18next-icu`, no `dayjs`, no `date-fns`, no `_zero`, no first-run picker.