# Design: Auth + Real Supabase Connection

## Technical Approach

Wire the app to the real Supabase project in five coordinated slices: (1) env-driven client with a SecureStore-backed session adapter, (2) full auth (email/password, Google/Apple OAuth PKCE, reset, persistence), (3) a single mode source of truth (`demo` | `authenticated`) with fixtures fallback, (4) profile auto-creation on sign-in, (5) dual-mode reads for the existing feature APIs. Purchase writes stay no-ops. SQL `0002_auth_fixes.sql` fixes the `scan_usage` PK and adds the analytics RPC. Maps 1:1 to the five specs; nothing beyond them.

Verified against installed deps: `@supabase/auth-js@2.111.0` exposes `exchangeCodeForSession` (NOT `setSessionFromUrl`); `expo-router@6.0.24` ships `Stack.Protected`; `expo-secure-store@57.0.1` installed; `expo-auth-session` NOT installed (dependency decision, see ADR-3); `.env` already carries `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` (gitignored).

## Architecture Decisions

| # | Decision | Alternatives | Chose it because |
|---|----------|--------------|------------------|
| ADR-1 | Env: `process.env.EXPO_PUBLIC_*` first, `expoConfig.extra` fallback; `isSupabaseConfigured()` also rejects placeholder anon key | extra-only (status quo) | Expo inlines `EXPO_PUBLIC_*` at build; current guard only checks URL, spec requires rejecting placeholder keys |
| ADR-2 | Chunked SecureStore adapter (2048 B/value limit) | Payload reduction (persist tokens only); single key; react-native-keychain | Full session JSON (user + tokens) exceeds 2048 B; chunking keeps supabase-js's storage contract unchanged; no new native dep |
| ADR-3 | OAuth PKCE via `expo-auth-session`; complete with `exchangeCodeForSession(code)` | `setSessionFromUrl` (absent in installed auth-js) | PKCE redirect returns `code`; auth-js 2.111.0 exchanges it. `redirectTo = AuthSession.makeRedirectUri({ path: 'oauth' })` — `ticketify://oauth` in dev builds, `exp://…` in Expo Go; whitelist both in dashboard. **Add `expo-auth-session` (not installed — install decision for tasks)** |
| ADR-4 | Mode source of truth: `useSettingsStore.mode` (`'demo'`\|`'authenticated'`); session in new `useSessionStore`; `useAuthMode()` derives `{ mode, userId }` | Session store owning mode | Proposal pins mode to settings store; hooks select data source BEFORE any network call → no fixture leakage |
| ADR-5 | Root gate: hold splash until restore + mode reconcile; `Stack.Protected guard={!(mode==='authenticated' && !session)}` | Conditional `<Redirect>` | No flash of wrong mode; expo-router 6 supports Protected natively |
| ADR-6 | Profile sync on auth events: upsert `{ id }` `ON CONFLICT (id) DO NOTHING` (RLS `profiles_insert_own` exists) | Trigger on `auth.users` | Client-side keeps logic in app; spec says "on every sign-in" |
| ADR-7 | Analytics RPC `monthly_category_totals(p_year_month text)` scoped to `auth.uid()`, `security invoker` | `security definer` + `user_id` param | Invoker respects existing RLS on `purchases`/`purchase_items`; no trusting-client user_id |
| ADR-8 | Purchase writes: `saveReceipt` stays `{ id: tempId() }` no-op, guarded in demo | Real insert | Spec: writes out of scope |

## Data Flow & Sequence Diagrams

**Launch / session restore** (ADR-5) — no flash of wrong mode:

    RootLayout
      ├─ prevent splash
      ├─ useSessionStore.restore()
      │    ├─ supabase.auth.getSession()  (reads chunked SecureStore adapter)
      │    ├─ valid   → set session, setMode('authenticated'), ensureProfile()
      │    └─ invalid → clear storage, setMode(default 'demo' or persisted)
      ├─ isBootstrapping=false → Stack.Protected guard evaluates
      │    └─ authenticated && !session → (auth) group renders
      └─ hide splash → (tabs) demo renders fixtures

**OAuth PKCE** (ADR-3):

    User taps Google ──► signInWithProvider('google')
      supabase.auth.signInWithOAuth({ provider, options:{ redirectTo, skipBrowserRedirect:true } })
        → data.url
      AuthSession.loadAsync({ redirectUri, url }) → promptAsync() (web-browser)
        → success → parse `code` from res.url
      supabase.auth.exchangeCodeForSession(code) → SIGNED_IN event
        → ensureProfile(userId) → setMode('authenticated') → navigate to (tabs)
        cancelled/error → no session, stay on sign-in

