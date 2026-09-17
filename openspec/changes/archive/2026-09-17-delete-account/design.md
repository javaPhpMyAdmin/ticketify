# Design: Delete Account (User-Account Deletion)

> **Status:** success · **Artifact store:** hybrid (this file + engram `sdd/delete-account/design`) · **Change:** `delete-account` · **Phase:** design — the concrete technical bridge between the spec (WHAT) and the upcoming `sdd-tasks` (HOW).
> Cross-refs: REQ-ACCTDEL-N in `openspec/specs/user-account-deletion/spec.md`; deltas `user-auth` (REQ-AUTH-DEL-N) and `household-sharing` (REQ-HOUSE-DEL-N).

## 1. Intent

Hard-delete an authenticated user's account and every byte of personal data attached to it (local DB via cascades, Storage receipts, `parse_attempts`, external RevenueCat alias) inside a single transactional server-side primitive. Irreversible, idempotent, fail-closed, and discoverable from the profile tab. Google Play Data Deletion policy + GDPR Art. 17.

## 2. Architecture overview

```
  Mobile client                                        Supabase (Postgres + Storage + Auth)        External
 ────────────                                          ──────────────────────────────────────        ────────
                                                         
 Profile tab  ─┐                                                              ┌─► auth.users(id)
               │   TypedConfirmation (organism,                              │  (cascade → 11 per-user tables
               ▼   new)                                                       │   incl. profiles, purchases,
   src/app/settings/delete-account.tsx                                        │   households, household_members,
               │   useSessionStore.deleteAccount()                            │   invite_codes, webhook_events,
               ▼      └─ logOutRevenueCat() (best-effort)                     │   scan_usage, monthly_user_totals,
   src/lib/supabase/feature-access.ts                                         │   category_budgets, categories)
        deleteAccount() ───► supabase.functions.invoke('delete-account', POST)
                                              │                               │
                                              ▼                               │
                                  Edge Function (Deno, verify_jwt = true)    │
                                  src/.../functions/delete-account/index.ts  │
                                              │                               │
                          ┌───────────────────┼────────────────────────────┐ │
                          ▼ 1) read auth.uid() from JWT                      │ │
                            2) DELETE https://api.revenuecat.com/           │ │
                               /v1/subscribers/{app_user_id}    ────────────┼─┼──► api.revenuecat.com
                                  (fail-closed if non-2xx)                   │ │
                            3) RPC public.delete_user_account(uuid)          │ │
                                  SECURITY DEFINER, owner = postgres ───────►┘ │
                                  BEGIN
                                    IF EXISTS auth.users row → RAISE ok
                                    PRE-FLIGHT households.created_by + member
                                      → if other member: RAISE EXCEPTION 'owner_must_disband_first'
                                          (SQLSTATE P0001)
                                    DELETE FROM storage.objects   WHERE bucket_id='receipts'
                                          AND (storage.foldername(name))[1] = uid
                                    DELETE FROM public.parse_attempts
                                          WHERE user_id = uid
                                    DELETE FROM auth.users          WHERE id = uid
                                  EXCEPTION WHEN OTHERS → ROLLBACK
                                  COMMIT
                                  RETURN 'ok' | 'already_deleted'
                            4) Map envelope back to DeleteAccountResult
                                              │
                                              ▼
                          Client: feature-access returns discriminated union
                                  ok → run cleanup chain (same as SIGNED_OUT):
                                       queryClient.clear(),
                                       useReceiptsStore.resetAll(),
                                       useProStore.reset(),
                                       useHouseholdStore.reset(),
                                       useSessionStore.session = null
                                  → router.replace('/sign-in')
                                  error → useDialogStore.show OR router.push
                                          + useToastStore.show (household detour)
```

Trust boundaries: gateway JWT (sets `auth.uid()`), service_role (edge function), SECURITY DEFINER (`postgres` — bypasses RLS for `storage.objects` sweep and `auth.users` delete). The RPC is the single destructive authority; client never touches `storage.objects` or `auth.users`.

## 3. DB schema changes — `mobile/supabase/migrations/0036_delete_account.sql`

