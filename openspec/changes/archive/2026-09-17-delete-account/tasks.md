# Tasks: Delete Account (User-Account Deletion)

> **Status**: success · **Artifact store**: hybrid (this file + engram `sdd/delete-account/tasks`) · **Change**: `delete-account` · **Phase**: tasks — sequenced, reviewable work units for `sdd-apply`.
> **Cross-refs**: spec `openspec/specs/user-account-deletion/spec.md` (REQ-ACCTDEL-1..15), deltas `user-auth` (REQ-AUTH-DEL-1..4), `household-sharing` (REQ-HOUSE-DEL-1..2). Source: design #1355.

## Intent

Decompose the `delete-account` design into 22 atomic, commit-able work units grouped into 4 stacked PRs so each slice is reviewable, reversible, and individually deployable.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~690 (design estimate) |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Suggested split | PR1 (SQL) → PR2 (edge fn) → PR3 (client) → PR4 (tests + docs) |
| Delivery strategy | chained |
| Chain strategy | **stacked-to-main** (cached preflight) |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

## PR chain overview

| PR | Title | Files | ~Lines | Depends on | Unblocks |
|----|-------|------:|------:|------------|----------|
| PR1 | SQL migration + RPC smoke test | 3 (1 new migration, 1 new test, 1 modified `package.json`) | ~190 | `main` | Edge function can call RPC |
| PR2 | Edge function + shared service-client | 7 (1 new shared module, 4 new function files, 1 new README, 1 modified `config.toml`) | ~230 | PR1 | Client can call edge function |
| PR3 | Client-side (wrapper + store + screen + organism + profile row + i18n) | 11 (1 modified + 1 new wrapper, 1 modified store, 2 new organism files, 1 new screen, 1 modified profile, 1 modified list, 6 modified i18n files) | ~210 | PR2 | Manual smoke flow + deploy |
| PR4 | Tests + deploy runbook | 4 (1 new harness, 1 modified `package.json`, 1 modified `test-features.mjs`, 1 modified README) | ~60 | PR3 | Release ready |

Total: ~690 lines across 22 files. **Each PR ≤250 lines** — well under the 400-line reviewer budget.

Branch convention (`stacked-to-main`): `<change>-pr<N>-<slug>`
- `delete-account-pr1-sql`
- `delete-account-pr2-edge`
- `delete-account-pr3-client`
- `delete-account-pr4-tests`

Each PR targets `main` after the previous merges. No feature/tracker branch.

---

## PR1: SQL migration + RPC smoke test

Smallest slice. Unblocks everything downstream by putting the destructive primitive in place first. **Base branch**: `main`.

**Covers**: REQ-ACCTDEL-6 (Storage sweep), REQ-ACCTDEL-7 (parse_attempts scrub), REQ-ACCTDEL-8 (auth.users delete), REQ-ACCTDEL-9 (idempotency), REQ-ACCTDEL-11 (privilege grants), REQ-HOUSE-DEL-1 (owner pre-flight).

### Work units

- [ ] **WU-1.1** — Create `mobile/supabase/migrations/0036_delete_account.sql` with the `public.delete_user_account(p_user_id uuid)` SECURITY DEFINER RPC: idempotency check, household-owner pre-flight raising `'owner_must_disband_first'`, Storage sweep on `storage.objects WHERE bucket_id='receipts' AND (storage.foldername(name))[1] = p_user_id::text`, `parse_attempts` scrub, `DELETE FROM auth.users`, transaction wrapper, `alter function … owner to postgres`, REVOKE from PUBLIC/anon/authenticated, GRANT to service_role. **Done =** migration applies cleanly on a fresh DB via `supabase db reset` (or `supabase db push` against local), and `\df public.delete_user_account` returns the function with `Owner = postgres` and `Security = DEFINER`.

