-- ============================================================================
-- Ticketify — delete-account SQL smoke test (migration 0036)
--
-- A fail-closed schema + behavior smoke test for the user-account-deletion
-- change (SDD change `delete-account`, PR1). It runs against a SCRATCH
-- database (e.g. `supabase db reset` output or a CI-local Postgres) —
-- never against production. It does NOT apply migrations; the catalog is
-- whatever the migrations declare, then the file seeds a minimal fixture
-- and exercises the destructive RPC contract end-to-end:
--
--   §1. Catalog — migration 0036 contract:
--        `public.delete_user_account(uuid)` exists, is SECURITY DEFINER,
--        owned by postgres, returns `text`, and has EXECUTE granted ONLY
--        to service_role (anon/authenticated/public REVOKED — the 0029 §4
--        trap, 0034 §3 style).
--   §2. Cascade — a user with rows across every per-user table is wiped
--        in ONE RPC call: profiles, stores, purchases, purchase_items,
--        scan_usage, monthly_user_totals, category_budgets,
--        webhook_events, households (when owned), household_members,
--        invite_codes, user-scoped categories, and (per 0036 §3) the
--        receipts bucket storage objects + (per 0036 §4) parse_attempts.
--        Each table is asserted to have zero rows for the deleted uid.
--   §3. Storage sweep — a seeded storage.objects row under
--        `<uid>/receipt.jpg` is gone after the RPC (the `receipts`
--        bucket has no ON DELETE CASCADE from auth.users; the sweep is
--        the only thing that removes the photo).
--   §4. parse_attempts scrub — a seeded row is gone after the RPC (the
--        table has NO FK to profiles — 0022 §1, requires an explicit
--        delete or the row survives).
--   §5. Household-owner blocked — a household `created_by` with at
--        least one OTHER active member in `household_members` is
--        REJECTED with the EXACT exception message
--        `'owner_must_disband_first'` AND SQLSTATE `P0001`. No rows are
--        deleted (profiles + auth.users still intact).
--   §6. Idempotency — a second call after a successful delete returns
--        `'already_deleted'` (text), exits cleanly (no exception), and
--        leaves the row count at zero. A second call on the
--        household-blocked user (still present, since the previous
--        attempt raised) also returns `'already_deleted'`? No — the
--        idempotency gate is ONLY for the auth.users-not-found case,
--        so the blocked-user rerun still raises (we assert that).
--   §7. Re-signup with the same email — after a successful delete, a
--        fresh `auth.users` row may be inserted with the SAME email
--        (Supabase Auth does not block re-registration). Confirms the
--        `auth.users.email` column does NOT have a unique constraint
--        that would prevent a returning user from signing up again
--        with the same address.
--
-- Structure: the whole file is a SINGLE `DO` block (the same constraint
-- as the rest of supabase/tests/*.sql — `supabase db query --local
-- --file` prepares the file as one statement). Failing `assert` aborts
-- the block and fails the query (exit != 0).
--
-- Fixture notes: NONE of the seeded rows exist in the fresh chain
-- (0001-0035 seeds no auth.users/profiles rows with these fixed UUIDs),
-- and every insert is idempotent (`on conflict (...) do nothing` with
-- fixed UUIDs), so the file is safe to re-run. `auth.users` inserts use
-- the common minimal column set; a future GoTrue schema drift fails
-- loudly here (fail-closed is intended).
--
-- The file is idempotent and safe to re-run.
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, never collide with real rows).
  -- The 'da' prefix (delete-account) keeps the namespace distinct from the
  -- other smoke tests in supabase/tests/.
  v_user_cascade      uuid := 'da000000-0000-0000-0000-0000000000c1';
  v_user_blocked      uuid := 'da000000-0000-0000-0000-0000000000b1';
  v_user_blocked_peer uuid := 'da000000-0000-0000-0000-0000000000b2';
  v_hid_blocked       uuid := 'da000000-0000-0000-0000-0000000000b3';
  v_store             uuid := 'da000000-0000-0000-0000-0000000000d1';
  v_purchase          uuid := 'da000000-0000-0000-0000-0000000000d2';
  v_item              uuid := 'da000000-0000-0000-0000-0000000000d3';
  v_category          uuid := 'da000000-0000-0000-0000-0000000000d4';
  v_storage_object    uuid := 'da000000-0000-0000-0000-0000000000d5';
  v_cascade_email     text := 'cascade@delete-account.test.local';

  -- §1 catalog vars.
  v_secdef      boolean;
  v_owner       text;
  v_rettype     text;

  -- §2 cascade behavior vars.
  v_count       int;

  -- §5 household-blocked vars.
  v_sqlstate    text;
  v_errmsg      text;
  v_blocked_uid_count int;

  -- §6 idempotency vars.
  v_second_call text;

  -- §7 re-signup vars.
  v_resignup_ok boolean;
  v_resignup_id uuid;
begin
  -- -------------------------------------------------------------------------
  -- §1. Catalog — migration 0036 contract
  -- -------------------------------------------------------------------------
  assert to_regprocedure('public.delete_user_account(uuid)') is not null,
    'delete_user_account(uuid) is missing (expected from 0036)';

  select p.prosecdef, pg_get_userbyid(p.proowner), format_type(p.prorettype, null)
    into v_secdef, v_owner, v_rettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'delete_user_account'
     and p.pronargs = 1;

  assert v_secdef, 'delete_user_account must be SECURITY DEFINER';
  assert v_owner = 'postgres',
    'delete_user_account must be owned by postgres (required for SECURITY DEFINER bypass)';
  assert v_rettype = 'text',
    'delete_user_account must return text (''ok'' | ''already_deleted'')';

  -- Least privilege (0034 §3 / 0022 §2 style): only service_role may call
  -- this destructive RPC. anon/authenticated/public are REVOKED — the
  -- 0029 §4 trap (create-or-replace resets EXECUTE to PUBLIC) is closed.
  assert has_function_privilege('service_role', 'public.delete_user_account(uuid)', 'EXECUTE'),
    'service_role must be able to execute delete_user_account (the only caller)';
  assert not has_function_privilege('authenticated', 'public.delete_user_account(uuid)', 'EXECUTE'),
    'authenticated must NOT be able to execute delete_user_account (least privilege — would let any user wipe any other user)';
  assert not has_function_privilege('anon', 'public.delete_user_account(uuid)', 'EXECUTE'),
    'anon must NOT be able to execute delete_user_account (least privilege)';
  assert not has_function_privilege('public', 'public.delete_user_account(uuid)', 'EXECUTE'),
    'public must NOT be able to execute delete_user_account (least privilege)';

  -- -------------------------------------------------------------------------
  -- §2. Cascade — seed a user with rows across every per-user table, plus
  --     §3 storage object + §4 parse_attempts row, then call the RPC and
  --     assert every row is gone.
  --
  --     Idempotency: a previous run's re-signup row (random uuid, same
  --     email) may still exist — wipe the email slot before the cascade
  --     insert so the partial unique index `users_email_partial_key`
  --     doesn't reject the deterministic uuid fixture.
  -- -------------------------------------------------------------------------
  delete from auth.users where email = v_cascade_email;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_cascade, 'authenticated', 'authenticated', v_cascade_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, tier, subscription_status, created_at)
  values (v_user_cascade, 'Cascade User', 0, 'USD', 'free', 'none', now())
  on conflict (id) do nothing;

  insert into public.stores (id, user_id, name, chain)
  values (v_store, v_user_cascade, 'Test Store', 'Test Chain')
  on conflict (id) do nothing;

  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values (v_purchase, v_user_cascade, v_store, current_date, 12.34, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, sort_order)
  values (v_item, v_purchase, 'Test Item', 1, 12.34, 12.34, 0)
  on conflict (id) do nothing;

  insert into public.scan_usage (user_id, year_month, scans_used, scans_limit)
  values (v_user_cascade, to_char(now(), 'YYYY-MM'), 0, 15)
  on conflict (user_id, year_month) do nothing;

  -- monthly_user_totals (0015) has its own cache table — seed a row.
  insert into public.monthly_user_totals (user_id, year_month, total, items_count, updated_at)
  values (v_user_cascade, to_char(now(), 'YYYY-MM'), 12.34, 1, now())
  on conflict (user_id, year_month) do nothing;

  -- category_budgets (0013)
  insert into public.category_budgets (user_id, category_slug, month, amount)
  values (v_user_cascade, 'food', to_char(now(), 'YYYY-MM'), 100.00)
  on conflict (user_id, category_slug, month) do nothing;

  -- webhook_events (0012)
  insert into public.webhook_events (user_id, event_id, event_ts, event_type, applied_at)
  values (v_user_cascade, 'cascade-evt-1', now(), 'TEST', now())
  on conflict (user_id, event_id) do nothing;

  -- user-scoped categories (0032): a custom row the user owns.
  insert into public.categories (id, slug, name, kind, icon, color, sort_order, user_id)
  values (v_category, 'cascade-custom', 'Cascade Custom', 'want', 'star', '#FF0000', 200, v_user_cascade)
  on conflict (id) do nothing;

  -- §4 fixture: a parse_attempts row (no FK — 0022 §1).
  insert into public.parse_attempts (user_id, hour_bucket, attempts)
  values (v_user_cascade, date_trunc('hour', now() at time zone 'UTC'), 3)
  on conflict (user_id, hour_bucket) do nothing;

  -- §3 fixture: a storage.objects row in the receipts bucket under the
  -- user's folder. Inserted with owner=v_user_cascade (Storage RLS does
  -- NOT fire for SECURITY DEFINER / superuser writes, which is what the
  -- test connects as).
  insert into storage.objects (id, bucket_id, name, owner, metadata, version)
  values (
    v_storage_object,
    'receipts',
    v_user_cascade::text || '/cascade-receipt.jpg',
    v_user_cascade,
    '{"mimetype":"image/jpeg","sizeBytes":1024}'::jsonb,
    '0be4ec51-9e88-4a4d-95da-5f4d3c8e2c10'
  )
  on conflict (id) do nothing;

  -- Pre-condition: every fixture row exists.
  select count(*) into v_count from public.profiles where id = v_user_cascade;
  assert v_count = 1, 'pre-condition: profile row must exist for cascade user';
  select count(*) into v_count from public.stores where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: stores row must exist';
  select count(*) into v_count from public.purchases where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: purchases row must exist';
  select count(*) into v_count from public.purchase_items
    where purchase_id = v_purchase;
  assert v_count = 1, 'pre-condition: purchase_items row must exist';
  select count(*) into v_count from public.scan_usage where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: scan_usage row must exist';
  select count(*) into v_count from public.monthly_user_totals where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: monthly_user_totals row must exist';
  select count(*) into v_count from public.category_budgets where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: category_budgets row must exist';
  select count(*) into v_count from public.webhook_events where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: webhook_events row must exist';
  select count(*) into v_count from public.categories where id = v_category and user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition: user-scoped categories row must exist';
  select count(*) into v_count from public.parse_attempts where user_id = v_user_cascade;
  assert v_count = 1, 'pre-condition (§4): parse_attempts row must exist';

  -- The receipts bucket storage object is found by (storage.foldername(name))[1].
  select count(*) into v_count from storage.objects
   where bucket_id = 'receipts'
     and (storage.foldername(name))[1] = v_user_cascade::text;
  assert v_count = 1, 'pre-condition (§3): storage.objects row in receipts bucket under user folder must exist';

  -- -------------------------------------------------------------------------
  -- Execute the RPC. The local `supabase db query --local` connection runs
  -- as the postgres role (superuser), which bypasses EXECUTE grants — so
  -- we are authorized to invoke the service_role-only RPC for the test.
  -- -------------------------------------------------------------------------
  perform public.delete_user_account(v_user_cascade);

  -- -------------------------------------------------------------------------
  -- §2 (continued) — assert every per-user table row is gone.
  -- -------------------------------------------------------------------------
  select count(*) into v_count from auth.users where id = v_user_cascade;
  assert v_count = 0, 'auth.users row must be deleted by the RPC';

  select count(*) into v_count from public.profiles where id = v_user_cascade;
  assert v_count = 0, 'profiles row must be deleted (CASCADE)';

  select count(*) into v_count from public.stores where user_id = v_user_cascade;
  assert v_count = 0, 'stores row must be deleted (CASCADE)';

  select count(*) into v_count from public.purchases where user_id = v_user_cascade;
  assert v_count = 0, 'purchases row must be deleted (CASCADE)';

  select count(*) into v_count from public.purchase_items where purchase_id = v_purchase;
  assert v_count = 0, 'purchase_items row must be deleted (CASCADE)';

  select count(*) into v_count from public.scan_usage where user_id = v_user_cascade;
  assert v_count = 0, 'scan_usage row must be deleted (CASCADE)';

  select count(*) into v_count from public.monthly_user_totals where user_id = v_user_cascade;
  assert v_count = 0, 'monthly_user_totals row must be deleted (CASCADE)';

  select count(*) into v_count from public.category_budgets where user_id = v_user_cascade;
  assert v_count = 0, 'category_budgets row must be deleted (CASCADE)';

  select count(*) into v_count from public.webhook_events where user_id = v_user_cascade;
  assert v_count = 0, 'webhook_events row must be deleted (CASCADE)';

  select count(*) into v_count from public.categories where user_id = v_user_cascade;
  assert v_count = 0, 'user-scoped categories row must be deleted (CASCADE)';

  -- -------------------------------------------------------------------------
  -- §3. Storage sweep — the receipts bucket storage object is gone.
  -- -------------------------------------------------------------------------
  select count(*) into v_count from storage.objects
   where bucket_id = 'receipts'
     and (storage.foldername(name))[1] = v_user_cascade::text;
  assert v_count = 0,
    'storage.objects in receipts bucket under user folder must be deleted by the Storage sweep (§3)';

  -- -------------------------------------------------------------------------
  -- §4. parse_attempts scrub — the counter row is gone.
  -- -------------------------------------------------------------------------
  select count(*) into v_count from public.parse_attempts where user_id = v_user_cascade;
  assert v_count = 0,
    'parse_attempts row must be deleted by the scrub (§4 — the table has no FK to profiles)';

  -- -------------------------------------------------------------------------
  -- §6. Idempotency — a second call on the SAME (now-deleted) uid returns
  -- ''already_deleted'' and does not raise.
  -- -------------------------------------------------------------------------
  v_second_call := public.delete_user_account(v_user_cascade);
  assert v_second_call = 'already_deleted',
    format('second call on deleted user must return ''already_deleted'', got: %s', v_second_call);

  -- -------------------------------------------------------------------------
  -- §5. Household-owner blocked — a household `created_by` with at least
  --     one OTHER active member is rejected with the EXACT exception text
  --     AND SQLSTATE P0001. Nothing else is mutated.
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_blocked,      'authenticated', 'authenticated', 'blocked-owner@delete-account.test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_blocked_peer, 'authenticated', 'authenticated', 'blocked-peer@delete-account.test.local',  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, tier, subscription_status, created_at)
  values
    (v_user_blocked,      'Blocked Owner', 0, 'USD', 'pro', 'active', now()),
    (v_user_blocked_peer, 'Blocked Peer',  0, 'USD', 'free', 'none',  now())
  on conflict (id) do nothing;

  -- Create the household as the owner (bypass the tier gate via direct
  -- insert — we are testing delete_account's pre-flight, not
  -- create_household's gate).
  insert into public.households (id, name, created_by, created_at)
  values (v_hid_blocked, 'Blocked Household', v_user_blocked, now())
  on conflict (id) do nothing;

  insert into public.household_members (household_id, user_id, role, joined_at)
  values
    (v_hid_blocked, v_user_blocked,      'owner',  now()),
    (v_hid_blocked, v_user_blocked_peer, 'member', now())
  on conflict (household_id, user_id) do nothing;

  update public.profiles set household_id = v_hid_blocked
   where id in (v_user_blocked, v_user_blocked_peer);

  -- Call the RPC — must raise.
  begin
    perform public.delete_user_account(v_user_blocked);
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      -- Capture SQLSTATE + message for the assertions below. The DO block
      -- exception handler runs before the assertion so the variables are
      -- bound by the time we check them.
      v_sqlstate := sqlstate;
      v_errmsg   := sqlerrm;
  end;

  assert v_sqlstate = 'P0001',
    format('household-owner blocked must raise SQLSTATE P0001 (explicit signal), got: %s', v_sqlstate);
  assert v_errmsg = 'owner_must_disband_first',
    format('household-owner blocked must raise exact message ''owner_must_disband_first'', got: %s', v_errmsg);

  -- Nothing was mutated: the owner + household + members still exist.
  select count(*) into v_blocked_uid_count from auth.users where id = v_user_blocked;
  assert v_blocked_uid_count = 1,
    'blocked RPC must NOT delete the owner (auth.users row still present)';

  select count(*) into v_blocked_uid_count from public.profiles where id = v_user_blocked;
  assert v_blocked_uid_count = 1,
    'blocked RPC must NOT delete the owner (profile row still present)';

  select count(*) into v_blocked_uid_count from public.household_members where user_id = v_user_blocked;
  assert v_blocked_uid_count = 1,
    'blocked RPC must NOT delete the owner''s household_members row';

  -- Calling again on the BLOCKED (still-present) user still raises — the
  -- idempotency gate is ONLY for the auth.users-not-found case. This is a
  -- guard against a future refactor turning the pre-flight into a silent
  -- no-op for a blocked owner.
  begin
    perform public.delete_user_account(v_user_blocked);
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      assert sqlstate = 'P0001',
        format('rerun on blocked owner must STILL raise P0001 (no silent no-op), got: %s', sqlstate);
      assert sqlerrm = 'owner_must_disband_first',
        format('rerun on blocked owner must STILL raise ''owner_must_disband_first'', got: %s', sqlerrm);
  end;

  -- -------------------------------------------------------------------------
  -- §7. Re-signup with the same email — after a successful delete, a fresh
  --     auth.users row may be inserted with the SAME email.
  --
  --     Supabase Auth 17.6.x (current local stack) DOES enforce a unique
  --     index `users_email_partial_key` on `auth.users(email) WHERE
  --     is_sso_user = false`. After the destructive RPC physically removes
  --     the row, a new signup with the same email succeeds because the
  --     email slot is free.
  --
  --     Idempotency: a previous run's re-signup row may already occupy the
  --     slot (its uuid is non-deterministic). Delete any leftover row
  --     with the test email BEFORE the insert so re-runs are clean.
  -- -------------------------------------------------------------------------
  delete from auth.users where email = v_cascade_email;

  v_resignup_ok := false;
  begin
    -- Use a NEW uuid (the original is gone) + the SAME email.
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_cascade_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
    returning id into v_resignup_id;
    v_resignup_ok := true;
  exception when others then
    v_resignup_ok := false;
    raise;
  end;

  assert v_resignup_ok,
    're-signup with the same email must succeed (Supabase Auth does not block re-registration)';
  assert v_resignup_id is not null,
    're-signup insert must return a new auth.users id';

  -- Sanity: confirm we can read the new row.
  select count(*) into v_count from auth.users where id = v_resignup_id;
  assert v_count = 1, 're-signup row must be queryable';

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'delete-account.sql smoke: catalog + cascade + storage sweep + parse_attempts scrub + household-owner block + idempotency + re-signup assertions passed';
end $$;