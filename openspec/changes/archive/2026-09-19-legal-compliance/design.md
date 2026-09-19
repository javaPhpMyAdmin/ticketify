# Design: Legal Compliance (`legal-compliance`)

> **Status**: success · **Artifact store**: both · **Change**: `legal-compliance` · **Phase**: design

## Technical Approach

One slice delivering: bundled static in-app legal screens (`/legal/{privacy,terms}`, no webview), a single consent gate serving all three entry paths (sign-up checkbox, OAuth first-open, existing-user re-accept), an append-only `legal_acceptances` table + SECURITY DEFINER RPC (0036 pattern, `authenticated`-only), a deferred client-side flush on first `SIGNED_IN` for email-confirmation sign-ups, GitHub Pages hosting (`docs/legal/` mirror), real Pages URLs in `legal-urls.ts` with in-app navigation via a router helper, and the 3-part `RECORD_AUDIO` manifest fix. Single source of truth for consent = absence of current-version acceptance rows; the gate is a root overlay (DialogHost pattern) so legal routes stay reachable pre-auth and while gated.

## Architecture Decisions

| # | Decision | Alternatives | Choice + Rationale |
|---|----------|--------------|--------------------|
| AD-1 | Content rendering | WebView over Pages URLs; markdown renderer | **Static RN `<Text>` screens from the `legal` i18n namespace.** Spec forbids runtime fetch (legal-content REQ-4); offline reads; no new deps. Content ships with releases. |
| AD-2 | Deferred flush point | `auth.users` INSERT trigger; edge function | **Client flush on first `SIGNED_IN`** (legal-consent REQ-4). Trigger rejected: spec mandates no trigger, and user identity (`email`→`user_id`) is only resolvable client-side at sign-in. Flush is fire-and-forget beside `ensureProfile` — the acceptance table FK targets `auth.users` directly (not `profiles`), so flush is race-safe: it never depends on `ensureProfile` settling. |
| AD-3 | Write path | Direct client INSERT only; table-only RLS | **RLS select/insert own + SECURITY DEFINER RPC as the canonical writer.** RLS insert-own policy exists per spec, but the app writes only via `record_legal_acceptance` for idempotency (`on conflict do nothing`) + version validation. No update/delete policies → append-only. |
| AD-4 | Version token | Semver, hash, timestamp | **ISO date string shared by both docs** (`2026-09-18`). Legal text has no semver compatibility semantics; dates sort lexicographically and name the effective date. Version bump = constant change only. |
| AD-5 | Hosting | `raw.githubusercontent.com`; own domain; Supabase Storage | **GitHub Pages from `main` `/docs`** (proposal-listed scheme `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/`). Jekyll renders Markdown to clean HTML suitable for store crawlers. Pages enablement is owner-gated and external (risk R-1). |
| AD-6 | Gate UX | Per-screen route guard; gate as forced `(tabs)` initial route | **Root overlay** (DialogHost pattern) driven by pure `shouldShowConsentGate(consentStatus, pathname)`, hidden on `/legal/*` so docs open while gated. Overlay blocks all other navigation trivially; sign-out + accept live on it (no dead-ends). Sign-up checkbox blocks submit separately (no overlay needed pre-auth). |
| AD-7 | Pending-flag identity | Bind to user id; bind to nothing | **Bind to sign-up email** (`{email, version, acceptedAt}` in SecureStore). At email-confirmation sign-up no `user_id` exists yet; on first `SIGNED_IN` flush only when `session.user.email === flag.email`, otherwise clear without flushing (REQ-4 "never leaks / stale flag clears"). |
| AD-8 | In-app navigation | Call `router.push` inline at 6 call sites | **`openLegalDocument(document)` helper** in `src/lib/legal-navigation.ts` — one typed seam (typedRoutes) for profile rows, sign-up footer, and gate links; keeps `openExternalUrl` available for the unchanged REQ-1/REQ-6 contract. |

## Data Flow

```
Sign-up (email) with checkbox:
  checkbox ✓ → signUpWithEmail → session? 
    ├─ yes → SIGNED_IN → flushPending (rpc×2 @ version) → clear flag
    └─ no (email confirmation) → pending flag {email, version, acceptedAt} → SecureStore
        → user confirms → first SIGNED_IN → email match? 
            ├─ match → rpc('record_legal_acceptance') ×2 → clear flag
            └─ mismatch → clear flag (no rows written) → gate on next open

OAuth first-open:
  signInWithProvider → exchange → SIGNED_IN → ensureProfile ∥ flushPending (no flag → no-op)
      → useLegalConsent query (select own rows) → missing row(s) → gated
      → ConsentGate overlay → Accept → rpc ×2 → invalidate query → gate opens

Existing user (version bump / partial acceptance):
  restore() → session → useLegalConsent → rows != LATEST_LEGAL_VERSIONS → gated (same path)
      → gate also reached after failed flush (rows absent) → Accept retries RPC → release on success
```

## DB Schema (0038_legal_acceptances.sql)