- [ ] **WU-1.2** — Create `mobile/supabase/tests/delete-account.sql` smoke test (single `do $$ … assert … $$` block, mirrors `household-gate-tier.sql` pattern) covering: (a) catalog assertions (function exists, owner=postgres, security definer, EXECUTE only to service_role), (b) cascade across all 12 per-user tables + `parse_attempts` + `storage.objects` in `receipts` bucket, (c) household owner with active member BLOCKED with exact exception text `'owner_must_disband_first'`, (d) solo owner NOT blocked, returns `'ok'`, (e) idempotency (second call returns `'already_deleted'`), (f) re-signup with same email allowed. **Done =** `pnpm test:sql` (or `supabase test db`) runs the new file and all 6 sections pass.

- [ ] **WU-1.3** — Wire the new SQL test into `mobile/package.json` `test:sql` script (and master `test` chain if the smoke wrapper `scripts/test-db-smoke.mjs` is the entrypoint). **Done =** `pnpm test:sql` invokes `0036_delete_account.sql` and it appears in the master `pnpm test` chain order after `0035_trial_freeze_guard.sql`.

### Acceptance

WU-1.1 + 1.2 + 1.3 complete. Migration applies locally. All 6 smoke sections pass. **No regression** on existing SQL tests (`pnpm test:sql` green).

---

## PR2: Edge function + shared service-client

Introduces the server-side orchestration layer. **Base branch**: `main` (after PR1 merges).

**Covers**: REQ-ACCTDEL-1 (edge function entry), REQ-ACCTDEL-2 (RC revoke), REQ-ACCTDEL-3 (idempotent envelope), REQ-ACCTDEL-4 (stable error codes), REQ-ACCTDEL-13 (audit row).

### Work units

- [ ] **WU-2.1** — Extract `mobile/supabase/functions/_shared/service-client.ts` from `revenuecat-webhook/index.ts` — pure refactor, identical `serviceClient()` factory with `auth: { persistSession: false }`. Import it from the new shared path in `revenuecat-webhook/index.ts` and DELETE the inline factory. **Done =** `supabase functions serve revenuecat-webhook` still works locally; `_shared/service-client.ts` exists; `revenuecat-webhook/index.ts` no longer contains the inline factory.

- [ ] **WU-2.2** — Add `[functions.delete-account]` block to `mobile/supabase/config.toml` with `verify_jwt = true`. Place it next to the existing `parse-ticket` block. **Done =** `supabase functions deploy delete-account --no-verify-jwt` is no longer required (the gateway validates the JWT).

- [ ] **WU-2.3** — Create `mobile/supabase/functions/delete-account/lib/revenuecat.ts` exporting `revokeSubscriber(appUserId: string): Promise<void>` — `DELETE https://api.revenuecat.com/v1/subscribers/{id}` with `Authorization: Bearer ${Deno.env.get('REVENUECAT_SECRET_API_KEY')}`. Treat 404 as success (alias already gone = idempotent). Throw on other non-2xx with the raw status code attached for caller-side mapping. **Done =** file exists, exports typed function, has a `// env: REVENUECAT_SECRET_API_KEY` header comment.

