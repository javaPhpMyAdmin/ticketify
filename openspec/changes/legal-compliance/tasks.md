# Tasks: Legal Compliance

## Review Workload Forecast

Estimated changed lines per area (additions + deletions):

| Area | Est. |
|------|------|
| migration 0038 + SQL smoke + both registries | ~300 |
| app.json RECORD_AUDIO + manifest assertion script | ~70 |
| i18n `legal` ns ×3 + config/types plumbing | ~410 |
| LegalScreen + `/legal/{privacy,terms}` routes | ~170 |
| generator script + `docs/legal/**` mirrors ×6 | ~610 |
| legal-urls swap + navigation helper + link sites | ~80 |
| consent logic + SecureStore flag + RPC client + hook | ~310 |
| ConsentGate + _layout wiring + flush + checkbox | ~270 |
| new harnesses + tsconfigs + stubs | ~420 |
| test-legal-links.mjs golden updates | ~60 |
| **Total** | **~2,700** (2,400–2,900) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
800-line budget risk: High

### Suggested Work Units (stacked-to-main; orchestrator picks strategy)

| Unit | PR | Scope | Depends on | Est. |
|------|----|-------|-----------|------|
| U1 | PR 1 | DB + config (0038, smoke, registries, RECORD_AUDIO, manifest assertion) | — | ~370 |
| U2 | PR 2 | In-app content (legal ns ×3, plumbing, LegalScreen, routes, parity harness) | — | ~600 |
| U3 | PR 3 | Hosting mirror (generator + 6 md mirrors + mirror harness) | U2 | ~610 |
| U4 | PR 4 | Consent logic + storage (versions, pure fns, flag, RPC client, hook, harness) | — (e2e needs U1) | ~560 |
| U5 | PR 5 | Gate UI + wiring (ConsentGate, _layout, SIGNED_IN flush, sign-up checkbox) | U2, U4 | ~460 |
| U6 | PR 6 | URLs + navigation (URL swap, openLegalDocument, link sites, goldens) — LAST, Pages-gated | U2 + Pages | ~140 |

## Phase 1: Foundation — DB + config (U1)

- [x] 1.1 `supabase/migrations/0038_legal_acceptances.sql`: append-only table, RLS select/insert own (no update/delete), `record_legal_acceptance(document,version)` SECURITY DEFINER per 0036 — postgres owner, REVOKE anon/public, EXECUTE authenticated-only, ISO-date version. [consent REQ-1]
- [x] 1.2 `supabase/tests/legal-acceptances.sql` (DO/assert): catalog (definer/owner/grants), duplicate no-op, bad-document CHECK raise, update/delete = 0 rows, anon select denied.
- [x] 1.3 Register smoke in `scripts/test-db-smoke.mjs` AND CI db-smoke step (registries currently drift — keep both in sync).
- [x] 1.4 `app.json` RECORD_AUDIO 3-part fix (remove permission, `recordAudioAndroid:false`, `blockedPermissions`) + `scripts/test-android-manifest.mjs` (scratch `expo prebuild` → assert no RECORD_AUDIO) + `test:android-manifest` script.

## Phase 2: In-app content (U2, U3)

- [ ] 2.1 `src/i18n/locales/{es-AR,en,pt-BR}/legal.json`: privacy/terms section arrays + consent-gate copy + `signUpConsentRequired`; es-AR truth; identical key sets, non-empty. [content L2]
- [ ] 2.2 Add `legal` ns to `src/i18n/config.ts` (NAMESPACES/RESOURCES) + `src/i18n/types.ts` (ResourceNamespaceMap).
- [ ] 2.3 `src/features/legal/components/LegalScreen.tsx` (scrollable, doc-title header + back) + routes `src/app/legal/{privacy,terms}.tsx`, ungated + deep-linkable. [content L1]
- [ ] 2.4 `scripts/generate-legal-markdown.mjs` emits `docs/legal/{locale}/{doc}.md` ×6 from catalogs; commit mirrors. [content L3]
- [ ] 2.5 `scripts/test-legal-content.mjs` (ns parity ×3 + 6 mirrors exist, non-empty, equal to fresh generation) + tsconfig; wire `test:legal-content` into `pnpm test`. [content L2/L3]

