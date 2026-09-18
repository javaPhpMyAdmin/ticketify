# Exploration: Legal Compliance (in-app legal content + hosted URLs + consent tracking)

> Status: success. Research + mapping only — no source files modified.
> Artifact store: hybrid (this file + Engram `sdd/legal-compliance/explore`).
> Change: `legal-compliance`. Date: 2026-09-18.

## Current State

### legal-links (shipped, PR #116)
- `src/lib/legal-urls.ts` — `LegalDocument = 'privacy' | 'terms'`; `LEGAL_URLS` maps each of the
  3 `SupportedLocale`s (`es-AR` | `en` | `pt-BR`) to a URL. All 6 values are
  `https://example.com/{privacy,terms}/{locale}` placeholders marked `// TODO(user): real URL`
  (lines 22-33). `legalUrlFor(document, locale)` falls back to the `es-AR` URL via an
  own-property guard (lines 35-51).
- `src/lib/open-external-url.ts` — `openExternalUrl(url, opener = WebBrowser.openBrowserAsync)`
  (line 24-41). https-only guard (line 31), never throws, returns boolean. Injectable opener is
  the test seam.
- Consumers (all fire-and-forget `void openExternalUrl(legalUrlFor(...))`):
  - `src/app/(auth)/sign-up.tsx:168-185` — legal footer (`auth:signUpLegalPrefix`,
    `settings:privacyPolicy`, `auth:signUpLegalAnd`, `settings:termsConditions`).
  - `src/app/(tabs)/profile.tsx:172-187` — `legalRows` rendered in the LEGAL section
    (`settings:legalSectionTitle`, profile.tsx:387-390).
- i18n keys:
  - `settings.legalSectionTitle|privacyPolicy|termsConditions` in all 3 catalogs
    (`src/i18n/locales/{es-AR,en,pt-BR}/settings.json`, lines ~107-109).
  - `auth.signUpLegalPrefix|signUpLegalAnd` in all 3 `auth.json` (es-AR/en/pt-BR).
- Test harness: `scripts/test-legal-links.mjs` (437 lines) — 4 sections: opener contract
  (injected stub; sync throws, non-callables, non-promise returns, non-Error rejects, http guard),
  URL map shape (2 docs × 3 locales, all https), resolver fallback (unknown locale + inherited
  prototype keys), and catalog parity + golden per-locale values. Wired as
  `package.json:52` `"test:legal-links"` and included in the master `test` chain (`package.json:54`).
  There is **no** `scripts/test-harness.mjs`; the “harness” is the `pnpm test` chain + CI.
- CI: `.github/workflows/ci.yml` runs `pnpm typecheck`, `pnpm lint`, `pnpm test` (verify job) and
  the Supabase `db-smoke` job (`supabase db query --local --file supabase/tests/*.sql`).

### Sign-up / account-creation flow
- `src/app/(auth)/sign-up.tsx` — local `useState` form (email/password), `canSubmit` requires
  email + password ≥ 8 (line 39-40). `handleSignUp` (42-61) calls
  `useSessionStore(s => s.signUpWithEmail)` and branches on `result.needsEmailConfirmation`.
  No checkbox / consent control exists.
- `src/features/auth/use-session-store.ts:235-257` — `signUpWithEmail` calls
  `supabase.auth.signUp({ email, password })` with no `options`. Two outcomes: email
  confirmation enabled → `{ error: null, needsEmailConfirmation: true }` and **no session**;
  confirmation disabled → a session is issued and `SIGNED_IN` fires.
- `src/features/auth/use-session-store.ts:351-395` — `onAuthStateChange` listener; on
  `SIGNED_IN` it runs `ensureProfile(session.user)` (fire-and-forget) then invalidates the
  profile query. `restore()` does the same for a stored session (lines 182-196).
- `src/lib/auth/profile-sync.ts:31-66` — `ensureProfile` upserts `profiles` (id, full_name,
  avatar_url) with `onConflict: 'id'`; failures are swallowed/logged. This is the single existing
  server-write seam that runs on every identity change.
- OAuth: `src/app/(auth)/sign-in.tsx:76-94` → `signInWithProvider` in `src/lib/auth/oauth.ts:197-254`.
  Account creation is implicit (new provider identity → GoTrue creates the account); there is no
  separate sign-up screen or consent step for OAuth. `src/app/oauth.tsx` is the PKCE callback route.