```sql
-- 0036_delete_account.sql
-- User-Account Deletion (REQ-ACCTDEL-6, -7, -8, -9; REQ-HOUSE-DEL-1).
-- Single destructive authority: a SECURITY DEFINER RPC owned by postgres
-- that orchestrates the Storage sweep, parse_attempts scrub, household
-- pre-flight, and the auth.users removal inside one transaction.

create or replace function public.delete_user_account(p_user_id uuid)
returns text
language plpgsql
security definer
volatile
set search_path = public, storage
as $$
declare
  v_other_member_count int;
begin
  -- ── Idempotency: second call after a prior delete is a no-op success. ──
  if not exists (select 1 from auth.users where id = p_user_id) then
    return 'already_deleted';
  end if;

  -- ── Household-owner pre-flight (REQ-HOUSE-DEL-1). ──
  -- Block if the caller is a household created_by AND another active
  -- member exists. `created_by = p_user_id` is true for one row only
  -- (the household the user created); `user_id <> p_user_id` excludes
  -- the owner-as-self row from household_members.
  select count(*) into v_other_member_count
    from public.households h
    join public.household_members hm on hm.household_id = h.id
   where h.created_by = p_user_id
     and hm.user_id  <> p_user_id;
  if v_other_member_count > 0 then
    -- SQLSTATE P0001 (raise_exception). The edge function matches on this
    -- exact text and maps to error code 'household_owner_with_members'.
    raise exception 'owner_must_disband_first';
  end if;

  -- ── All destructive steps in one transaction. ──
  -- Wrap in BEGIN/EXCEPTION so a partial failure leaves no orphan state.
  begin
    -- Receipt photos for the user (storage.objects in 'receipts' bucket).
    -- service_role bypasses RLS (0001 §208 grants own-folder DELETE only).
    delete from storage.objects
     where bucket_id = 'receipts'
       and (storage.foldername(name))[1] = p_user_id::text;

    -- parse_attempts has no FK to profiles (0001); scrub the rows here.
    delete from public.parse_attempts
     where user_id = p_user_id;

    -- The cascade does the rest: profiles → stores, purchases, items,
    -- scan_usage, monthly_user_totals, category_budgets, webhook_events,
    -- households (if owner), household_members, invite_codes, categories
    -- (user rows). profiles.household_id on surviving members becomes NULL
    -- via ON DELETE SET NULL (0001:71).
    delete from auth.users where id = p_user_id;
  exception when others then
    raise;  -- the outer caller's exception handler will see it.
  end;

  return 'ok';
end;
$$;

-- Owner must be postgres so SECURITY DEFINER runs as bypassrls.
alter function public.delete_user_account(p_user_id uuid) owner to postgres;

-- ── Least privilege (REQ-ACCTDEL SEC-REVIEW; mirrors household-gate-tier). ──
-- Postgres grants EXECUTE to PUBLIC by default; revoke explicitly.
revoke execute on function public.delete_user_account(uuid) from public;
revoke execute on function public.delete_user_account(uuid) from anon;
revoke execute on function public.delete_user_account(uuid) from authenticated;
grant  execute on function public.delete_user_account(uuid) to service_role;

comment on function public.delete_user_account(p_user_id uuid) is
  'Hard-deletes a user account and all personal data (Storage sweep, parse_attempts scrub, auth.users cascade). SECURITY DEFINER, owned by postgres, callable only by service_role. Idempotent: second call returns already_deleted.';
```

**Indexes / constraints:** none new. All cascade chains already exist (0001, 0032). `households.created_by` and `household_members(user_id)` are already indexed by their primary purpose.

## 4. Edge function — `mobile/supabase/functions/delete-account/`

Mirrors `revenuecat-webhook` (service-role client, idempotent envelope). Reads `auth.uid()` from the gateway-validated JWT — `verify_jwt = true` in `config.toml` (matches `parse-ticket`).

### `mobile/supabase/functions/_shared/service-client.ts` (NEW — DRY refactor)

Pulled from `revenuecat-webhook/index.ts`. Justification: the same 5-line factory now lives in two functions. Shared location keeps the `auth: { persistSession: false }` flag identical and gives a future third function a single import.

```ts
import { createClient } from '@supabase/supabase-js';
export function serviceClient(url = Deno.env.get('SUPABASE_URL') ?? '',
                              key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '') {
  return createClient(url, key, { auth: { persistSession: false } });
}
```

### `mobile/supabase/functions/delete-account/index.ts` (NEW)