```sql
create table public.legal_acceptances (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  document    text        not null check (document in ('privacy', 'terms')),
  version     text        not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);
alter table public.legal_acceptances enable row level security;
create policy "legal_acceptances_select_own" on public.legal_acceptances
  for select using (auth.uid() = user_id);
create policy "legal_acceptances_insert_own" on public.legal_acceptances
  for insert with check (auth.uid() = user_id);
-- no update/delete policies: append-only for clients (REQ-1)

create or replace function public.record_legal_acceptance(p_document text, p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.legal_acceptances (user_id, document, version)
  values (auth.uid(), p_document, p_version)
  on conflict (user_id, document, version) do nothing;
end;
$$;
alter function public.record_legal_acceptance(text, text) owner to postgres;
revoke execute on function public.record_legal_acceptance(text, text) from public, anon, service_role;
grant  execute on function public.record_legal_acceptance(text, text) to authenticated;
```

Follows 0036 exactly: SECURITY DEFINER, definer pinned to `postgres`, explicit REVOKE (the 0029 §4 PUBLIC trap), LEAST PRIVILEGE grant — here `authenticated` only (0036 granted `service_role` only; this RPC derives `user_id` from `auth.uid()`, so the caller role is `authenticated`).

## Interfaces / Contracts

```ts
// src/features/legal/legal-versions.ts
export const LATEST_LEGAL_VERSIONS = { privacy: '2026-09-18', terms: '2026-09-18' } as const;

// src/features/legal/legal-consent.ts — pure, node-testable
isConsentComplete(rows: {document,version}[], latest): boolean   // both docs @ exactly latest
shouldShowConsentGate(status: 'loading'|'complete'|'gated', pathname: string): boolean
flushDecision(flag: {email,version}, userEmail: string): 'flush' | 'clear-stale'

// src/features/legal/use-legal-consent.ts — TanStack Query (queryKeys.legal(userId))
//   select rows → status; accept() → rpc×2 → invalidateQuery(queryKeys.legal)

// src/lib/legal-navigation.ts
export function openLegalDocument(document: LegalDocument): void  // router.push(`/legal/${document}`)
```

