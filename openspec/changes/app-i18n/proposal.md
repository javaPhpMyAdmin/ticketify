# Proposal: App i18n — Multilingual UI (en/es-AR/pt-BR) + Locale-Aware Formatters

## Intent

Ticketify mobile is **100% Rioplatense Spanish (voseo) today** — every literal in every screen, every accessibility label, every validation message, every user-safe error message from Supabase flows. The locale layer is fully hand-rolled (`src/lib/format.ts`, `DatePickerField/calendar.ts`) with three duplicated currency maps and zero `Intl` / `dayjs` / `expo-localization`.

To grow into new markets (Brazil, Spanish-speaking LATAM beyond es-AR, generic English for any other region) the app needs real multilingual support **without breaking the existing es-AR experience**. The migration is also a forcing function for two latent cleanups: the three duplicated currency-format maps and the duplicated month/weekday arrays across `format.ts` and `calendar.ts`.

This change introduces i18next (v26) + `react-i18next` + `expo-localization` (the project's first native dependency), ships three locales (`en`, `es-AR`, `pt-BR`), a language selector in Settings with a manual override persisted in `expo-secure-store`, and locale-aware formatters for dates / months / relative-day / weekdays. `es-AR` stays the source of truth and the fallback; `pt-BR` and `en` ship with full feature parity but smaller plural coverage (`_one` / `_other` only — no ICU).

## Scope

### In Scope

- UI copy for all three locales across the entire `src/app/**` and `src/features/**` surface (~900-1,100 unique strings, ~120 files).
- Locale-aware formatters: dates, months (short + full), weekdays, relative-day (`Hoy` / `Ayer`), time meridiem (`a. m.` / `p. m.`), percentages.
- Currency formatting keeps the **hybrid policy**: language drives strings/labels, currency code drives number grouping/decimals/symbol. `formatCurrency` stays independent of `i18next.language` — the **currency code is the formatting authority**. LATAM currencies (`ARS`/`UYU`/`BRL`/`MXN`) always render with `.` thousands + `,` decimals; international currencies (`USD`/`EUR`/`GBP`) always render with `,` thousands + `.` decimals. The UI locale only changes the symbol form (e.g. `US$` vs `$US`) and any auxiliary copy.
- Pluralization via i18next's CLDR `_one` / `_other` suffix keys — no `i18next-icu`. Used in ~6-10 strings (day counts, item counts, "Quedan N días", etc.).
- Language selector in Settings (mirrors `currency.tsx` shape) with a "Automático (es-AR)" option plus three explicit locale picks.
- Device locale detection via `expo-localization.getLocales()[0].languageTag` + detector mapping (`pt-*` → `pt-BR`, `en-*` → `en`, anything else → `es-AR` fallback).
- Manual override persistence in `expo-secure-store` (client-only; not coupled to the server-side `profiles` row).
- Currency labels (`Peso uruguayo`, `Dólar estadounidense`, etc.) become i18n keys — not duplicated across locale files.
- Voseo-specific copy (e.g. ` (vos)` suffix in household list) becomes a translation key so pt-BR and en get native equivalents.

### Out of Scope

- Grammatical-gender-aware selectors (no `t('greeting', { gender })` — es-AR copy is voseo-only; pt-BR and en are gender-neutral in our surface copy).
- Backend strings: there are none in this app. All copy is client-rendered.
- Locales beyond en / es-AR / pt-BR. (Adding a fourth locale is a one-line `supportedLngs` push once the key catalog is dense enough.)
- Right-to-left languages (Arabic / Hebrew). i18next supports `dir` per locale natively if needed later — not now.
- `dayjs` / `date-fns` adoption. Hand-rolled `format.ts` (205 LOC) stays.
- Default currency change. `UYU` stays the default regardless of UI language.
- Server-side locale-aware RPCs. The Postgres layer is locale-agnostic and untouched.
- First-run onboarding language picker. The first launch uses device locale; users discover the selector in Settings.
- Backend `profiles.locale` column. Manual override is client-only via `expo-secure-store`.

## Capabilities

### New Capabilities

- `app-i18n`: locale-aware UI copy and formatters (en / es-AR / pt-BR), language selector in Settings, device locale detection, manual override persistence, CLDR `_one` / `_other` plurals.

### Modified Capabilities

- None. The change is purely client-side string extraction. No existing capability's spec-level behavior changes — `data-access`, `household-sharing`, `category-budgets`, `monthly-run-rate`, `home-month-navigation`, `profile-sync`, and the rest remain source-of-truth identical at the requirement level. Their code may read from i18n for copy, but the requirements (e.g. "show monthly budget progress") are unchanged.

## Decisions

| Decision | Value |
|---|---|
| Scope | UI copy + formatters (dates/numbers/currency) + pluralization. NO grammatical-gender selectors. |
| Locales | `en` (generic), `es-AR` (default + source of truth + fallback), `pt-BR` |
| Locale detection | `expo-localization` device locale + manual override in Settings; fallback `es-AR` |
| Migration shape | 3 PRs incremental (PR 1 setup → PR 2 primary flow → PR 3 long tail + consolidations) |
| Review budget | `review_budget_lines: 1000` for PR 2 and PR 3 (override of preflight 600); PR 1 fits the 400 default |
| Library | `i18next` v26 + `react-i18next` + `expo-localization` 17.x — no FormatJS, no LinguiJS, no `i18next-icu` |
| Currency format vs language | Hybrid: language drives strings/labels; currency code drives number grouping/decimals; `formatCurrency` stays independent of `i18next.language` |
| `formatDateES` / `formatRelativeDay` / `formatTime` | Wrapper pass in PR 2 (add `locale` arg, keep legacy call sites working); rewrite/clean-state in PR 3 |
| `dayjs` | No — hand-rolled 205 LOC stays |
| Plural categories | i18next built-in `_one` / `_other` CLDR suffix — no `i18next-icu` plugin |
| Fallback chain | `supportedLngs: ['en','es-AR','pt-BR']`, `fallbackLng: 'es-AR'`; detector maps `pt-*` → `pt-BR`, `en-*` → `en`, anything else → `es-AR` |
| Manual override persistence | `expo-secure-store` (client-only, decoupled from `profiles` row) |
| Voseo + currency labels | i18n keys (`t('household.youSuffix')`, `t('currency.UYU')`, etc.) |
| Default currency code | `UYU` stays — currency is independent of language |
| Repo conventions | Conventional commits in Spanish, no `Co-Authored-By`; UI copy is Rioplatense Spanish (voseo) for the `es-AR` tree; PR body uses `Closes #N`, no `type:*` labels |
| First-run behavior | No language picker on first launch. Device locale wins, manual override available in Settings. |

## Approach

**Three PRs, additive, low risk per PR.** Each PR is self-contained: PR 1 wires the provider without migrating screens; PR 2 migrates the primary flow; PR 3 finishes the long tail and consolidates the locale plumbing. The library stack is `i18next` v26 (no `Intl`, no polyfills, no Babel macros — pure JS, ~10 KB gz) + `react-i18next` (~3 KB gz) + a thin custom detector (~25 LOC) backed by `expo-localization` 17.x. No `i18next-react-native-language-detector` — we read `getLocales()[0].languageTag` directly, which is the Expo-canonical source.

PR 1 ships a "wiring proof": boot caption or tab labels react to locale changes live. PR 2 is the user's main journey (auth + tabs + settings + ticket flow + `feature-access.ts` error messages + `DatePickerField`). PR 3 finishes `pro/charts`, `receipts/[id]`, drill-downs, the duplicate currency maps, the duplicate month arrays, and the voseo-specific copy. Formatter consolidation is wrapped in PR 2 (legacy `formatDateES` keeps working) and rewritten in PR 3 (single locale-aware `formatDate`).

The codebase deliberately avoids `Intl` (`format.ts:1-7` calls out Hermes inconsistency). This change **continues that stance** — i18next's `_one`/`_other` suffix scheme is CLDR-conformant without depending on `Intl.PluralRules`.

## PR breakdown

| PR | Scope | Lines (est.) | Files (est.) | Budget | Biggest risk per PR |
|---|---|---|---|---|---|
| **PR 1 — Setup** | deps install, `src/i18n/{config,detector,types}.ts`, three minimal `common.json` locale files, `useLocaleStore` (Zustand) + `expo-secure-store` adapter, `<I18nProvider>` in `_layout.tsx`, `language.tsx` settings screen, "Idioma" row in `profile.tsx`, tab labels + boot caption as wiring proof | ~300-400 | 12-15 (8 new) | fits 400 default | `i18n.init()` race against BootSplash fade-out — gate `setBooted(true)` on `i18n.isInitialized` |
| **PR 2 — Primary flow** | auth + tabs + settings + ticket flow + `features/*` hooks + `feature-access.ts` error messages + `DatePickerField` (`calendar.ts` exports become locale-aware via direct `i18next.t()`); `formatDateES` becomes a wrapper that accepts `locale` | ~2,000-2,800 | 40-50 | 1000 (binding override) | Non-React helpers (`MANUAL_ERROR_MESSAGES`, `READ_ERROR_MESSAGE` consumers) must use `i18next.t()` directly — not `useTranslation()`; `Stack.Screen options.title` lives in screen files, not root layout |
| **PR 3 — Long tail + consolidations** | `pro/charts.tsx`, `receipts/[id]`, drill-downs, feature components, 3× currency map consolidation onto single `formatCurrency` helper, `MONTHS_SHORT_ES` / `MONTHS_FULL_ES` + `MONTHS_ABBR_ES_AR` / `MONTHS_FULL_ES_AR` consolidation, voseo suffix key, `formatDateES` rewrite to clean state | ~1,500-2,000 | 30-40 | 1000 (binding override) | Skia-rendered chart text (`CategoryDonut`, `ChartLegend`) must keep working after the currency-map consolidation; mixed data+copy templates like `InsightHeroCard.tsx:197` need careful interpolation |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/i18n/**` | New | `config.ts`, `detector.ts`, `types.ts`, `stores/useLocaleStore.ts` |
| `src/i18n/locales/{en,es-AR,pt-BR}/**` | New | nested JSON catalogs, one file per namespace (`common.json`, `auth.json`, `tabs.json`, `settings.json`, `tickets.json`, `receipts.json`, `household.json`, `analytics.json`, `errors.json`, `a11y.json`) |
| `src/app/_layout.tsx` | Modified | mount `<I18nProvider>`, gate boot fade-out on `i18n.isInitialized` |
| `src/app/(tabs)/_layout.tsx` | Modified | tab labels via `t('tabs.*')` |
| `src/app/settings/language.tsx` | New | language selector screen |
| `src/app/(tabs)/profile.tsx` | Modified | "Idioma" row in `AccountSettingsList` |
| `src/lib/format.ts` | Modified (PR 2 wrapper, PR 3 rewrite) | `formatCurrency`/`formatCurrencyWhole` independent of language; `MONTHS_*_ES` arrays become locale-keyed; `formatDateES` → `formatDate(locale, iso)` |
| `src/components/molecules/DatePickerField/calendar.ts` | Modified | `MONTHS_FULL_ES_AR`/`MONTHS_ABBR_ES_AR`/`WEEKDAY_*`/`formatDateES` read from `i18next.t()` directly (non-React module) |
| `src/lib/supabase/feature-access.ts` | Modified | 6 user-safe error messages (`READ_ERROR_MESSAGE`-style constants) become `t('errors.*')` calls inside the function |
| `src/features/tickets/manual-form.ts` | Modified | `MANUAL_ERROR_MESSAGES` map (6 entries) reads via `i18next.t()` at call time |
| `src/features/charts/components/{CategoryDonut,ChartLegend}.tsx` | Modified (PR 3) | drop duplicated currency map; consume shared `formatCurrency` |
| `src/app/settings/currency.tsx` | Modified | currency labels via `t('currency.*')` |
| `src/features/household/**` | Modified | voseo ` (vos)` suffix → `t('household.youSuffix')` |
| `src/app/pro/charts.tsx`, `src/app/receipts/[id].tsx`, `src/app/categories/[key].tsx`, `src/app/items/[name].tsx`, `src/app/stores/[name].tsx` | Modified (PR 3) | full string extraction |
| All other `src/app/**` and `src/features/**` screens | Modified (PR 2 or PR 3) | string extraction per PR breakdown |
| `package.json` | Modified | add `i18next` ^26, `react-i18next` ^16, `expo-localization` ~17 |
| `ios/Podfile.lock` | Modified | first native dep — devs run `npx pod-install` after PR 1 merges |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| BootSplash fade-out races `i18n.init()` — first frame shows raw keys | HIGH | Gate `setBooted(true)` on `i18n.isInitialized` in `_layout.tsx`; PR 1 verification on real device |
| Non-React helpers (`MANUAL_ERROR_MESSAGES`, `READ_ERROR_MESSAGE` consumers, `calendar.ts` exports) cannot use `useTranslation()` — must call `i18next.t()` directly | MEDIUM | Use direct `i18next.t()` in module-level helpers; `useTranslation()` only inside React components |
| `Stack.Screen options.title` set at root layout doesn't have access to `useTranslation()` without context plumbing | MEDIUM | Move per-screen title to a `<Stack.Screen options={{ title }} />` inside each screen component (PR 2) |
| First native dep (`expo-localization`) — devs must run `npx pod-install` after PR 1; CI may not have iOS pods cached | MEDIUM | Document in PR 1 description; CI already runs `pnpm typecheck` (no native build); Android auto-links |
| `formatCurrency` consumers (`CategoryDonut`, `ChartLegend`, every chart with Skia text) may break if we change the symbol map shape | MEDIUM | PR 3 keeps the same return type (`string`) and same `lib/format.ts` exports; only the internal map consolidates |
| Mixed data+copy templates like `InsightHeroCard.tsx:197` (multiple interpolations + plural + currency) and `ReceiptRow.tsx:177` (a11y label with manual flag + name + date + amount) | MEDIUM | Use i18next interpolation with named vars; design phase confirms the template shape |
| Toast messages captured at call time won't update if locale changes mid-toast | LOW | Acceptable for 2-3s toast lifetime; flag as known limitation; design phase confirms |
| Test posture stays typecheck-only — i18n wiring has no test coverage | LOW | Add `scripts/test-i18n-detector.mjs` for the detector mapping (pure function, 5-10 assertions); React wiring stays manual device verification |
| `useDialogStore.show({title, message, primaryLabel, secondaryLabel})` strings captured at call time — same as toasts | LOW | All callers compute strings at call time, correct under i18next model |
| 33 existing test scripts (`scripts/*.mjs`) may import from `lib/format.ts` — PR 1 must not break them | LOW | `formatCurrency` / `formatCurrencyWhole` signatures unchanged; only the month-name exports get a sibling set |
| en / pt-BR translations not natively reviewed by native speakers before PR 2 ships | MEDIUM | Ship best-effort translations with explicit "review before launch" note in PR description; user accepts the review window |
| Skia text rendering inside chart components depends on string length — es-AR copy is often 20-40% longer than en, may overflow | LOW | Verify chart text container widths after PR 3; `TextShaper` layout already supports overflow elide |
| Two parallel month-name arrays (`MONTHS_SHORT_ES` in `format.ts` + `MONTHS_ABBR_ES_AR` in `calendar.ts`) drift over time | LOW | PR 3 consolidates onto one locale-aware source |
| Three duplicated currency maps (`format.ts`, `CategoryDonut.tsx`, `ChartLegend.tsx`) drift over time | LOW | PR 3 consolidates onto `lib/format.ts`; charts consume shared helper |

## Test plan

No new test harness. The project stays typecheck + manual device verification (consistent with the `category-budgets` precedent and `openspec/config.yaml`).

- **PR 1 verification (manual device matrix):**
  - iOS simulator, language set to Spanish (Argentina): app launches in es-AR, tab labels render `Inicio / Analítica / Historial / Perfil`, boot caption renders in es-AR.
  - iOS simulator, language set to Portuguese (Brazil): app launches in pt-BR, tab labels render `Início / Analítica / Histórico / Perfil`.
  - iOS simulator, language set to English (US): app launches in en, tab labels render `Home / Analytics / History / Profile`.
  - iOS simulator, language set to French: detector maps unknown locale → `es-AR` fallback.
  - Open Settings → Idioma, switch between `Automático (es-AR)`, `English`, `Español (Argentina)`, `Português (Brasil)`. Tab labels update live without app restart.
  - Kill + relaunch app. Manual override persists (last-selected language wins).
  - Disable network → relaunch. Locale JSON files bundle via Metro; works offline.

- **PR 2/3 verification (manual device matrix):**
  - Walk the primary flow in each locale: sign-in → home → manual entry → review → analytics → settings → language selector. No English keys (`home.title`) visible anywhere.
  - Walk the pro flow in each locale: paywall → charts → drill-downs.
  - a11y: VoiceOver (iOS) / TalkBack (Android) reads the localized accessibilityLabel on ReceiptRow, ItemDetail, ChartLegendItem.
  - Pluralization: pick a trial-expiry flow with `daysRemaining = 1` and `daysRemaining = 5`. Verify en uses `1 day` / `5 days`, es-AR uses `1 día` / `5 días`, pt-BR uses `1 dia` / `5 dias`.
  - Date formatting: pick a date in February 2027. Verify `formatShortDate` renders correctly per locale.

- **Typecheck gates every PR:** `pnpm typecheck` must pass.

- **Detector unit test (PR 1):** add `scripts/test-i18n-detector.mjs` covering the 6-8 mapping cases (`pt-BR` → `pt-BR`, `pt-PT` → `pt-BR`, `en-US` → `en`, `en-GB` → `en`, `es-AR` → `es-AR`, `es-MX` → `es-AR`, `fr-FR` → `es-AR`, empty → `es-AR`).

## Rollback plan

- **PR 1:** fully revertible. PR 1 is additive — install deps, add `src/i18n/`, add `<I18nProvider>` wrapper, add language selector screen. Revert the commit. No existing screen is touched. The boot fade-out gating reverts to the original behavior. The boot caption or tab labels revert to the existing hardcoded Spanish literals.
- **PR 2:** mechanical text replacement per file. Revert = revert the commit. No schema change, no migration, no data loss. The hand-rolled `format.ts` wrappers keep the legacy `formatDateES` export working, so reverting PR 2 doesn't break PR 1.
- **PR 3:** mechanical text replacement + currency map consolidation + month-array consolidation + `formatDateES` rewrite. Revert = revert the commit. The currency-map consolidation touches `CategoryDonut.tsx` and `ChartLegend.tsx` (Skia-rendered) — if the revert is needed, the duplicated maps return and `lib/format.ts` returns to its pre-PR-3 shape.

All three PRs are independently revertible. None of them touch `supabase/migrations/`, `profiles.*` columns, RPCs, or auth flows.

## Dependencies

- `i18next` ^26.4 (zero runtime deps, ~10 KB gz, MIT)
- `react-i18next` ^16.x (~3 KB gz, MIT)
- `expo-localization` ~17.x (Expo SDK 54 compatible, native dep — first in this project)
- `expo-secure-store` (already in `package.json` — manual override persistence reuses it)
- `npx pod-install` (iOS only, devs run once after PR 1 merges)

No backend dependencies. No new Postgres migrations. No `profiles` schema change. No new RPCs.

## Open questions for design

1. **`expo-secure-store` key name** — propose `ticketify.locale.override` (string `'auto' | 'en' | 'es-AR' | 'pt-BR'`). Confirm naming convention with existing storage adapter keys.
2. **First-run welcome copy** — should the welcome screen (if any in `auth/sign-up`) greet in device locale or default to es-AR? Design phase confirms.
3. **"Automático (es-AR)" selector label** — should the auto label read literally "Automático (es-AR)" in es-AR (transparent about the fallback) or just "Automático" (locale-agnostic)? Recommend literal because the user is picking languages and deserves to know the fallback.
4. **The ` (vos)` suffix in pt-BR** — Rioplatense voseo uses " (vos)". pt-BR has no equivalent suffix; recommend ` (você)` for pt-BR or just drop the suffix entirely for non-es-AR locales. Design phase confirms.
5. **`InsightHeroCard.tsx:197` template shape** — ``Tu día más caro fue el ${weekday} ${day} (${formatCurrency(...)} · ${multiple}x tu promedio)`` needs the full template as a single key with named interpolation variables (`weekday`, `day`, `amount`, `multiple`). Confirm template shape (one key vs split into two).
6. **Currency label translations** — "Peso uruguayo" / "Uruguayan peso" / "Peso uruguaio". Design phase confirms pt-BR wording.
7. **`(tabs)/profile.tsx:197-199` plural key** — `daysRemaining === 1 ? 'Queda 1 día' : `Quedan ${daysRemaining} días`` becomes `t('subscription.daysRemaining', { count: daysRemaining })` with `_one` / `_other` variants. Confirm key naming convention (flat vs nested).
8. **Test posture for `scripts/test-features.mjs`** — this test runner (if still in use) reads `formatCurrency` outputs. PR 1 must keep its signature. Confirm test runner is still active.
9. **`daysRemaining === 0` edge case** — pt-BR and en both use `0 days` / `0 dias`. i18next `_other` suffix covers it. Confirm no separate `_zero` key needed.
10. **`react-i18next` Trans component vs `t()` calls** — for the InsightHeroCard template, use `t('insights.expensiveDay', { ... })` interpolation OR `<Trans values={{...}}>template</Trans>` JSX? Design phase picks the cleaner pattern.

## Success Criteria

- [ ] Three locales ship with feature-parity strings for the primary flow: en, es-AR, pt-BR.
- [ ] Device locale detected automatically on first launch; falls back to es-AR for any unsupported locale.
- [ ] Manual override in Settings persists across app restarts via `expo-secure-store`.
- [ ] All currency formatting stays locale-aware (language drives strings/labels; currency code drives number grouping/decimals); no `Intl` introduced.
- [ ] Pluralization works for the ~6-10 plural strings (`Quedan N días`, item counts, day counts) with i18next `_one` / `_other` suffix keys — no ICU plugin.
- [ ] `formatDate` / `formatShortDate` / `formatTime` / `formatRelativeDay` render correctly per locale across all three (en uses `Today / Yesterday / Jan 12, 2027 / 02:30 PM`; es-AR uses `Hoy / Ayer / 12 ene 2027 / 02:30 p. m.`; pt-BR uses `Hoje / Ontem / 12 de jan. de 2027 / 14:30`).
- [ ] Currency-map duplication eliminated (PR 3): `CategoryDonut.tsx` and `ChartLegend.tsx` consume shared `formatCurrency` from `lib/format.ts`.
- [ ] Month-array duplication eliminated (PR 3): single locale-aware source for `MONTHS_FULL_*` / `MONTHS_ABBR_*` / `WEEKDAY_*`.
- [ ] Voseo suffix ` (vos)` → `t('household.youSuffix')` with ` (você)` for pt-BR and ` (you)` for en.
- [ ] `pnpm typecheck` passes after each PR.
- [ ] All three PRs review under `review_budget_lines: 1000` (PR 1 under 400 default).
- [ ] Boot fade-out gates on `i18n.isInitialized` — no raw-key flash on cold start.
- [ ] iOS devs run `npx pod-install` once after PR 1; documented in PR description.