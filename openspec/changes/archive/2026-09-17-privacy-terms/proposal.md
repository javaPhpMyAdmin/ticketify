# Proposal: Privacy Policy + T&C (privacy-terms)

## Intent

Ticketify has zero legal content today (no files, screens, i18n keys, or URLs). Google Play and App Store Connect **require a hosted privacy-policy URL** at submission — in-app screens alone cannot satisfy that constraint. This change makes legal documents reachable from the app: a Legal group in Settings (Privacy Policy, Terms & Conditions) plus legal links on the sign-up footer (Play/Apple expect ToS accessible at account creation). Rows/links open the hosted document for the user's active locale via a new external-link opener utility. App-side scope is small and pattern-following; the legal **text** and **hosting** remain user-owned.

## Scope

**In scope**
- New util `src/lib/open-external-url.ts` — `WebBrowser.openBrowserAsync(url)` wrapper.
- Settings: "Legal" group (2 rows) in `src/app/(tabs)/profile.tsx`, rendered between the main list and the danger zone via a second `AccountSettingsList`.
- Sign-up footer legal links in `src/app/(auth)/sign-up.tsx` — same locale-aware opener, pre-auth safe.
- i18n keys in 3 catalogs + a parity-asserting test script wired into `pnpm test`.

**Out of scope**
- Authoring the legal text (user-owned).
- Hosting/deploying the pages + registering the real domain (user-owned; critical path for store submission, not for this code).
- Play Console / App Store Connect data-safety + privacy-URL form entries (user fills in console).
- In-app legal screens / offline copies (Option A/C extras — rejected, see Decision Log).

## Context

`profile.tsx:91-163` builds a declarative `settings: AccountSettingRow[]` (label via `t('settings:…')`, chevron, `onPress`); rendering (:358-372) splits main list (`slice(0, len-1)`) from the danger row. `AccountSettingsList` renders rows as Pressables — reusable as-is for a Legal card. i18n: flat camelCase keys, `settings` namespace at 105/105/105 parity (es-AR source of truth); parity is enforced by feature test scripts (pattern: `test-manual-screen.mjs:1567-1583` — `keySet(en) === keySet(esAr)` + per-key existence, dependency-injected pickers). `expo-web-browser` ~15 is installed (used in `oauth.ts` via `openAuthSessionAsync`) but no generic opener exists. Sign-up footer (`sign-up.tsx:151-160`) has no legal links.

## Approach

