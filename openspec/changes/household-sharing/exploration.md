# Exploration: Household Sharing

## Current State

### Data Model
- **`profiles`** — 1:1 with `auth.users`. Has `monthly_budget`, `currency`, `tier`. RLS: own-row only.
- **`purchases`** — user-scoped (`user_id` FK). RLS: `purchases_select_own` — `auth.uid() = user_id`.
- **`purchase_items`** — scoped via parent `purchases` join. RLS: join-through on `p.user_id = auth.uid()`.
- **`stores`** — user-scoped + global chains (`user_id IS NULL`). RLS: own or global.
- **`category_budgets`** — per-user, per-category, per-month. RLS: own-row only.
- **`scan_usage`** — per-user, per-month. RLS: own-row only.

### RPCs (all `security invoker`, `auth.uid()`-scoped)
- `monthly_category_totals(p_year_month)` — per-category spend for one month
- `monthly_purchases_total(p_year_month)` — total paid for one month

### Client Architecture
- **Feature-based** (`src/features/{home,analytics,budget,profile,...}`)
- **Data access seam** (`src/lib/supabase/feature-access.ts`) — all reads funnel through discriminated results
- **Query keys** (`src/lib/query-keys.ts`) — user-scoped, per-domain
- **Zustand stores** — `use-settings-store` (has `household_sharing: boolean` + `setHouseholdSharing` — **currently a no-op**), `use-receipts-store` (hydrated from the home feed query)
- **TanStack Query** — server-state cache, keyed by `userId`

### Existing Household Hooks
- Profile screen toggle calls `setHouseholdSharing(v)` in zustand + the API no-op function
- `use-settings-store` persists `household_sharing: boolean` locally (no backend)
- `src/features/profile/api.ts` — `setHouseholdSharing` is a documented TODO

### Key Files Affected
- `supabase/migrations/0001_initial_schema.sql` — RLS policies, storage policies
- `supabase/migrations/0013_category_budgets.sql` — `monthly_category_totals` RPC
- `supabase/migrations/0010_monthly_purchases_total.sql` — `monthly_purchases_total` RPC
- `src/lib/supabase/feature-access.ts` — read seam (category totals, monthly total, budgets)
- `src/lib/query-keys.ts` — all cache keys are user-scoped
- `src/features/home/api.ts` — `readPurchaseList`, `searchPurchaseItems`
- `src/features/home/hooks/useHomeFeed.ts` — feed aggregation, search, store detail
- `src/stores/use-settings-store.ts` — household_sharing state
- `src/features/profile/api.ts` — household sharing write
- `src/app/(tabs)/profile.tsx` — household toggle UI
- `src/types/index.ts` — domain types

---

## 1. Invite Flow

### Options

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **Code-based (WhatsApp-style)** | Natural for Uruguayan market (WhatsApp ubiquity), shareable via any channel, no email dependency, works without account discovery | Code can be forwarded/screenshot; need expiry + single-use enforcement | Low |
| **Deep link** | One-tap join, seamless UX | Requires the invitee to have the app installed, harder to share via WhatsApp text, OS-level handling quirks | Medium |
| **Email-based** | Discoverable, cross-platform | Uruguay has low email usage among younger demographics, requires email input validation, slower flow | High |

### Recommendation: Code-based (WhatsApp-style)

**Rationale**: Uruguay's communication is overwhelmingly WhatsApp-based. A 6-digit code that can be typed or copied into WhatsApp is the most natural flow. The code should be:
- **6 alphanumeric characters** (case-insensitive, no ambiguous chars like 0/O, 1/I/L)
- **72-hour expiry** (long enough for async WhatsApp back-and-forth)
- **Single-use** (consumed on first join)
- **Rate-limited**: max 3 active codes per household owner per 24h

### Code Lifecycle
```
Owner generates code → stored in `household_invites` table (hashed)
  → Owner shares code via WhatsApp
  → Invitee enters code in app
  → Backend validates: not expired, not consumed, household exists
  → Invitee added as member
  → Code marked consumed
```

---

## 2. Sharing Levels

### Options

| Level | Description | Privacy | Complexity |
|-------|-------------|---------|------------|
| **A: View-only totals** | Monthly totals per category, no item detail | High privacy — only aggregated numbers visible | Low |
| **B: Totals + categories + store names** | Category totals, store names, item counts, but no individual items or receipt images | Medium privacy — can see WHERE money was spent, not exactly what | Medium |
| **C: Full shared access** | Everything: items, images, receipt details | Low privacy — complete transparency | High (storage sharing, image access) |

