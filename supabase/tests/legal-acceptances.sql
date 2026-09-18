-- ============================================================================
-- Ticketify — legal-acceptances SQL smoke test (migration 0038)
--
-- A fail-closed schema + behavior smoke test for the legal compliance change
-- (SDD change `legal-compliance`, U1: DB + config). It runs against a
-- SCRATCH database (e.g. `supabase db reset` output or a CI-local Postgres)
-- — never against production. It does NOT apply migrations; the catalog is
-- whatever the migrations declare, then the file seeds a minimal fixture and
-- exercises the acceptance-record contract end-to-end (legal-consent
-- REQ-1):
--
--   §1. Catalog — migration 0038 contract:
--        `public.legal_acceptances` exists with EXACTLY the four designed
--        columns (user_id uuid NOT NULL, document text NOT NULL, version
--        text NOT NULL, accepted_at timestamptz NOT NULL default now()),
--        primary key (user_id, document, version), a CHECK constraining
--        `document` to ('privacy','terms'), an ON DELETE CASCADE FK to
--        auth.users, RLS enabled with EXACTLY two policies
--        (select_own scoped using auth.uid() = user_id, insert_own scoped
--        with check auth.uid() = user_id) and NO update/delete policy
--        (append-only); `public.record_legal_acceptance(text,text)` is
--        SECURITY DEFINER, owned by postgres, and has EXECUTE granted ONLY
--        to authenticated (anon/PUBLIC/service_role REVOKED — the 0029 §4
--        trap, 0036 style).
--   §2. Behavior as `authenticated` (user A, JWT sub claim via the
--        request.jwt.claim.* GUC convention): a direct own-row INSERT is
--        allowed by insert_own; the RPC writes rows deriving user_id from
--        auth.uid(); a duplicate (document, version) RPC call is a NO-OP
--        (on conflict do nothing); an unknown document raises CHECK
--        violation 23514; UPDATE and DELETE on own rows affect ZERO rows
--        (no policy — immutable); an INSERT with ANOTHER user's user_id is
--        blocked by the with-check; A's SELECT never sees B's rows.
--   §3. FK cascade — deleting the auth.users row removes the user's
--        acceptance rows (audit rows die with the account).
--   §4. Anon denial (LAST: role persists for the rest of the transaction):
--        anon reads zero rows (no anon select policy) and is denied
--        EXECUTE on the RPC (42501 insufficient_privilege).
--
-- Structure: the whole file is a SINGLE `DO` block (the same constraint as
-- the rest of supabase/tests/*.sql — `supabase db query --local --file`
-- prepares the file as one statement). Failing `assert` aborts the block
-- and fails the query (exit != 0).
--
-- Fixture notes: NONE of the seeded rows exist in the fresh chain
-- (0001-0037 seeds no auth.users rows with these fixed UUIDs), and every
-- insert is idempotent (`on conflict (...) do nothing` with fixed UUIDs),
-- so the file is safe to re-run. `auth.users` inserts use the common
-- minimal column set; a future GoTrue schema drift fails loudly here
-- (fail-closed is intended).
-- ============================================================================

do $$
declare
  -- Fixed test identities (deterministic, never collide with real rows).
  -- The 'ac' prefix (acceptances) keeps the namespace distinct from the
  -- other smoke tests in supabase/tests/.
  v_user_a       uuid := 'ac000000-0000-0000-0000-0000000000a1';
  v_user_b       uuid := 'ac000000-0000-0000-0000-0000000000b1';
  v_email_a      text := 'user-a@legal.test.local';
  v_email_b      text := 'user-b@legal.test.local';

  -- The version token shared by both documents (design AD-4 / legal-consent
  -- C2: ISO date string; the client constant LATEST_LEGAL_VERSIONS uses the
  -- same value).
  v_version      text := '2026-09-18';

  -- §1 catalog vars.
  v_secdef       boolean;
  v_owner        text;
  v_relrowse     boolean;
  v_count        int;
  v_rows         int;
  v_def          text;
  v_typ          text;
  v_null         text;
  v_default      text;

  -- §2 behavior vars.
  v_blocked      boolean;
  v_sqlstate     text;
  v_errmsg       text;
begin
  -- -------------------------------------------------------------------------
  -- §1. Catalog — migration 0038 contract
  -- -------------------------------------------------------------------------
  assert to_regclass('public.legal_acceptances') is not null,
    'legal_acceptances table is missing (expected from 0038)';

  -- Exactly the four designed columns.
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public' and table_name = 'legal_acceptances';
  assert v_count = 4,
    'legal_acceptances must have exactly the 4 designed columns (user_id, document, version, accepted_at)';

  select data_type, is_nullable, column_default
    into v_typ, v_null, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'legal_acceptances'
     and column_name = 'user_id';
  assert v_typ = 'uuid' and v_null = 'NO',
    'user_id must be uuid NOT NULL (FK target auth.users.id)';

  select data_type, is_nullable
    into v_typ, v_null
    from information_schema.columns
   where table_schema = 'public' and table_name = 'legal_acceptances'
     and column_name = 'document';
  assert v_typ = 'text' and v_null = 'NO',
    'document must be text NOT NULL (CHECK-constrained to privacy|terms)';

  select data_type, is_nullable
    into v_typ, v_null
    from information_schema.columns
   where table_schema = 'public' and table_name = 'legal_acceptances'
     and column_name = 'version';
  assert v_typ = 'text' and v_null = 'NO',
    'version must be text NOT NULL (ISO date string, e.g. 2026-09-18)';

  select data_type, is_nullable, column_default
    into v_typ, v_null, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'legal_acceptances'
     and column_name = 'accepted_at';
  assert v_typ = 'timestamp with time zone' and v_null = 'NO',
    'accepted_at must be timestamptz NOT NULL';
  assert v_default is not null,
    'accepted_at must default to now()';

  -- Primary key (user_id, document, version) — exact column set + order.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.legal_acceptances'::regclass
     and contype = 'p';
  assert v_def = 'PRIMARY KEY (user_id, document, version)',
    'primary key must be (user_id, document, version), got: ' || coalesce(v_def, '<none>');

  -- document CHECK ('privacy' | 'terms').
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.legal_acceptances'::regclass
     and contype = 'c';
  assert v_def ilike '%document%'
     and v_def ilike '%privacy%'
     and v_def ilike '%terms%',
    'a CHECK constraint must constrain document to (privacy, terms), got: ' || coalesce(v_def, '<none>');

  -- FK to auth.users ON DELETE CASCADE.
  select count(*) into v_count
    from pg_constraint
   where conrelid = 'public.legal_acceptances'::regclass
     and contype = 'f'
     and confrelid = 'auth.users'::regclass
     and confdeltype = 'c';
  assert v_count = 1,
    'legal_acceptances must have an ON DELETE CASCADE FK to auth.users';

  -- RLS enabled.
  select c.relrowsecurity into v_relrowse
    from pg_class c
   where c.oid = 'public.legal_acceptances'::regclass;
  assert v_relrowse, 'RLS must be enabled on legal_acceptances';

  -- Exactly two policies: select_own + insert_own; NO update/delete
  -- (append-only — REQ-1 "no update/delete policies").
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'legal_acceptances';
  assert v_count = 2,
    'legal_acceptances must expose exactly 2 policies (select_own, insert_own), got: ' || v_count;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'legal_acceptances'
     and cmd = 'SELECT'
     and qual ilike '%auth.uid()%' and qual ilike '%user_id%';
  assert v_count = 1,
    'select_own must scope using on auth.uid() = user_id';

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'legal_acceptances'
     and cmd = 'INSERT'
     and with_check ilike '%auth.uid()%' and with_check ilike '%user_id%';
  assert v_count = 1,
    'insert_own must scope with check on auth.uid() = user_id';

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'legal_acceptances'
     and cmd in ('UPDATE', 'DELETE');
  assert v_count = 0,
    'there must be NO update/delete policies (acceptances are append-only)';

  -- RPC catalog: definer, owner, grants (0036 style; 0029 §4 trap closed).
  assert to_regprocedure('public.record_legal_acceptance(text,text)') is not null,
    'record_legal_acceptance(text,text) is missing (expected from 0038)';

  select p.prosecdef, pg_get_userbyid(p.proowner)
    into v_secdef, v_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'record_legal_acceptance'
     and p.pronargs = 2;

  assert v_secdef, 'record_legal_acceptance must be SECURITY DEFINER';
  assert v_owner = 'postgres',
    'record_legal_acceptance must be owned by postgres (required for SECURITY DEFINER bypass)';

  assert has_function_privilege('authenticated', 'public.record_legal_acceptance(text,text)', 'EXECUTE'),
    'authenticated must be able to execute record_legal_acceptance (the canonical writer)';
  assert not has_function_privilege('anon', 'public.record_legal_acceptance(text,text)', 'EXECUTE'),
    'anon must NOT be able to execute record_legal_acceptance (least privilege)';
  assert not has_function_privilege('public', 'public.record_legal_acceptance(text,text)', 'EXECUTE'),
    'PUBLIC must NOT be able to execute record_legal_acceptance (the 0029 §4 trap)';
  assert not has_function_privilege('service_role', 'public.record_legal_acceptance(text,text)', 'EXECUTE'),
    'service_role must NOT be able to execute record_legal_acceptance (design: authenticated ONLY — unlike 0036, the caller role derives user_id from auth.uid())';

  -- -------------------------------------------------------------------------
  -- §2. Behavior — simulated via the Supabase JWT claim GUC (user-categories
  --     convention: BOTH keys set — the local supabase image's auth.uid()
  --     reads request.jwt.claim.sub (singular), while scaffolded/test
  --     harnesses may read request.jwt.claims (plural, whole payload)).
  -- -------------------------------------------------------------------------

  -- Seed both fixture users (as postgres: RLS bypassed, so user B's rows
  -- below are inserted outside any policy — they exist only to prove A's
  -- SELECT cannot see them).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated', v_email_a, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_user_b, 'authenticated', 'authenticated', v_email_b, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  -- Seed user B's acceptance row directly (postgres, RLS bypassed) so the
  -- cross-user isolation assertion in 2f has something to filter out.
  insert into public.legal_acceptances (user_id, document, version)
  values (v_user_b, 'privacy', v_version)
  on conflict (user_id, document, version) do nothing;

  -- Act as user A (authenticated + sub claim).
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_user_a), true);
  set local role authenticated;

  -- 2a. Direct own-row INSERT is allowed by the insert_own policy.
  insert into public.legal_acceptances (user_id, document, version)
  values (v_user_a, 'privacy', v_version)
  on conflict (user_id, document, version) do nothing;
  select count(*) into v_count
    from public.legal_acceptances
   where user_id = v_user_a and document = 'privacy' and version = v_version;
  assert v_count = 1,
    'an authenticated user must be able to INSERT their own acceptance row (insert_own)';

  -- 2b. The RPC writes rows deriving user_id from auth.uid().
  perform public.record_legal_acceptance('terms', v_version);
  select count(*) into v_count
    from public.legal_acceptances
   where user_id = v_user_a and document = 'terms' and version = v_version;
  assert v_count = 1,
    'record_legal_acceptance must insert a row for the calling user (auth.uid())';

  -- 2c. Duplicate (document, version) RPC call is a NO-OP — no second row.
  perform public.record_legal_acceptance('privacy', v_version);
  perform public.record_legal_acceptance('terms', v_version);
  select count(*) into v_count
    from public.legal_acceptances
   where user_id = v_user_a and version = v_version;
  assert v_count = 2,
    're-running the RPC with the same (document, version) must be a no-op (on conflict do nothing)';

  -- 2d. An unknown document raises CHECK violation 23514 and writes nothing.
  begin
    perform public.record_legal_acceptance('cookies', v_version);
    raise exception 'MISSING_EXPECTED_RAISE';
  exception
    when others then
      if sqlerrm = 'MISSING_EXPECTED_RAISE' then
        raise;
      end if;
      v_sqlstate := sqlstate;
      v_errmsg   := sqlerrm;
  end;
  assert v_sqlstate = '23514',
    format('an invalid document must raise CHECK violation (23514), got: %s — %s', v_sqlstate, v_errmsg);
  select count(*) into v_count
    from public.legal_acceptances
   where document = 'cookies';
  assert v_count = 0,
    'a rejected document must not leave any row behind';

  -- 2e. UPDATE / DELETE on OWN rows affect ZERO rows (no policy — the
  --     append-only contract: acceptances are immutable).
  update public.legal_acceptances
     set version = '2026-10-01'
   where user_id = v_user_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 0,
    'UPDATE on own acceptance rows must affect zero rows (no update policy)';

  delete from public.legal_acceptances
   where user_id = v_user_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 0,
    'DELETE on own acceptance rows must affect zero rows (no delete policy)';

  select count(*) into v_count
    from public.legal_acceptances
   where user_id = v_user_a;
  assert v_count = 2,
    'both acceptance rows must still exist after the blocked UPDATE/DELETE (immutable)';

  -- 2f. Cross-user isolation: A's SELECT sees ONLY own rows (B's row is
  --     filtered by select_own), and an INSERT with ANOTHER user's user_id
  --     is blocked by the insert_own with-check.
  select count(*) into v_count from public.legal_acceptances;
  assert v_count = 2,
    'A must see ONLY their own rows (B''s row filtered by select_own)';

  v_blocked := false;
  begin
    insert into public.legal_acceptances (user_id, document, version)
    values (v_user_b, 'terms', v_version);
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked,
    'INSERT with another user''s user_id must violate the insert_own with-check (42501)';
  select count(*) into v_count
    from public.legal_acceptances
   where user_id = v_user_b and document = 'terms';
  assert v_count = 0,
    'the blocked cross-user INSERT must not have written B''s row';

  -- -------------------------------------------------------------------------
  -- §3. FK cascade — deleting the auth.users row removes the acceptance
  --     rows (audit rows die with the account). Return to postgres first:
  --     `set local role authenticated` cannot DELETE from auth.users.
  -- -------------------------------------------------------------------------
  reset role;

  delete from auth.users where id = v_user_a;
  select count(*) into v_count
    from public.legal_acceptances
   where user_id = v_user_a;
  assert v_count = 0,
    'acceptance rows must cascade-delete with the auth.users row (ON DELETE CASCADE)';

  -- Restore user A so the fixture stays consistent for a re-run.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated', v_email_a, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- §4. Anon denial (LAST: role persists for the rest of the transaction).
  --     The select policy targets `authenticated` only → anon reads zero
  --     rows (RLS filters; not an error). EXECUTE on the RPC is REVOKED
  --     from anon → the call raises 42501.
  -- -------------------------------------------------------------------------
  perform set_config('role', 'anon', true);

  select count(*) into v_count from public.legal_acceptances;
  assert v_count = 0,
    'anon must not read any acceptance rows (select policy targets authenticated only)';

  v_blocked := false;
  begin
    perform public.record_legal_acceptance('privacy', v_version);
  exception
    when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked,
    'anon must be denied EXECUTE on record_legal_acceptance (42501 insufficient_privilege)';

  -- -------------------------------------------------------------------------
  -- Summary — only reached if every assert above passed.
  -- -------------------------------------------------------------------------
  raise notice 'legal-acceptances.sql smoke: catalog (columns + PK + CHECK + FK cascade + RLS policies + definer owner/grants) + RPC writes/idempotency + CHECK rejection + append-only (0-row UPDATE/DELETE) + cross-user isolation + FK cascade + anon denial assertions passed';
end $$;