- **Opener**: `openExternalUrl(url, opener = WebBrowser.openBrowserAsync): Promise<boolean>` — injectable opener matches the repo's picker-injection test convention; catches rejection, returns `false`; callers fire-and-forget (`void openExternalUrl(...)`). No session/auth coupling → pre-auth safe. No user-facing error copy needed for link rows.
- **URL map**: `src/lib/legal-urls.ts` — `LEGAL_URLS = { privacy: Record<AppLocale,string>, terms: Record<AppLocale,string> }` + `legalUrlFor(document, locale)` falling back to es-AR. URLs are **user-provided placeholders** (`https://example.com/privacy/…`, `TODO(user): replace` — flagged; user owns real domain).
- **Settings**: separate `legalRows: AccountSettingRow[]` (don't append to `settings[]` — would break the slice/danger split) rendered in a new section between `section` and `dangerSection` (:358-372).
- **Sign-up**: legal links under the existing footer pairing.
- **i18n**: `settings` gains `legalSectionTitle`, `privacyPolicy`, `termsConditions` (3 catalogs). Sign-up connectors: auth-screen copy lives in the `auth` namespace → recommend `auth:signUpLegalPrefix` + `auth:signUpLegalAnd` reusing `settings:privacyPolicy`/`termsConditions` as link labels. Flagged for user ruling.
- **Tests**: `scripts/test-legal-links.mjs` — 3-catalog legal-key parity + non-empty values; URL map has 3 entries/document, all `https:`; opener returns `true`/`false` via injected stub. Add `pnpm test:legal-links` to the `test` chain.

## Capabilities

- **New** — `legal-links`: external-link opener contract, locale-aware legal URL map, Settings "Legal" group rows, sign-up footer legal links, legal i18n keys + parity test.
- **Modified** — None behaviorally. Sign-up footer addition specified inside `legal-links`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/lib/open-external-url.ts` | New | Injectable `openBrowserAsync` wrapper |
| `src/lib/legal-urls.ts` | New | Locale→URL map + resolver (placeholders) |
| `src/app/(tabs)/profile.tsx` | Modified | Legal section between main list and danger zone |
| `src/app/(auth)/sign-up.tsx` | Modified | Footer legal links (pre-auth) |
| `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` | Modified | 3 new keys each (+ auth.json if connectors land there) |
| `scripts/test-legal-links.mjs` | New | Parity + contract harness |
| `package.json` | Modified | `test:legal-links` in chain |

## Workflow Plan

Single small PR: est. ~250–350 changed lines (< 400 review budget). 2-3 additive work units (opener+urls+constants w/ tests → settings group → sign-up footer + i18n). Leave chain/forecast resolution to sdd-tasks.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legal URLs/text missing (user owns hosting) | High (external) | Placeholders marked `TODO(user)`; app code proceeds independently; store submission blocked until user publishes — surfaced in verify/release notes |
| Placeholder URLs shipped to prod | Med | Parity test asserts `https:` URLs; apply-phase task to swap real domain; manual release checklist |
| i18n parity break (105/105/105) | Med | 3-catalog key-set + non-empty assertions in `test-legal-links.mjs`, wired into `pnpm test` |
| Pre-auth opener breaks behind session gate | Low | Util is pure `WebBrowser`, no auth import |
| `WebBrowser` quirks on web/dev | Low | Promote+return-`boolean`; dev smoke-check on web |
| Console entries (URL, data-safety) forgotten | Med | Out of repo — verify-report notes dependency; user fills Play/App Store forms |

## Rollback Plan

Pure additive UI: revert = remove Legal section/link rows + footer links (3 files), drop ~5-6 i18n keys (3 files), delete opener/urls/test scripts + chain entry. No data, schema, or auth behavior touched — single-commit revert.

## Dependencies

- User: real domain + published legal pages (store submission; not required for code merge).
- None for app code (expo-web-browser already installed).

## Success Criteria

- [ ] Settings shows "Legal" group; each row opens the hosted doc for active locale (es-AR/en/pt-BR) in external browser
- [ ] Sign-up footer shows Privacy Policy + T&C links; works pre-auth without session
- [ ] 3 catalogs keep identical key sets with non-empty legal values; `pnpm test` green
- [ ] No `example.com` placeholder in `legal-urls.ts` at release
- [ ] Resolved open questions (below) locked before spec

## Decision Log

| Decision | Value |
|---|---|
| Approach | **Option B** (hosted pages + in-app links); rejected A (in-app screens fail store URL requirement), C (hybrid adds second copy of legal content) |
| Legal languages | 3 hosted docs (es-AR, en, pt-BR); app links to active-locale doc |
| Sign-up links | Included — Play/Apple expect ToS accessible at account creation |
| Processors to disclose | Supabase (DB/auth/storage), RevenueCat (subscriptions), Google Play (payments) — confirmed list |
| Legal text + hosting | User-owned, out of repo |
| Store console forms | User-filled, out of repo |

## Resolved question (user ruling 2026-09-17)

**Sign-up footer connectors namespace**: RESOLVED — `auth:` connectors (`auth:signUpLegalPrefix`, `auth:signUpLegalAnd`) reusing `settings:privacyPolicy` / `settings:termsConditions` as link labels. User approved ("dale esta bien asi").

---

**Status**: success
**Next Recommended**: `spec`
**Skill Resolution**: paths-injected — `sdd-propose/SKILL.md`, `_shared/sdd-phase-common.md` + `_shared/openspec-convention.md`