### Recommendation: Level B as default, Level C as upgrade

**Rationale**:
- **Level A** is too restrictive — the primary value of household sharing is knowing what was bought and where (e.g., "did we already buy milk?").
- **Level B** is the sweet spot: you can see categories and store names (useful for coordination) without exposing individual items (some purchases are personal).
- **Level C** (full access) should be offered as an explicit opt-in per household — useful for couples who share everything, but not the right default for roommates or parents/children.
- **Privacy by default** is the correct posture. Escalating from B→C is a conscious decision.

### Implementation
- Store `sharing_level` on `household_members` (owner sets it per member, or per household default)
- Level A: RPCs return only `category_totals` aggregated, no `items`, no `stores`
- Level B: RPCs return `category_totals` + `store_name` but no `items`, no `image_url`
- Level C: Full access, no filtering

---

## 3. Permissions Model

### Roles

| Permission | Owner | Member |
|------------|-------|--------|
| View shared data | ✅ | ✅ (per sharing level) |
| Scan receipts | ✅ | ✅ (own receipts only) |
| Invite members | ✅ | ❌ |
| Remove members | ✅ | ❌ (can self-remove) |
| Set sharing level | ✅ (global + per-member) | ❌ |
| Set shared budgets | ✅ | ❌ |
| Edit/delete own receipts | ✅ | ✅ |
| Edit/delete others' receipts | ❌ | ❌ |
| Leave household | ✅ (only if >1 member, or dissolves household) | ✅ |
| Dissolve household | ✅ (only owner) | ❌ |

**Key decisions**:
- **Only the owner can invite** — prevents unauthorized membership growth
- **Members can self-remove** — respects autonomy
- **Owner cannot see member receipts at item level unless Level C** — privacy boundary
- **No admin/member distinction beyond owner** — simple, two-role model

---

## 4. Data Model

### New Tables

```sql
-- Households: 1 owner, N members
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null default 'Mi hogar',
  created_at  timestamptz not null default now()
);

-- Members: who belongs to which household
create table public.household_members (
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'member')),
  sharing_level text not null default 'level_b' check (sharing_level in ('level_a', 'level_b', 'level_c')),
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Invites: codes for joining
create table public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  code          text not null unique,  -- stored hashed (bcrypt/argon2)
  created_by    uuid not null references public.profiles(id) on delete cascade,
  expires_at    timestamptz not null,
  consumed_by   uuid references public.profiles(id),
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Index for code lookup
create index household_invites_code_idx on public.household_invites (code)
  where consumed_by is null and expires_at > now();
```

### User→Household FK

Add to `profiles`:
```sql
alter table public.profiles
  add column household_id uuid references public.households(id);
```

This denormalizes for fast lookup (avoiding a join through `household_members` on every query). The source of truth is `household_members`.

### RLS Policies

```sql
-- Helper function: check if user is member of a household
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql security invoker stable set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  )
$$;

-- households: members can read, owner can update
create policy "households_select_member" on public.households
  for select using (public.is_household_member(id));

create policy "households_update_owner" on public.households
  for update using (owner_id = auth.uid());

-- household_members: members can read their own household's membership list
create policy "household_members_select_own_household" on public.household_members
  for select using (public.is_household_member(household_id));

-- Only owner can insert/remove members
create policy "household_members_insert_owner" on public.household_members
  for insert with check (
    exists (
      select 1 from public.households
      where id = household_id and owner_id = auth.uid()
    )
  );

create policy "household_members_delete_owner" on public.household_members
  for delete using (
    exists (
      select 1 from public.households
      where id = household_id and owner_id = auth.uid()
    )
  );

-- Invites: owner can read/create, anyone can read their own consumed invite
create policy "household_invites_select_owner" on public.household_invites
  for select using (
    exists (
      select 1 from public.households
      where id = household_id and owner_id = auth.uid()
    )
  );

create policy "household_invites_insert_owner" on public.household_invites
  for insert with check (
    exists (
      select 1 from public.households
      where id = household_id and owner_id = auth.uid()
    )
  );
```

### RPC Changes

All existing RPCs need a `p_household_id` parameter (optional) to scope queries to household members when sharing is active:

