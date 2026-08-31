# Design: Household Sharing

## Technical Approach

RPC-only household queries. Existing user-scoped RLS stays untouched — personal queries follow the same paths they always have. Household queries go through new/modified RPCs that accept an optional `p_household_id` parameter. The client decides personal vs household path based on the user's household membership state (hydrated from `profiles.household_id`). This matches the exploration's approved Option B and avoids a full RLS overhaul.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Household query scope | Modify RLS policies vs RPC-only | RLS change = every table + every policy + audit nightmare. RPC-only = clean separation, existing policies untouched | **RPC-only** |
| Code storage | Hashed vs plaintext | Hashed = secure but no "show me my code" flow. Plaintext = simple, codes are single-use 72h tokens, not secrets | **Plaintext** (6-char codes are disposable tokens, not passwords) |
| Household state source | Profile denormalization vs join-only | Denorm = O(1) lookup, one write on join/leave. Join-only = no denorm drift risk, but extra query on every household decision | **Denormalize** `profiles.household_id` |
| Account deletion | Dissolve household vs transfer ownership vs block | Block = bad UX. Dissolve = loses other members' household. Transfer = respects tenure | **Transfer** ownership to longest-tenured member |
| Cache invalidation | Realtime broadcast vs refetch-on-focus | Realtime = instant sync, setup cost. Focus refetch = simple, V1-sufficient | **Refetch on focus** (V1) |

## Database Layer

### New Tables

```sql
-- 1. households
create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Mi hogar',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2. household_members (composite PK)
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- 3. invite_codes
create table public.invite_codes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code         text not null unique,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  expires_at   timestamptz not null,
  consumed_by  uuid references public.profiles(id),
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Index for code lookup (active codes only)
create index invite_codes_active_idx on public.invite_codes (code)
  where consumed_by is null and expires_at > now();
```

### ALTER profiles

```sql
alter table public.profiles
  add column household_id uuid references public.households(id);
```

### RLS Policies

```sql
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invite_codes enable row level security;

-- Helper: am I a member of this household?
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql security invoker stable set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  )
$$;

-- households: members read, owner updates
create policy "households_select_member" on public.households
  for select using (public.is_household_member(id));
create policy "households_update_owner" on public.households
  for update using (created_by = auth.uid());
create policy "households_insert_self" on public.households
  for insert with check (created_by = auth.uid());

-- household_members: members read own household, RPC handles writes
create policy "household_members_select" on public.household_members
  for select using (public.is_household_member(household_id));
-- Insert/delete handled by RPCs only (no direct client writes)

-- invite_codes: owner reads/creates, joiner reads own consumed
create policy "invite_codes_select_owner" on public.invite_codes
  for select using (
    exists (select 1 from public.households where id = household_id and created_by = auth.uid())
  );
create policy "invite_codes_select_consumed" on public.invite_codes
  for select using (consumed_by = auth.uid());
create policy "invite_codes_insert_owner" on public.invite_codes
  for insert with check (
    exists (select 1 from public.households where id = household_id and created_by = auth.uid())
  );
```

### RPCs

```sql
-- Generate invite code (owner only, rate-limited to 3 active/24h)
create or replace function public.generate_invite_code(p_household_id uuid)
returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_code text;
  v_count int;
begin
  -- Rate limit: max 3 active codes per household per 24h
  select count(*) into v_count
  from public.invite_codes
  where household_id = p_household_id
    and consumed_by is null
    and expires_at > now()
    and created_at > now() - interval '24 hours';
  if v_count >= 3 then
    raise exception 'RATE_LIMIT';
  end if;
  -- Generate 6-char code (no ambiguous chars)
  v_code := upper(
    substr(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      encode(gen_random_bytes(4), 'base64'),
      '0','a'),'1','b'),'O','c'),'I','d'),'L','e'),'l','f'),'|','g'),'+','h'),'=','i'),'/','j'),
      1, 6));
  insert into public.invite_codes (household_id, code, created_by, expires_at)
  values (p_household_id, v_code, auth.uid(), now() + interval '72 hours');
  return v_code;
end;
$$;

-- Accept invite code (any authenticated user, max 5 members)
create or replace function public.accept_invite_code(p_code text)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_invite record;
  v_member_count int;
begin
  select * into v_invite
  from public.invite_codes
  where upper(code) = upper(p_code)
    and consumed_by is null
    and expires_at > now();
  if not found then
    raise exception 'INVALID_CODE';
  end if;
  -- Max 5 members
  select count(*) into v_member_count
  from public.household_members
  where household_id = v_invite.household_id;
  if v_member_count >= 5 then
    raise exception 'HOUSEHOLD_FULL';
  end if;
  -- Prevent self-invite
  if v_invite.created_by = auth.uid() then
    raise exception 'SELF_INVITE';
  end if;
  -- Prevent duplicate membership
  if exists (
    select 1 from public.household_members
    where household_id = v_invite.household_id and user_id = auth.uid()
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;
  -- Insert membership
  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, auth.uid(), 'member');
  -- Denormalize onto profiles
  update public.profiles set household_id = v_invite.household_id where id = auth.uid();
  -- Mark consumed
  update public.invite_codes set consumed_by = auth.uid(), consumed_at = now()
  where id = v_invite.id;
  return v_invite.household_id;
end;
$$;

-- Leave household (transfer ownership if owner + >1 member)
create or replace function public.leave_household()
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_hid uuid;
  v_role text;
  v_member_count int;
  v_new_owner uuid;
begin
  select household_id, role into v_hid, v_role
  from public.household_members
  where user_id = auth.uid();
  if not found then
    raise exception 'NOT_IN_HOUSEHOLD';
  end if;
  select count(*) into v_member_count
  from public.household_members where household_id = v_hid;
  if v_role = 'owner' and v_member_count > 1 then
    -- Transfer to longest-tenured member
    select user_id into v_new_owner
    from public.household_members
    where household_id = v_hid and user_id != auth.uid()
    order by joined_at asc limit 1;
    update public.household_members set role = 'owner'
    where household_id = v_hid and user_id = v_new_owner;
    update public.households set created_by = v_new_owner
    where id = v_hid;
  end if;
  -- Remove membership
  delete from public.household_members
  where household_id = v_hid and user_id = auth.uid();
  -- Clear denorm
  update public.profiles set household_id = null where id = auth.uid();
  -- If last member left, dissolve
  if (select count(*) from public.household_members where household_id = v_hid) = 0 then
    delete from public.households where id = v_hid;
  end if;
end;
$$;

-- Dissolve household (owner only)
create or replace function public.dissolve_household()
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_hid uuid;
begin
  select id into v_hid from public.households where created_by = auth.uid();
  if not found then
    raise exception 'NOT_OWNER';
  end if;
  -- Clear denorm for all members
  update public.profiles set household_id = null
  where household_id = v_hid;
  -- CASCADE deletes household_members and invite_codes
  delete from public.households where id = v_hid;
end;
$$;
```

