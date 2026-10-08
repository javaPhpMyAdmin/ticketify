-- ============================================================================
-- Ticketify — receipt-currency SQL smoke test (migration 0042)
--
-- Pins the money-integrity slice B contract (REQ-8) at the SQL tier: the
-- receipt's own unit is stored with the row, never guessed, never backfilled,
-- and a tampered unit costs the caller nothing. Runs against a SCRATCH
-- database (`supabase db reset` output or the CI-local stack) — never against
-- production. Like every other file in supabase/tests/ it does NOT apply
-- migrations; it asserts what 0042 already declared on this catalog.
--
-- What it pins
-- ------------
-- §1. The column. `public.purchases.currency` exists, is `text`, is
--     NULLABLE, and carries NO column default — three properties in one:
--     nullable + no-default is what "legacy rows stay unit-less" rests on
--     (an insert that omits the unit stores NULL, never a guessed code), and
--     the absence of a CHECK constraint is NFR-1 (the supported catalog
--     lives in code — src/lib/format.ts + parse-ticket — so a row-level
--     CHECK would freeze catalog evolution behind a migration).
-- §2. The shape-A overload contract (0042 §2 header): the 8-param
--     save_receipt exists with p_currency REQUIRED (exactly one default,
--     belonging to the trailing p_is_manual), the 6- and 7-param overloads
--     from 0023/0029/0032 survive untouched, and EXECUTE is granted to
--     `authenticated` only — revoked from anon and PUBLIC (0042 §3).
--     WHY THIS MATTERS BEYOND BOOKKEEPING: the whole shape-A decision
--     (required p_currency BEFORE the defaulted p_is_manual) exists because
--     Postgres has no fewest-defaults tie-break (42P03) — a defaulted
--     p_currency would make the live client's 7-key call ambiguous
--     (PGRST203) and fail every receipt save. A future "cleanup" that
--     re-defaults p_currency must trip this assertion, not production.
-- §3. A unit the catalog accepts is stored VERBATIM (after upper+btrim) —
--     'CLP' round-trips, and the value a client reads back off the row is
--     the value it renders. This is the whole point of REQ-8: what you
--     scanned is what the row keeps.
-- §4. Catalog re-check #2 at the RPC (REQ-8 #2): an out-of-catalog code
--     ('XYZ') does NOT raise — the save still succeeds (ok=true, row
--     created) and the unit is normalized to NULL, exactly what "no unit
--     detected" stores. A guessed or tampered unit must not cost the user
--     an otherwise valid receipt; the edge parse is gate #1, this is gate
--     #2, and neither may reject the save itself.
-- §5. The legacy/omitted path: a 7-arg call (named notation, no
--     p_currency — what the pre-0042 client and any unit-less scan send)
--     resolves to the untouched 7-param overload and stores NULL.
-- §6. No backfill / no default (REQ-8 #3): a bare INSERT that omits the
--     column entirely stores NULL. Post-reset there are no pre-0042 rows to
--     inspect (the table starts empty), so the durable, always-on property
--     — nothing ever fills the unit in behind the caller's back — is pinned
--     here at the only seam that survives a fresh database: the column
--     default. The migration's own "rewrites nothing" claim additionally
--     rests on its header + review, exactly like 0041's (see the LIMITATION
--     note in currency-default.sql — same honest scope).
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as the
-- rest of supabase/tests/*.sql — `supabase db query --local --file` prepares
-- the file as one statement). A failing `assert` aborts the block and fails
-- the query (exit != 0).
--
-- Fixture notes: the fixed UUID (ce...-ce01) is outside every other smoke's
-- range (a..., b..., c0..., cd..., e0..., f0...), every insert is
-- `on conflict do nothing`, and cleanup runs on BOTH paths (success +
-- failure handler), so the file is idempotent and leaves the scratch DB as
-- it found it. The profile is tier 'pro' so the scan-cap increment can never
-- make a save return ok=false (deterministic assertions either way).
-- ============================================================================

do $$
declare
  -- Fixed test identity (deterministic, never collides with real rows or
  -- with the ce-free cd000000 fixtures of currency-default.sql).
  v_user    uuid := 'ce000000-0000-0000-0000-00000000ce01';

  -- §2 catalog vars.
  v_is_nullable text;
  v_data_type   text;
  v_default_cnt int;
  v_has_6       boolean;
  v_has_7       boolean;
  v_has_8       boolean;

  -- §3–§5 RPC vars.
  v_ok         boolean;
  v_pid        uuid;
  v_stored     text;
  v_row_date   date;
begin
  -- -------------------------------------------------------------------------
  -- §1. The column: text, nullable, NO default, NO check constraint
  -- -------------------------------------------------------------------------
  select
    case when a.attnotnull then 'NO' else 'YES' end,
    format_type(a.atttypid, a.atttypmod)
  into v_is_nullable, v_data_type
  from pg_attribute a
  join pg_class     c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'purchases'
    and a.attname = 'currency'
    and a.attnum > 0
    and not a.attisdropped;

  assert v_data_type is not null,
    'public.purchases.currency is missing — migration 0042 must add the column';

  assert v_data_type = 'text',
    format('purchases.currency must be text, got %s', v_data_type);

  assert v_is_nullable = 'YES',
    format('purchases.currency must be NULLABLE (legacy rows are unit-less), got %s', v_is_nullable);

  assert not exists (
    select 1
    from pg_attrdef d
    join pg_class     c on c.oid = d.adrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'purchases'
      and d.adnum = (
        select a.attnum from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'currency'
      )
  ), 'purchases.currency must have NO column default — a default would fill a unit in behind the caller (REQ-8 #3: no backfill, no guessing)';

  assert not exists (
    select 1
    from pg_constraint con
    join pg_class      c on c.oid = con.conrelid
    join pg_namespace  n on n.oid = c.relnamespace
    join unnest (con.conkey) k on true
    join pg_attribute  a on a.attrelid = c.oid and a.attnum = k
    where n.nspname = 'public'
      and c.relname = 'purchases'
      and con.contype = 'c'
      and a.attname = 'currency'
  ), 'purchases.currency must carry NO CHECK constraint — the supported catalog lives in code (NFR-1); a row-level CHECK would freeze catalog evolution behind a migration';

  -- -------------------------------------------------------------------------
  -- §2. Shape-A overload contract + grants (0042 §2/§3)
  -- -------------------------------------------------------------------------
  select count(*) > 0 into v_has_6
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 6;
  assert v_has_6,
    'the 6-param save_receipt overload (0023) must survive 0042 untouched';

  select count(*) > 0 into v_has_7
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 7;
  assert v_has_7,
    'the 7-param save_receipt overload (0029/0032) must survive 0042 untouched — it is the path the live 7-key client call resolves to';

  select count(*) > 0 into v_has_8
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 8
     and p.proargnames[7] = 'p_currency';
  assert v_has_8,
    'the 8-param save_receipt overload (0042 shape A) must exist with p_currency as the 7th parameter (before p_is_manual)';

  -- Exactly ONE default in the 8-param signature, and it is the trailing
  -- p_is_manual: p_currency is REQUIRED. This is load-bearing (42P03 — see
  -- §2's header comment): re-defaulting p_currency would make the live
  -- 7-key call ambiguous and fail every save with PGRST203.
  select coalesce(array_length(p.proargdefaults, 1), 0)
    into v_default_cnt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_receipt' and p.pronargs = 8;
  assert v_default_cnt = 1,
    format('the 8-param save_receipt must carry EXACTLY ONE default (p_is_manual) so p_currency stays required — shape A; got %s default(s)', v_default_cnt);

  assert has_function_privilege(
           'authenticated',
           'public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], text, boolean)',
           'EXECUTE'),
    'authenticated must have EXECUTE on the 8-param save_receipt (0042 §3)';

  assert not has_function_privilege(
           'anon',
           'public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], text, boolean)',
           'EXECUTE'),
    'anon must NOT have EXECUTE on the 8-param save_receipt (0042 §3)';

  assert not has_function_privilege(
           'public',
           'public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], text, boolean)',
           'EXECUTE'),
    'PUBLIC must NOT have EXECUTE on the 8-param save_receipt (0042 §3: revoke after CREATE OR REPLACE on a new signature)';

  -- -------------------------------------------------------------------------
  -- Fixtures — one pro profile so the scan-cap increment always passes
  -- -------------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', 'receipt-currency@money.test.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, monthly_budget, currency, created_at)
  values (v_user, 'Receipt Currency', 0, 'USD', now())
  on conflict (id) do nothing;

  update public.profiles set tier = 'pro' where id = v_user;

  -- Both auth.uid() GUC spellings, per house convention: the local
  -- supabase image's auth.uid() reads request.jwt.claim.sub (singular);
  -- scaffolded/test harnesses may read request.jwt.claims (plural).
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_user), true);

  -- -------------------------------------------------------------------------
  -- §3. An in-catalog unit is stored verbatim (what you scanned = what
  --     the row keeps; a client reading this row renders 'CLP')
  -- -------------------------------------------------------------------------
  select ok, purchase_id into v_ok, v_pid
    from public.save_receipt(
      p_store_id       => null,
      p_purchase_date  => date '2026-09-10',
      p_total          => 4500.00,
      p_payment_method => 'cash',
      p_image_url      => null,
      p_items          => array[
        row('Pan', 1, 4500.00, 4500.00, null, false, 0)::public.purchase_item_input
      ],
      p_currency       => 'CLP',
      p_is_manual      => false
    );
  assert v_ok and v_pid is not null,
    'save_receipt with an in-catalog unit must succeed (ok=true)';

  select currency into v_stored from public.purchases where id = v_pid;
  assert v_stored = 'CLP',
    format('an in-catalog ''CLP'' must persist as ''CLP'' (client reads and renders this value), got %s', coalesce(v_stored, 'NULL'));

  -- Normalization is part of the contract: upper + btrim, so the lowercase
  -- padded form a parser might emit lands on the same canonical code.
  select ok, purchase_id into v_ok, v_pid
    from public.save_receipt(
      p_store_id       => null,
      p_purchase_date  => date '2026-09-11',
      p_total          => 99.90,
      p_payment_method => 'card',
      p_image_url      => null,
      p_items          => array[
        row('Yerba', 1, 99.90, 99.90, null, false, 0)::public.purchase_item_input
      ],
      p_currency       => ' clp ',
      p_is_manual      => false
    );
  assert v_ok and v_pid is not null,
    'save_receipt with a lowercase/padded unit must succeed (normalization must not reject)';

  select currency into v_stored from public.purchases where id = v_pid;
  assert v_stored = 'CLP',
    format(''' clp '' must normalize to canonical ''CLP'' (upper+btrim), got %s', coalesce(v_stored, 'NULL'));

  -- -------------------------------------------------------------------------
  -- §4. Out-of-catalog unit: saved anyway, unit stored as NULL —
  --     never raises (REQ-8 #2, gate #2 of two)
  -- -------------------------------------------------------------------------
  select ok, purchase_id into v_ok, v_pid
    from public.save_receipt(
      p_store_id       => null,
      p_purchase_date  => date '2026-09-12',
      p_total          => 12.00,
      p_payment_method => 'cash',
      p_image_url      => null,
      p_items          => array[
        row('Galletitas', 1, 12.00, 12.00, null, false, 0)::public.purchase_item_input
      ],
      p_currency       => 'XYZ',
      p_is_manual      => false
    );
  assert v_ok and v_pid is not null,
    'an out-of-catalog unit must NOT raise — the receipt is still saved (ok=true, REQ-8 #2: a tampered unit never costs the save)';

  select currency into v_stored from public.purchases where id = v_pid;
  assert v_stored is null,
    format('an out-of-catalog ''XYZ'' must be normalized to NULL (viewer fallback), got %s', coalesce(v_stored, 'NON-NULL'));

  -- -------------------------------------------------------------------------
  -- §5. The omitted-unit path: a 7-arg call (no p_currency) resolves to
  --     the untouched 7-param overload and stores NULL
  -- -------------------------------------------------------------------------
  select ok, purchase_id into v_ok, v_pid
    from public.save_receipt(
      p_store_id       => null,
      p_purchase_date  => date '2026-09-13',
      p_total          => 5.50,
      p_payment_method => 'cash',
      p_image_url      => null,
      p_items          => array[
        row('Factura', 1, 5.50, 5.50, null, false, 0)::public.purchase_item_input
      ],
      p_is_manual      => false
    );
  assert v_ok and v_pid is not null,
    'the legacy 7-arg call (unit omitted) must still succeed — f8 must not make it ambiguous (shape A)';

  select currency into v_stored from public.purchases where id = v_pid;
  assert v_stored is null,
    format('a save that omits the unit must store NULL (viewer fallback), got %s', coalesce(v_stored, 'NON-NULL'));

  -- -------------------------------------------------------------------------
  -- §6. No default: a bare INSERT that omits the column stores NULL
  --     (the durable no-backfill / no-guessing seam)
  -- -------------------------------------------------------------------------
  insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, status, created_at)
  values ('ce000000-0000-0000-0000-00000000ce02', v_user, null, date '2026-09-14', 7.00, 'cash', 'confirmed', now())
  on conflict (id) do nothing;

  select currency into v_stored from public.purchases where id = 'ce000000-0000-0000-0000-00000000ce02';
  assert v_stored is null,
    format('a purchase inserted WITHOUT the column must be unit-less (NULL) — no default may fill a unit in, got %s', coalesce(v_stored, 'NON-NULL'));

  -- -------------------------------------------------------------------------
  -- Cleanup — success path (items cascade with the purchase)
  -- -------------------------------------------------------------------------
  delete from public.purchases   where user_id = v_user;
  delete from public.scan_usage  where user_id = v_user;
  delete from public.profiles    where id = v_user;
  delete from auth.users         where id = v_user;

  raise notice 'receipt-currency smoke test passed (0042)';

exception
  -- -------------------------------------------------------------------------
  -- Cleanup — FAILURE path. Same four deletes, then `raise;`.
  --
  -- `assert_failure` is listed EXPLICITLY and is not optional: per the
  -- PostgreSQL docs, OTHERS "matches every error type except QUERY_CANCELED
  -- and ASSERT_FAILURE". Every failure this file is built to detect is a
  -- failed `assert` (SQLSTATE P0004), so a plain `when others` would compile,
  -- look correct, and never fire once — verified against this stack by
  -- mutation on the sibling files, not by reading. `assert_failure or others`
  -- covers both the assertion failures and any other error (missing table,
  -- permission error) the block can hit.
  --
  -- The bare `raise;` is load-bearing: it re-raises the original error with
  -- its original SQLSTATE, so the run still exits non-zero. Swallowing it
  -- would turn a genuinely broken migration into a green run.
  --
  -- Honest scope: a PL/pgSQL block with an EXCEPTION clause runs as a
  -- subtransaction, so by the time this handler runs the block's statements
  -- are already rolled back (the sibling files measured 0 fixture rows
  -- surviving a failed run) — these deletes are defensive, and earn their
  -- place for the case that bites: a future handler added to "make CI green".
  -- -------------------------------------------------------------------------
  when assert_failure or others then
    delete from public.purchases where user_id = v_user;
    delete from public.scan_usage where user_id = v_user;
    delete from public.profiles  where id = v_user;
    delete from auth.users       where id = v_user;
    raise;
end
$$;