```sql
-- Example: monthly_category_totals with household support
create or replace function public.monthly_category_totals(
  p_year_month text,
  p_household_id uuid default null
)
returns table (...)
language sql security invoker stable set search_path = public as $$
  with household_user_ids as (
    select user_id from public.household_members
    where household_id = p_household_id
    union
    select auth.uid()  -- always include self
  )
  select ...
  from purchase_items pi
  join purchases p on p.id = pi.purchase_id
  where p.user_id in (select user_id from household_user_ids)
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  ...
$$;
```

**Affected RPCs**:
- `monthly_category_totals` — add `p_household_id` parameter
- `monthly_purchases_total` — add `p_household_id` parameter

**New RPCs needed**:
- `accept_household_invite(p_code text)` — validate code, add member, return household_id
- `leave_household()` — remove self from household (or dissolve if owner + last member)
- `dissolve_household()` — owner-only, delete household + all memberships

---

## 5. Shared Budgets

### Options

| Approach | Pros | Cons |
|----------|------|------|
| **Per-user budgets** (current model) | Simple, no conflict, each person controls their own spending | Doesn't represent "household spending limit" — each person sees different budget bars |
| **Per-household budgets** | Single source of truth for "how much do we spend as a household" | Conflict if both users try to set it; needs role-based write access |
| **Hybrid: household global + per-user categories** | Household sets the monthly total; members set per-category budgets independently | More complex, but realistic — "we spend 50k/month total, but each decides their own food budget" |

### Recommendation: Per-user budgets remain, add household total

**Rationale**:
- **Keep `profiles.monthly_budget` as-is** — each user sees their own budget bar (personal accountability)
- **Add `households.monthly_budget`** — the household total, visible in a "Household" card on the home feed
- **`category_budgets` stay per-user** — no shared category budgets in V1; this avoids write conflicts and keeps the model simple
- The household total is the SUM of all members' purchases for the month, compared against `households.monthly_budget`

---

## 6. Feed & History Views

### When Household Sharing Is Active

