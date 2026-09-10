# Design: App i18n — Multilingual UI (en / es-AR / pt-BR) + Locale-Aware Formatters

## Technical Approach

Three additive PRs ship a `i18next` v26 + `react-i18next` + `expo-localization` 17.x stack behind a thin custom detector and a small Zustand `useLocaleStore`. The hand-rolled `lib/format.ts` stays in place; PR 2 adds `locale` arguments as wrappers over the existing exports and PR 3 collapses the wrappers + duplicates into a single locale-aware surface. Currency formatting follows the **hybrid policy** (REQ-4, Engram 1217): the **currency code** drives number grouping/decimals AND symbol; the **UI locale** is read internally only for label/symbol-form variants — `formatCurrency(value, currencyCode)` takes no locale argument. `es-AR` is both the source of truth, the first-launch active language, and `fallbackLng`. The override persists in `expo-secure-store` under `ticketify.locale.override` and is decoupled from the server-side `profiles` row. No `Intl`, no `i18next-icu`, no `dayjs`, no `date-fns`, no Babel macros.

## Architecture Decisions

| # | Decision | Options | Choice | Rationale |
|---|----------|---------|--------|-----------|
| AD-1 | Where locale override lives | (a) New `useLocaleStore`; (b) extend `useSettingsStore` with `locale` + `setLocale` | **(a)** | Spec binding: "client-only persistence, decoupled from server `profiles`". `useSettingsStore` is the profile mirror (currency, household_sharing) — coupling locale to it would conflate two lifecycles (server-backed vs secure-store-only) and bloat the store with persistence code. A separate Zustand store stays ~40 LOC, mirrors the existing `useHouseholdStore` pattern, and lets `useLocaleStore.hydrate()` read the override before the secure-store adapter writes back without touching the profile row. |
| AD-2 | React vs module-level i18n | `useTranslation()` everywhere; `i18next.t()` everywhere; mixed | **Mixed (boundary per REQ-10)** | React components use `useTranslation()` (proper re-render subscription). Non-React module helpers — `MANUAL_ERROR_MESSAGES` (`src/features/tickets/manual-form.ts:24-34`), the 6 `READ_ERROR_MESSAGE` constants (`src/lib/supabase/feature-access.ts:46,512,564,567,595,599`), and `src/components/molecules/DatePickerField/calendar.ts` exports — call `i18next.t()` directly. They cannot host hooks; subscribing via the global `i18next` instance is the contract. |
| AD-3 | InsightHeroCard template | `<Trans values={...}>...</Trans>` JSX; `t('key', { weekday, day, amount, multiple })` interpolation | **`t()` interpolation** | i18next interpolation with named vars is type-safe via the module-augmentation `types.ts` (`t('insights.expensiveDay', { weekday, day, amount, multiple })`), produces smaller diffs (no JSX body rewrite), and matches the spec acceptance-gate examples. `<Trans>` is reserved for cases with embedded `<Link>` / `<Pressable>` children — none of the current ~6-10 plural strings qualify. |
| AD-4 | i18n.init timing | (a) In `<I18nProvider>`'s `useEffect`; (b) before `<I18nProvider>` mounts, in `_layout.tsx` directly | **(a)** | Provider `useEffect` runs once on mount and gates on `i18n.isInitialized` via `i18next.on('initialized', ...)`. Putting the init outside the provider splits boot ownership between two files (the layout owns the boot gate AND the i18n init, which couples them); keeping both inside `I18nProvider` keeps the gate and the init co-located. Trade-off: the boot fade-out fires from the layout's `useEffect` that watches `i18n.isInitialized` (a module-level event), so the layout subscribes to the same event the provider emits — clean. |
| AD-5 | `formatDateES` wrapper API for PR 2 | (a) Add `locale` arg, keep legacy call sites; (b) rewrite signature, force migration | **(a) wrapper** | `formatDateES(iso, todayISO)` is consumed by the picker trigger and the `DatePickerField` modal. PR 2 introduces `formatDate(locale, iso, opts?)` as the new canonical API; `formatDateES` becomes a one-liner that calls `formatDate('es-AR', iso, opts)`. Legacy call sites work unchanged. PR 3 removes `formatDateES` entirely once every call site has been migrated to `formatDate(locale, ...)`. Sketch: `export function formatDateES(iso: string, opts?: { todayISO?: string }): string { return formatDate('es-AR', iso, opts); }`. |
| AD-6 | `formatCurrency` signature for the hybrid policy | (a) `formatCurrency(value, currencyCode, locale)`; (b) `formatCurrency(value, currencyCode)` reading locale internally | **(b)** | Spec REQ-4 / Engram 1217 corrected text: "currency code is the formatting authority; the UI locale only changes the symbol form and auxiliary copy". The signature is `formatCurrency(value, currencyCode)`; locale is read internally via `i18next.language`. Classification table — `LATAM_CURRENCIES = new Set(['ARS','UYU','BRL','MXN','CLP','COP','PEN'])` always use `.` thousands + `,` decimals; `INTL_CURRENCIES = new Set(['USD','EUR','GBP','JPY','CAD','AUD'])` always use `,` thousands + `.` decimals; unknown codes fall back to international grouping (safer default — won't mislead a Brazilian seeing `1.234` as thousands when the locale was supposed to render `1,234`). Symbol forms live in a `CURRENCY_LOCALE_SYMBOL: Record<string, string>` lookup keyed by code (current set: `UYU: '$U'`, `USD: 'US$'`, `ARS: '$'`, `BRL: 'R$'`). The UI locale read is wired but no-op for these four — the API is in place for future expansion (e.g. JPY has `¥` / `￥` variants) without rewriting callers. |
| AD-7 | Plural key shape | i18next `_one` / `_other` suffix on same key (flat namespace); nested `subscription.daysRemaining: { one, other }` | **Suffix on same key** | i18next v26 default; the spec REQ-5 binding pins this. Example — `src/app/(tabs)/profile.tsx:197-199` becomes `t('subscription.daysRemaining', { count: daysRemaining })` with `subscription.daysRemaining_one: 'Queda 1 día'` and `subscription.daysRemaining_other: 'Quedan {{count}} días'` in each locale file. Zero uses `_zero` / `_two` / `_few` / `_many` (REQ-5). |
| AD-8 | i18n JSON file organization | Single `common.json` per locale; flat `locales/{en,es-AR,pt-BR}/{ns}.json` per namespace | **Per-namespace flat files** | Smaller diffs per PR (PR 2 adds `auth.json` / `tickets.json` independently), easier code review (one namespace = one concern), and Metro `resolveJsonModule` resolves each file as a typed import. The catalog maps to REQ-1: `common`, `auth`, `tabs`, `settings`, `tickets`, `receipts`, `household`, `analytics`, `errors`, `a11y`, `currency`. Naming: `src/i18n/locales/<locale>/<namespace>.json`. |
| AD-9 | BootSplash + i18n init order | Run init outside provider; run inside provider `useEffect`; race-free gate via `i18n.isInitialized` event | **Provider `useEffect` + layout subscribes to `initialized` event** | `_layout.tsx` adds `i18next.on('initialized', () => setBooted(true))`; the provider's `useEffect` calls `i18n.init({ resources, lng: detectedLocale, fallbackLng: 'es-AR', supportedLngs: ['en','es-AR','pt-BR'] })` exactly once. Failure path: `.catch` logs `console.warn` and falls back to `i18next.changeLanguage('es-AR')` — `setBooted(true)` fires either way; the app never crashes on corrupt JSON (REQ-6 / acceptance gate 10). Secure-store read failures follow the same pattern (log + use the detected locale). |
| AD-10 | Tests | jest/RTL setup; harness scripts (`scripts/test-*.mjs`); typecheck-only | **Harness scripts + typecheck** | Repo posture is `openspec/config.yaml: Testing: None configured`; `category-budgets` precedent uses harness scripts (test-features, test-category-budget-*, etc.). Three harnesses: `scripts/test-i18n-detector.mjs` (PR 1, 8 mapping cases from REQ-2 / NFR-4), `scripts/test-format-currency.mjs` (PR 2, 12 classification + format cases — USD/ARS/UYU/BRL/EUR/GBP/JPY/MXN/CAD/AUD + unknown code + zero value + negative value), `scripts/test-i18n-init.mjs` (PR 1, boot-failure path: corrupt JSON, secure-store read error → falls back to es-AR, `setBooted` still fires). |
| AD-11 | `Stack.Screen options.title` strategy | Set in root layout (current); per-screen `<Stack.Screen options={{ title }} />`; `useScreenTitle(key)` hook | **Per-screen + `useScreenTitle(key)` hook** | REQ-7 / proposal: root layout has no React context for `useTranslation()` without a wrapper. Per-screen titles inside each migrated screen file (`src/app/pro/charts.tsx`, `src/app/pro/index.tsx`, `src/app/receipts/[id].tsx`, drill-downs) plus a small `src/i18n/hooks/useScreenTitle.ts` that calls `useTranslation()` and returns `t(key)`. New screens use `useScreenTitle('namespace.title')`; the title stays reactive to locale change because `useTranslation` re-subscribes. Root layout's `<Stack.Screen name="pro/charts" options={{ title: 'Estadísticas Pro' }} />` is removed in PR 3 once the screen file owns its title. |
| AD-12 | PR-by-PR diff distribution | Flat 3-PR; split PR 2 into 2a+2b | **Flat 3-PR with budget bump** | PR 1 (~300-400 LOC) fits the 400 default. PR 2 (~2,000-2,800 LOC) and PR 3 (~1,500-2,000 LOC) need `review_budget_lines: 1000` per the binding table (consistent with the `category-budgets` precedent). Top files by estimated diff per PR: **PR 1** — `package.json` (~5), `src/app/_layout.tsx` (~+15/-4), `src/app/(tabs)/_layout.tsx` (~+10/-4), `src/i18n/config.ts` (~80 new), `src/i18n/detector.ts` (~30 new), `src/i18n/types.ts` (~25 new), `src/i18n/stores/useLocaleStore.ts` (~45 new), `src/i18n/storage/localeSecureStore.ts` (~30 new), `src/i18n/components/I18nProvider.tsx` (~50 new), `src/app/settings/language.tsx` (~110 new), `src/app/(tabs)/profile.tsx` (~+8/-2), `src/i18n/locales/*/common.json` (~120 total new). No file in PR 1 exceeds 200 LOC. **PR 2** — `src/features/auth/**` (~280), `src/lib/supabase/feature-access.ts` (~+30/-6), `src/lib/format.ts` (~+60 wrapper pass), `src/features/tickets/manual-form.ts` (~+15/-6), `src/features/household/**` (~+120/-40), `src/components/molecules/DatePickerField/calendar.ts` (~+40/-20), `src/app/(tabs)/profile.tsx` (~+120/-45), `src/app/(tabs)/history.tsx` (~+110/-44), `src/app/(tabs)/analytics.tsx` (~+120/-43), `src/app/settings/household.tsx` (~+90/-45). The PR 2 hot files (`features/auth/**`, `(tabs)/profile.tsx`) hit ~120 LOC of diff — flagged below for splitting into helper-extraction pre-passes if needed. **PR 3** — `src/app/pro/charts.tsx` (~+180/-70), `src/app/receipts/[id].tsx` (~+180/-70), `src/features/charts/components/{CategoryDonut,ChartLegend}.tsx` (~+20/-30 each — net deduplication), `src/lib/format.ts` (~+200/-80 — rewrite), `src/components/molecules/DatePickerField/calendar.ts` (~+30/-40), `src/app/pro/index.tsx` (~+50/-22), `src/app/categories/[key].tsx` (~+50/-16), `src/app/items/[name].tsx` (~+50/-8), `src/app/stores/[name].tsx` (~+50/-8), `src/features/analytics/**` (~+150/-100). `src/lib/format.ts` PR-3 rewrite touches ~280 LOC but most are deletes of the wrapper pass + consolidation of duplicated arrays — net 200 added lines. Flagged: if `src/lib/format.ts` diff exceeds 200 LOC, split the rewrite into two commits within PR 3 (consolidations first, then `formatDate` API rewrite). |

## Data Flow

```
Cold start
  └─ app/_layout.tsx mounts
       ├─ useSessionStore.restore()                          (existing)
       ├─ <I18nProvider> mounts (PR 1)                       ↓ first frame
       │    ├─ useLocaleStore.hydrate() reads secure-store   async
       │    │     └─ ticketify.locale.override = 'auto'      detected locale wins
       │    ├─ detectLocale() reads getLocales()[0].languageTag
       │    │     └─ 'pt-*' → 'pt-BR', 'en-*' → 'en',
       │    │        'es-AR' → 'es-AR', other → 'es-AR'
       │    └─ i18n.init({ lng: resolved, fallbackLng: 'es-AR',
       │                   supportedLngs: ['en','es-AR','pt-BR'],
       │                   resources: bundled JSON catalogs })
       │         ├─ on success → i18n.on('initialized') →
       │         │      setBooted(true) → BootSplash fades
       │         └─ on error  → console.warn + changeLanguage('es-AR')
       │                + setBooted(true) anyway → no crash
       │
       └─ Stack renders
            ├─ <Stack.Screen options={{ title }} /> inside each screen (REQ-7)
            │    └─ useScreenTitle('namespace.title') reads useTranslation()
            └─ (tabs)/_layout.tsx reads t('tabs.home|analytics|history|profile')

User taps "Português (Brasil)" in /settings/language
  └─ handleSelect('pt-BR')
       ├─ useLocaleStore.setLocale('pt-BR')
       │    └─ expo-secure-store write('ticketify.locale.override', 'pt-BR')
       ├─ i18next.changeLanguage('pt-BR')          synchronous
       └─ React re-renders all useTranslation() subscribers
            ├─ tab labels → 'Início / Analítica / Histórico / Perfil'
            ├─ <Stack.Screen options.title> → pt-BR title
            ├─ formatCurrency() reads i18n.language internally
            │    → symbol form lookup (no-op for our 4 codes today)
            └─ formatRelativeDay() reads i18n.language internally
                 → 'Hoje' / 'Ontem' / pt-BR short-month formatters

Module-level helper (e.g. feature-access.ts)
  └─ getReadErrorMessage(code)
       ├─ i18next.t(`errors.featureAccess.${code}`)   no hook
       └─ returns localized string at call time

Currency rendering per call (REPEAT for every formatCurrency call)
  └─ formatCurrency(value, currencyCode)
       ├─ locale = i18next.language                 internal, for labels only
       ├─ classification = LATAM_CURRENCIES.has(code)
       │                    ? LATAM_GROUPING
       │                    : INTL_GROUPING         (unknown → INTL safer default)
       ├─ symbol = CURRENCY_LOCALE_SYMBOL[code]     keyed by code, not locale
       └─ renders e.g. 'US$ 1,234.56' / '$U 1.234,56' / 'ARS 1.234,56'
              (number shape follows code; symbol follows code)
```

## File Changes (per-PR rollout)

### PR 1 — setup (≤ 400 LOC; fits default)
| File | Action | Description |
|------|--------|-------------|
| `package.json` + `pnpm-lock.yaml` | Modify | Add `i18next@^26`, `react-i18next@^16`, `expo-localization@~17` |
| `ios/Podfile.lock` | Modify (dev-machine) | `npx pod-install` after merge — documented in PR description |
| `src/i18n/config.ts` | Create | `i18next.init({ supportedLngs, fallbackLng: 'es-AR', resources, ns: [...] })` |
| `src/i18n/detector.ts` | Create | Pure `detectLocale(tag): 'en' | 'es-AR' | 'pt-BR'` mapping per REQ-2 |
| `src/i18n/types.ts` | Create | Module augmentation: `declare module 'i18next' { interface CustomTypeOptions { resources: Catalog } }` |
| `src/i18n/stores/useLocaleStore.ts` | Create | Zustand: `locale: string`, `override: 'auto' | 'en' | 'es-AR' | 'pt-BR'`, `setLocale()`, `hydrate()` |
| `src/i18n/storage/localeSecureStore.ts` | Create | Thin `expo-secure-store` adapter for `ticketify.locale.override` |
| `src/i18n/components/I18nProvider.tsx` | Create | Mounts `react-i18next`, runs `i18n.init()` once on mount |
| `src/i18n/hooks/useScreenTitle.ts` | Create | `t(key)` wrapper for `Stack.Screen options.title` (used from PR 2 onward) |
| `src/i18n/locales/en/common.json` + `es-AR/common.json` + `pt-BR/common.json` | Create | Minimal catalogs (`app.name`, `tabs.home|analytics|history|profile`, `common.ok|cancel|back|save|loading`) |
| `src/app/_layout.tsx` | Modify | Mount `<I18nProvider>`; subscribe to `i18n.on('initialized', setBooted)`; subscribe `useScreenTitle('pro.chartsTitle')` if PR 1 wires the wiring proof |
| `src/app/(tabs)/_layout.tsx` | Modify | Tab labels via `t('tabs.*')` — wiring proof for live locale switching |
| `src/app/settings/language.tsx` | Create | Language selector screen (4 options per REQ-3) — mirrors `src/app/settings/currency.tsx` |
| `src/app/(tabs)/profile.tsx` | Modify | Add "Idioma" row to `AccountSettingsList` |
| `scripts/test-i18n-detector.mjs` | Create | 8 mapping cases (NFR-4) |
| `scripts/test-i18n-init.mjs` | Create | Boot failure path (REQ-6 / NFR-4) |
| `package.json` test chain | Modify | Append `test:i18n-detector`, `test:i18n-init` |

### PR 2 — primary flow (≤ 1000 LOC; binding override)
| File | Action | Description |
|------|--------|-------------|
| `src/app/(auth)/sign-in.tsx` + `sign-up.tsx` + `forgot-password.tsx` + `reset-password.tsx` | Modify | All 4 forms → ~12 keys each from `auth.*` namespace |
| `src/app/(tabs)/index.tsx` + `history.tsx` + `analytics.tsx` + `profile.tsx` | Modify | Tabs primary surface → `tabs.*` / `home.*` / `analytics.*` / `profile.*` |
| `src/app/settings/profile-edit.tsx` + `budget.tsx` + `category-budgets.tsx` + `currency.tsx` + `household.tsx` + `export.tsx` | Modify | All settings screens; `currency.tsx` labels via `t('currency.*')` |
| `src/app/ticket/manual.tsx` + `ticket/review/[id].tsx` + `ticket/camera.tsx` | Modify | Ticket flow → `tickets.*` |
| `src/features/auth/**` + `src/features/budget/**` + `src/features/tickets/**` + `src/features/profile/**` + `src/features/household/**` + `src/features/pro/**` | Modify | Hooks / components used by the screens above |
| `src/lib/supabase/feature-access.ts` | Modify | 6 `READ_ERROR_MESSAGE`-style constants → `i18next.t('errors.featureAccess.*')` at call time |
| `src/features/tickets/manual-form.ts` | Modify | `MANUAL_ERROR_MESSAGES` map → `i18next.t('errors.manual.*')` at call time |
| `src/components/molecules/DatePickerField/{calendar.ts, DatePickerField.tsx}` | Modify | `MONTHS_FULL_ES_AR` / `MONTHS_ABBR_ES_AR` / `WEEKDAY_*` / `formatDateES` become wrapper calls into `formatDate('es-AR', ...)`; calendar reads `i18next.t()` directly for the new locale-aware variants |
| `src/components/organisms/{BudgetCard, ReceiptRow, CategoryCard, ProfileHeader, UsageMeter}/**` | Modify | Most-used organisms; `accessibilityLabel` per REQ-NFR-5 |
| `src/lib/format.ts` | Modify (wrapper pass) | Add `formatDate(locale, iso, opts?)`, `formatShortDate(locale, iso)`, `formatMonthFull(locale, month)`, `formatMonthAbbr(locale, month)`, `formatWeekday(locale, weekday, mondayFirst?)`, `formatRelativeDay(locale, iso, now?)`, `formatTime(locale, iso)`, `formatPercent(locale, value)`, `formatCurrency(value, currencyCode)` (locale read internally per AD-6). Existing `formatDateES` / `formatShortDate` / `formatYearMonth` / `formatTime` / `formatRelativeDay` / `formatCurrency` / `formatCurrencyWhole` keep their signatures as wrappers that call the new locale-aware variants with `'es-AR'` (or no-op for `formatCurrency` since it's already code-driven). |
| `src/i18n/locales/{en,es-AR,pt-BR}/{auth,settings,tickets,household,errors,a11y,currency}.json` | Create | Per-namespace catalogs |
| `scripts/test-format-currency.mjs` | Create | 12 classification + format cases (AD-10) |

### PR 3 — long tail + consolidations (≤ 1000 LOC; binding override)
| File | Action | Description |
|------|--------|-------------|
| `src/app/pro/charts.tsx` | Modify | Largest single hotspot (~70 raw strings → `charts.*` + `analytics.*` + `a11y.*`) |
| `src/app/pro/index.tsx` | Modify | Paywall copy (`pro.*`) |
| `src/app/receipts/[id].tsx` + `receipts/ReceiptCategoryItemsModal.tsx` | Modify | Receipt detail + items modal |
| `src/app/categories/[key].tsx` + `items/[name].tsx` + `stores/[name].tsx` | Modify | Drill-downs |
| `src/features/analytics/**` + `src/features/charts/**` + `src/features/items/**` + `src/features/export/**` | Modify | Feature components |
| `src/components/molecules/{AmountDisplay, EmptyState, FieldGroup, BootSplash, BottomSheet, Card, Chip, ListItem, ProgressBar, Skeletons}` | Modify | Generic UI primitives — only the labeled ones |
| `src/components/atoms/{Toast, Dialog, Badge}` | Modify | a11y labels |
| `src/features/charts/components/{CategoryDonut, ChartLegend}.tsx` | Modify | Drop the duplicated `CURRENCY_SYMBOLS` maps; consume shared `formatCurrency` from `lib/format.ts` |
| `src/lib/format.ts` | Modify (rewrite) | Drop the wrapper exports (`formatDateES` etc.); single canonical `formatDate(locale, iso, opts?)` API; consolidate `MONTHS_*_ES*` arrays onto the locale-aware data source |
| `src/components/molecules/DatePickerField/calendar.ts` | Modify | Drop `MONTHS_FULL_ES_AR` / `MONTHS_ABBR_ES_AR` arrays; consume `formatMonthFull` / `formatMonthAbbr` / `formatWeekday` from `lib/format.ts` |
| `src/app/settings/household.tsx` | Modify | Drop hardcoded ` (vos)` literal → `t('household.youSuffix')` per REQ-9 |
| `src/i18n/locales/{en,es-AR,pt-BR}/{pro,receipts,analytics,charts,items,export,household}.json` | Create | Long-tail namespace catalogs |
| `src/app/_layout.tsx` | Modify (PR 3 follow-up) | Remove the hardcoded `<Stack.Screen name="pro/charts" options={{ title: 'Estadísticas Pro' }} />` once `src/app/pro/charts.tsx` owns its title via `<Stack.Screen options={{ title: useScreenTitle('pro.chartsTitle') }} />` |

## Risks

| Risk | Severity | Mitigation | Caught by |
|------|----------|------------|-----------|
| BootSplash fade-out races `i18n.init()` — first frame shows raw keys | HIGH | `_layout.tsx` subscribes to `i18n.on('initialized', () => setBooted(true))`; failure path falls back to `es-AR` and still fires `setBooted(true)` (REQ-6) | PR 1 review + manual device matrix (Acceptance gate 9) |
| Non-React helpers (`MANUAL_ERROR_MESSAGES`, 6 `READ_ERROR_MESSAGE` consumers, `calendar.ts`) cannot use `useTranslation()` | MEDIUM | Direct `i18next.t()` per AD-2 / REQ-10; typecheck enforces no `useTranslation` import in those files | PR 2 review + grep `useTranslation` in module helpers |
| `Stack.Screen options.title` set at root layout has no `useTranslation()` context | MEDIUM | Move per-screen titles into each screen file via `<Stack.Screen options={{ title }} />`; add `useScreenTitle(key)` helper (AD-11); root layout deletes hardcoded `options={{ title: 'Estadísticas Pro' }}` in PR 3 | PR 3 review (Acceptance gate 2 + REQ-7) |
| First native dep (`expo-localization`) — devs must `npx pod-install` after PR 1 | MEDIUM | Document in PR 1 description; CI only runs `pnpm typecheck` (no native build); Android auto-links | PR 1 review + repo onboarding doc |
| `formatCurrency` consumers in Skia-rendered charts may break if symbol map shape changes | MEDIUM | PR 3 keeps `formatCurrency(value, currencyCode)` signature unchanged from PR 2; only the internal map consolidates; chart code calls the shared helper exactly the same way | PR 3 review (Acceptance gate 4) |
| Mixed data + copy templates (`InsightHeroCard.tsx:197` `weekday` + `day` + `amount` + `multiple`; `ReceiptRow.tsx:177` a11y with manual flag + name + date + amount; `CategoryBudgetRow.tsx:77-84` `amount` + `limit`) | MEDIUM | AD-3: `t('key', { ...named })` interpolation; module augmentation in `src/i18n/types.ts` keeps the call sites type-safe | PR 3 review |
| Toast messages captured at call time won't update if locale changes mid-toast | LOW | Acceptable for 2-3s toast lifetime — flag in PR 2 as known limitation; call sites compute strings at call time | PR 2 review |
| 33 existing harness scripts in `scripts/*.mjs` import `formatCurrency` / `formatDateES` | LOW | PR 2 wrapper pass keeps `formatCurrency` and `formatDateES` signatures unchanged; existing assertions still pass | PR 2 `pnpm test` chain green |
| en / pt-BR translations not natively reviewed by native speakers before PR 2 ships | MEDIUM | Ship best-effort translations; explicit "review before launch" note in PR description; locale files are easy to update post-merge (just JSON) | PR 2 review |
| Skia text rendering inside chart components depends on string length — pt-BR copy often 20-40% longer than en | LOW | Verify chart text container widths after PR 3; `TextShaper` already supports overflow elide | PR 3 manual device matrix |
| Two parallel month-name arrays drift over time | LOW | PR 3 consolidates onto `lib/format.ts` as the single source (`MONTHS_FULL_ES` and `MONTHS_ABBR_ES_AR` in `calendar.ts` deleted) | PR 3 review |
| Three duplicated currency maps drift over time | LOW | PR 3 consolidates onto `lib/format.ts`; `CategoryDonut.tsx` and `ChartLegend.tsx` consume shared `formatCurrency` (REQ-13 / Acceptance gate 1) | PR 3 review |
| `formatDateES` legacy call sites forgotten in PR 3 rewrite | LOW | `formatDateES` deleted only after `grep -rn 'formatDateES' src/` returns zero non-test hits; the harness `scripts/test-features.mjs` covers the consumer paths | PR 3 review + grep verify |
| Secure-store write fails when user toggles language (rare on Expo, but possible on locked devices) | LOW | `useLocaleStore.setLocale()` wraps the write in try/catch; on failure, log + keep the in-memory override (live UI update) — next cold start falls back to secure-store | PR 1 review |
| `pnpm typecheck` regression from module-augmentation typo in `src/i18n/types.ts` | LOW | All three PRs run `pnpm typecheck` in CI; module-augmentation lands in PR 1 with a smoke-test for `t('tabs.home')` resolving typed | PR 1 CI |

## Migration / Rollout

**PR 1 — Setup.** Additive only. The wiring proof is the tab labels (`(tabs)/_layout.tsx`) — pick a locale in `Settings → Idioma`, watch the four labels swap live, no restart. The boot caption uses `t('app.name')` (or `t('common.loading')`) so the first frame proves `i18n.isInitialized` fired before `setBooted(true)`. The `useLocaleStore` reads `expo-secure-store` on hydrate; `I18nProvider` calls `i18n.init()` in a `useEffect`; the layout subscribes to the `initialized` event and gates `setBooted`. Failure paths log and fall back to `es-AR`. No screen copy changes — every existing string stays hardcoded in this PR.

**PR 2 — Primary flow.** Add the per-namespace locale files (`auth`, `settings`, `tickets`, `errors`, `a11y`, `currency`, `household`). Migrate every screen in the primary flow (auth → tabs → settings → ticket) and every helper they depend on. `lib/format.ts` gains the locale-aware API as wrappers over the existing exports; `formatDateES(iso, todayISO)` becomes a one-liner that calls `formatDate('es-AR', iso, { todayISO })`. Module-level helpers (`MANUAL_ERROR_MESSAGES`, the 6 `READ_ERROR_MESSAGE` constants, `calendar.ts` exports) switch to direct `i18next.t()`. Existing call sites of `formatCurrency` / `formatDateES` / `formatShortDate` keep working unchanged. Per-screen `<Stack.Screen options={{ title }} />` blocks land in each migrated screen file. The `currency.tsx` selector switches to `t('currency.*')` for labels. The ` (vos)` literal stays hardcoded for one more PR. No third-party review pass assumed — translations ship best-effort.

**PR 3 — Long tail + consolidations.** Migrate `pro/charts.tsx`, `receipts/[id].tsx`, drill-downs, and the feature folders. Consolidate the three currency maps (`CategoryDonut`, `ChartLegend`, `format.ts`) onto a single `formatCurrency` in `lib/format.ts`. Consolidate the two parallel month arrays (`format.ts` + `calendar.ts`) onto a single locale-aware source. Rewrite `formatDateES` away — every call site now reads `formatDate(locale, iso, opts?)`. The hardcoded ` (vos)` suffix becomes `t('household.youSuffix')`. The root layout's `<Stack.Screen name="pro/charts" options={{ title: 'Estadísticas Pro' }} />` is removed once the screen owns the title. The diff is mostly deletes of the wrapper exports and the duplicated arrays plus additions of the long-tail catalog files.

All three PRs are independently revertible. None touch `supabase/migrations/`, `profiles.*` columns, RPCs, or auth flows. The bundle stays ≤ 30 KB gz (NFR-1). `pnpm typecheck` passes after every PR. The boot fade-out gates on `i18n.isInitialized` so no raw-key flash ships.

## Test Plan

| Harness | PR | Cases |
|---|---|---|
| `scripts/test-i18n-detector.mjs` | PR 1 | REQ-2 / NFR-4: `es-AR → 'es-AR'`, `pt-BR → 'pt-BR'`, `pt-PT → 'pt-BR'`, `en-US → 'en'`, `en-GB → 'en'`, `es-MX → 'es-AR'`, `fr-FR → 'es-AR'`, empty array → `'es-AR'` |
| `scripts/test-i18n-init.mjs` | PR 1 | REQ-6: corrupt JSON → console.warn logged + `i18n.changeLanguage('es-AR')` + `setBooted(true)` fires; secure-store read error → falls back to detected locale + `setBooted(true)` fires |
| `scripts/test-format-currency.mjs` | PR 2 | REQ-4: USD/ARS/UYU/BRL/EUR/GBP/JPY/MXN/CAD/AUD × LATAM vs INTL classification × zero/negative values × unknown code falls back to INTL grouping |
| `pnpm typecheck` | every PR | Module-augmentation `t('tabs.home')` resolves typed in PR 1; full repo typecheck passes in PR 2 and PR 3 |
| Manual device matrix | PR 1 | es-AR / pt-BR / en / fr (fallback) simulators; settings selector live-switches; manual override persists across cold start; offline launch works (NFR-6) |
| Manual device matrix | PR 2 | Primary flow walks clean in all three locales — no raw keys (`home.title`, `auth.signIn`) visible anywhere; user-safe Supabase errors render in active locale; DatePickerField opens with locale-correct month + weekday labels |
| Manual device matrix | PR 3 | Pro charts + receipts + drill-downs render in all three locales; chart text doesn't overflow on pt-BR (longer copy); `formatDateES` callers all migrated; currency labels correct per locale |
| a11y smoke | PR 2 / PR 3 | VoiceOver / TalkBack reads localized `accessibilityLabel` on `ReceiptRow`, `ItemDetail`, `ChartLegendItem` |

## No-Goals

- No gender selectors (REQ-binding).
- No backend strings (none exist).
- No locales beyond en / es-AR / pt-BR.
- No RTL.
- No `dayjs` / `date-fns` / `Intl` / `i18next-icu`.
- No server-side locale-aware RPCs.
- No `profiles.locale` column.
- No first-run onboarding language picker.
- No change to the `UYU` default currency.
- No toast capture pattern change (toasts already compute strings at call time).
- No `useDialogStore` shape change.

## Open Questions

- [x] AD-6 reconciles the spec REQ-4 corrected text (Engram 1217) with the binding table's "(locale) reads internally only for label choices" — the implementation reads `i18next.language` inside `formatCurrency` and passes through a code-keyed symbol map. For our 4 supported currencies (UYU/USD/ARS/BRL) the symbol form is the same in all three locales today; the API stays forward-compatible.
- [x] AD-12 splits `src/lib/format.ts` PR-3 rewrite into two commits within PR 3 if diff > 200 LOC (consolidations first, then `formatDate` API rewrite). Flagged for the apply phase.
- [x] `pnpm-lock.yaml` regeneration happens automatically; no manual `npx pod-install` step in CI (CI only typechecks).