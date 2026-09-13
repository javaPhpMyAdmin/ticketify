-- ============================================================================
-- Ticketify — user-categories schema + RLS smoke test (migration 0032)
--
-- A fail-closed schema + behavior smoke test for the user-scoped custom
-- categories change. It runs against a SCRATCH database (e.g. `supabase db
-- reset` output or a CI-local Postgres) — never against production. It does
-- NOT apply migrations; the catalog is whatever the migrations declare, then
-- the file seeds a minimal fixture and exercises the NEW contracts:
--
--   1. Catalog — migration 0032 contract:
--      `categories.user_id` (uuid, nullable, FK profiles ON DELETE CASCADE),
--      the old global `categories_slug_key` UNIQUE(slug) constraint GONE,
--      the two partial unique indexes (global slug + per-user slug) present
--      and unique, the (user_id, sort_order) index present, the kind CHECK
--      still in place (0001), RLS on with exactly the 4 policies
--      (select_auth + insert/update/delete_own), and
--      `purchase_items_category_id_fkey` switched to ON DELETE RESTRICT
--      (confdeltype 'r' — the block-delete backstop).
--   2. Partial unique index behavior: the same slug under two different
--      users is allowed; a duplicate slug for the SAME user raises 23505;
--      a duplicate GLOBAL slug raises 23505; the user_id FK cascades with
--      profiles (account deletion removes own categories in the same
--      statement).
--   3. kind CHECK: a kind outside ('need','want') raises check_violation —
--      null/unknown kinds never reach the row (creation UI requirement).
--   4. RLS write policies (as `authenticated` with a JWT sub claim):
--      insert/update/delete on the caller's OWN rows succeed; inserts with
--      another user's user_id or a NULL (global) user_id are blocked;
--      updates/deletes of global rows and other users' rows affect ZERO
--      rows; the select-all policy still lets authenticated users read the
--      13 canonical rows AND other users' custom rows.
--   5. FK RESTRICT behavior: deleting a referenced custom category raises
--      foreign_key_violation and does NOT re-bucket the item (no silent
--      'otros'); after the referencing purchase is removed, the empty
--      category deletes cleanly.
--   6. save_receipt (SECURITY DEFINER, 0032 §5) validates EVERY submitted
--      category_id server-side, on BOTH overloads: the 7-param signature
--      (0029) validates in its own body; the 6-param compat signature (0023)
--      is redefined by 0032 as a delegate to the 7-param (p_is_manual =>
--      false), so a 6-key HTTP RPC call (no p_is_manual key — PostgREST
--      selects overloads by argument count) can no longer smuggle another
--      user's category uuid past the definer (review gate BLOCKER, round 2).
--      A line referencing ANOTHER user's custom category raises and rolls
--      back; a global row, the caller's own row, and NULL all succeed — on
--      BOTH overloads. Raw SQL cannot behaviorally probe the 6-param path
--      (42P03 ambiguous_function while the 7-param default exists — PG 16
--      and 17 both), so §6.5b asserts the body contract on pg_proc and the
--      PostgREST behavioral probe is CI-gated.
--   7. Direct PostgREST-style write policies on purchase_items (0032 §3.5)
--      verify category ownership (definer functions are not the only path):
--      INSERT/UPDATE with another user's category uuid fail; the UPDATE
--      WITH CHECK must ALSO re-state parent-ownership (round-2 CRITICAL
--      closure — see 7b).
--   7b. Re-parenting guard (round-2 CRITICAL): the UPDATE WITH CHECK must
--      ALSO state parent-ownership. Per CREATE POLICY semantics, an UPDATE
--      policy's WITH CHECK — once present — is the ONLY new-row validator
--      (USING filters the old row), so a category-only WITH CHECK leaves
--      re-parenting A into B's purchase open. The 6.7 behavioral asserts
--      pin the closure; the introspection assert below is the RED→GREEN
--      proxy. Moving an item between the caller's OWN purchases stays
--      legal (0001 posture).
--   8. Global-vs-own coexistence + the user-first floor: a global row and
--      the caller's own row MAY share a slug (per-scope uniqueness), and
--      the categories_user_sort_order_floor CHECK (user_id is null or
--      sort_order >= 100) keeps every canonical slug sorting before any
--      custom row — the deterministic map winner for same-slug collisions.
--   9. Anon (LAST: role persists for the rest of the transaction): the
--      select policy targets authenticated only, so anon reads zero rows.
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as
-- pro-subscription.sql / household-totals.sql — `supabase db query
-- --local --file` prepares the file as one statement). Failing `assert`
-- aborts the block and fails the query (exit != 0).
--
-- Fixture notes: NONE of the seeded rows exist in the fresh chain
-- (0001-0032 seeds no auth.users/profiles rows with these fixed UUIDs), and
-- every insert is idempotent (`on conflict (...) do nothing` with fixed
-- UUIDs), so the file is safe to re-run. User A is set to tier 'pro' so the
-- save_receipt cases never hit the free-tier scan cap (deterministic).
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, never collide with real rows).
  v_user_a      uuid := 'a0000000-0000-0000-0000-00000000000a';
  v_user_b      uuid := 'b0000000-0000-0000-0000-00000000000b';
  v_cat_a       uuid := 'c0000000-0000-0000-0000-000000000001'; -- user A 'delivery'
  v_cat_b       uuid := 'c0000000-0000-0000-0000-000000000002'; -- user B 'delivery'
  v_cat_own     uuid; -- user A row created through RLS (insert policy)
  v_cat_farm    uuid := 'c0000000-0000-0000-0000-000000000004'; -- user A shadow of canonical 'farmacia'
  v_cat_rpc     uuid := 'c0000000-0000-0000-0000-000000000005'; -- user A 'rpc-own' (save_receipt positive case)
  v_global_farm uuid; -- canonical global 'farmacia' id (looked up, 0005)
  v_purchase    uuid := 'a0000000-0000-0000-0000-0000000000aa';
  v_item        uuid := 'b0000000-0000-0000-0000-0000000000aa';
  v_purchase2   uuid := 'a0000000-0000-0000-0000-0000000000bb'; -- direct-RLS negative fixture
  v_item2       uuid := 'b0000000-0000-0000-0000-0000000000bb';
  v_purchase_a1 uuid := 'a0000000-0000-0000-0000-0000000000c1'; -- A's purchase (re-parent source, §6.7)
  v_purchase_a2 uuid := 'a0000000-0000-0000-0000-0000000000c2'; -- A's purchase (re-parent target, §6.7)
  v_purchase_b  uuid := 'a0000000-0000-0000-0000-0000000000c3'; -- B's purchase (§2-seeded, §6.7 negative)
  v_item_a1     uuid := 'b0000000-0000-0000-0000-0000000000c1'; -- A's item under v_purchase_a1 (§6.7)
  v_rpc_ok      boolean;
  v_rpc_pid     uuid;
  v_has_default boolean;

  -- §1 catalog vars.
  v_tmp         text;
  v_is_unique   boolean;
  v_pred        text;
  v_rls         boolean;
  v_count       bigint;
  v_rows        int;
  v_blocked     boolean;