```ts
import { serviceClient } from '../_shared/service-client.ts';
import { revokeSubscriber } from './lib/revenuecat.ts';

const UNAUTHENTICATED_SQLSTATE = 'PGRST301';  // PostgREST anon + missing JWT
const OWNER_MUST_DISBAND_MESSAGE = 'owner_must_disband_first';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  // verify_jwt = true → the gateway already validated the JWT and put the
  // user into auth.uid(). We read it from the service-role client context.
  const svc = serviceClient();
  const { data: { user } } = await svc.auth.getUser(
    req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  );
  if (!user) return json(401, { ok: false, error: 'unauthenticated' });
  const appUserId = user.id;

  // 1) RevenueCat alias revoke (fail-closed; the spec REQ-ACCTDEL-7 promises
  //    the alias is gone BEFORE auth.users goes).
  try {
    await revokeSubscriber(appUserId);
  } catch (err) {
    console.error('[delete-account] revenuecat revoke failed:', err);
    return json(502, { ok: false, error: 'revenuecat_revoke_failed',
                        message: 'No se pudo revocar la suscripción de RevenueCat.' });
  }

  // 2) SECURITY DEFINER RPC. Idempotent.
  const { data, error } = await svc.rpc('delete_user_account', { p_user_id: appUserId });
  if (error) {
    if (error.message?.includes(OWNER_MUST_DISBAND_MESSAGE)) {
      return json(409, { ok: false, error: 'household_owner_with_members',
                          message: 'Tenés que disolver el hogar antes de eliminar tu cuenta.' });
    }
    console.error('[delete-account] rpc failed:', error.code, error.message);
    return json(500, { ok: false, error: 'internal' });
  }
  return json(200, { ok: true, already_deleted: data === 'already_deleted' });
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status,
    headers: { 'Content-Type': 'application/json' } });
}
```

### `mobile/supabase/functions/delete-account/lib/revenuecat.ts` (NEW)