**Demo ↔ authenticated switching** (ADR-4):

    Settings store mode = single truth; features call useAuthMode()
      demo mode:            hooks return fixtures synchronously, zero network
      switch → authenticated, signed out: router.push('/sign-in'), mode stays demo
      switch → authenticated, signed in:  setMode('authenticated') → hooks query Supabase
      switch → demo while authed:         setMode('demo'), session retained, reads = fixtures

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/supabase.ts` | Modify | Read `process.env.EXPO_PUBLIC_*` (fallback `extra`); plug SecureStore adapter; harden `isSupabaseConfigured`; typed client once `gen types` runs |
| `src/lib/supabase/storage-adapter.ts` | Create | Chunked SecureStore adapter (AsyncStorage contract) |
| `src/lib/auth/oauth.ts` | Create | `signInWithProvider(provider)` PKCE flow |
| `src/lib/auth/profile-sync.ts` | Create | `ensureProfile(userId)` upsert `DO NOTHING` |
| `src/features/auth/use-session-store.ts` | Create | Zustand: `session`, `isBootstrapping`, `restore`, `signIn/Up/Out`, subscribe `onAuthStateChange` |
| `src/features/auth/use-auth-mode.ts` | Create | `useAuthMode(): { mode, userId }` from settings + session stores |
| `src/features/auth/index.ts` | Create | Barrel |
| `src/app/_layout.tsx` | Modify | Splash hold + `Stack.Protected` gate; register `(auth)`, `reset-password` screens |
| `src/app/(auth)/sign-in.tsx`, `sign-up.tsx`, `forgot-password.tsx` | Create | Forms (pending state, disabled submit, duplicate-email / invalid-credentials errors) |
| `src/app/(auth)/_layout.tsx` | Create | Stack for auth screens |
| `src/app/reset-password.tsx` | Create | Deep link (recovery `code`) → `exchangeCodeForSession` → `updateUser({ password })` |
| `src/stores/use-settings-store.ts` | Modify | Add `mode: AuthMode`, `setMode` |
| `src/features/{profile,budget,analytics}/api.ts` | Modify | Real Supabase reads (authed path) |
| `src/features/{profile,budget,analytics}/hooks/*` | Modify | Mode-aware: `demo` → fixtures, no network |
| `src/features/tickets/api.ts` | Modify | `saveReceipt` no-op guard; upload/parse stay stubbed |
| `src/features/tickets/hooks/useScanTicket.ts` | Modify | Pass session `userId` (not `'anon'`) |
| `src/app/(tabs)/index.tsx`, `history.tsx` | Modify | Source inline mocks from fixtures module (kept in demo; purchase-list reads out of scope) |
| `src/app/(tabs)/profile.tsx` | Modify | Mode switch + sign-out rows |
| `supabase/migrations/0002_auth_fixes.sql` | Create | PK migration + RPC |

## Interfaces / Contracts

```ts
// storage-adapter.ts — AsyncStorage contract supabase-js expects
export const secureStoreAdapter: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>; // chunked, ≤1800 bytes/chunk (SecureStore's 2048 limit is byte-based; 1800 chars of CJK/emoji would exceed it)
  removeItem(key: string): Promise<void>;
};
// Key scheme: `sb-auth` + `.meta` / `.0..n` (SecureStore charset [A-Za-z0-9._-], no ':')
```

```ts
// use-auth-mode.ts
export type AuthMode = 'demo' | 'authenticated';
export function useAuthMode(): { mode: AuthMode; userId: string | null }; // userId = session?.user.id ?? null
```

```sql
-- 0002_auth_fixes.sql (see Migration)
create or replace function public.monthly_category_totals(p_year_month text)
returns table (category_id uuid, category_name text, category_slug text,
               total numeric, item_count bigint, percent_of_total numeric)
language sql security invoker stable set search_path = public as $$
  select c.id, c.name, c.slug,
         sum(pi.total_price)::numeric(12,2), count(*)::bigint,
         round(100.0 * sum(pi.total_price) / nullif(sum(sum(pi.total_price)) over (), 0), 1)
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  join public.categories c on c.id = pi.category_id
  where p.user_id = auth.uid() and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  group by c.id, c.name, c.slug
$$;
```

## Migration / Rollout

1. `supabase db push` 0002 after duplicate check: `select user_id, year_month, count(*) from scan_usage group by 1,2 having count(*)>1` → dedupe (keep highest `scans_used`) → `drop constraint scan_usage_pkey` → `add primary key (user_id, year_month)`. Down: check no user has >1 row, drop composite PK, re-add `user_id` PK.
2. Dashboard config: enable email + Google/Apple; whitelist `ticketify://oauth` and the Expo Go `exp://` redirect.
3. `.env` already has real keys → `isSupabaseConfigured()` true.

## Rollback Plan

- Env: remove `EXPO_PUBLIC_*` keys → placeholder client, guard false, demo-only app.
- Auth gate/screens: `git revert`; demo path untouched.
- SQL: `drop function monthly_category_totals`; PK revert documented above.
- No data-loss risk: writes remain no-ops.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (no runner — exercised at verify) | Adapter chunk/unchunk round-trip incl. >2048 B; `isSupabaseConfigured` (env/placeholder cases); `useAuthMode` selection | Ad-hoc node/tsx checks; logic kept pure |
| Integration (manual device) | Email sign-up/dup, sign-in, reset (no enumeration), OAuth both providers, restart persistence, expired-token discard, RLS own/other row select | Expo Go + dev build |
| E2E | Demo↔auth switching; no writes in demo; fixtures never leak | Manual script per verify-report |

## Open Questions

- [ ] `expo-auth-session` version to install (SDK 54-compatible) — install decision deferred to tasks (ADR-3).
- [ ] `supabase gen types` requires project link — typed `Database` optional hardening; fallback untyped client + `src/types`.
- [ ] Email confirmation toggle on sign-up (confirmation state vs auto session) — screen must handle both.