**Home Feed**:
- Add a "Household" card at the top showing the household total for the current month (like the existing budget bar, but for the household)
- Personal receipts + household receipts are **merged** in the feed
- **Visual distinction**: household member receipts get a subtle colored dot/avatar next to the store name (e.g., green dot for "partner's receipt")
- Receipts are still owned by their scanner — tapping a receipt opens YOUR receipt (or, at Level C, the full detail of anyone's receipt)

**History Tab**:
- When household is active, add a toggle: "Mi gasto" | "Hogar" (personal vs household view)
- "Mi gasto" shows only the user's receipts (current behavior)
- "Hogar" shows all household members' receipts merged, with per-member subtotals visible
- Month selector works the same way — it's the union of months with data from any household member

**Analytics Tab**:
- Household view: category totals aggregated across all members
- Personal view: category totals for the user only (current behavior)
- Toggle similar to History

**Key UX principle**: The user always sees their own data first. Household data is an opt-in view, not a replacement.

---

## 7. Tech Constraints & RLS Impact

### RLS Strategy

**Option A: Modify existing RLS policies to check household membership**
- Pros: No query changes needed for basic reads
- Cons: Complex policy logic, every table gets household-aware policies, harder to audit

**Option B: RPC-only approach — all household queries go through new/modified RPCs**
- Pros: Clean separation, existing RLS stays untouched for personal queries
- Cons: More RPCs, client must decide whether to call personal or household RPC

### Recommendation: Option B (RPC-only for household queries)

**Rationale**: The existing RLS policies are clean, well-documented, and user-scoped. Modifying them to be household-aware adds complexity to every policy on every table. Instead:
- Personal queries continue through existing paths (RLS unchanged)
- Household queries go through new/modified RPCs that accept `p_household_id`
- The RPCs use `security invoker` + `auth.uid()` check (must be a member of the household to call)

### Storage (Receipt Images)

- Receipt images stay in the user's own folder (`<user_id>/<file>`)
- For Level C sharing, add a **signed URL mechanism**: the RPC generates a temporary signed URL that household members can use to view the image
- Level A/B: `image_url` is excluded from the returned data — no storage access needed

### Cache Invalidation

- All query keys currently embed `userId`. For household queries, keys become `[...key, householdId]`
- When a member scans a receipt, invalidate the household cache for all members (via a Supabase Realtime broadcast or a simple refetch-on-focus)
- **V1 approach**: Refetch on screen focus (simpler, no Realtime setup). Realtime updates are a V2 optimization.

---

## 8. UI/UX Flow Sketch

### Screens

```
Profile → "Uso compartido del hogar" (existing toggle)
  → When enabled: navigate to new Household setup flow

Household Setup (new screen group)
  ├── Create Household → generates code → share via WhatsApp
  ├── Join Household → enter code → join
  └── Household Settings (owner only)
      ├── Members list (avatars, roles, sharing levels)
      ├── Invite code display + regenerate
      ├── Shared budget setting
      └── Leave/Dissolve household

Home Feed (modified)
  └── Household summary card (new, when household active)

History Tab (modified)
  └── "Mi gasto" / "Hogar" toggle (new, when household active)

Analytics Tab (modified)
  └── "Mi gasto" / "Hogar" toggle (new, when household active)
```

### Navigation Flow

```
Profile toggle ON
  → No household? → Create or Join modal
  → Has household? → Navigate to Household Settings

Create flow:
  1. "Crear hogar" → name input (default: "Mi hogar")
  2. Code generated → display code + "Compartir por WhatsApp" button
  3. Waiting state: "Esperando a que se una..."
  4. Member joins → notification + member appears in list

Join flow:
  1. Enter 6-digit code
  2. Validates → shows household name + member count
  3. Confirm → joined → navigate to home
```

---

## 9. Risks and Open Questions

### Risks

1. **RLS complexity explosion** — Every new table and RPC must be household-aware. Mitigation: RPC-only approach keeps existing RLS clean.

2. **Cache coherency** — When one member scans, others don't see it until refetch. Mitigation: Focus-triggered refetch is good enough for V1.

3. **Image sharing at Level C** — Signed URLs add complexity and have security implications (URL leakage). Mitigation: Short-lived URLs (5 min), logged access.

4. **Migration risk** — Adding `household_id` to `profiles` is a nullable FK (safe), but bulk updates later could be risky. Mitigation: Nullable FK, backfill only when household is created.

5. **Code abuse** — Forwarded codes could let unintended people join. Mitigation: Single-use, 72h expiry, owner confirms membership (optional V2 feature).

### Open Questions

1. **Should the owner confirm new members?** (V1: no — code is implicit consent. V2: yes — pending members list)
2. **Can a household have multiple owners?** (V1: no — single owner. V2: co-owner role)
3. **What happens when the owner deletes their account?** (Dissolve household? Transfer ownership?)
4. **Mixed currencies?** (V1: no — household members must share the same currency. V2: multi-currency support)
5. **Is household sharing a Pro feature?** (Recommendation: Yes — it's a premium feature that drives subscription value)

---

## 10. Complexity Estimates

| Sub-feature | Size | Notes |
|-------------|------|-------|
| Database schema (tables, RLS, indexes) | **M** | 3 new tables, 1 column on profiles, ~12 RLS policies |
| Invite flow (generate, share, consume, expire) | **M** | Code generation, validation RPC, expiry logic |
| Household RPCs (category_totals, purchases_total) | **M** | Modify 2 existing RPCs, add 1 new param each |
| Accept invite + leave/dissolve RPCs | **S** | 3 new RPCs, straightforward |
| Home feed household card | **S** | New card component, household total query |
| History "Mi gasto/Hogar" toggle | **M** | Toggle UI, conditional query, merged feed logic |
| Analytics "Mi gasto/Hogar" toggle | **M** | Same pattern as History |
| Profile household settings screen | **M** | New screen group, members list, code display |
| Sharing level enforcement | **S** | Filter fields in RPC responses based on level |
| Image sharing (Level C) | **M** | Signed URL generation, access logging |
| Cache key refactoring (query keys) | **S** | Add householdId to relevant keys |
| Zustand store updates | **S** | Add household state, member list, sharing level |
| **Total** | **L** | ~12 sub-features, multiple screens + DB changes |

### Recommended Implementation Order

1. **Phase 1 — Foundation** (M): Schema + RLS + invite flow RPCs
2. **Phase 2 — Core Sharing** (M): Modified RPCs + household settings screen
3. **Phase 3 — Feed Integration** (M): Home card + History/Analytics toggles
4. **Phase 4 — Polish** (S): Sharing levels + image sharing + cache optimization

---

## Ready for Proposal

**Yes** — the exploration covers all 7 dimensions with concrete recommendations, data model sketches, API surface changes, UI flow, risks, and complexity estimates. The orchestrator should proceed to `sdd-propose` with this exploration as input.