## Phase 3: URLs + navigation (U6 — last, Pages-gated)

- [ ] 3.1 `src/lib/legal-navigation.ts`: typed `openLegalDocument(document)` → `router.push('/legal/'+document)`.
- [ ] 3.2 Swap 6 `LEGAL_URLS` values to `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/`; drop `TODO(user)` markers. [links REQ-7]
- [ ] 3.3 sign-up footer (`sign-up.tsx:168-185`) + profile `legalRows` (`profile.tsx:172-187`) → `openLegalDocument`; opener not invoked. [links REQ-3/REQ-4]
- [ ] 3.4 `scripts/test-legal-links.mjs`: Pages-domain goldens + REQ-7 real-domain assertion (`example.com` fails suite). [links REQ-7]

## Phase 4: Consent (U4, U5)

- [ ] 4.1 `src/features/legal/legal-versions.ts`: `LATEST_LEGAL_VERSIONS = { privacy:'2026-09-18', terms:'2026-09-18' }`. [consent C2]
- [ ] 4.2 `src/features/legal/legal-consent.ts` (pure): `isConsentComplete` (both docs @ exactly latest), `shouldShowConsentGate` (hidden on `/legal/*`), `flushDecision(flag, userEmail)` → flush | clear-stale. [C2/C4]
- [ ] 4.3 `src/features/legal/pending-acceptance.ts` (SecureStore `{email, version, acceptedAt}` via `secureStoreAdapter`) + `record-acceptance.ts` (`supabase.rpc('record_legal_acceptance')` ×2). [C4]
- [ ] 4.4 `src/features/legal/use-legal-consent.ts` (select own rows → status; `accept()` = rpc ×2 + invalidate) + `queryKeys.legal(userId)` in `src/lib/query-keys.ts`. [C1/C5]
- [ ] 4.5 `src/features/legal/components/ConsentGate.tsx`: blocking overlay — Accept, legal links, sign-out; release only when both rows exist. [C5]
- [ ] 4.6 `src/app/_layout.tsx`: mount gate beside DialogHost via `shouldShowConsentGate`; register legal routes OUTSIDE `Stack.Protected`. [L1/C5]
- [ ] 4.7 `src/features/auth/use-session-store.ts` SIGNED_IN: fire-and-forget `flushPendingAcceptance(session.user)` beside `ensureProfile` (never blocks; email-match safety). [C4]
- [ ] 4.8 `src/app/(auth)/sign-up.tsx`: mandatory consent checkbox blocks submit + validation message; links tappable pre-check, form state preserved on back. [C3]
- [ ] 4.9 `scripts/test-legal-consent.mjs` (completeness partial/bump, gate hidden on `/legal/*`, flushDecision match/stale/fail-survives) + tsconfig + stubs (`@/lib/supabase`, SecureStore); wire `test:legal-consent` into `pnpm test`. [C2/C4/C5]

## Phase 5: Verification (all units)

- [ ] 5.1 `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm test:sql` green; new harnesses + db-smoke step present in `.github/workflows/ci.yml`.
- [ ] 5.2 `git fetch origin/main` — confirm 0038 free; renumber if a parallel branch claimed it.
- [ ] 5.3 Owner enables GitHub Pages (main `/docs`, Jekyll); `curl -sfI` ×6 = 200 before 3.2 ships.

## Blockers / External Dependencies

1. **GitHub Pages enablement** (owner action, repo Settings) — blocks only U6 URL swap + curl verification.
2. **Legal copy drafting/approval** ×3 locales (content authoring) — draft copy ships marked-draft; version bump re-gates later.
3. **Migration numbering** — verify 0038 vs `origin/main` at apply; renumber on collision.
4. **Registry drift discovered**: CI db-smoke runs `recalculate-on-purchase-items-update` but not `delete-account`; local `test-db-smoke.mjs` is the inverse. Register the legal smoke in BOTH; drift fix optional/out-of-scope.
5. Origin slug confirmed `ticketify` (matches Pages URL scheme); R-1b cleared.