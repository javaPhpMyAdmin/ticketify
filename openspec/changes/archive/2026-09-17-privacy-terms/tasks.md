# Tasks: Privacy Policy + T&C (`privacy-terms`)

> **Status**: success · **Artifact store**: both (this document + Engram `sdd/privacy-terms/tasks`) · **Change**: `privacy-terms` · **Phase**: tasks — ordered, TDD-sequenced implementation tasks for `sdd-apply`.
> **Cross-refs**: spec `openspec/specs/legal-links/spec.md` (REQ-1..REQ-7), design `openspec/changes/privacy-terms/design.md` (AD-1..AD-7). Source: design.

## Intent

Decompose the `legal-links` design into 11 concrete, test-first tasks grouped in the 3 locked work units (WU-1 lib+contracts ~150 lines; WU-2 i18n+Settings Legal group ~160; WU-3 sign-up footer+wiring ~60; ~370 total across 14 files). One small single PR to `main`; every WU is a standalone commit with its own verification and reversible rollback.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~370 (WU-1 ~150 · WU-2 ~160 · WU-3 ~60) |
| Files touched | 14 (2 new libs, 2 screens, 6 catalogs, 1 new harness, 1 new test tsconfig, 1 stub, 1 `package.json`) |
| 400-line budget risk | **Low** |
| Chained PRs recommended | **No** |
| Suggested split | Single PR `feat/legal-links`, 3 sequential WU commits |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low
```

~370 changed lines is well under the 400-line review budget and the 800-line session budget. No size exception, no chain. **No `Decision needed before apply`** — the design resolved all open questions (AD-1..AD-7); the `example.com` placeholder swap is a user-owned release gate (REQ-7), not an apply-phase code decision.

### Suggested Work Units

| Unit | Goal | Commit | Depends on |
|------|------|--------|------------|
| 1 | Opener + locale-aware URL map libs with contract harness (sections 1–3) | `feat(lib): … (WU-1)` | — |
| 2 | i18n keys (6 catalogs) + Settings Legal group | `feat(i18n): … (WU-2)` | WU-1 |
| 3 | Sign-up footer legal links + `test:legal-links` chain wiring | `feat(auth)+chore(test) (WU-3)` | WU-2 |

---

## WU-1 — Lib layer + contracts

Base: `main`. Smallest slice — puts the opener and URL map in place with the harness that everything downstream verifies against. Covers REQ-1, REQ-2, REQ-6 (partial), REQ-7 (placeholder markers), AD-1, AD-5, AD-7.

> **Standalone test command for this WU**: the harness is not yet wired into `package.json` (that is WU-3) — run `node scripts/test-legal-links.mjs` directly. Regression gate: `pnpm test:auth`.

- [x] **T-1.1 (WU-1) — Extend `scripts/test-stubs/web-browser.ts` additively.** Add `openBrowserAsync(url: string): Promise<{ type: 'opened' }>` that records the URL into a module-local variable, plus `__getLastOpenedUrl(): string | null`. Do NOT touch `StubWebBrowserResult`, `__setNextBrowserResult`, `openAuthSessionAsync`, or `maybeCompleteAuthSession` (used by test-auth.mjs). **TDD/test**: regression first — `pnpm test:auth` must stay green with the additive exports (stub typechecks against the auth tsconfig). **Done =** `pnpm test:auth` exits 0, `__getLastOpenedUrl()` returns `null` before any call and the recorded URL after `openBrowserAsync`. **Depends on**: none.

- [x] **T-1.2 (WU-1) — Create `scripts/tsconfig.legal-links-test.json`.** Mirror `tsconfig.auth-test.json` (module commonjs, strict, `baseUrl: ".."`, paths `expo-web-browser` → `./scripts/test-stubs/web-browser.ts`, `@/*` → `./src/*`). Include: `../src/lib/open-external-url.ts`, `../src/lib/legal-urls.ts`, `../src/i18n/detector.ts` (transitive import of `legal-urls.ts` — MUST be in the include list or the compile step fails), `../scripts/test-stubs/web-browser.ts`, `../scripts/test-stubs/globals.d.ts`. **TDD/test**: consumed by the harness compile step — first verified when T-1.3 runs `node scripts/test-legal-links.mjs`. **Done =** file exists, `tsc -p` against it succeeds once the lib modules exist. **Depends on**: none.

- [x] **T-1.3 (WU-1) — Create `scripts/test-legal-links.mjs` with harness sections 1–3 (RED).** Mirror test-auth.mjs pattern (header comment, `mkdtempSync` workdir under `node_modules/.tmp`, `compile()` via `execFileSync(tsc -p tsconfig.legal-links-test.json)`, `Module._resolveFilename` require hook mapping `expo-web-browser` → stub and generic `@/` → `outDir/src`, `load()` dynamic import of CJS emit, `test()`/pass-fail counters). **Section 1 — opener contract (REQ-1)**: resolving stub → `true` + exact URL passed; rejecting stub → `false`, no exception escapes; no explicit opener → stub `openBrowserAsync` invoked, recorded URL asserted via `__getLastOpenedUrl()`. **Section 2 — URL map (REQ-2)**: keys `['privacy','terms']`; per document 3 `SupportedLocale` tags; all 6 values match `/^https:\/\//`. Do NOT assert against `example.com` (REQ-7 — harness must pass with placeholders). **Section 3 — resolver (REQ-2)**: `legalUrlFor('privacy','pt-BR')` → pt-BR URL; `legalUrlFor('terms','fr-FR')` → es-AR; `legalUrlFor('privacy','')` → es-AR; `legalUrlFor('terms','es-AR')` → es-AR. **TDD/test**: `node scripts/test-legal-links.mjs` — RED now: compile fails on the missing `src/lib` modules. **Done =** harness exists; run fails (compile error) until T-1.4/T-1.5 land — the failure names the missing modules. **Depends on**: T-1.1, T-1.2.

- [x] **T-1.4 (WU-1) — Create `src/lib/open-external-url.ts` (GREEN).** Verbatim AD-1 contract: `export type ExternalUrlOpener = (url: string) => Promise<unknown>;` and `export async function openExternalUrl(url, opener: ExternalUrlOpener = WebBrowser.openBrowserAsync): Promise<boolean>` with try/catch → `true`/`false`. No auth/session/store imports (pre-auth safety NFR). **TDD/test**: `node scripts/test-legal-links.mjs` — section 1 turns green. **Done =** section 1 passes (resolve → true, reject → false, default opener recorded via stub). **Depends on**: T-1.3 (RED first).

- [x] **T-1.5 (WU-1) — Create `src/lib/legal-urls.ts` (GREEN).** Verbatim AD-7 contract: import `{ DEFAULT_LOCALE, type SupportedLocale } from '@/i18n/detector'`; `export type LegalDocument = 'privacy' | 'terms'`; `LEGAL_URLS: Record<LegalDocument, Record<SupportedLocale, string>>` with all 6 `https://example.com/...` placeholders, each carrying a `// TODO(user): real URL` comment (REQ-7 grep-able markers); `export function legalUrlFor(document, locale: string): string` doing `LEGAL_URLS[document][locale as SupportedLocale] ?? LEGAL_URLS[document][DEFAULT_LOCALE]`. **TDD/test**: `node scripts/test-legal-links.mjs` — sections 2–3 turn green. **Done =** sections 2 and 3 pass; placeholders render normally. **Depends on**: T-1.3.

### WU-1 acceptance

T-1.1..T-1.5 complete. `node scripts/test-legal-links.mjs` exits 0 (sections 1–3). `pnpm test:auth` exits 0 (no stub regression). `pnpm typecheck` exits 0 (covers the new `src/` modules). `pnpm lint` exits 0.

---

## WU-2 — i18n keys + Settings Legal group

Base: `main` (after WU-1 lands). Covers REQ-3, REQ-5, AD-2, AD-3, accessibility NFR.

> **Standalone test command**: still `node scripts/test-legal-links.mjs` (chain wiring lands in WU-3).

- [x] **T-2.1 (WU-2) — Extend `scripts/test-legal-links.mjs` with harness section 4 — catalog parity (RED).** Per test-i18n-init pattern: full-file `keySet` equality for `settings.json` and `auth.json` across the 3 locales; every legal key (`legalSectionTitle`, `privacyPolicy`, `termsConditions`, `signUpLegalPrefix`, `signUpLegalAnd`) exists and holds a non-empty string in all three catalogs; failures name locale + key (REQ-5 divergence scenario). **TDD/test**: `node scripts/test-legal-links.mjs` — RED: section 4 fails on the missing legal keys in all catalogs. **Done =** section 4 runs and fails naming the missing keys/locales. **Depends on**: WU-1 complete (T-1.3 harness base).

- [x] **T-2.2 (WU-2) — Add 3 legal keys to `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` (GREEN).** `"legalSectionTitle": "LEGAL"` (all 3); `"privacyPolicy"` — `Política de privacidad` / `Privacy Policy` / `Política de privacidade`; `"termsConditions"` — `Términos y condiciones` / `Terms & Conditions` / `Termos e condições` (es-AR source of truth, translations from design AD integration table). **TDD/test**: `node scripts/test-legal-links.mjs` — section 4 settings parity turns green. **Done =** settings key count 108/108/108; parity assertion passes for the settings namespace. **Depends on**: T-2.1.

- [x] **T-2.3 (WU-2) — Add 2 legal connectors to `src/i18n/locales/{es-AR,en,pt-BR}/auth.json` (GREEN).** `"signUpLegalPrefix"` — `Al continuar aceptás la ` / `By signing up you agree to the ` / `Ao se cadastrar você aceita a `; `"signUpLegalAnd"` — ` y los ` / ` and the ` / ` e os `. **Trailing spaces are INTENTIONAL** (existing convention, `auth.json:37`) — do not trim; keep the lowercase `la`/`los` agreements so concatenation reads correctly. **TDD/test**: `node scripts/test-legal-links.mjs` — section 4 auth parity turns green. **Done =** full section 4 passes (both namespaces, 3 locales, non-empty values). **Depends on**: T-2.1.

- [x] **T-2.4 (WU-2) — Add the Legal group to `src/app/(tabs)/profile.tsx` (GREEN).** Per AD-2/AD-3:
  1. Imports: `openExternalUrl` from `@/lib/open-external-url`, `legalUrlFor` from `@/lib/legal-urls`, `useLocaleStore`.
  2. `const activeLocale = useLocaleStore((s) => s.activeLocale);` — **NOT** `localeOverride` (design risk table).
  3. `const legalRows: AccountSettingRow[]` AFTER the `settings` array (ends `:163`): `{ id: 'privacy-policy', label: t('settings:privacyPolicy'), icon: 'doc.text', trailing: { type: 'chevron' }, onPress: () => void openExternalUrl(legalUrlFor('privacy', activeLocale)) }` and the `terms-and-conditions` twin with icon `doc.on.doc` + `legalUrlFor('terms', activeLocale)`. No `tone` (neutral).
  4. NEW `<View style={styles.section}>` inserted between `:361` (main section close) and `:363` (danger-zone comment): `<Text style={styles.sectionTitle}>{t('settings:legalSectionTitle')}</Text>` + `<AccountSettingsList rows={legalRows} />` (second list instance — a11y labels come free from the component, AD-2). **NO new styles; `settings.slice`/danger split untouched.**

  **TDD/test**: `pnpm typecheck` (integration gate — new symbols resolve), then manual smoke per REQ-3: Legal group appears between main list and danger zone; tapping each row opens the active-locale URL in the external browser, no in-app navigation. **Done =** typecheck exit 0; manual scenario passes on device/web. **Depends on**: T-1.4, T-1.5, T-2.2.

### WU-2 acceptance

T-2.1..T-2.4 complete. `node scripts/test-legal-links.mjs` exits 0 (all 4 sections). `pnpm typecheck` + `pnpm lint` exit 0. Manual: Legal group in place, rows open active-locale URLs, slice untouched.

---

## WU-3 — Sign-up footer + chain wiring

Base: `main` (after WU-2 lands). Covers REQ-4, REQ-6 (wiring), AD-4, AD-6, pre-auth safety NFR.

- [x] **T-3.1 (WU-3) — Add legal footer links to `src/app/(auth)/sign-up.tsx` (GREEN).** Per AD-4: imports for `openExternalUrl`, `legalUrlFor`, `useLocaleStore`; `const activeLocale = useLocaleStore((s) => s.activeLocale);` after `:27`. After the footer `</View>` (`:160`), a wrapped row: `<Text style={styles.legalText}>{t('auth:signUpLegalPrefix')}</Text>` + `<Pressable accessibilityRole="link" accessibilityLabel={t('settings:privacyPolicy')} onPress={() => void openExternalUrl(legalUrlFor('privacy', activeLocale))}>` with `<Text style={styles.legalLink}>{t('settings:privacyPolicy')}</Text>` + `<Text style={styles.legalText}>{t('auth:signUpLegalAnd')}</Text>` + the terms twin (`legalUrlFor('terms', activeLocale)`). Add exactly 3 new styles: `legalFooter` (row wrap, centered, marginTop, gap), `legalLink` (`labelSm` primary weight 600), `legalText` (`labelSm` textSecondary). No auth/session coupling. **TDD/test**: typecheck first (`pnpm typecheck` — new imports/selector resolve), then manual smoke per REQ-4: fresh install, no session — both links visible pre-auth; tap opens the es-AR/en/pt-BR doc in the external browser and stays on sign-up; opener rejection silent. **Done =** typecheck exit 0; pre-auth manual scenario passes. **Depends on**: T-2.2, T-2.3 (labels + connectors).

- [x] **T-3.2 (WU-3) — Wire `test:legal-links` into `mobile/package.json` (AD-6).** Add `"test:legal-links": "node scripts/test-legal-links.mjs"` right after `"test:i18n-init"`; in the master `test` chain insert `&& pnpm test:legal-links` between `test:i18n-init` and `test:sql`. **TDD/test**: `pnpm test:legal-links` exits 0 standalone, then the exact chain position is verified by the full `pnpm test`. **Done =** `pnpm test:legal-links` green standalone; `pnpm test` runs it in position (between `test:i18n-init` and `test:sql`) and the whole chain exits 0. **Depends on**: WU-2 complete (harness sections 1–4 green).

### WU-3 acceptance

T-3.1..T-3.2 complete. `pnpm test` (master chain) exits 0 with `test:legal-links` in the locked position. `pnpm typecheck` + `pnpm lint` exit 0. Manual: sign-up footer links work pre-auth.

---

## Commit strategy

One commit per work unit (orchestrator-locked), Conventional Commits with repo scope convention + WU tag (per `git log` style: `feat(i18n): … (WU-3.7)`, `chore(test): wire … (WU-4.2)`). Tests go WITH the code they verify.

**Branch**: `feat/legal-links` (repo style `feat/<slug>`; single PR to `main`).

1. `feat(lib): add openExternalUrl opener + locale-aware legal URL map with contract harness (WU-1)` — T-1.1..T-1.5 (libs + stub + tsconfig + harness sections 1–3).
2. `feat(i18n): add legal-links copy + Legal settings group (WU-2)` — T-2.1..T-2.4 (6 catalogs + harness section 4 + profile.tsx).
3. `feat(auth): add sign-up footer legal links + wire test:legal-links into test chain (WU-3)` — T-3.1..T-3.2 (sign-up.tsx + package.json).

Optional refinement matching the delete-account precedent (`chore(test): wire delete-account into master chain`): split WU-3 into `feat(auth): … (WU-3.1)` + `chore(test): wire test:legal-links into master chain (WU-3.2)` — only if the reviewer prefers tighter units; the 1-commit-per-WU mapping above is the default.

## Pre-deploy checklist (single PR)

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test:legal-links` exits 0 standalone
- [ ] `pnpm test:auth` exits 0 (stub regression gate)
- [ ] `pnpm test` master chain exits 0 (`test:legal-links` between `test:i18n-init` and `test:sql`)
- [ ] Manual: Settings Legal group between main list and danger zone; both rows open active-locale URLs in external browser
- [ ] Manual: sign-up footer links visible pre-auth (fresh install, no session); taps open browser, user stays on sign-up
- [ ] Release gate (user-owned, verify-phase surfaced): no `example.com` remains in `legal-urls.ts`; real domain recorded for Play Console / App Store Connect

## Estimated review time

| Scope | Reviewer load | Ballpark |
|-------|---------------|----------|
| Single PR (`feat/legal-links`, ~370 lines / 14 files) | Low–Medium | ~15–20 min |

## Rollback note

Reverse-order deletion per design (pure additive change; no data, schema, or auth behavior touched):
1. Revert WU-3: remove the sign-up footer block + 3 styles; drop the `test:legal-links` script + chain `&&` segment.
2. Revert WU-2: remove the Legal section + `legalRows` + imports/selector in `profile.tsx`; drop the 3+2 keys from the 6 catalog files.
3. Revert WU-1: delete `src/lib/open-external-url.ts`, `src/lib/legal-urls.ts`, `scripts/test-legal-links.mjs`, `scripts/tsconfig.legal-links-test.json`; strip the additive `openBrowserAsync`/`__getLastOpenedUrl` exports from `scripts/test-stubs/web-browser.ts`.

Each step leaves the app functional (step 1 → sign-up footer gone; step 2 → settings back to baseline; step 3 → libs/harness gone). Single-commit revert per WU keeps the sequence clean.