### Modified RPCs

Both existing RPCs get an optional `p_household_id uuid default null`. When null, behavior is unchanged (backward compatible). When set, the WHERE clause expands to include all household members:

```sql
-- monthly_category_totals (modified — add p_household_id)
-- Replace existing function. Key change: household_user_ids CTE
-- filters purchases to household members when p_household_id is set.
-- budget_limit LEFT JOIN stays scoped to auth.uid() (per-user budgets).

-- monthly_purchases_total (modified — same pattern)
-- Add p_household_id. When set, SUM across household members.
```

Both RPCs: if `p_household_id IS NOT NULL`, verify caller is a member via `is_household_member(p_household_id)` — non-members get zero results (not an error).

## API / Service Layer

### `src/lib/supabase/feature-access.ts`

Add new read functions:

| Function | Description |
|----------|-------------|
| `readHouseholdInfo(householdId)` | Read household name + member count (via `households` + `household_members` join) |
| `readHouseholdMembers(householdId)` | Read member list (user_id, role, joined_at, profiles.full_name) |
| `readActiveInviteCode(householdId)` | Read the current unconsumed code (if any) for display |

Modify existing functions:

| Function | Change |
|----------|--------|
| `readCategoryTotals(yearMonth, householdId?)` | Optional 2nd param, passed to RPC |
| `readMonthlyPurchasesTotal(yearMonth, householdId?)` | Optional 2nd param, passed to RPC |

New write functions (RPC calls):

| Function | Description |
|----------|-------------|
| `createHousehold(name)` | Insert into `households`, set profile denorm, return household_id |
| `generateInviteCode(householdId)` | Call RPC, return code string |
| `acceptInviteCode(code)` | Call RPC, return household_id |
| `leaveHousehold()` | Call RPC |
| `dissolveHousehold()` | Call RPC |

### `src/features/home/api.ts`

`readPurchaseList` gets an optional `householdId`. When set, add `.eq('purchases.user_id', household_user_ids)` — the household feed merges all members' receipts at the client level (Level B: totals + store names, no items from other members).

Actually, for Level B: the home feed does NOT show other members' individual items. It shows a **household summary card** with aggregated totals. Individual receipts stay personal. This means `readPurchaseList` stays personal-only; a new `readHouseholdFeed(householdId)` provides aggregated data (category totals, store totals, total amount).

## State Management

### `src/stores/use-settings-store.ts`

Replace the no-op `household_sharing` toggle with actual household state:

```ts
interface SettingsState {
  // ...existing fields...
  household_id: string | null;
  household_name: string | null;
  household_role: 'owner' | 'member' | null;
  setHouseholdState: (id: string | null, name: string | null, role: 'owner' | 'member' | null) => void;
}
```

The toggle on the profile screen becomes: "no household" → shows create/join options. "has household" → navigates to household settings. No more on/off toggle.

### `src/lib/query-keys.ts`

Add household-scoped keys:

```ts
householdInfo: (userId: string, householdId: string) =>
  ['household', 'info', userId, householdId] as const,
householdMembers: (userId: string, householdId: string) =>
  ['household', 'members', userId, householdId] as const,
householdCategoryTotals: (userId: string, householdId: string, yearMonth: string) =>
  ['household', 'analytics', 'category-totals', userId, householdId, yearMonth] as const,
householdPurchasesTotal: (userId: string, householdId: string, yearMonth: string) =>
  ['household', 'analytics', 'purchases-total', userId, householdId, yearMonth] as const,
```