- [ ] **WU-2.4** — Create `mobile/supabase/functions/delete-account/lib/responses.ts` exporting the error code constants: `ERROR_UNAUTHENTICATED`, `ERROR_HOUSEHOLD_OWNER`, `ERROR_REVENUECAT_REVOKE`, `ERROR_INTERNAL`. Plus the `jsonResponse(status, body)` helper mirroring `revenuecat-webhook/lib/responses.ts` (if it doesn't already exist at shared scope — copy the pattern otherwise). **Done =** constants exported, no runtime side-effects, compiles under `supabase/functions/deno.json` imports.

- [ ] **WU-2.5** — Create `mobile/supabase/functions/delete-account/index.ts` main handler:
  1. Reject non-POST with 405.
  2. Read bearer token from `Authorization` header, call `svc.auth.getUser(token)` to resolve `appUserId`. On failure → `unauthenticated` envelope (401).
  3. Call `revokeSubscriber(appUserId)` BEFORE the RPC. On non-2xx → `revenuecat_revoke_failed` envelope (502).
  4. Invoke RPC `public.delete_user_account(uuid)` via `svc.rpc(...)`. Map Postgres exception text `'owner_must_disband_first'` → `household_owner_with_members` envelope (409). Other errors → `internal` envelope (500).
  5. On success return `{ ok: true, already_deleted: rpc_returned === 'already_deleted' }` (200).
  6. After success, insert `webhook_events` row `(event_id = crypto.randomUUID(), event_type = 'ACCOUNT_DELETION', user_id = appUserId, payload = {} as jsonb, received_at = now(), environment = 'production')` via `svc.from('webhook_events').insert(...)`. Swallow insert errors with `console.error` (audit is best-effort; primary destructive path already succeeded).
  
  **Done =** file exists, compiles with `deno check`, handles all 5 error paths above with stable envelopes, reads `auth.uid()` from the JWT not from client body.

- [ ] **WU-2.6** — Document deploy sequence in `mobile/supabase/functions/delete-account/README.md`: prerequisites (`REVENUECAT_SECRET_API_KEY` must be set via `supabase secrets set`), deploy commands in order (`db push` → `functions deploy`), rollback commands (disable function via console, leave migration in place), smoke test invocation. **Done =** README exists, includes the env-var gate, the deploy command sequence, and a rollback section that mirrors design §13 step 4.

### Acceptance

WU-2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6 complete. `supabase functions serve delete-account` boots locally. Hitting it with a sample JWT returns the expected envelope shape. **`revenuecat-webhook` regression check** — local serve still works, deploy still succeeds.

---

## PR3: Client-side (wrapper + store + screen + organism + profile row + i18n)

User-facing surface. **Base branch**: `main` (after PR2 merges).

**Covers**: REQ-ACCTDEL-1 (in-app entry), REQ-ACCTDEL-5 (typed-confirmation), REQ-ACCTDEL-10 (Pro vs Free banner), REQ-ACCTDEL-12 (i18n), REQ-ACCTDEL-14 (final routing), REQ-HOUSE-DEL-2 (cross-route typed-value preservation).

### Work units

- [ ] **WU-3.1** — Add to `mobile/src/lib/supabase/feature-access.ts`:
  - `DeleteAccountErrorCode` union type (`'unauthenticated' | 'household_owner_with_members' | 'revenuecat_revoke_failed' | 'internal'`).
  - `DeleteAccountResult` discriminated union (`{ status: 'ok'; alreadyDeleted?: boolean } | { status: 'error'; code: DeleteAccountErrorCode; message: string }`).
  - `deleteAccount(): Promise<DeleteAccountResult>` exported function — gates on `isSupabaseConfigured`, calls `supabase.functions.invoke<{ ok: boolean; already_deleted?: boolean; error?: DeleteAccountErrorCode; message?: string }>('delete-account', { method: 'POST' })`, maps the response per design §5.
  
  **Done =** file typechecks (`pnpm typecheck`), discriminated union exported, `deleteAccount` exported.

- [ ] **WU-3.2** — Add `deleteAccount: () => Promise<DeleteAccountResult>` action to `mobile/src/features/auth/use-session-store.ts` `SessionState`. Implementation per design §6:
  1. `await logOutRevenueCat()` (best-effort, never throws).
  2. `const result = await deleteAccountFn();` early-return on error.
  3. Manual cleanup chain (in order): `queryClient.clear()`, `useReceiptsStore.getState().resetAll()`, `useProStore.getState().reset()`, `useHouseholdStore.getState().reset()`, `useSessionStore.setState({ session: null })`.
  4. Return success.
  
  Also add `deleteAccountDraft: { typedValue: string } | null` field + `setDeleteAccountDraft(...)` action to support cross-route preservation (REQ-HOUSE-DEL-2). **Done =** action compiles, manual cleanup runs in order, transient draft field exists.

- [ ] **WU-3.3** — Create `mobile/src/components/organisms/TypedConfirmation/index.tsx` + `types.ts` + `lib/match.ts`:
  - `lib/match.ts` exports `matchesTypedConfirmation(input: string, prompt: string): boolean` — pure helper: `input.trim().toLowerCase() === prompt.trim().toLowerCase()`.
  - `types.ts` exports `TypedConfirmationProps` per design §7.
  - `index.tsx` renders: title, body, TextInput (controlled), primary button (danger-tinted, disabled when `!matchesTypedConfirmation(value, prompt)`), optional secondary button. Accessibility: `accessibilityLabel` on the TextInput describes the irreversible nature.
  
  Register the organism in `mobile/src/components/organisms/index.ts`. **Done =** organism renders, primary enables only when typed value matches prompt (case-insensitive trimmed), exported from the barrel file.

- [ ] **WU-3.4** — Create `mobile/src/app/settings/delete-account.tsx` screen with three sections in order per design §8:
  1. **Subscription banner** — Pro branch (`subscriptionStatus === 'active' || 'trial'`): render `deleteAccountBannerProTitle/Body` + `Pressable` calling `showManageSubscriptions()`. Free branch: `deleteAccountBannerFreeTitle/Body`, no action.
  2. **Export nudge** (Pro only) — `useProEntitlement().isPro` gates visibility. `Pressable` → `router.push('/settings/export')`. Hidden for Free.
  3. **TypedConfirmation** — `typedPrompt = t('settings:deleteAccountTypedPrompt')` (`'ELIMINAR'`). `onPrimary` does:
     - `setDeleting(true)` → `await useSessionStore.getState().deleteAccount()` → `switch (result.code)` per design §8 → `router.replace('/auth/sign-in')` on success.
     - On error: `useDialogStore.show(...)` for retry, or `useToastStore.show(...)` + `router.replace('/settings/household')` for the household block.
  
  Read `typedValue` from `useSessionStore.deleteAccountDraft` on mount (REQ-HOUSE-DEL-2). Write through on every keystroke. Clear on unmount if not deleting. **Done =** screen renders, full flow works in dev (sign-in → Profile → Delete account → type `ELIMINAR` → confirm → routed to `/auth/sign-in`).

- [ ] **WU-3.5** — Add danger-toned row to `mobile/src/app/(tabs)/profile.tsx` settings array, appended LAST:
  ```ts
  {
    id: 'delete-account',
    label: t('settings:deleteAccount'),
    icon: 'trash',
    tone: 'danger',
    trailing: { type: 'chevron' },
    onPress: () => router.push('/settings/delete-account'),
  }
  ```
  Wrap it in a `dangerSection` `View` with `borderTopColor` + `paddingTop` for visual separation. **Done =** row visible at the bottom, danger styling applied, navigates to `/settings/delete-account`.

- [ ] **WU-3.6** — Extend `mobile/src/features/profile/components/AccountSettingsList.tsx` minimally: add `tone?: 'default' | 'danger'` to `AccountSettingRow` interface. In `renderRowContent`, when `row.tone === 'danger'`, render the `Icon` with `color={colors.danger}` and the `Text` label with `{ color: colors.danger }`. **Done =** row renders with danger styling; existing rows (which omit `tone`) render unchanged.

- [ ] **WU-3.7** — Add all 17 i18n keys to `mobile/src/i18n/locales/{es-AR,en,pt-BR}/settings.json` (`deleteAccount`, `deleteAccountSectionTitle`, `deleteAccountBannerProTitle/Body/Action`, `deleteAccountBannerFreeTitle/Body`, `deleteAccountExportNudgeTitle/Action`, `deleteAccountConfirmTitle/Body`, `deleteAccountTypedPrompt`, `deleteAccountTypedAction`, `deleteAccountFinalWarning`, `deleteAccountErrorTitle`, `deleteAccountErrorHouseholdBody`, `deleteAccountErrorRevokeBody`, `deleteAccountErrorInternalBody`, `deleteAccountErrorRetry`) AND `mobile/src/i18n/locales/{es-AR,en,pt-BR}/auth.json` (`couldNotDeleteAccount`). **Done =** `pnpm typecheck` passes, every key present in all 3 locales, es-AR has full Spanish translations (canonical), en + pt-BR have placeholder values that compile. `pnpm test:i18n-detector` green.

- [ ] **WU-3.8** — Verify TypeScript compiles (`pnpm typecheck`), ESLint passes (`pnpm lint`), no broken refs (search for the new organism/screen/wrapper symbols). **Done =** all three commands exit 0.

### Acceptance

WU-3.1 + 3.2 + 3.3 + 3.4 + 3.5 + 3.6 + 3.7 + 3.8 complete. Manual smoke flow works end-to-end in dev: Profile → Delete account → type `ELIMINAR` → confirm → routed to `/auth/sign-in`. Household owner with members is blocked and routed to `/settings/household`. Pro banner + export nudge visible.

---

## PR4: Tests + deploy runbook

Final verification + production runbook. **Base branch**: `main` (after PR3 merges).

**Covers**: REQ-ACCTDEL-9 (idempotency test), REQ-ACCTDEL-12 (storage-scope invariant), REQ-ACCTDEL-15 (production readiness).

### Work units

- [ ] **WU-4.1** — Create `mobile/scripts/test-delete-account.mjs` covering:
  1. **TypedConfirmation match logic** — exact match, whitespace-padded, different casing, extra chars, empty input, whitespace-only input. (Reuses `lib/match.ts` from PR3.)
  2. **`feature-access.deleteAccount` envelope mapping** — `{ ok: true }` → success, `{ ok: true, already_deleted: true }` → success with flag, `{ ok: false, error: 'household_owner_with_members' }` → mapped error code, `FunctionsHttpError` → `'internal'`, `FunctionsRelayError` → `'internal'`.
  3. **`useSessionStore.deleteAccount` cleanup chain order** — assert `logOutRevenueCat()` ran BEFORE the RPC, `queryClient.clear()` + 3 store resets + `setState({ session: null })` all ran on success, NONE ran on error, `logOutRevenueCat` rejection is swallowed silently.
  
  Follow the `test-features.mjs` pattern (compile + require-hook + stub). **Done =** harness exits 0, all 3 sections pass.

- [ ] **WU-4.2** — Wire `pnpm test:delete-account` into `mobile/package.json` scripts AND the master `pnpm test` chain. Add the script definition `"test:delete-account": "node scripts/test-delete-account.mjs"`. Add `pnpm test:delete-account &&` to the master chain (after `test:webhook-idempotency`). **Done =** `pnpm test:delete-account` runs standalone; `pnpm test` invokes it in the right position.

- [ ] **WU-4.3** — Extend `mobile/scripts/test-features.mjs` to cover the storage-scope invariant from the new RPC — add a parallel to the existing `deleteReceipt` check that asserts the new wrapper never calls the storage delete endpoint directly (it routes through the edge function). **Done =** harness exits 0, new assertion passes.

- [ ] **WU-4.4** — Final deploy runbook update — extend `mobile/supabase/functions/delete-account/README.md` (created in WU-2.6) with: prerequisites checklist (env var set, project ref confirmed), full deploy command sequence with expected output, rollback commands (function disable, NOT migration drop), smoke test invocation (`curl` against the deployed function with a fresh JWT), monitoring notes (audit row check: `select * from webhook_events where event_type = 'ACCOUNT_DELETION' order by received_at desc limit 5;`, RevenueCat dashboard subscriber lookup). **Done =** README is complete and runnable by an on-call engineer without further context.

### Acceptance

WU-4.1 + 4.2 + 4.3 + 4.4 complete. `pnpm test` (master chain) passes locally. Deploy runbook is complete, runnable, and rollback path is documented.

---

## Cross-PR dependencies

```text
                    ┌──────────────────────────────────────────────────────┐
                    │ main                                                │
                    └──────────────────────────────────────────────────────┘
                                  ▲              ▲               ▲              ▲
                                  │              │               │              │
                ┌─────────────────┴───┐ ┌─────────┴──────┐ ┌──────┴───────┐ ┌───┴────────────┐
                │ PR1                │ │ PR2            │ │ PR3          │ │ PR4            │
                │ delete-account-    │ │ delete-account-│ │ delete-      │ │ delete-        │
                │   pr1-sql          │ │   pr2-edge     │ │   account-   │ │   account-     │
                │                    │ │                │ │   pr3-client │ │   pr4-tests    │
                │ 0036 RPC + smoke   │ │ shared client  │ │ wrapper +    │ │ harness +      │
                │ test               │ │ + delete-      │ │ store +      │ │ test:db wiring │
                │                    │ │   account fn   │ │ screen +     │ │ + runbook      │
                │                    │ │                │ │ organism +   │ │                │
                │                    │ │                │ │ profile row  │ │                │
                │                    │ │                │ │ + i18n       │ │                │
                └────────────────────┘ └────────────────┘ └──────────────┘ └────────────────┘
                       │                       │                  │                │
                       └───── PR1 first ───────┘                  │                │
                              └──── PR2 reads RPC ────────────────┘                │
                                     └──── PR3 consumes edge function ─────────────┘
                                                  (PR4 last — tests the whole stack)
```

Stacking order is strict: **PR1 → PR2 → PR3 → PR4** into `main`. Each PR targets `main` directly (stacked-to-main). No feature/tracker branch. Each PR includes its own verification (sql test / local function serve / manual smoke / master `pnpm test`).

---

## Commit strategy

Following `work-unit-commits` conventions: one commit per WU (or group tightly-coupled WUs). Conventional Commits format. Tests + docs go WITH the code they verify.

### PR1 (`delete-account-pr1-sql`)
1. `feat(db): add delete_user_account SECURITY DEFINER RPC` (WU-1.1)
2. `test(db): add smoke test for delete_user_account cascade + idempotency + household block` (WU-1.2)
3. `chore(test): wire 0036_delete_account into test:sql chain` (WU-1.3)

### PR2 (`delete-account-pr2-edge`)
1. `refactor(edge): extract shared service-client from revenuecat-webhook` (WU-2.1)
2. `feat(edge): register delete-account function with verify_jwt=true` (WU-2.2)
3. `feat(edge): add delete-account revenuecat revoke helper` (WU-2.3)
4. `feat(edge): add delete-account response envelope constants` (WU-2.4)
5. `feat(edge): implement delete-account handler with idempotent envelope` (WU-2.5)
6. `docs(edge): document delete-account deploy sequence` (WU-2.6)

### PR3 (`delete-account-pr3-client`)
1. `feat(client): add deleteAccount wrapper + DeleteAccountResult type` (WU-3.1)
2. `feat(client): add useSessionStore.deleteAccount action with manual cleanup chain` (WU-3.2)
3. `feat(ui): add TypedConfirmation organism` (WU-3.3)
4. `feat(ui): add delete-account settings screen` (WU-3.4)
5. `feat(ui): add danger-toned delete-account row to profile` (WU-3.5 + WU-3.6 grouped — same change surface)
6. `feat(i18n): add delete-account copy in es-AR/en/pt-BR` (WU-3.7)
7. `chore(verify): typecheck + lint after delete-account wiring` (WU-3.8)

### PR4 (`delete-account-pr4-tests`)
1. `test(client): add test-delete-account harness for wrapper + store + organism logic` (WU-4.1 + WU-4.3 grouped — both extend test coverage of the new code surface)
2. `chore(test): wire test:delete-account into master test chain` (WU-4.2)
3. `docs(deploy): finalize delete-account runbook with rollback + monitoring` (WU-4.4)

---

## Pre-deploy checklist

For each PR, all gates MUST pass before merge.

### PR1
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test:sql` exits 0 (includes new smoke test)
- [ ] `supabase db advisors` reports no new warnings on the migration
- [ ] Migration applies cleanly via `supabase db reset` (or `supabase db push` local)
- [ ] No merge conflicts with `main`

### PR2
- [ ] `pnpm typecheck` exits 0 (deno-checked separately)
- [ ] `supabase functions serve revenuecat-webhook` works locally (no regression from WU-2.1 refactor)
- [ ] `supabase functions serve delete-account` boots and returns the expected envelope on a sample JWT
- [ ] No merge conflicts with `main`

### PR3
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test:i18n-detector` exits 0 (all new keys in all 3 locales)
- [ ] Manual smoke: sign in → Profile → Delete account → type `ELIMINAR` → confirm → routed to `/auth/sign-in`
- [ ] Manual smoke: household owner with members → blocked, routed to `/settings/household`
- [ ] Manual smoke: Pro user → banner + export nudge visible; Free user → banner only
- [ ] No merge conflicts with `main`

### PR4
- [ ] `pnpm test` (master chain) exits 0
- [ ] `pnpm test:delete-account` exits 0 standalone
- [ ] README is runnable by an on-call engineer without further context
- [ ] No merge conflicts with `main`

---

## Estimated review time per PR

| PR | Scope | Reviewer load | Ballpark time |
|----|-------|---------------|---------------|
| PR1 | SQL review (security definer, cascades, grants) + smoke test | Low | ~10 min |
| PR2 | Edge function + shared service-client refactor | Medium | ~20 min |
| PR3 | Largest diff (wrapper + store + screen + organism + profile + i18n, 11 files) | Medium-High | ~30 min |
| PR4 | Tests + docs | Low | ~15 min |

**Total**: ~75 min review wall-clock, split across 4 review sessions with merge windows between.

---

## What / Why / Where / Learned

**What**: 22 atomic work units across 4 stacked PRs (PR1 SQL, PR2 edge, PR3 client, PR4 tests) implementing the `delete-account` change end-to-end. Each WU has an observable "Done =" criterion. Each PR stays under 250 changed lines, well below the 400-line reviewer budget.

**Why**: The design forecast ~690 changed lines across 22 files — a single PR would breach the reviewer cognitive-load budget. Stacking into 4 PRs respects technical dependencies (SQL before RPC, edge before client, tests last), keeps each slice independently reviewable and reversible, and aligns with the cached `chain_strategy: stacked-to-main`.

**Where**:
- `/Users/marcelobatista/Desktop/ticketify/mobile/openspec/changes/delete-account/tasks.md` (persisted)
- Engram topic `sdd/delete-account/tasks`, project `coronatracker`, type `architecture`
- Source: design #1355, proposal #1353, explore #1352

**Learned**:
- Strict PR ordering matters — PR2 reads the RPC from PR1; PR3 consumes the edge function from PR2; PR4 verifies the whole stack. Reversing any pair would produce broken intermediate states.
- `webhook_events` audit row insertion belongs in PR2 (edge function, after successful RPC) — keeps attribution to `service_role` not `postgres`, avoids orphan rows if cascade fails post-returns.
- The cross-route `deleteAccountDraft` transient lives on `useSessionStore` (not router params) — prevents the literal `ELIMINAR` from leaking into the nav log.
- The `service-client` extraction in WU-2.1 must be a pure refactor (no behavior change) so `revenuecat-webhook` regression risk is contained to diff readability, not runtime.
- Test placement follows the existing project convention: harness scripts under `mobile/scripts/`, smoke SQL under `mobile/supabase/tests/`, wired into `package.json` `test:*` scripts.