```ts
const RC_BASE = 'https://api.revenuecat.com/v1';
const KEY = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';

/** Throws on non-2xx (mapped by caller to 'revenuecat_revoke_failed'). */
export async function revokeSubscriber(appUserId: string): Promise<void> {
  const res = await fetch(`${RC_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${KEY}` },
  });
  // 404 = alias already gone; treat as success (idempotent).
  if (!res.ok && res.status !== 404) {
    throw new Error(`revenuecat revoke ${res.status}: ${await res.text()}`);
  }
}
```

## 5. Client wrapper — `mobile/src/lib/supabase/feature-access.ts` (additions)

```ts
export type DeleteAccountErrorCode =
  | 'unauthenticated'
  | 'household_owner_with_members'
  | 'revenuecat_revoke_failed'
  | 'internal';

export type DeleteAccountResult =
  | { status: 'ok'; alreadyDeleted?: boolean }
  | { status: 'error'; code: DeleteAccountErrorCode; message: string };

export async function deleteAccount(): Promise<DeleteAccountResult> {
  if (!isSupabaseConfigured) {
    return { status: 'error', code: 'internal',
             message: 'Supabase no está configurado en este dispositivo.' };
  }
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean; already_deleted?: boolean; error?: DeleteAccountErrorCode;
    message?: string;
  }>('delete-account', { method: 'POST' });

  if (error) {
    // FunctionsHttpError carries the status; FunctionsRelayError is a transport
    // failure (treated as 'internal' so the user sees "inténtalo de nuevo").
    return { status: 'error', code: 'internal',
             message: 'No se pudo eliminar la cuenta. Inténtalo de nuevo.' };
  }
  if (!data) return { status: 'error', code: 'internal',
                      message: 'No se pudo eliminar la cuenta. Inténtalo de nuevo.' };

  if (data.ok) return { status: 'ok', alreadyDeleted: data.already_deleted === true };

  return {
    status: 'error',
    code: data.error ?? 'internal',
    // Surface only sanitized localized strings on the screen — server
    // `message` is for debug only and is NOT shown to the user.
    message: '',
  };
}
```

The screen maps the (code, screen-controlled localized copy) — `deleteAccount()` never returns a user-facing string sourced from the server (anti-enumeration; mirrors `feature-access.ts` post-M3).

## 6. Store action — `mobile/src/features/auth/use-session-store.ts` (addition)

Add to `SessionState`:

```ts
deleteAccount: () => Promise<DeleteAccountResult>;
```

Implementation:

```ts
deleteAccount: async () => {
  // (a) Best-effort local SDK clear; never throws by contract
  //     (`logOutRevenueCat` swallows errors). The server-side REST revoke
  //     in step (b) is authoritative; this is purely about preventing the
  //     NEXT user on this device from inheriting the alias.
  await logOutRevenueCat();

  // (b) Server: storage sweep + parse_attempts scrub + RC revoke + auth.users
  //     delete inside the RPC transaction. Throws NOTHING useful — returns a
  //     discriminated DeleteAccountResult the caller maps to UX.
  const result = await deleteAccountFn();   // imported from feature-access
  if (result.status === 'error') return result;

  // (c) Manual cleanup — the SIGNED_OUT listener does NOT fire after hard
  //     delete (auth.users is gone, no JWT to invalidate; supabase.auth
  //     .signOut() is never called). Replicate the listener body verbatim.
  queryClient.clear();
  useReceiptsStore.getState().resetAll();
  useProStore.getState().reset();
  useHouseholdStore.getState().reset();
  useSessionStore.setState({ session: null });

  return result;  // { status: 'ok', alreadyDeleted?: boolean }
},
```

## 7. `TypedConfirmation` organism — `mobile/src/components/organisms/TypedConfirmation/index.tsx`

**Decision: standalone organism** (NOT a slot on `useDialogStore`). Why: (a) the dialog store's `DialogOptions` carries only text + button labels, not a controlled TextInput value — extending it leaks into every dialog call site; (b) the typed-confirmation is destructive-flow-specific copy (the action label is the danger phrase, not "OK"), and the dialog's `tone: 'danger'` paints only the primary button, whereas the typed-confirmation wants a danger-tinted text field outline too; (c) reusability — the household "disband" action could adopt typed-confirmation in a follow-up without rewriting the dialog API.

Props (`mobile/src/components/organisms/TypedConfirmation/types.ts`):

```ts
export interface TypedConfirmationProps {
  /** Card title (bold). */
  title: string;
  /** Body copy under the title (multi-line OK). */
  body: string;
  /** The exact word the user must type (i18n key — comes from settings:deleteAccountTypedPrompt). */
  typedPrompt: string;
  /** Controlled value of the TextInput. */
  typedValue: string;
  onTypedValueChange: (v: string) => void;
  /** Filled CTA label (typically the same word as typedPrompt). */
  primaryLabel: string;
  onPrimary: () => void;
  /** Renders the primary disabled; default false. */
  primaryDisabled?: boolean;
  /** Paints the primary with colors.danger; default 'danger'. */
  tone?: 'danger';
  /** Outlined dismiss CTA label (typically common:cancel). */
  secondaryLabel?: string;
  onSecondary?: () => void;
}
```

Match rule: `typedValue.trim().toLowerCase() === typedPrompt.trim().toLowerCase()`. A trailing space, different casing, or extra characters re-disables the button (matches the spec's "Scenario: Final button enables only on match"). Accessibility: the TextInput has an `accessibilityLabel` describing the irreversible nature; the primary button announces "Eliminar cuenta — acción irreversible" in es-AR (matches the NFR Accessibility section).

Internal implementation:
- `Card` + `TextInput` (controlled, `autoCapitalize="none"`, `autoCorrect={false}`).
- Compute `const matches = typedValue.trim().toLowerCase() === typedPrompt.trim().toLowerCase();`
- `primaryDisabled` defaults to `!matches`. The parent's `primaryDisabled` is OR-ed (`primaryDisabled || !matches`).
- `tone === 'danger'` paints the primary with `colors.danger` (mirror of `DialogHost.primaryButtonDanger`).

## 8. Delete-account screen — `mobile/src/app/settings/delete-account.tsx`

Three sections in order, top to bottom:

1. **Subscription banner** (Pro vs Free branch):
   - Reads `useProEntitlement()`. If `subscriptionStatus === 'active' || 'trial'`: Pro banner (`deleteAccountBannerProTitle` / `deleteAccountBannerProBody`) + a `Pressable` that calls `showManageSubscriptions()` (Decision 4). `accessibilityLabel` from `pro:manageSubscription` (existing key).
   - Else: Free banner (`deleteAccountBannerFreeTitle` / `deleteAccountBannerFreeBody`), no deep-link.
2. **Pre-delete export nudge (Pro only)** — `useProEntitlement().isPro` → render `Pressable` with `deleteAccountExportNudgeTitle` + `deleteAccountExportNudgeAction` that does `router.push('/settings/export')` (Decision 8). Hidden for Free.
3. **TypedConfirmation** — `typedPrompt = t('settings:deleteAccountTypedPrompt')` (= `'ELIMINAR'` in es-AR). `primaryLabel = t('settings:deleteAccountTypedAction')`. `onPrimary`:

```tsx
const onConfirm = async () => {
  setDeleting(true);
  const result = await useSessionStore.getState().deleteAccount();
  setDeleting(false);
  if (result.status === 'ok') {
    router.replace('/sign-in');
    return;
  }
  // Map error code → UX
  switch (result.code) {
    case 'household_owner_with_members':
      useToastStore.getState().show(t('settings:deleteAccountErrorHouseholdOwnerBody'), 'default');
      router.replace('/settings/household');
      return;
    case 'revenuecat_revoke_failed':
    case 'internal':
    default:
      useDialogStore.getState().show({
        title: t('settings:deleteAccountErrorTitle'),
        message: t('settings:deleteAccountError' +
          (result.code === 'revenuecat_revoke_failed' ? 'Revoke' : 'Internal') + 'Body'),
        primaryLabel: t('settings:deleteAccountErrorRetry'),
        tone: 'danger',
      });
      return;
  }
};
```

Screen-level state: `const [deleting, setDeleting] = useState(false);` and a `Spinner` overlay over the TypedConfirmation while in flight.

## 9. Profile settings row — `mobile/src/app/(tabs)/profile.tsx`

Append to the `settings` array (the LAST entry):

```tsx
const settings: AccountSettingRow[] = [
  // ... existing 7 rows unchanged ...
  {
    id: 'delete-account',
    label: t('settings:deleteAccount'),
    icon: 'trash',
    tone: 'danger',
    trailing: { type: 'chevron' },
    onPress: () => router.push('/settings/delete-account'),
  },
];
```

**Visual separation** — wrap the row in its own section after the existing `settings` section so it sits below the divider:

```tsx
<View style={styles.dangerSection}>
  <AccountSettingsList rows={[settings[settings.length - 1]]} />
</View>
```

New `styles.dangerSection`: `borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md`. The danger tone paints the icon bubble border + label text with `colors.danger`.

**Prop change to `AccountSettingsList`** — add an optional `tone?: 'default' | 'danger'` to `AccountSettingRow` (propagated into the row). When `tone === 'danger'`, `renderRowContent` uses `colors.danger` for the icon tint and label text. This is non-breaking (every existing row omits the prop and gets `'default'`). The current `style` has a hardcoded `colors.textPrimary` for the label and `colors.textPrimary` for the icon — change both to `row.tone === 'danger' ? colors.danger : colors.textPrimary`.

```ts
// in src/features/profile/components/AccountSettingsList.tsx
export interface AccountSettingRow {
  id: string;
  label: string;
  value?: string;
  icon: IconName;
  trailing: SettingTrailing;
  onPress?: () => void;
  tone?: 'default' | 'danger';   // NEW — defaults to 'default'
}
```

```tsx
// renderRowContent:
<Icon name={row.icon} size={18}
      color={row.tone === 'danger' ? colors.danger : colors.textPrimary} />
<Text style={[styles.label,
       row.tone === 'danger' && { color: colors.danger }]}>
  {row.label}
</Text>
```

## 10. i18n keys

`mobile/src/i18n/locales/es-AR/settings.json` (canonical — full Spanish):

```jsonc
"deleteAccount": "Eliminar cuenta",
"deleteAccountSectionTitle": "ZONA PELIGROSA",
"deleteAccountBannerProTitle": "Tu suscripción de Google Play sigue activa",
"deleteAccountBannerProBody": "Eliminar tu cuenta de Ticketify no cancela tu suscripción de Google Play. Si querés dejar de pagar, cancelala desde Google Play antes de continuar.",
"deleteAccountBannerProAction": "Administrar suscripción",
"deleteAccountBannerFreeTitle": "Tu cuenta es gratuita",
"deleteAccountBannerFreeBody": "Eliminar tu cuenta no genera cargos ni cancelaciones.",
"deleteAccountExportNudgeTitle": "Exportá tus datos antes de eliminar",
"deleteAccountExportNudgeAction": "Ir a exportar",
"deleteAccountConfirmTitle": "Eliminar tu cuenta",
"deleteAccountConfirmBody": "Se eliminarán todos tus tickets, presupuestos, hogares y datos. Esta acción no se puede deshacer. Podés crear una cuenta nueva con el mismo email, pero será una cuenta nueva sin tus datos.",
"deleteAccountTypedPrompt": "ELIMINAR",
"deleteAccountTypedAction": "Eliminar cuenta para siempre",
"deleteAccountFinalWarning": "Esta acción es irreversible.",
"deleteAccountErrorTitle": "No se pudo eliminar la cuenta",
"deleteAccountErrorHouseholdOwnerBody": "Tenés que disolver el hogar antes de eliminar tu cuenta.",
"deleteAccountErrorRevokeBody": "No pudimos cancelar tu suscripción. Probá de nuevo en unos minutos.",
"deleteAccountErrorInternalBody": "No pudimos eliminar la cuenta. Inténtalo de nuevo.",
"deleteAccountErrorRetry": "Reintentar"
```

`mobile/src/i18n/locales/es-AR/auth.json`:

```jsonc
"couldNotDeleteAccount": "No se pudo eliminar la cuenta. Inténtalo de nuevo."
```

**en** + **pt-BR**: placeholder values that compile (`"TODO_TRANSLATE"` or `i18next.t(key)` echo). Every key MUST exist in all three locales — the `test:i18n-detector` (and a future key-coverage step in the new harness) catches missing keys. Format mirrors existing keys (e.g. `householdLeaveConfirmBody`).

## 11. Test design

### `mobile/scripts/test-delete-account.mjs` (NEW)

Mirrors `test-features.mjs` (compile + require-hook + stub). Covers:

1. **TypedConfirmation match logic** (pure, in `lib/match.ts` — extract the `trim().toLowerCase() === ...` comparison into a named export for testability):
   - exact match → `true`
   - whitespace-padded match → `true`
   - different casing → `true`
   - extra characters → `false`
   - empty value → `false`
   - whitespace-only value → `false`
2. **`feature-access.deleteAccount` envelope mapping**:
   - `{ ok: true }` → `{ status: 'ok', alreadyDeleted: undefined }`
   - `{ ok: true, already_deleted: true }` → `{ status: 'ok', alreadyDeleted: true }`
   - `{ ok: false, error: 'household_owner_with_members' }` → `{ status: 'error', code: 'household_owner_with_members' }`
   - FunctionsHttpError → `{ status: 'error', code: 'internal' }`
   - FunctionsRelayError → `{ status: 'error', code: 'internal' }`
3. **`useSessionStore.deleteAccount` cleanup chain order** (assert via spy on `queryClient.clear`, the three store resets, and `setState({ session: null })`):
   - mock `deleteAccountFn` (feature-access) to resolve ok
   - assert: `logOutRevenueCat()` ran BEFORE the RPC
   - assert: `queryClient.clear()` ran
   - assert: `useReceiptsStore.resetAll()` ran
   - assert: `useProStore.reset()` ran
   - assert: `useHouseholdStore.reset()` ran
   - assert: `useSessionStore.session` is null
   - mock RPC error → assert NO store resets ran (cleanup is gated on success)
   - mock `logOutRevenueCat` rejection → assert it does NOT throw (swallowed silently)

### `mobile/supabase/tests/delete-account.sql` (NEW)

A single `do $$ begin ... assert ... end $$;` block (pattern from `household-gate-tier.sql`). Six sections:

1. **Catalog**: `public.delete_user_account(uuid)` exists, is `SECURITY DEFINER`, owned by `postgres`, `returns text`. EXECUTE granted to `service_role` ONLY (anon/public/authenticated revoked). Pin the function signature exactly.
2. **Cascade** — seed a user with rows in profiles, stores, purchases, purchase_items, scan_usage, monthly_user_totals, category_budgets, webhook_events, categories (user row), households (as owner, solo), household_members (owner role), invite_codes (created by user), parse_attempts (no FK), and a `storage.objects` row in `receipts` bucket whose `name = user_id || '/receipt-1.jpg'`. Set `request.jwt.claims = {"sub": user_id}`, call the RPC, assert every row is gone EXCEPT `webhook_events` (which cascades too — assert empty) and the storage bucket (assert empty).
3. **Household owner with active member is BLOCKED** — seed user as `households.created_by` + a `household_members` row for another user. Call the RPC, assert: exception text is exactly `'owner_must_disband_first'`, no `auth.users` row was deleted (still present), every per-user row still exists.
4. **Solo owner is NOT blocked** — seed user as `households.created_by` + a single `household_members` row for self (role='owner'). Call the RPC, assert: returns `'ok'`, every row deleted.
5. **Idempotency** — call the RPC a second time on a deleted user, assert it returns `'already_deleted'` (no exception, no further DB writes).
6. **Re-signup with same email** — after deletion, `insert into auth.users(...)` with the same email succeeds (no unique constraint blocks it).

### `mobile/package.json`

- Add `"test:delete-account": "node scripts/test-delete-account.mjs"` to `scripts`.
- Add `"pnpm test:delete-account &&"` to the master `pnpm test` chain (after `test:webhook-idempotency` to mirror the webhook-vs-RPC grouping).
- Mirror `test:sql` registration in `scripts/test-db-smoke.mjs` — add `mobile/supabase/tests/delete-account.sql` to the file list so `pnpm test:sql` runs it (Docker required; same posture as the other 5 smoke tests).

## 12. Deployment & config

`mobile/supabase/config.toml` — add after the existing `[functions.parse-ticket]` block:

```toml
# delete-account authenticates with the user's own JWT (verified by the
# gateway) — no shared secret. Mirrors parse-ticket's verify_jwt = true
# (REQ-ACCTDEL-7 / design D7).
[functions.delete-account]
verify_jwt = true
```

Deploy sequence:

```bash
# 1. Set the new secret (one-time per environment).
supabase secrets set REVENUECAT_SECRET_API_KEY=rc_sk_xxx --project-ref <ref>

# 2. Apply the migration. CI uses `supabase db push`; locally it's
#    `supabase db reset --local` then `supabase db push` for prod.
supabase db push --project-ref <ref>

# 3. Deploy the function. CI wires this into a GitHub Actions workflow.
supabase functions deploy delete-account --project-ref <ref>
```

**Pre-deploy gate:** the migration is committed but the function is NOT deployed until the secret is set. The CI `db-smoke` job runs `delete-account.sql` against a scratch DB (where `service_role` EXISTS by default — the smoke test still works); the production deploy script aborts if `REVENUECAT_SECRET_API_KEY` is unset in the environment.

## 13. Rollback plan

Drop in reverse dependency order. The SQL migration is the ONLY artifact that cannot be naively dropped — see callout.

| Step | Action | Files / SQL |
|---|---|---|
| 1 | Revert the new row + the danger tone on `AccountSettingsList` + the danger section wrapper. | `mobile/src/app/(tabs)/profile.tsx`, `mobile/src/features/profile/components/AccountSettingsList.tsx` |
| 2 | Delete the screen + the organism + the i18n keys (3 locales × 17 + 1 = 52 keys). | `mobile/src/app/settings/delete-account.tsx`, `mobile/src/components/organisms/TypedConfirmation/`, `mobile/src/i18n/locales/{es-AR,en,pt-BR}/settings.json` + `auth.json` |
| 3 | Revert the store action + the wrapper. | `mobile/src/features/auth/use-session-store.ts`, `mobile/src/lib/supabase/feature-access.ts` |
| 4 | Remove the function + the shared lib + the config block + the env secret. | `mobile/supabase/functions/delete-account/`, `mobile/supabase/functions/_shared/service-client.ts`, `mobile/supabase/config.toml`, `supabase secrets unset REVENUECAT_SECRET_API_KEY` |
| 5 | Remove the test scripts + the smoke test + the package.json entry. | `mobile/scripts/test-delete-account.mjs`, `mobile/supabase/tests/delete-account.sql`, `mobile/scripts/test-db-smoke.mjs`, `mobile/package.json` |
| 6 | **DO NOT drop the migration without review** — keep `0036_delete_account.sql` applied and disable the function instead (flip `verify_jwt = false`? no — better: redeploy the previous function-less state by removing the `[functions.delete-account]` block). Manual `auth.admin.deleteUser` via dashboard continues to work; the RPC stays available but unreachable. | If a rollback-to-zero is mandatory: `drop function if exists public.delete_user_account(uuid);` — the `IF EXISTS` guards against missing-state. |

## 14. Open technical decisions

1. **`webhook_events` ledger row insertion location** — spec REQ-ACCTDEL-13 wants a `('ACCOUNT_DELETION', user_id, now())` row BEFORE the cascade. **Decision: insert from the edge function AFTER the RPC returns `'ok'`**, not from inside the RPC. Rationale: (a) the RPC runs under SECURITY DEFINER with `current_user = postgres`; inserting via `service_role` from the edge function keeps the audit write attributable to a known service identity; (b) if the RPC fails after the cascade but before returning (e.g. network blip between RPC and client), a pre-cascade row would persist for a `user_id` that no longer has a profile — an orphan. Inserting AFTER success guarantees the row corresponds to a confirmed deletion. Tradeoff: a crash between the RPC return and the insert leaves the ledger without a row, but `auth.users` is already gone so a future operator can reconstruct from Supabase logs.
2. **Cross-route typed-value preservation (REQ-HOUSE-DEL-2)** — the typed value should survive the trip to `/settings/household`. Approach: lift the typed-confirmation state up to the `useSessionStore.deleteAccount()` caller via a new transient field `useSessionStore.deleteAccountDraft: { typedValue: string } | null` (cleared after success or after a "give up" tap on the household screen). The screen writes the draft on every keystroke (cheap; it's a string). On return from `/settings/household`, the screen reads `deleteAccountDraft` and seeds its `useState` from it. Alternative (rejected): Expo Router's `router.navigate` with params — params round-trip through URL encoding which leaks the literal `ELIMINAR` into the nav log.

## 15. What / Why / Where / Learned

**What**: Concrete technical design for `delete-account` — migration `0036_delete_account.sql` (SECURITY DEFINER RPC orchestrating Storage sweep + parse_attempts scrub + household pre-flight + auth.users delete), edge function `delete-account` (verify_jwt=true, RC REST revoke first, idempotent envelope), client wrapper `deleteAccount()` returning `DeleteAccountResult`, store action `useSessionStore.deleteAccount()` running the manual cleanup chain, `TypedConfirmation` organism (standalone, not a dialog slot), `src/app/settings/delete-account.tsx`, danger-toned profile row via `AccountSettingRow.tone`, and 17+1 i18n keys across 3 locales.

**Why**: `revenuecat-webhook` is the right pattern mirror (service-role client, idempotent 200-no-op envelope, identical RPC ownership contract). Decision 1 (household block), Decision 3 (server-side RC revoke), and Decision 6 (parse_attempts scrub) all collapse into a single SECURITY DEFINER transaction so a partial failure leaves no orphan state. The TypedConfirmation is a standalone organism because the dialog store's API doesn't model a controlled input — extending it would leak into every dialog call site.

**Where**: `mobile/supabase/migrations/0036_delete_account.sql`, `mobile/supabase/functions/delete-account/{index.ts, lib/revenuecat.ts}`, `mobile/supabase/functions/_shared/service-client.ts`, `mobile/supabase/config.toml`, `mobile/supabase/tests/delete-account.sql`, `mobile/src/lib/supabase/feature-access.ts`, `mobile/src/features/auth/use-session-store.ts`, `mobile/src/components/organisms/TypedConfirmation/{index.tsx, types.ts, lib/match.ts}`, `mobile/src/app/settings/delete-account.tsx`, `mobile/src/app/(tabs)/profile.tsx`, `mobile/src/features/profile/components/AccountSettingsList.tsx`, `mobile/src/i18n/locales/{es-AR,en,pt-BR}/{settings,auth}.json`, `mobile/scripts/test-delete-account.mjs`, `mobile/scripts/test-db-smoke.mjs`, `mobile/package.json`.

**Learned**: (a) `CREATE OR REPLACE FUNCTION` resets EXECUTE grants — the migration MUST include `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` in the same file (the 0029 §4 trap, confirmed in `household-gate-tier.sql`'s smoke test). (b) The `webhook_events` ledger becomes orphan-but-readable-only-to-service_role after the cascade — spec REQ-ACCTDEL-13 surfaces this so audits don't flag it as a leak. (c) `auth.users` deletion does NOT invalidate live JWTs (still valid until expiry, ~1h) — accepted risk per spec; RLS surfaces empty results so no row-level leak. (d) `supabase.auth.signOut()` is NEVER called on hard delete, so the `SIGNED_OUT` listener never fires — `deleteAccount()` must run the cleanup chain manually (mirror of `use-session-store.ts:285-300`). (e) The shared `_shared/service-client.ts` refactor keeps the diff smaller than two parallel copies and centralizes the `auth.persistSession: false` invariant.

---

**Next phase**: `sdd-tasks` — break this design into concrete, ordered, reviewable work units. Estimated diff footprint: SQL ~80 lines + edge fn ~100 lines + client ~250 lines + i18n ~60 lines + tests ~200 lines = ~690 changed lines across 12 files. **High risk** against the 400-line PR review budget — chained PRs (DB+RPC one PR, client one PR, tests+i18n one PR) likely.
