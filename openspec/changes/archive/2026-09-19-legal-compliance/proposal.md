# Proposal: Legal Compliance — in-app legal content, hosted URLs, consent tracking

## Intent

Play Console requires a hosted privacy-policy URL at submission; all 6 `legal-urls.ts` values are `example.com` placeholders, and the app has zero legal content. Play compliance also demands the unused `RECORD_AUDIO` permission be removed (hard-coded in expo-camera's manifest). Meanwhile, Terms/Privacy must be reachable in-app pre-auth and acceptance must be tracked with a versioned audit trail (sign-up, OAuth, and re-acceptance for existing users). This change delivers content, hosting, consent UX, and the audit trail in one slice.

## Scope

### In Scope
- Bundled static in-app content screens for Terms + Privacy in all 3 locales (es-AR source of truth, en, pt-BR) — no webview/markdown renderer.
- One shared consent-gate component serving 3 entry paths: new email sign-ups (mandatory checkbox blocking submit), new OAuth users (first app open), existing users without a current-version acceptance (blocking gate on app open).
- Versioned acceptance tracking: migration `0038_legal_acceptances.sql` (append-only rows, RLS select/insert own) + SECURITY DEFINER RPC `record_legal_acceptance(document, version)` per the 0036 pattern, granted to `authenticated`.
- Email-confirmation sign-up: acceptance deferred locally (pending flag) and flushed on the first `SIGNED_IN` event. NO `auth.users` trigger.
- GitHub Pages hosting (owner action): legal text mirrored as Markdown to `docs/legal/{locale}/`; URLs served from `https://javaPhpMyAdmin.github.io/ticketify/legal/...`.
- Replace all 6 placeholders in `src/lib/legal-urls.ts` with real Pages URLs.
- Play fix: remove `RECORD_AUDIO` — three-part change (permissions list, `recordAudioAndroid: false`, `android.blockedPermissions`).
- i18n: new `legal` namespace × 3 catalogs; update `test-legal-links.mjs` golden values; new harness(es) wired into `pnpm test` + CI; SQL smoke test registered in `test-db-smoke.mjs` + CI `db-smoke`.

### Out of Scope
- Localizing iOS permission strings (English today; polish item).
- Redesigning account deletion or RevenueCat flows.
- Migrating acceptance rows from other sources (none exist).
- Remote rendering / live content updates (text updates ship with app releases).

## Capabilities

### New Capabilities
- `legal-content`: bundled in-app privacy/terms screens, 3 locales, i18n `legal` namespace, Markdown mirror for Pages hosting.
- `legal-consent`: sign-up checkbox, consent gate (3 entry paths), deferred flush, `legal_acceptances` + RPC, re-acceptance for existing users.

### Modified Capabilities
- `legal-links`: REQ-3 (Settings rows navigate in-app instead of invoking the opener), REQ-4 (sign-up footer links navigate in-app, pre-auth), REQ-7 (placeholders replaced by real Pages URLs; release gate becomes "assert real domain").

## Approach

- Content: static RN `<Text>` routes `src/app/legal/{privacy,terms}.tsx` — ungated (outside the session gate) so sign-up/consent screens can reach them. Content from `legal.{doc}.{locale}` i18n keys; a small script emits the `docs/legal/` Markdown mirror.
- Consent gate: one component; with a session, query acceptance for `LATEST_LEGAL_VERSIONS` (client constant); missing rows → blocking screen (Accept + in-app links). Sign-up checkbox sets the pending flag; `SIGNED_IN` handler flushes via RPC then clears it.
- DB: append-only `legal_acceptances(user_id, document, version, accepted_at)` PK `(user_id, document, version)`, RLS select/insert own, no update/delete; version format **ISO date** (`2026-09-18`) — legal text has no semver compatibility semantics, dates sort lexicographically and tie to the effective date. Verify 0038 against `origin/main` at apply time.
- Hosting: enable Pages in repo settings (owner), Jekyll from `main` `/docs`; Markdown renders to clean HTML. URL base `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/`.
- Android: remove `RECORD_AUDIO` from `expo.android.permissions`; add `recordAudioAndroid: false` + `android.blockedPermissions: ["android.permission.RECORD_AUDIO"]` (expo-camera's library manifest hard-codes it).

## Constraints

- No new native/runtime dependencies.
- GitHub Pages must be enabled by the repo owner — external action, blocks URL swap verification.
- Legal text authoring × 3 locales is a content dependency (user/legal review).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/legal-urls.ts` | Modified | 6 placeholders → real Pages URLs |
| `src/app/(auth)/sign-up.tsx` | Modified | Consent checkbox gates submit; footer links → in-app routes |
| `src/features/auth/use-session-store.ts` | Modified | Pending-flag flush on `SIGNED_IN` |
| `src/app/(tabs)/profile.tsx` | Modified | Legal rows navigate in-app |
| `src/lib/auth/oauth.ts`, `profile-sync.ts` | Modified | OAuth first-open gate; flush seam |
| `src/app/legal/*` + gate route | New | Content + consent-gate screens |
| `supabase/migrations/0038_*.sql` + `tests/*.sql` | New | Table, RLS, RPC; smoke test both registries |
| `app.json` | Modified | RECORD_AUDIO removal |
| `src/i18n/locales/*/legal.json` + `config.ts`/`types.ts` | New | 3-locale namespace |
| `scripts/test-legal-links.mjs` + new harness; `package.json`; `.github/workflows/ci.yml` | Modified | Golden values WILL break; update + register |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pages enablement delayed → URL swap blocked | High | Land content/screens/DB first; URLs are the last commit; placeholder→real swap is one-shot |
| Migration 0038 collision with parallel branches | Low | Verify `origin/main` at apply time |
| `test-legal-links.mjs` golden breakage | Certain | Update goldens + add new harness in same change |
| Legal wording needs review | Med | Ship with clearly-marked draft copy; version bump re-gates users later |
| Gate flush fails (offline, RPC error) | Med | Pending flag survives; gate re-prompts until rows exist |

## Rollback Plan

Revert the change PR: URL map returns to placeholders (REQ-7 gate), `legal_acceptances` table + RPC removed via a follow-up migration, gate component unmounted, permission changes revert in `app.json` (Play resubmit uses previous AAB). Pages can be disabled in repo settings at any time; `docs/legal/` removal is safe.

## Dependencies

- Repo owner enables GitHub Pages (settings) — external action.
- Legal text authored/approved in 3 locales — content dependency.

## Success Criteria

- [ ] `pnpm test` + `pnpm typecheck` green; new harnesses and SQL smoke registered in CI.
- [ ] Sign-up submit blocked until checkbox; acceptance row(s) exist after first `SIGNED_IN`.
- [ ] Fresh OAuth user and existing user both hit the blocking consent screen until accepting current version.
- [ ] 6 real Pages URLs in `legal-urls.ts`; no `example.com` remains.
- [ ] Generated AndroidManifest declares no `RECORD_AUDIO`.

## Open Questions

- Legal wording approval (draft vs final copy; version string `2026-09-18` assumed).
- Pages enablement timing (blocks only the URL swap, not content/DB work).