`src/lib/legal-urls.ts`: keep `LEGAL_URLS`/`legalUrlFor` shape (REQ-2 unchanged); six values → real Pages URLs; `TODO(user)` markers removed. Sign-up footer + profile `legalRows` + gate links switch to `openLegalDocument`; `openExternalUrl` still exported (REQ-1 contract, testable via stub).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/0038_legal_acceptances.sql` | Create | Table + RLS + RPC above |
| `supabase/tests/legal-acceptances.sql` | Create | DO/assert smoke: catalog grants, idempotency, RLS append-only, anon denied |
| `src/app/legal/{privacy,terms}.tsx` | Create | Thin routes → shared `LegalScreen` (`src/features/legal/components/LegalScreen.tsx`): ScrollView, document-title header + back, renders `legal.{doc}` sections |
| `src/features/legal/` (components, hooks, lib) | Create | `ConsentGate`, `useLegalConsent`, `legal-consent.ts`, `legal-versions.ts`, `pending-acceptance.ts` (SecureStore via `secureStoreAdapter`), `record-acceptance.ts` (`supabase.rpc`), `LegalScreen` |
| `src/lib/legal-navigation.ts` | Create | `openLegalDocument` router helper |
| `src/app/_layout.tsx` | Modify | Register `legal/privacy` + `legal/terms` OUTSIDE `Stack.Protected` (pre-auth/deep-linkable); mount `ConsentGate` overlay beside DialogHost with `shouldShowConsentGate` |
| `src/features/auth/use-session-store.ts` | Modify | `SIGNED_IN` handler: `void flushPendingAcceptance(session.user)` beside `ensureProfile` (fire-and-forget, never blocks) |
| `src/app/(auth)/sign-up.tsx` | Modify | Consent checkbox (mandatory, blocks submit + validation message, links tappable pre-check); footer links → `openLegalDocument` |
| `src/app/(tabs)/profile.tsx` | Modify | `legalRows` onPress → `openLegalDocument` |
| `src/lib/legal-urls.ts` | Modify | 6 real Pages URLs, no placeholders |
| `src/i18n/locales/*/legal.json` ×3 | Create | `privacy`/`terms` section arrays + consent-gate copy + `signUpConsentRequired` (es-AR source of truth) |
| `src/i18n/config.ts`, `types.ts` | Modify | Add `legal` to `NAMESPACES`, `RESOURCES`, `ResourceNamespaceMap` |
| `src/lib/query-keys.ts` | Modify | `legal: (userId) => ['legal', userId] as const` |
| `docs/legal/{es-AR,en,pt-BR}/{privacy,terms}.md` ×6 | Create | Markdown mirror (committed; Pages source) |
| `scripts/generate-legal-markdown.mjs` | Create | Emits the 6 mirrors from the catalogs |
| `scripts/test-legal-links.mjs` | Modify | Golden values → Pages domain; REQ-7 now asserts real domain in-suite (no `example.com`) |
| `scripts/test-legal-content.mjs` | Create | Catalog parity (legal ns), mirror completeness + equivalence to in-app text |
| `scripts/test-legal-consent.mjs` | Create | Pure fns: completeness, gate decision, flush decision (match/stale/fail-survives), sign-up blocking |
| `scripts/tsconfig.legal-*-test.json`, `scripts/test-stubs/web-browser.ts` | Create/Modify | Per-AD-5 harness tsconfig pattern; stub additive |
| `scripts/test-db-smoke.mjs`, `package.json`, `.github/workflows/ci.yml` | Modify | Register smoke + harnesses in `pnpm test` chain + db-smoke job |
| `app.json` | Modify | RECORD_AUDIO 3-part change (config below) |

## Config Changes

- **RECORD_AUDIO** (Play compliance, NOT a spec capability — config + verification only): (1) remove `"android.permission.RECORD_AUDIO"` from `expo.android.permissions`; (2) `expo-camera` plugin gains `"recordAudioAndroid": false`; (3) add `"android.blockedPermissions": ["android.permission.RECORD_AUDIO"]`. Verification = post-prebuild manifest assertion: `npx expo prebuild --platform android` in a scratch dir, then assert generated `AndroidManifest.xml` contains no `RECORD_AUDIO` (script in the verification harness).
- **GitHub Pages**: owner action — repo Settings → Pages → Deploy from branch `main` `/docs` (Jekyll). Documented external step; verification = six `curl -sfI` 200 checks per URL before the URL swap is final (release gate).
- `package.json`: `test:legal-content`, `test:legal-consent`, `generate:legal-docs` scripts; chain inserts.

## Migration / Rollout

0038 must be verified against `origin/main` at apply time (`git fetch origin`, diff migration dirs) — today the max is 0037 so no collision; if a parallel branch lands 0038 first, renumber to the next free slot. Apply order: DB first, then content/screens, consent, URLs last (Pages enablement blocks only the URL swap).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (node ESM, tsc-compile) | legal-consent pure fns | New harness: completeness (partial=gate, version bump re-gates), gate decision (hidden on `/legal/*`), flush decision (email match→flush, mismatch→clear, RPC fail→keep) |
| Unit | URL map + opener + goldens | Update `test-legal-links.mjs`: 6 real-domain URLs, REQ-7 real-domain assertion, `example.com` fails; opener contract unchanged |
| Unit | Content/mirror parity | New harness: `legal` ns key-set parity + non-empty ×3; six `docs/legal/**` files exist, non-empty, equal to fresh generation |
| SQL smoke | 0038 contract | `legal-acceptances.sql`: SECURITY DEFINER + postgres owner, EXECUTE authenticated-only (anon/service_role/PUBLIC revoked), duplicate RPC no-op, invalid document raises CHECK, version CHECK (`^\d{4}-\d{2}-\d{2}$`), RLS update/delete = 0 rows, anon select denied |
| Consent RPC (client) | `supabase.rpc('record_legal_acceptance', {p_document, p_version})` → 204 + named args + JWT-role request | U4 client slice: LIVE PostgREST check (not only mocks) — COMMITMENT. The SQL smoke exercises the RPC via direct SQL `perform` only, and CI db-smoke excludes postgrest; the client → PostgREST → definer contract is pinned as an open gap in the `legal-acceptances.sql` header and MUST be verified live in U4 |
| Config | RECORD_AUDIO | Post-prebuild AndroidManifest assertion (above) |

## Rollback Considerations

Revert the change PR. `legal_acceptances` is append-only audit data: dropping it in a rollback loses the audit trail — prefer a follow-up migration (0039) to `drop function` + `drop table` only after confirming no pending flush UX is in the field, or keep the table and revert the client. `legal-urls.ts` returns to placeholders (REQ-7 gate re-arms), gate overlay unmounts, `app.json` permissions revert (previous AAB stays in Play), `docs/legal/` removal is safe, Pages can be disabled anytime.

## Risks / Mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R-1 | Pages enablement delayed → URL swap blocked | High | Land DB/content/consent first; URLs are the last commit; verification = 6×200 curl |
| R-1b | Pages URL assumes repo slug `ticketify` (remote is currently `CoronaTracker`) | Med | Owner confirms repo slug at enablement; URL scheme is proposal-locked, flag at verify if base differs |
| R-2 | Migration 0038 collision with parallel branches | Low | Verify `origin/main` at apply time; renumber |
| R-3 | Legal wording not approved (draft copy) | Med | Clearly-marked draft; version bump re-gates later |
| R-4 | Golden breakage in test-legal-links | Certain | Update goldens + new harnesses in the same change |
| R-5 | Deferred flush lost (reinstall/other device) | Med | Spec-safe: gate re-prompts; consent never assumed from missing data |
| R-6 | RECORD_AUDIO resurfaces via expo-camera updates | Low | `blockedPermissions` belt-and-braces + manifest assertion in CI |
| R-7 | Change is large (>400-line review budget) | Certain | DB slice (0038 + smoke) and client slices land as separate PRs (chained) — forecast in tasks |

**Next Recommended**: `tasks`