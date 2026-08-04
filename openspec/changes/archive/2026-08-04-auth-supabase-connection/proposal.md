# Proposal: Auth + Real Supabase Connection

## Intent

App is 100% mocked: no auth, feature APIs return fixtures, client targets a placeholder URL though a real project exists. Wire it to real Supabase with full auth. Login is mandatory from app start — a signed-in user goes straight to their real data; there is no preview or demo path.

> Scope change (2026-08-03): demo mode removed by product decision — no fixtures fallback, no mode switching, no dual-mode reads.

## Scope

### In Scope
- Client wired to real project via `.env` (`EXPO_PUBLIC_*` keys, currently unread)
- Auth: email/password + Google/Apple OAuth; sign up/in/out, reset
- Session persistence via SecureStore adapter
- Auth screens (`src/app/(auth)/`) + session gate in root layout (sign-in required from launch)
- Profile auto-creation on sign-in (`auth.users` upsert) + RLS verification
- Real READS on existing APIs (profile, budget, tickets, analytics) — authenticated-only
- Minimal backend fixes: `scan_usage` composite PK, analytics RPC
- Removal of all demo-mode code (fixtures, mode switch, auth-mode storage, seam)

### Out of Scope
- Demo/preview mode: users MUST authenticate to use the app; no fixtures, no mode switching
- Household sharing (switch stays non-functional)
- Real camera parsing / `parse-ticket` deployment
- Data migration of mock features
- Purchase/receipt writes (save stays no-op; next slice)

## Capabilities

`openspec/specs/` empty — all new:
- `user-auth`: flows, OAuth, reset, session persistence, mandatory sign-in
- `supabase-connection`: env wiring, client config, `isSupabaseConfigured`
- `profile-sync`: auto-create/fetch + RLS
- `data-access`: authenticated reads (budget, tickets, analytics)

## Approach

- Env: read `process.env.EXPO_PUBLIC_*` in `supabase.ts` (fallback `expoConfig.extra`); keep placeholder + `isSupabaseConfigured()`.
- Client: SecureStore adapter (`persistSession: true`), `detectSessionInUrl: false`, OAuth via Linking.
- Auth: `(auth)` group + root gate `guard={!session}`; OAuth PKCE via `expo-auth-session`; scheme set.
- Reads: feature APIs query real Supabase data unconditionally (session-gated); defensive error states only.
- Profile: SIGNED_IN → upsert `ON CONFLICT DO NOTHING`; verify RLS select.
- SQL: `0002_auth_fixes.sql` — PK fix + RPC scoped to `auth.uid()`.
- Demo removal: delete fixtures/mode modules; simplify gate, seam, hooks, profile rows.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/supabase.ts` | Modified | Env-aware client, SecureStore adapter |
| `src/app/_layout.tsx` | Modified | Session gate (`!session`) |
| `src/app/(auth)/` | New | Sign-in/up/reset screens |
| `src/features/auth/` | New | Session store + hooks |
| `src/features/{profile,budget,tickets,analytics}/` | Modified | Authenticated API reads; remove demo branches |
| `src/app/(tabs)/{index,history,profile}.tsx` | Modified | Consume APIs; remove demo greeting/mode rows |
| `src/lib/fixtures/`, `src/lib/auth/{auth-mode-storage,mode-switch}.ts`, `scripts/test-demo.mjs` | Removed | Demo-mode modules + harness |
| `supabase/migrations/0002_auth_fixes.sql` | New | PK fix + RPC |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SecureStore 2048-byte/key limit vs session | Med | Split keys; in-memory fallback |
| OAuth flow differs Expo Go vs dev build | Med | PKCE; test both |
| Residual demo references survive removal | Med | Dedicated removal task enumerates every touchpoint; typecheck/lint gate |
| RLS blocks reads | Low | Verify policies first |
| PK migration on existing data | Med | Check duplicates before applying |

## Rollback Plan

- `.env`: remove EXPO_PUBLIC keys → placeholder client, `isSupabaseConfigured()` false, reads surface unconfigured error states (no demo fallback).
- Auth gate/screens: `git revert`.
- SQL: drop RPC, revert PK via documented down migration.
- No data-loss risk: writes stay no-ops.

## Dependencies

- Installed: `@supabase/supabase-js`, `expo-secure-store`, `expo-web-browser`
- To add: `expo-auth-session` (install during apply)
- External: enable email + Google/Apple in dashboard
- `supabase gen types` for typed `Database`

## Success Criteria

- [ ] `isSupabaseConfigured()` true; requests hit real project host
- [ ] First launch requires sign-in; no fixtures path exists
- [ ] Sign up auto-creates profile; sign in → real data; restart → session persists
- [ ] Sign out clears session and returns to sign-in
- [ ] Password reset + OAuth complete sessions
- [ ] Authed reads return DB rows; demo modules deleted
- [ ] `pnpm typecheck` passes