### New Zustand Store: `src/stores/use-household-store.ts`

```ts
interface HouseholdState {
  householdId: string | null;
  householdName: string | null;
  role: 'owner' | 'member' | null;
  members: Array<{ user_id: string; full_name: string | null; role: string; joined_at: string }>;
  viewMode: 'personal' | 'household'; // toggle state for History/Analytics
  setViewMode: (mode: 'personal' | 'household') => void;
  hydrate: (data: { householdId: string | null; name: string | null; role: string | null }) => void;
  setMembers: (members: HouseholdState['members']) => void;
  reset: () => void;
}
```

## Component Architecture

### New Screens

| Path | Description |
|------|-------------|
| `src/app/settings/household.tsx` | Household management screen (members list, invite code, leave/dissolve) |
| `src/app/settings/invite.tsx` | Generate and share invite code (modal) |
| `src/app/settings/join.tsx` | Enter invite code (modal) |

### Modified Screens

| File | Change |
|------|--------|
| `src/app/(tabs)/profile.tsx` | Replace toggle with navigate-to-household flow |
| `src/app/pro/charts.tsx` | Add household view mode toggle when household active |
| `src/app/(tabs)/history.tsx` | Add household view mode toggle |
| `src/app/(tabs)/analytics.tsx` | Add household view mode toggle |
| `src/features/home/hooks/useHomeFeed.ts` | Add household summary card data when household active |

### New Components

| Path | Description |
|------|-------------|
| `src/features/household/` | New feature module (index.ts, api.ts, hooks/, components/) |
| `src/features/household/components/HouseholdCard.tsx` | Home feed card showing household total |
| `src/features/household/components/MemberList.tsx` | Members display (avatars, roles) |
| `src/features/household/components/InviteCodeDisplay.tsx` | Code + share button |
| `src/features/household/components/JoinCodeInput.tsx` | 6-digit code input |
| `src/features/household/hooks/useHousehold.ts` | Main household data hook (membership, members, role) |

## Navigation

```
Profile
  └─ "Hogar" row (not a toggle anymore)
      ├─ No household → push /settings/join (or /settings/invite if creating)
      └─ Has household → push /settings/household

/settings/household
  ├─ Members list
  ├─ Invite code (owner only, shows code + share)
  ├─ Leave household
  └─ Dissolve household (owner only, with confirmation)

/settings/invite (modal)
  └─ Shows generated code + "Compartir por WhatsApp"

/settings/join (modal)
  └─ 6-digit input → validate → confirm join → pop to home
```

## Migration Strategy

1. **Migration file**: `0014_household_sharing.sql` — all new tables, ALTER profiles, RPCs, RLS
2. **Backward compatibility**: `profiles.household_id` is nullable — existing users unaffected. Modified RPCs have `DEFAULT null` on the new param — existing callers pass zero args and get the same behavior.
3. **Feature flag**: The `household_sharing` boolean in settings store already exists. The UI uses it as a gate: only show household features when household_id is set on the profile. No server-side flag needed.
4. **No data migration**: Zero existing rows change. New columns are nullable. New tables start empty.
5. **Rollback**: Drop the new tables, drop the ALTER, revert the two RPCs. Zero data loss.

## Security

- **RLS**: All household writes go through RPCs with `security invoker` — `auth.uid()` is enforced. Non-members calling household RPCs get zero results (defensive, not error-leaking).
- **Invite codes**: Plaintext 6-char codes are disposable tokens, not secrets. Single-use + 72h expiry + rate limit (3 active/24h). No hashing needed.
- **Max 5 members**: Enforced in `accept_invite_code` RPC server-side.
- **Ownership transfer**: Server-side in `leave_household` RPC — longest-tenured member gets owner role atomically.
- **Account deletion**: A PostgreSQL trigger on `auth.users` delete (or Supabase webhook) calls `dissolve_household` for owners, or `leave_household` for members. This needs a `pg_trigger` or an edge function hook.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| RPC | `generate_invite_code`, `accept_invite_code`, `leave_household`, `dissolve_household` | SQL-level tests via `supabase db test` or manual psql scripts |
| RPC | Modified `monthly_category_totals` with `p_household_id` | Verify personal (null) and household paths return correct data |
| E2E | Create household → generate code → join → leave → dissolve | Manual flow test (no test runner configured) |
| Type | TypeScript types for new tables/hooks | `tsc --noOpen` via build command |

## Open Questions

- [ ] Account deletion hook: PostgreSQL trigger on `auth.users` or Supabase edge function webhook? (The existing `revenuecat-webhook` pattern suggests edge function, but triggers are simpler for cascade logic.) → **Still open.** No account-deletion trigger or webhook is implemented. `leave_household` promotes the longest-tenured member on manual leave, but automatic account-deletion handling remains unimplemented.
- [x] Should the home feed household card show per-member breakdown, or just the total? → **Resolved: total + member count only.** `HouseholdCard` shows the aggregate current-month total and member count, no per-member breakdown.
