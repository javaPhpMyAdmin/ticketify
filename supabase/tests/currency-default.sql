-- ============================================================================
-- Ticketify — currency-default SQL smoke test (migration 0041)
--
-- A fail-closed catalog smoke test for the i18n workstream's currency-default
-- alignment (app-i18n, gap G5). It runs against a SCRATCH database (e.g.
-- `supabase db reset` output or a CI-local Postgres) — never against
-- production. Like every other file in supabase/tests/ it is READ-ONLY at the
-- schema level: it does NOT apply migrations and does NOT rewrite existing
-- rows. It only reads `pg_catalog` and asserts what 0041 declares.
--
-- What it pins
-- ------------
-- §1. The column default. `public.profiles.currency` must default to the
--     canonical UPPERCASE `'USD'`. Asserted on the RAW catalog string, so a
--     Postgres that renders the literal as `'USD'::text` (its usual
--     `pg_get_expr` rendering) is compared on VALUE, not on formatting — a
--     string compare against `'USD'` alone would fail on a correct catalog.
-- §2. The default FIRES, and the column stores an explicit value verbatim.
--     Two properties, both observable from a post-migration smoke test:
--       (a) a profile inserted WITHOUT a currency is born 'USD';
--       (b) a profile inserted WITH 'UYU' keeps 'UYU' — i.e. the default is
--           not shadowed by a CHECK, a normalizing rule, or a trigger that
--           forces 'USD' over a real user choice. Verified by mutation: a
--           `before insert or update` trigger setting `new.currency='USD'`
--           fails this file.
--
--     LIMITATION — read this before trusting §2(b) as a backfill guard. This
--     class of test runs AFTER the migration chain, so it CANNOT detect a
--     one-time lowercase backfill of the kind an EARLIER migration performed
--     (`update ... set currency = 'usd'`): such a backfill has already finished
--     by the time the fixtures are inserted, and no surviving row reveals it.
--     0041's "declares a default, rewrites nothing" property is therefore
--     pinned by its own migration header and by review, NOT by this file. What
--     §2(b) does pin is the durable, always-on enforcement surface (triggers /
--     CHECKs / coercions), which is how the bug actually returns.
-- §3. The column's nullability and type are unchanged (`text NOT NULL`), so
--     the migration did not widen or loosen anything on its way through.
--
-- Why §2 seeds and deletes rows: that is the only way to observe a DEFAULT
-- actually firing. The seeds use fixed UUIDs outside every other smoke
-- test's range (cd...-cd*, vs da... / e0...), are inserted ON CONFLICT DO
-- NOTHING, and are removed in the same DO block — so the file is idempotent
-- and safe to re-run, and leaves the scratch DB as it found it.
--
-- Cleanup runs on BOTH paths. The three fixtures are removed by one pair of
-- deletes on the success path AND by an identical pair inside an
-- `exception when assert_failure or others ... raise;` handler, so a run that
-- dies mid-file cannot strand rows. That handler used to be absent: the only
-- cleanup sat at the very end, after every assert, which a failure skips. The
-- re-raise is load-bearing — see the block comment at the foot of the file for
-- why `assert_failure` must be named explicitly (PL/pgSQL's `OTHERS` does not
-- match it) and what the cleanup can and cannot achieve given subtransaction
-- rollback.
--
-- Structure: the whole file is a SINGLE `DO` block (same constraint as the
-- rest of supabase/tests/*.sql — `supabase db query --local --file` prepares
-- the file as one statement). A failing `assert` aborts the block and fails
-- the query (exit != 0).
-- ============================================================================

do $$
declare
  v_user       uuid := 'cd000000-0000-0000-0000-00000000c5d1'; -- §2 already-chosen 'UYU' fixture
  v_user_fresh uuid := 'cd000000-0000-0000-0000-00000000c5d2'; -- §2 default-firing fixture (no currency given)
  v_dup_id     uuid := 'cd000000-0000-0000-0000-00000000c5d3'; -- §4 duplicate-insert fixture. Declared HERE,
                                                                    -- not inside the §4 block: the failure-path
                                                                    -- handler at the foot of this block has to
                                                                    -- reach all three fixture ids, and a variable
                                                                    -- declared in the §4 block does not outlive it.

  v_default_expr text;
  v_default_val  text;
  v_is_nullable  text;
  v_data_type    text;
  v_seeded_cur   text;
  v_fresh_cur    text;
  v_untouched_cur text;
begin
  ---------------------------------------------------------------------------
  -- §1. The column default is exactly the canonical UPPERCASE 'USD'
  ---------------------------------------------------------------------------
  select
    pg_get_expr(d.adbin, d.adrelid),
    d.adbin::text,
    -- `is_nullable` is an information_schema.columns view column; the raw
    -- catalog flag is pg_attribute.attnotnull (true = NOT NULL).
    case when a.attnotnull then 'NO' else 'YES' end,
    format_type(a.atttypid, a.atttypmod)
  into v_default_expr, v_default_val, v_is_nullable, v_data_type
  from pg_attribute a
  join pg_class     c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attrdef   d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and a.attname = 'currency'
    and a.attnum > 0
    and not a.attisdropped;

  assert v_default_expr is not null,
    'public.profiles.currency has no column default — migration 0041 must declare one';

  -- Compare the VALUE inside the rendered default expression rather than the
  -- whole string: pg_get_expr returns `'USD'::text` on a standard catalog, so
  -- a bare equality against `'USD'` would reject a correct schema.
  --
  -- `~` (NOT `~*`) is the load-bearing operator here. The pre-0041 version of this
  -- file used `~*`, which is case-INSENSITIVE, so it matched `'USD'` just as
  -- happily as `'usd'` and could not tell the two apart -- the one property
  -- this migration exists to establish. Its second assertion made the same
  -- mistake and was a tautology: with both sides case-folded,
  -- `!~* 'USD' or ~* 'usd'` is true for any expression containing either
  -- spelling. Both are replaced below by case-sensitive checks.
  assert (v_default_expr ~ '''USD'''::text),
    format('expected the profiles.currency default to contain ''USD'' UPPERCASE, got: %s', v_default_expr);

  -- Case-sensitive negative: a lowercase-only literal anywhere in the default
  -- expression means the canonical-uppercase requirement (NFR-1) is unmet,
  -- even though `toUpperCase()` would make the two format identically.
  assert (v_default_expr !~ '''usd'''::text),
    format('the default must not carry a lowercase ''usd'' literal: %s', v_default_expr);

  ---------------------------------------------------------------------------
  -- §3. Type and nullability untouched by 0041
  ---------------------------------------------------------------------------
  assert v_is_nullable = 'NO',
    format('profiles.currency must stay NOT NULL, got %s', coalesce(v_is_nullable, 'MISSING'));

  assert v_data_type = 'text',
    format('profiles.currency must stay text, got %s', coalesce(v_data_type, 'MISSING'));

  ---------------------------------------------------------------------------
  -- §2. The default FIRES, and an explicit currency is stored verbatim
  ---------------------------------------------------------------------------
  -- A currency the user (or 0007) actually chose must survive as given. 0007
  -- rewrote every 'USD' row to 'UYU'; no trigger, CHECK or coercion may repeat
  -- that mistake in the other direction. See the header LIMITATION note for
  -- what this assertion cannot see (a one-time backfill).
  insert into auth.users (id, email)
  values (v_user, 'currency-default@i18n.test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, currency)
  values (v_user, 'UYU')
  on conflict (id) do nothing;

  select currency into v_seeded_cur
  from public.profiles where id = v_user;

  assert v_seeded_cur = 'UYU',
    format('an explicitly-chosen UYU row must survive 0041 untouched, got %s', coalesce(v_seeded_cur, 'NULL'));

  -- Now the default itself: a profile inserted WITHOUT a currency must be
  -- born 'USD'. This is the behavior the migration exists to change, and it
  -- is only observable through a real insert.
  insert into auth.users (id, email)
  values (v_user_fresh, 'currency-default-fresh@i18n.test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id)
  values (v_user_fresh);

  select currency into v_fresh_cur
  from public.profiles where id = v_user_fresh;

  assert v_fresh_cur = 'USD',
    format('a new profile must be born with the ''USD'' default, got %s', coalesce(v_fresh_cur, 'NULL'));

  -- And the seeded row is STILL 'UYU' after the no-currency insert above: the
  -- DEFAULT applied to the row that omitted it and left the row that supplied
  -- one completely alone.
  select currency into v_untouched_cur
  from public.profiles where id = v_user;

  assert v_untouched_cur = 'UYU',
    format('0041 must not override an explicitly-chosen currency, got %s', coalesce(v_untouched_cur, 'NULL'));


  ---------------------------------------------------------------------------
  -- §4. unique_violation guard (23505) and anti-clobber guarantee
  ---------------------------------------------------------------------------
  declare
    v_dup_23505 boolean := false;
    v_pre_cur   text;
    v_post_cur  text;
  begin
    -- Seed a known row with an explicit currency
    insert into auth.users (id, email)
    values (v_dup_id, 'currency-default-dup@i18n.test.local')
    on conflict (id) do nothing;

    insert into public.profiles (id, currency)
    values (v_dup_id, 'EUR')
    on conflict (id) do nothing;

    select currency into v_pre_cur from public.profiles where id = v_dup_id;
    assert v_pre_cur = 'EUR',
      format('duplicate guard seed must be EUR, got %s', coalesce(v_pre_cur, 'NULL'));

    -- Attempt to insert the SAME id again (should raise unique_violation/23505)
    begin
      insert into public.profiles (id, currency) values (v_dup_id, 'USD');
    exception
      when unique_violation then
        v_dup_23505 := true;
    end;

    assert v_dup_23505 = true,
      'expected duplicate insert into profiles to raise unique_violation (23505)';

    -- Currency must remain unchanged
    select currency into v_post_cur from public.profiles where id = v_dup_id;
    assert v_post_cur = v_pre_cur,
      format('a rejected duplicate insert must not change currency (pre=%s, post=%s)', v_pre_cur, coalesce(v_post_cur, 'NULL'));

    -- No cleanup here on purpose: §4's fixture is removed by the single
    -- cleanup statement below, which runs on BOTH the success and the failure
    -- path. Two cleanup sites meant one of them could be skipped by a future
    -- edit, and the one at the end of the file was on no failure path at all.
  end;

  -- ---------------------------------------------------------------------------
  -- Cleanup — success path
  -- ---------------------------------------------------------------------------
  -- Leave the scratch DB exactly as we found it. Plain deletes against the three
  -- fixed fixture ids (no ON CONFLICT clause involved here): the inserts above
  -- are all `on conflict do nothing`, so a row left behind by an interrupted
  -- run is simply removed and re-running stays clean.
  delete from public.profiles where id in (v_user, v_user_fresh, v_dup_id);
  delete from auth.users   where id in (v_user, v_user_fresh, v_dup_id);

  raise notice 'currency-default smoke test passed (0041)';

exception
  -- ---------------------------------------------------------------------------
  -- Cleanup — FAILURE path. Same two deletes, then `raise;`.
  --
  -- `assert_failure` is listed EXPLICITLY and is not optional: per the
  -- PostgreSQL docs, `OTHERS` "matches every error type except QUERY_CANCELED
  -- and ASSERT_FAILURE". Every failure this file is built to detect is a
  -- failed `assert` (SQLSTATE P0004), so a plain `when others` would compile,
  -- look correct, and never fire once — verified against this stack by
  -- mutation, not by reading. `assert_failure or others` is one branch and
  -- covers both the assertion failures and any other error the block can hit
  -- (a missing table, a permission error).
  --
  -- The bare `raise;` is load-bearing in the other direction: it re-raises the
  -- original error with its original message and SQLSTATE, so the run still
  -- exits non-zero. Swallowing it here would turn a genuinely broken
  -- migration into a green run.
  --
  -- Honest scope of what these deletes can achieve: a PL/pgSQL block with an
  -- EXCEPTION clause runs as a subtransaction, so when an assert fires the
  -- block's statements are already rolled back by the time this handler runs —
  -- measured on this stack, the handler sees 0 of the rows the block inserted.
  -- Under the `supabase db query` runner that also means these deletes are
  -- defensive no-ops, and a pre-fix failing run of this file was verified to
  -- leave 0 fixture rows behind. They earn their place for the case that
  -- actually bites: someone later adding a handler that swallows the error to
  -- "make CI green". Without the `raise;`, and with the cleanup skipped the way
  -- it was before this change, that edit would COMMIT the fixtures.
  ---------------------------------------------------------------------------
  when assert_failure or others then
    delete from public.profiles where id in (v_user, v_user_fresh, v_dup_id);
    delete from auth.users   where id in (v_user, v_user_fresh, v_dup_id);
    raise;
end
$$;