- **No onboarding / re-accept flow exists anywhere** (grep for onboard/welcome/firstRun returns
  nothing). All app routes are behind the session gate; auth routes are `sign-in`, `sign-up`,
  `forgot-password`, `reset-password`, `oauth`.

### Profiles table + migration conventions
- `supabase/migrations/0001_initial_schema.sql:15-23` — `public.profiles`:
  `id uuid pk references auth.users(id) on delete cascade`, `full_name`, `avatar_url`,
  `monthly_budget`, `currency`, `tier`, `created_at`. RLS at lines 109-127:
  `profiles_select_own`, `profiles_update_own`, `profiles_insert_own` (`auth.uid() = id`).
- Latest migrations: `0036_delete_account.sql` (SECURITY DEFINER RPC pattern: header block with
  change id + cross-refs, `set search_path`, `owner to postgres`, explicit
  `revoke execute ... from public/anon/authenticated` + `grant execute ... to service_role`,
  `comment on function`) and `0037_drop_webhook_events_user_id_fk.sql`.
- Table-creating convention (`0032_user_categories.sql`): `create table`, indexes, explicit RLS
  policies; table grants rely on the platform defaults (the SQL smoke runner re-applies
  platform grants — `scripts/test-db-smoke.mjs:95-136`).
- **Next migration number: `0038`** (0001-0037 present).
- SQL smoke-test convention: `supabase/tests/<name>.sql` is a single `DO`/`assert` block
  (NOT pgTAP), seeded with fixed UUIDs + idempotent inserts; must be registered in BOTH
  `scripts/test-db-smoke.mjs` (new `run([...])` line) and the CI `db-smoke` job steps.
- Edge functions live in `supabase/functions/` (`delete-account`, `parse-ticket`,
  `revenuecat-webhook`) and are declared in `supabase/config.toml` (`verify_jwt` per function).

### In-app rendering options
- Installed deps (`package.json:56-98`): **no** `react-native-webview`, no
  `react-native-render-html`, no `react-native-markdown-display` (also absent from
  `node_modules/.pnpm`).
- `expo-web-browser ~15.0.11` is installed and used in exactly two places: OAuth
  (`src/lib/auth/oauth.ts:32,38,229`) and the legal-links opener
  (`src/lib/open-external-url.ts:14,26`).
- `expo-print ~15.0.8` exists (used for export PDFs) but is not an in-app HTML renderer.
- Simplest viable in-app content screen: new expo-router routes (auto-registered, no
  `_layout` change needed) rendering static React Native `<Text>` paragraphs — zero new deps.
  Content source is the open decision (i18n JSON vs TS constants vs bundled Markdown), because
  **no legal text exists anywhere in the repo today**.

### app.json / Android permission issue
- `app.json:25-28` `android.permissions` explicitly lists
  `"android.permission.RECORD_AUDIO"` and `"android.permission.CAMERA"`.
- `app.json:52-57` `expo-camera` plugin has only `cameraPermission`; `recordAudioAndroid`
  defaults to `true` (`node_modules/expo-camera/plugin/src/withCamera.ts:19,33`).
- `app.json:45-51` `expo-image-picker` has `photosPermission` + `cameraPermission`.
- Generated `android/app/src/main/AndroidManifest.xml:2,5` currently declares both CAMERA and
  RECORD_AUDIO.