begin
  -- -------------------------------------------------------------------------
  -- 1. Catalog — migration 0032 contract
  -- -------------------------------------------------------------------------

  -- categories.user_id: uuid, nullable (null = global canonical row), FK to
  -- profiles ON DELETE CASCADE (mirrors stores, matches design D-storage).
  select data_type into v_tmp
    from information_schema.columns
   where table_schema = 'public' and table_name = 'categories' and column_name = 'user_id';
  assert v_tmp = 'uuid', 'categories.user_id must be uuid (0032)';

  select is_nullable into v_tmp
    from information_schema.columns
   where table_schema = 'public' and table_name = 'categories' and column_name = 'user_id';
  assert v_tmp = 'YES', 'categories.user_id must be nullable (NULL = global canonical row)';

  select c.confdeltype into v_tmp
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.conrelid = 'public.categories'::regclass
     and c.confrelid = 'public.profiles'::regclass
     and a.attname = 'user_id';
  assert v_tmp = 'c', 'categories.user_id FK must be ON DELETE CASCADE (profile deletion removes own categories)';

  -- The old global UNIQUE(slug) must be GONE — replaced by the partial
  -- unique indexes below. Its presence would break same-slug-across-users
  -- (spec "Same slug under different users").
  assert not exists (
    select 1 from pg_constraint
     where conrelid = 'public.categories'::regclass and conname = 'categories_slug_key'
  ), 'categories_slug_key (UNIQUE slug) must be dropped (replaced by partial unique indexes)';

  -- categories_global_slug_idx: UNIQUE(slug) WHERE user_id IS NULL.
  select i.indisunique, pg_get_expr(i.indpred, i.indrelid)
    into v_is_unique, v_pred
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'categories_global_slug_idx';
  assert v_is_unique, 'categories_global_slug_idx must be UNIQUE';
  assert v_pred like '(user_id IS NULL)%',
    'categories_global_slug_idx must be partial on user_id IS NULL (got: ' || coalesce(v_pred, '<null>') || ')';

  -- categories_user_slug_idx: UNIQUE(user_id, slug) WHERE user_id IS NOT NULL.
  select i.indisunique, pg_get_expr(i.indpred, i.indrelid)
    into v_is_unique, v_pred
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'categories_user_slug_idx';
  assert v_is_unique, 'categories_user_slug_idx must be UNIQUE';
  assert v_pred like '(user_id IS NOT NULL)%',
    'categories_user_slug_idx must be partial on user_id IS NOT NULL (got: ' || coalesce(v_pred, '<null>') || ')';

  -- categories_user_sort_idx: NON-unique (user_id, sort_order) helper.
  select i.indisunique, pg_get_expr(i.indpred, i.indrelid)
    into v_is_unique, v_pred
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'categories_user_sort_idx';
  assert not v_is_unique, 'categories_user_sort_idx must NOT be unique';
  assert v_pred is null, 'categories_user_sort_idx must have no predicate';

  -- kind CHECK (0001) still present — the DB backstop for need/want.
  assert exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.categories'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%need%'
       and pg_get_constraintdef(c.oid) like '%want%'
  ), 'categories.kind CHECK (need/want) must still exist (0001, unchanged)';

  -- User-first sort floor (0032 §2.5): custom rows must sort AFTER every
  -- canonical row. All 13 canonical rows use sort_order < 100 (0001 max 99
  -- 'otros', 0005 max 90), so the CHECK `user_id is null or sort_order >=
  -- 100` makes `order(sort_order, slug)` place global rows before user rows
  -- deterministically — the caller's own row is ALWAYS the map winner for a
  -- same-slug collision (see fix #3, user-first by construction).
  assert exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.categories'::regclass
       and c.conname = 'categories_user_sort_order_floor'
  ), 'categories_user_sort_order_floor CHECK (user_id is null or sort_order >= 100) must exist (0032)';
  assert (
    select pg_get_constraintdef(oid)
      from pg_constraint
     where conrelid = 'public.categories'::regclass
       and conname = 'categories_user_sort_order_floor'
  ) ilike '%user_id is null%' and (
    select pg_get_constraintdef(oid)
      from pg_constraint
     where conrelid = 'public.categories'::regclass
       and conname = 'categories_user_sort_order_floor'
  ) ilike '%sort_order%',
    'categories_user_sort_order_floor must check (user_id is null or sort_order >= 100)';

  -- RLS must remain enabled (0002) with exactly the 4 policies:
  -- select_auth (existing) + insert/update/delete_own (0032).
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'categories';
  assert v_rls, 'categories RLS must be enabled (0002)';

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'categories'
     and policyname in
       ('categories_select_auth', 'categories_insert_own',
        'categories_update_own', 'categories_delete_own');
  assert v_count = 4,
    'categories must have exactly the 4 policies (select_auth + insert/update/delete_own), got ' || v_count;

  -- The write policies must actually be auth.uid()-scoped (fail-closed: a
  -- policy that exists but grants everything would pass the count check).
  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'categories'
       and policyname = 'categories_insert_own' and cmd = 'INSERT'
       and with_check like '%auth.uid()%' and with_check like '%user_id%'
  ), 'categories_insert_own with_check must scope on auth.uid() = user_id';
  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'categories'
       and policyname = 'categories_update_own' and cmd = 'UPDATE'
       and qual like '%auth.uid()%' and with_check like '%auth.uid()%'
  ), 'categories_update_own must scope using/with check on auth.uid() = user_id';
  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'categories'
       and policyname = 'categories_delete_own' and cmd = 'DELETE'
       and qual like '%auth.uid()%'
  ), 'categories_delete_own must scope using on auth.uid() = user_id';

  -- purchase_items.category_id FK switched to ON DELETE RESTRICT —
  -- confdeltype 'r' (spec block-delete: 'n' (SET NULL) or 'a'/'d' fail).
  select c.confdeltype into v_tmp
    from pg_constraint c
   where c.conname = 'purchase_items_category_id_fkey'
     and c.conrelid = 'public.purchase_items'::regclass
     and c.confrelid = 'public.categories'::regclass;
  assert v_tmp = 'r',
    'purchase_items_category_id_fkey must be ON DELETE RESTRICT (confdeltype r), got: ' || coalesce(v_tmp, '<missing>');

  -- -------------------------------------------------------------------------
  -- 2. Fixtures — two profiles + canonical-row sanity (no backfill)
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated', 'cat-a@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_b, 'authenticated', 'authenticated', 'cat-b@test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, created_at)
  values
    (v_user_a, 'Cat A', 0, 'USD', now()),
    (v_user_b, 'Cat B', 0, 'USD', now())
  on conflict (id) do nothing;

  -- User B's purchase for the §6.7 re-parenting negative (inserted here as
  -- the superuser/migration role — the RLS write policies would block it
  -- later, and the WHOLE POINT is that A cannot re-parent into it). Stays
  -- as a persistent fixture like v_cat_b (fixed uuid, idempotent).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values ('a0000000-0000-0000-0000-0000000000c3', v_user_b, null, date '2026-08-11', 9.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  -- Deterministic save_receipt cases: user A is 'pro' so the scan cap never
  -- aborts the positive RPC call (returns ok=true regardless of re-runs).
  update public.profiles set tier = 'pro' where id = v_user_a;

  -- Migration 0032 is additive + nullable: the canonical rows keep
  -- user_id = NULL and the 13-seed taxonomy is untouched (8 from 0001 +
  -- 5 from 0005; 'otros' is the deterministic fallback row).
  select count(*) into v_count from public.categories where user_id is null;
  assert v_count = 13, 'canonical rows must stay at 13 with user_id NULL (no backfill), got ' || v_count;
  assert (select user_id from public.categories where slug = 'otros') is null,
    'canonical otros must keep user_id NULL';

  -- -------------------------------------------------------------------------
  -- 3. Partial unique index behavior (superuser migration role — RLS bypassed,
  --    the indexes are role-independent)
  -- -------------------------------------------------------------------------

  -- 3a. Same slug under different users ALLOWED (spec scenario).
  insert into public.categories (id, user_id, slug, name, kind, icon, color, sort_order)
  values (v_cat_a, v_user_a, 'delivery', 'Delivery', 'want', 'bicycle', '#10B981', 110)
  on conflict (id) do nothing;

  insert into public.categories (id, user_id, slug, name, kind, icon, color, sort_order)
  values (v_cat_b, v_user_b, 'delivery', 'Delivery B', 'need', 'bicycle', '#3B82F6', 110)
  on conflict (id) do nothing;

  assert exists (select 1 from public.categories where id = v_cat_a and user_id = v_user_a)
     and exists (select 1 from public.categories where id = v_cat_b and user_id = v_user_b),
    'same slug (delivery) across two users must BOTH exist (per-user partial index allows it)';

  -- 3b. Duplicate slug for the SAME user → 23505, no row created.
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (v_user_a, 'delivery', 'Delivery Dup', 'want', 'bicycle', '#10B981', 111);
  exception
    when unique_violation then v_blocked := true;
  end;
  assert v_blocked, 'duplicate (user_id, slug) for the same user must raise unique_violation (23505)';
  select count(*) into v_count from public.categories where slug = 'delivery' and user_id = v_user_a;
  assert v_count = 1, 'the rejected duplicate must not have created a row';

  -- 3c. Duplicate GLOBAL slug → 23505 (categories_global_slug_idx still
  --     enforces canonical uniqueness).
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (null, 'otros', 'Otros Dup', 'need', 'square.grid.2x2', '#6B7280', 112);
  exception
    when unique_violation then v_blocked := true;
  end;
  assert v_blocked, 'duplicate global slug must raise unique_violation (categories_global_slug_idx)';

  -- 3d. Global-vs-own coexistence (user-first fix #3): a GLOBAL row and the
  --     caller's OWN row MAY share a slug — uniqueness is per scope
  --     (categories_global_slug_idx vs categories_user_slug_idx). Here the
  --     caller shadows the canonical 'farmacia' (0005, sort_order 80) with
  --     their own 'farmacia' (sort_order 140, above the floor).
  select id into v_global_farm
    from public.categories
   where slug = 'farmacia' and user_id is null;
  assert v_global_farm is not null, 'canonical global farmacia must exist (0005)';

  insert into public.categories (id, user_id, slug, name, kind, icon, color, sort_order)
  values (v_cat_farm, v_user_a, 'farmacia', 'Mi Farmacia', 'want', 'pills.fill', '#14B8A6', 140)
  on conflict (id) do nothing;

  assert exists (select 1 from public.categories where id = v_global_farm and user_id is null)
     and exists (select 1 from public.categories where id = v_cat_farm and user_id = v_user_a),
    'a global row and the caller''s own row MUST be able to share a slug (per-scope uniqueness)';

  -- Per-scope uniqueness still enforced while both coexist:
  -- a second global 'farmacia' and a second OWN 'farmacia' both raise 23505.
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (null, 'farmacia', 'Farmacia Dup', 'need', 'pills.fill', '#14B8A6', 60);
  exception
    when unique_violation then v_blocked := true;
  end;
  assert v_blocked, 'second GLOBAL farmacia must raise unique_violation (global scope still unique)';

  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (v_user_a, 'farmacia', 'Farmacia Own Dup', 'want', 'pills.fill', '#14B8A6', 141);
  exception
    when unique_violation then v_blocked := true;
  end;
  assert v_blocked, 'second OWN farmacia must raise unique_violation (per-user scope still unique)';

  -- -------------------------------------------------------------------------
  -- 4. kind CHECK (spec "Invalid kind is rejected")
  -- -------------------------------------------------------------------------
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (v_user_a, 'bad-kind', 'Bad Kind', 'luxury', 'bicycle', '#10B981', 113);
  exception
    when check_violation then v_blocked := true;
  end;
  assert v_blocked, 'kind outside (need, want) must raise check_violation (23P01)';

  -- 4b. User-first floor (0032 §2.5): a custom row BELOW the floor is
  --     rejected (it would sort ahead of canonical rows and break the
  --     deterministic map winner); exactly 100 (the floor) is allowed; a
  --     GLOBAL row is unaffected (seed-only rows are not floored).
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (v_user_a, 'low-sort', 'Low Sort', 'want', 'bicycle', '#10B981', 50);
  exception
    when check_violation then v_blocked := true;
  end;
  assert v_blocked, 'custom row with sort_order < 100 must raise check_violation (floor)';

  insert into public.categories (id, user_id, slug, name, kind, icon, color, sort_order)
  values ('c0000000-0000-0000-0000-000000000006', v_user_a, 'at-floor', 'At Floor', 'want', 'bicycle', '#10B981', 100)
  on conflict (id) do nothing;
  assert exists (select 1 from public.categories where id = 'c0000000-0000-0000-0000-000000000006'),
    'custom row with sort_order = 100 (the floor) must be allowed';
  delete from public.categories where id = 'c0000000-0000-0000-0000-000000000006';

  -- -------------------------------------------------------------------------
  -- 5. RLS write policies — as `authenticated` with user A's JWT claim.
  --    BOTH claim GUC keys are set: the local supabase image's auth.uid()
  --    reads request.jwt.claim.sub (singular), while scaffolded/test
  --    harnesses may read request.jwt.claims (plural, whole payload).
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a"}', true);
  set local role authenticated;

  -- 5a. INSERT own row (with check auth.uid() = user_id) → allowed.
  --     Fixed UUID + conflict guard keeps the file idempotent (safe to
  --     re-run: a previous run already inserted, renamed, then deleted it).
  insert into public.categories (id, user_id, slug, name, kind, icon, color, sort_order)
  values ('c0000000-0000-0000-0000-000000000003', v_user_a, 'delivery-own', 'Delivery Own', 'want', 'bicycle', '#10B981', 120)
  on conflict (id) do nothing;
  select id into v_cat_own from public.categories where slug = 'delivery-own' and user_id = v_user_a;
  assert v_cat_own is not null, 'authenticated user must be able to INSERT their own custom category';

  -- 5b. INSERT with ANOTHER user's user_id → RLS with-check blocks it.
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (v_user_b, 'sneaky', 'Sneaky', 'want', 'bicycle', '#10B981', 121);
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked, 'INSERT with another user_id must violate the RLS with-check (42501)';

  -- 5c. INSERT a GLOBAL row (user_id NULL) as a client → blocked: canonical
  --     rows are seed-only, the write policy requires auth.uid() = user_id.
  v_blocked := false;
  begin
    insert into public.categories (user_id, slug, name, kind, icon, color, sort_order)
    values (null, 'global-sneaky', 'Global Sneaky', 'need', 'bicycle', '#10B981', 122);
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked, 'client INSERT with user_id NULL (global row) must be blocked';

  -- 5d. UPDATE own row → exactly 1 row.
  update public.categories set name = 'Delivery Own Renamed' where id = v_cat_own;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'user must be able to UPDATE their own custom row (1 row affected)';

  -- 5e. UPDATE a global canonical row → 0 rows.
  update public.categories set name = 'Hacked' where slug = 'otros';
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'user must NOT be able to UPDATE a global canonical row';

  -- 5f. UPDATE another user's row → 0 rows (spec "RLS blocks cross-user writes").
  update public.categories set name = 'Hacked B' where id = v_cat_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'user must NOT be able to UPDATE another user''s row';

  -- 5g. DELETE own row → exactly 1 row.
  delete from public.categories where id = v_cat_own;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'user must be able to DELETE their own custom row (1 row affected)';

  -- 5h. DELETE a global canonical row → 0 rows.
  delete from public.categories where slug = 'otros';
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'user must NOT be able to DELETE a global canonical row';

  -- 5i. DELETE another user's row → 0 rows.
  delete from public.categories where id = v_cat_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'user must NOT be able to DELETE another user''s row';

  -- 5j. Select behavior preserved (design "What Stays Unchanged"): the
  --     select-all policy still exposes the canonical 13 AND other users'
  --     custom rows to authenticated readers.
  select count(*) into v_count from public.categories where user_id = v_user_b;
  assert v_count = 1, 'authenticated SELECT must still read other users'' custom rows (select-all policy)';
  select count(*) into v_count from public.categories where user_id is null;
  assert v_count = 13, 'authenticated SELECT must still read all 13 canonical rows';

  -- -------------------------------------------------------------------------
  -- 6. FK RESTRICT behavior — block-delete backstop (spec Block-Delete Policy)
  -- -------------------------------------------------------------------------

  -- Fixture: one confirmed purchase (user A) with an item in cat-a.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values (v_purchase, v_user_a, null, date '2026-08-03', 50.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values (v_item, v_purchase, 'Comida', 1, 50.00, 50.00, v_cat_a, false, 0)
  on conflict (id) do nothing;

  -- 6a. DELETE a category that is in use → blocked by the FK (RESTRICT),
  --     NOT silently re-bucketed via the old ON DELETE SET NULL.
  v_blocked := false;
  begin
    delete from public.categories where id = v_cat_a;
  exception
    when foreign_key_violation then v_blocked := true;
  end;
  assert v_blocked,
    'deleting a category with purchases must raise foreign_key_violation (RESTRICT, no SET NULL re-bucket)';

  -- 6b. No silent fallback: the item still references cat-a unchanged.
  assert (select category_id from public.purchase_items where id = v_item) = v_cat_a,
    'FK RESTRICT must leave the item''s category untouched (no re-bucket to otros)';

  -- 6c. After the referencing purchase is removed (cascades to its items),
  --     the now-empty category deletes cleanly (spec "Delete succeeds when
  --     empty" — here enforced at the DB level).
  delete from public.purchases where id = v_purchase; -- ON DELETE CASCADE removes the item
  delete from public.categories where id = v_cat_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'an empty category must be deletable after its last purchase is removed';

  -- -------------------------------------------------------------------------
  -- 6.5 save_receipt (SECURITY DEFINER, 0032 §5) — category ownership is
  --     validated SERVER-SIDE, because RLS write policies do not fire inside
  --     the definer context: a crafted client could otherwise reference
  --     another user's custom category uuid and the save would succeed
  --     (review gate BLOCKER). Runs as `authenticated` with user A's JWT.
  --
  --     The 7-param cases below use NAMED notation + p_is_manual so they
  --     resolve to the 7-param overload (0029), which 0032 replaces with the
  --     validation — exactly like the current client (api.ts:698).
  --
  --     The 6-param compat overload (0023, no p_is_manual) is covered in
  --     §6.5b: PostgREST routes a 6-key call to it BY ARGUMENT COUNT, but
  --     raw SQL cannot execute a 6-arg call while the 7-param default
  --     exists (42P03 ambiguous_function on PG 16/17 — no fewest-defaults
  --     tie-break), so §6.5b asserts the function-body contract on pg_proc.
  --     The PostgREST behavioral probe is CI-gated (supabase stack only).
  --     Either way the round-2 BLOCKER demanded the 6-param body be closed:
  --     0032 redefines it as a delegate to the validated 7-param.
  -- -------------------------------------------------------------------------

  -- Overload contract: both signatures must exist, and the 7-param keeps its
  -- DEFAULT on p_is_manual so the app's named-notation call resolves to the
  -- validated 7-param (0029/0032 — this is the path api.ts always uses).
  -- The 6-param overload (0023, no defaults) is closed by 0032 as a delegate
  -- to the validated 7-param; that closure exists for the PostgREST
  -- 6-key-count routing path and is asserted in §6.5b (raw SQL 6-arg calls
  -- are 42P03-ambiguous while the 7-param default exists — PG 16/17).
  assert to_regprocedure('public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[])') is not null,
    'the 6-param save_receipt overload must exist (0023 signature, redefined by 0032)';
  assert to_regprocedure('public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean)') is not null,
    'the 7-param save_receipt overload must exist (0029/0032)';
  select p.proargdefaults is null into v_has_default
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 6;
  assert v_has_default, 'the 6-param overload must declare NO defaults (exact-arity resolution)';
  select p.proargdefaults is not null into v_has_default
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 7;
  assert v_has_default, 'the 7-param overload must keep its DEFAULT on p_is_manual so the app path (named notation) resolves to the validated 7-param';

  -- Negative: a line referencing ANOTHER user's custom category (v_cat_b)
  -- must raise and roll back — no purchase, no item, no scan-slot consumed.
  v_blocked := false;
  begin
    select ok, purchase_id into v_rpc_ok, v_rpc_pid
      from public.save_receipt(
        p_store_id       => null,
        p_purchase_date  => date '2026-08-03',
        p_total          => 10.00,
        p_payment_method => 'cash',
        p_image_url      => null,
        p_items          => array[
          row('Comida B', 1, 10.00, 10.00, v_cat_b, false, 0)::public.purchase_item_input
        ],
        p_is_manual      => false
      );
  exception
    when raise_exception then v_blocked := true;
  end;
  assert v_blocked,
    'save_receipt must REJECT a line referencing another user''s custom category (raise, full rollback)';
  assert not exists (
    select 1 from public.purchases where user_id = v_user_a and purchase_date = date '2026-08-03'
  ), 'the rejected save_receipt must have rolled back completely (no purchase row)';

  -- Negative: a uuid that matches NO category row at all — same rejection
  -- (fail-closed: unknown ids are never silently accepted).
  v_blocked := false;
  begin
    select ok, purchase_id into v_rpc_ok, v_rpc_pid
      from public.save_receipt(
        p_store_id       => null,
        p_purchase_date  => date '2026-08-04',
        p_total          => 10.00,
        p_payment_method => 'cash',
        p_image_url      => null,
        p_items          => array[
          row('Comida Ghost', 1, 10.00, 10.00, 'ffffffff-ffff-ffff-ffff-ffffffffffff', false, 0)::public.purchase_item_input
        ],
        p_is_manual      => false
      );
  exception
    when raise_exception then v_blocked := true;
  end;
  assert v_blocked, 'save_receipt must REJECT a category_id that matches no category row';

  -- Own row for the positive case (fixed id, idempotent).
  insert into public.categories (id, user_id, slug, name, kind, icon, color, sort_order)
  values (v_cat_rpc, v_user_a, 'rpc-own', 'RPC Own', 'want', 'bicycle', '#10B981', 130)
  on conflict (id) do nothing;

  -- Positive: NULL + a global canonical row ('otros') + the caller's OWN
  -- custom row all succeed in one receipt (mixed line categories are legal).
  select ok, purchase_id into v_rpc_ok, v_rpc_pid
    from public.save_receipt(
      p_store_id       => null,
      p_purchase_date  => date '2026-08-05',
      p_total          => 31.00,
      p_payment_method => 'cash',
      p_image_url      => null,
      p_items          => array[
        row('Sin categoria', 1, 1.00, 1.00, null, false, 0)::public.purchase_item_input,
        row('Otros canonico', 1, 10.00, 10.00, (select id from public.categories where slug = 'otros' and user_id is null), false, 1)::public.purchase_item_input,
        row('Propio', 1, 20.00, 20.00, v_cat_rpc, false, 2)::public.purchase_item_input
      ],
      p_is_manual      => false
    );
  assert v_rpc_ok and v_rpc_pid is not null,
    'save_receipt must succeed with a global row, the caller''s own row, and NULL category ids';

  -- Cleanup (as user A, own rows): remove the RPC purchase so the file stays
  -- idempotent across re-runs.
  delete from public.purchases where id = v_rpc_pid;

  -- -------------------------------------------------------------------------
  -- 6.5b 6-param compat overload (0023 signature) — CLOSED by 0032 (round-2
  --      BLOCKER). PostgREST selects overloads BY ARGUMENT COUNT (docs:
  --      "Overloaded functions can be called by providing the appropriate
  --      arguments"), so a 6-key HTTP RPC call — no p_is_manual key — lands
  --      on the 6-param overload; NO old client is needed to reach it. Its
  --      old body (0023) copied category_id into purchase_items with NO
  --      ownership validation: with the FK RESTRICT + per-user categories,
  --      a crafted 6-key call could pin another user's category as
  --      undeletable and leak its label/color into the attacker's own
  --      aggregates.
  --
  --      RAW SQL cannot execute a 6-arg call while the 7-param default
  --      exists: PostgreSQL resolution is AMBIGUOUS ("function is not
  --      unique", 42P03) on both PG 16 and 17 — there is no
  --      fewest-defaults tie-break. That ambiguity is fail-closed (loud
  --      error, no run), so the behavioral RED probe is provable ONLY over
  --      PostgREST HTTP (CI-gated, see supabase/tests/README.md). At the
  --      SQL layer the contract is asserted on the FUNCTION BODY itself:
  --      the old 0023 body performs its own `insert into public.purchase_items`
  --      (no validation anywhere); 0032 must replace it with a delegate to
  --      the validated 7-param that loads p_is_manual => false — so pg_proc
  --      must NOT contain the unvalidated copy body anymore.
  -- -------------------------------------------------------------------------

  -- Source-contract asserts (the SQL-provable RED/GREEN proxy for the
  -- PostgREST-routed attack):
  --   1. The 6-param body must NOT be 0023's unvalidated copy (which
  --      contains its own `insert into public.purchase_items`).
  --   2. The 6-param body must delegate to the validated 7-param with
  --      p_is_manual => false (explicit origin false — this signature
  --      predates the origin param).
  select pg_get_functiondef(p.oid) into v_tmp
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 6;
  assert v_tmp is not null, '6-param save_receipt must exist (0023 signature, redefined by 0032)';
  assert not v_tmp ilike '%insert into public.purchase_items%',
    '6-param save_receipt body must NOT be 0023''s unvalidated copy (no direct purchase_items INSERT — it must delegate to the validated 7-param)';
  assert v_tmp ilike '%p_is_manual => false%',
    '6-param save_receipt body must delegate to the validated 7-param loading p_is_manual => false (single validated implementation)';

  -- -------------------------------------------------------------------------
  -- 6.6 Direct PostgREST-style write policies (0032 §3.5) — purchase_items
  --     INSERT/UPDATE must verify category ownership TOO: the definer RPC is
  --     not the only write path (updateReceipt hits purchase_items via
  --     PostgREST, review gate CRITICAL #2). Runs as `authenticated` A.
  -- -------------------------------------------------------------------------

  -- Fixture: one owned purchase + one owned item with a global category.
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values (v_purchase2, v_user_a, null, date '2026-08-06', 5.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values (v_item2, v_purchase2, 'Global', 1, 5.00, 5.00,
          (select id from public.categories where slug = 'otros' and user_id is null), false, 0)
  on conflict (id) do nothing;

  -- INSERT with ANOTHER user's category uuid → RLS with-check blocks (42501).
  v_blocked := false;
  begin
    insert into public.purchase_items (purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
    values (v_purchase2, 'Sneaky B', 1, 5.00, 5.00, v_cat_b, false, 1);
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked, 'purchase_items INSERT with another user''s category must be blocked by RLS (42501)';

  -- UPDATE whose NEW value is another user's category uuid → the WITH CHECK
  -- branch (0032 §3.5) REJECTS the new row with 42501. (A USING-only policy
  -- would silently update 0 rows; WITH CHECK makes the violation LOUD — the
  -- PostgREST PATCH returns an error instead of a no-op.)
  -- Note: an UPDATE that only touches non-category columns on rows whose
  -- category is already invalid stays SILENTLY pruned by USING (0 rows) —
  -- the old row cannot even be matched, which is the intended filter.
  v_blocked := false;
  begin
    update public.purchase_items set category_id = v_cat_b where id = v_item2;
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked, 'purchase_items UPDATE to another user''s category must raise 42501 (WITH CHECK)';

  -- Positive control: the same user can still insert with a GLOBAL category
  -- (and own categories) — parent-ownership + category-ownership both hold.
  insert into public.purchase_items (purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values (v_purchase2, 'Propio ok', 1, 6.00, 6.00, v_cat_rpc, false, 2);
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'purchase_items INSERT with the caller''s OWN category must be allowed';

  -- Cleanup (as user A): remove the fixture purchase so re-runs stay clean.
  delete from public.purchases where id = v_purchase2;

  -- -------------------------------------------------------------------------
  -- 6.7 Re-parenting guard (round-2 CRITICAL) — purchase_items UPDATE must
  --     not let an item change parents into ANOTHER user's purchase.
  --
  --     POLICY SEMANTICS NOTE (PG16/17): per CREATE POLICY, once an UPDATE
  --     policy defines a WITH CHECK expression, that expression alone
  --     validates the NEW row (USING filters the OLD row). The round-2
  --     CRITICAL premise — a category-only WITH CHECK lets a re-parent
  --     UPDATE pass — follows directly from those documented semantics, so
  --     the parent-ownership clause in the WITH CHECK is the PRIMARY
  --     closure, not defense-in-depth. The 6.7 behavioral asserts below pin
  --     the closure; the introspection assert is the RED→GREEN proxy that
  --     keeps the policy self-contained and greppable. Moves between the
  --     caller's OWN purchases must remain legal (0001 posture).
  -- -------------------------------------------------------------------------

  -- Policy contract: update_own WITH CHECK must reference the parent
  -- (purchases/purchase_id/auth.uid()) AND the category predicate;
  -- insert_own WITH CHECK must keep parent-ownership too (0001 posture must
  -- not have been dropped by 0032).
  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'purchase_items'
       and policyname = 'purchase_items_update_own' and cmd = 'UPDATE'
       and with_check ilike '%purchases%'
       and with_check ilike '%purchase_id%'
       and with_check ilike '%auth.uid()%'
  ), 'purchase_items_update_own WITH CHECK must state parent-ownership of the NEW row (round-2 CRITICAL: once a WITH CHECK exists it is the sole new-row validator — the parent clause is the primary closure, not an implicit USING side effect)';
  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'purchase_items'
       and policyname = 'purchase_items_update_own' and cmd = 'UPDATE'
       and with_check ilike '%category_id%'
  ), 'purchase_items_update_own WITH CHECK must keep the category predicate';
  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'purchase_items'
       and policyname = 'purchase_items_insert_own' and cmd = 'INSERT'
       and with_check ilike '%purchases%'
       and with_check ilike '%purchase_id%'
       and with_check ilike '%auth.uid()%'
  ), 'purchase_items_insert_own WITH CHECK must keep parent-ownership (0001 posture, not dropped by 0032)';

  -- Fixtures: two purchases owned by A, one owned by B (seeded in §2 as the
  -- superuser — A cannot insert it), one item under A's first purchase with
  -- a GLOBAL category ('otros', so the category predicate alone cannot block
  -- the attack — only parent-ownership can).
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values (v_purchase_a1, v_user_a, null, date '2026-08-09', 7.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values (v_purchase_a2, v_user_a, null, date '2026-08-10', 8.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
  values (v_item_a1, v_purchase_a1, 'Movible', 1, 7.00, 7.00,
          (select id from public.categories where slug = 'otros' and user_id is null), false, 0)
  on conflict (id) do nothing;

  -- Negative: as A, move the item into B's purchase (uuid known via sharing
  -- surfaces) → 42501 (raised pre-fix by PostgreSQL's USING-on-new-row
  -- recheck; post-fix also by the explicit WITH CHECK parent predicate),
  -- loud failure, item untouched. Regression guard — must NEVER regress to
  -- silent success.
  v_blocked := false;
  begin
    update public.purchase_items set purchase_id = v_purchase_b where id = v_item_a1;
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked, 're-parenting an item into ANOTHER user''s purchase must raise 42501 (WITH CHECK parent-ownership)';
  assert (select purchase_id from public.purchase_items where id = v_item_a1) = v_purchase_a1,
    'the rejected re-parent must leave the item under its original purchase';

  -- Positive control: A moves the item between A's OWN two purchases → the
  -- WITH CHECK (own parent + own/global category) passes → 1 row affected.
  update public.purchase_items set purchase_id = v_purchase_a2 where id = v_item_a1;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'moving an item between the caller''s OWN purchases must be allowed (1 row)';
  assert (select purchase_id from public.purchase_items where id = v_item_a1) = v_purchase_a2,
    'the item must now sit under the caller''s second purchase';

  -- Cleanup (as user A): remove the fixture purchases so re-runs stay clean
  -- (items cascade). User B's purchase is a persistent superuser fixture
  -- (like v_cat_b) — A cannot delete it by design.
  delete from public.purchases where id in (v_purchase_a1, v_purchase_a2);

  -- -------------------------------------------------------------------------
  -- 7. Anon denial (LAST: role persists for the rest of the transaction).
  --    The select policy targets `authenticated` only → anon reads zero rows
  --    (RLS filters; not an error).
  -- -------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  select count(*) into v_count from public.categories;
  assert v_count = 0, 'anon must not read any category rows (select policy targets authenticated only)';

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'user-categories.sql smoke: catalog + per-scope uniqueness + coexistence + sort floor + RLS write policies + category-ownership (RPC 7-param + RPC 6-param compat + direct INSERT/UPDATE) + re-parenting guard + FK RESTRICT assertions passed';
end $$;