- **CRITICAL:** `recordAudioAndroid: false` alone is NOT sufficient. `expo-camera`’s library
  manifest hard-codes `<uses-permission android:name="android.permission.RECORD_AUDIO"/>`
  (`node_modules/expo-camera/android/src/main/AndroidManifest.xml:3`), and Gradle manifest
  merging injects it regardless of the config plugin. Expo docs are explicit: the only way to
  remove a package-level manifest permission is `android.blockedPermissions`
  (https://docs.expo.dev/guides/permissions). Expo tracks the same bug for expo-audio
  (expo/expo#45098) and expo-camera (expo/expo#45132 still open).
- iOS permission strings (`photosPermission`/`cameraPermission`) are English while the UI is
  Spanish — polish item, explicitly out of scope.

### Hosting / repo
- Remote: `https://github.com/javaPhpMyAdmin/ticketify.git`, **PUBLIC**, default branch `main`.
  Repo root on GitHub == this `mobile/` directory (verified with `git rev-parse --show-toplevel`
  and `git ls-tree origin/main`).
- `raw.githubusercontent.com/javaPhpMyAdmin/ticketify/{main|<sha>}/<path>` returns 200
  `text/plain` (verified for `package.json` at both `main` and commit `165b6fb`).
- GitHub blob URLs (`github.com/javaPhpMyAdmin/ticketify/blob/main/README.md`) return 200
  `text/html` (Markdown rendered by GitHub UI).
- GitHub Pages API returns 404 — **Pages is not enabled**; there is no `docs/` folder and no
  `gh-pages` branch. No git tags exist (pin to a commit SHA, not a tag, today).

### Test / verification conventions
- Unit tests: dependency-free Node ESM harnesses `scripts/test-*.mjs`, `node:assert/strict`,
  `tsc`-compiled into a temp dir with an isolated `scripts/tsconfig.<name>-test.json`, plus a
  `Module._resolveFilename` hook for `@/` and mocked Expo modules (see
  `scripts/test-legal-links.mjs:72-89` and `scripts/test-stubs/web-browser.ts`).
- Commands: `pnpm typecheck` (`tsc --noEmit`), `pnpm lint` (`expo lint`), `pnpm test` (39-step
  chain), `pnpm test:sql` (Docker + Supabase CLI). `openspec/config.yaml` sets
  `apply.tdd: true`.
- i18n parity is enforced per feature harness (sorted key-set equality across the 3 catalogs),
  and `test-legal-links.mjs` additionally pins golden values — changing sign-up/legal copy will
  require updating that golden table.

## Affected Areas

- `src/lib/legal-urls.ts` — 6 placeholder URLs to replace; may need a version/slug concept.
- `src/lib/open-external-url.ts` — may become secondary if rows navigate in-app.
- `src/app/(auth)/sign-up.tsx` — consent checkbox + submit gating + post-signup registration.
- `src/app/(tabs)/profile.tsx` — legal rows change from external open to in-app routes.
- `src/features/auth/use-session-store.ts` — `signUpWithEmail` is where consent metadata/RPC
  would be threaded; `SIGNED_IN` path is where deferred registration would flush.
- `src/lib/auth/profile-sync.ts` — candidate seam for server-side acceptance registration.
- `src/lib/auth/oauth.ts` — OAuth account creation path needs a consent decision.
- `supabase/migrations/0038_*.sql` — new `legal_acceptances` table + RLS (+ RPC/trigger).
- `supabase/tests/*.sql` + `scripts/test-db-smoke.mjs` + `.github/workflows/ci.yml` — SQL smoke.
- `src/i18n/locales/{es-AR,en,pt-BR}/{settings,auth}.json` + possibly a new namespace.
- `scripts/test-legal-links.mjs` — golden values / new assertions; `package.json` test chain.
- `app.json` — permission fix + legal URL swap if the URLs move to app config.
- New `src/app/settings/{privacy,terms}.tsx` (or a single `legal.tsx`) — in-app content screens.

## Approaches

### A. In-app content: static bundled screens (RECOMMENDED)
- New routes rendering RN `<Text>` paragraphs; content as TS constants or i18n JSON; a small
  script emits `.md` mirrors for hosting.
- Pros: no new deps, offline, testable, fast; single repo source of truth with the hosted copy.
- Cons: content must be authored/translated; app release needed to change text (unlike a URL).
- Effort: Low-Medium.

### B. In-app content: remote fetch/render (rejected)
- Fetch Markdown/HTML from the hosted URL at runtime and render with a new dep
  (`react-native-webview` / `react-native-render-html` / `react-native-markdown-display`).
- Pros: single live source; no app release to update text.
- Cons: new dependency + native rebuild, legal text unavailable offline, network failure leaves
  a legally-required screen empty. Not recommended for a legal document.

### C. In-app content: hybrid (summary screen + hosted link) (rejected)
- Short localized summary in-app with a "Read full policy" external link.
- Pros: satisfies URL + in-app feel.
- Cons: two copies / parity risk; more surface. Rejected by the prior privacy-terms proposal too.

### Hosting options

| Option | URL stability | Presentation | Setup |
|---|---|---|---|
| raw.githubusercontent (pinned commit) | Stable while commit exists | `text/plain`, plain Markdown | None |
| GitHub blob (pinned commit) | Stable | Rendered Markdown w/ GitHub chrome | None |
| GitHub Pages (`/docs` or `gh-pages`) | Stable | Clean HTML, custom path | Enable Pages (workflow/settings) |
| External host (Notion/other) | User-owned | Varies | Account + publishing |

Any public stable HTTPS URL satisfies the Play listing requirement; raw and blob both qualify.
GitHub Pages gives the cleanest reviewer-facing page but is the only option needing setup.

### Consent registration mechanics

| Option | Works with email-confirmation signup | OAuth | Complexity |
|---|---|---|---|
| `signUp(options.data.user_metadata)` + trigger/RPC on `auth.users` | Yes (server-side) | Only if metadata passed on first auth | Medium-High; touches `auth.users` |
| Client RPC after session; pending flag flushed on first SIGNED_IN | Yes (deferred) | Requires explicit consent step | Medium |
| Accept on first `SIGNED_IN` in `ensureProfile` when no row exists | Yes | Yes | Low, but records consent implicitly (weak audit) |
| Store consent only in `profiles` columns (no table) | Yes | Yes | Low, but contradicts the requested table shape |

## Recommendation

- Render both documents as bundled in-app screens (Option A), with the same text mirrored to a
  hosting path in-repo; use GitHub Pages if the user wants a clean reviewer URL, otherwise pin a
  raw/blob URL to a commit. Do NOT add a webview.
- Create migration `0038` with `legal_acceptances (user_id, document, version, accepted_at)`,
  RLS select/insert own, plus a SECURITY DEFINER RPC `record_legal_acceptance(document, version)`
  (owned by postgres, granted to `authenticated`) for the post-session path.
- Register consent at sign-up by passing the accepted versions to `signUp` and, because email
  confirmation yields no session, either (a) defer with a local pending flag flushed on the
  first `SIGNED_IN`, or (b) register via a trigger on `auth.users`. Prefer the deferred client
  path unless the proposal confirms the trigger is acceptable.
- Replace all 6 placeholders and fix the Android permission with BOTH
  `recordAudioAndroid: false` AND `android.blockedPermissions: ["android.permission.RECORD_AUDIO"]`,
  and remove the explicit `RECORD_AUDIO` entry from `android.permissions`.

## Risks

- **CRITICAL (Play compliance):** `recordAudioAndroid: false` alone does not remove
  `RECORD_AUDIO` — the expo-camera library manifest re-adds it. Must add
  `android.blockedPermissions` and remove the explicit `android.permissions` entry.
- **CRITICAL (schema numbering):** next migration is `0038`; any parallel branch creating
  `0038` on `main` collides. Verify against `origin/main` before apply.
- **WARNING (test harness):** `scripts/test-legal-links.mjs` pins exact golden copy and URL-map
  behavior; changing legal-links to in-app navigation or editing sign-up copy WILL break it.
  New legal content/screens need the golden table and key lists updated, plus a new harness
  registered in the `pnpm test` chain and CI.
- **WARNING (content dependency):** no legal text exists in the repo; the change is blocked on
  the user providing/authorizing the text and choosing the language coverage (3 locales vs 1).
- **WARNING (email-confirmation gap):** with confirmation enabled there is no session at
  sign-up, so a naive client insert into `legal_acceptances` under RLS cannot run. The design
  must choose the deferral/trigger path.
- **WARNING (existing users):** no acceptance rows will exist for anyone pre-change and there is
  no re-accept prompt. Decide whether to add one.
- **WARNING (URL stability):** a raw/blob URL on `main` changes when the file changes; pin a
  commit SHA (no tags exist) for a stable Play listing URL, or use Pages.
- **INFO (i18n):** adding a new namespace requires `src/i18n/config.ts` +
  `src/i18n/types.ts` plumbing; extending `settings` is cheaper. iOS permission strings are
  English vs Spanish UI (out of scope polish).

## Ready for Proposal

Yes. The proposal must lock: (1) consent UX (checkbox + where the re-accept gate lives, if any),
(2) registration mechanics for email-confirmation + OAuth, (3) content source/language and
hosting target, (4) exact `legal_acceptances` shape (append-only vs upsert, version format), and
(5) whether the in-app rows replace or complement the external opener.

## Skill Resolution

- `sdd-explore/SKILL.md` (executor override) loaded via skill tool.
- `_shared/sdd-phase-common.md` and `_shared/openspec-convention.md` read directly.
- No additional registry skills matched (no `.atl/skill-registry.md` consulted; repo uses
  `skills-lock.json`/`.agents`).
