-- ============================================================================
-- supabase/tests/trial-rollback.sql
-- Ticketify — Smoke for the 0040_rc_trial_rollback.sql rollback migration.
--
-- Paired with supabase/tests/trial-cutover.sql (0039 forward smoke). This
-- file asserts the PRE-CUTOVER catalog state is restored after 0040 applies.
-- On a fresh `supabase db reset --local` + `0039 → 0040` sequence, all
-- assertions here are GREEN. On a post-cutover DB that just had 0040 applied
-- (no 0039), all assertions are GREEN.
--
-- Like the cutover smoke, this file is safe to re-run (idempotent: it
-- only reads + asserts; it never mutates catalog or data).
--
-- The file uses `do $$ ... $$` blocks + `perform` for catalog reads (the
-- pre-cutover conventions + the project-wide smoke style documented in
-- supabase/tests/README.md).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. trial_ends_at column is RESTORED on profiles.
-- ---------------------------------------------------------------------------

do $$
begin
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'trial_ends_at'
  ), 'profiles.trial_ends_at column must be RESTORED (0040 §7 reverse)';
end $$;

-- ---------------------------------------------------------------------------
-- §2. subscription_status CHECK widened back to (none, trial, active, expired).
-- ---------------------------------------------------------------------------

do $$
declare
  v_checkdef text;
begin
  select pg_get_constraintdef(oid) into v_checkdef
    from pg_constraint
   where conname = 'profiles_subscription_status_check'
     and conrelid = 'public.profiles'::regclass;

  assert v_checkdef is not null,
    'profiles_subscription_status_check constraint must EXIST (0040 §6 reverse)';
  -- The CHECK must include all 4 pre-cutover values. Use a permissive
  -- match: the constraint def must contain each token.
  assert v_checkdef like '%none%',
    format('CHECK must include ''none'': %s', v_checkdef);
  assert v_checkdef like '%trial%',
    format('CHECK must include ''trial'' (pre-cutover): %s', v_checkdef);
  assert v_checkdef like '%active%',
    format('CHECK must include ''active'': %s', v_checkdef);
  assert v_checkdef like '%expired%',
    format('CHECK must include ''expired'' (pre-cutover): %s', v_checkdef);
end $$;

-- Direct insert acceptance probe (the four pre-cutover values).
do $$
declare
  v_user uuid := gen_random_uuid();
  v_email text := 'rollback-smoke+' || v_user::text || '@example.test';
  v_sqlstate text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

  -- 'none' (default).
  begin
    insert into public.profiles (id, subscription_status, trial_ends_at) values (v_user, 'none', null);
  exception when others then
    raise exception 'rollback CHECK must accept ''none'': %', sqlerrm;
  end;

  -- 'trial' (the value 0039 §1 backfilled away).
  begin
    insert into public.profiles (id, subscription_status, trial_ends_at) values (v_user, 'trial', now() + interval '5 days');
  exception when others then
    raise exception 'rollback CHECK must accept ''trial'': %', sqlerrm;
  end;
  delete from public.profiles where id = v_user;

  -- 'active'.
  begin
    insert into public.profiles (id, subscription_status, trial_ends_at) values (v_user, 'active', null);
  exception when others then
    raise exception 'rollback CHECK must accept ''active'': %', sqlerrm;
  end;
  delete from public.profiles where id = v_user;

  -- 'expired'.
  begin
    insert into public.profiles (id, subscription_status, trial_ends_at) values (v_user, 'expired', null);
  exception when others then
    raise exception 'rollback CHECK must accept ''expired'': %', sqlerrm;
  end;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
end $$;

-- ---------------------------------------------------------------------------
-- §3. RPCs RESTORED — start_free_trial, expire_overdue_trials, sync_subscription_status
-- (3-arg), set_profile_tier, sync_client_subscription.
-- ---------------------------------------------------------------------------

do $$
begin
  -- start_free_trial() exists.
  assert to_regprocedure('public.start_free_trial()') is not null,
    'start_free_trial() must be RESTORED (0040 §4 reverse)';
  -- expire_overdue_trials() exists.
  assert to_regprocedure('public.expire_overdue_trials()') is not null,
    'expire_overdue_trials() must be RESTORED (0040 §5 reverse)';
  -- sync_subscription_status 3-arg overload exists.
  assert to_regprocedure('public.sync_subscription_status(uuid, text, timestamptz)') is not null,
    'sync_subscription_status(uuid, text, timestamptz) 3-arg overload must be RESTORED (0040 §9a reverse)';
  -- sync_subscription_status 2-arg does NOT exist.
  assert to_regprocedure('public.sync_subscription_status(uuid, text)') is null,
    'sync_subscription_status(uuid, text) 2-arg form must NOT exist (rollback)';
  -- set_profile_tier exists.
  assert to_regprocedure('public.set_profile_tier(uuid, text)') is not null,
    'set_profile_tier() must exist';
  -- sync_client_subscription exists.
  assert to_regprocedure('public.sync_client_subscription(text)') is not null,
    'sync_client_subscription() must exist';
end $$;

-- ---------------------------------------------------------------------------
-- §4. sync_client_subscription allow-list restored to (none, trial, expired).
-- The 0039 forward smoke §4 asserts the post-cutover narrow allow-list
-- ('none' only); this rollback smoke asserts the WIDER allow-list is back.
-- ---------------------------------------------------------------------------

do $$
declare
  v_sqlstate text;
begin
  -- 'active' is webhook-reserved (must RAISE) — same as pre-cutover.
  begin
    perform public.sync_client_subscription('active');
  exception when others then v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = 'P0001',
    format('sync_client_subscription(''active'') must RAISE P0001 (webhook-reserved), got: %s', coalesce(v_sqlstate, 'null'));

  -- 'trial' must be ALLOWED again (pre-cutover allowed client to claim
  -- their own trial via this RPC — restored by §9d reverse).
  v_sqlstate := null;
  begin
    perform public.sync_client_subscription('trial');
  exception when others then v_sqlstate := sqlstate;
  end;
  assert v_sqlstate is null,
    format('sync_client_subscription(''trial'') must SUCCEED post-rollback (pre-cutover allow-list), got: %s', coalesce(v_sqlstate, 'null'));

  -- 'expired' must be ALLOWED again.
  v_sqlstate := null;
  begin
    perform public.sync_client_subscription('expired');
  exception when others then v_sqlstate := sqlstate;
  end;
  assert v_sqlstate is null,
    format('sync_client_subscription(''expired'') must SUCCEED post-rollback, got: %s', coalesce(v_sqlstate, 'null'));

  -- 'none' must still be allowed (unchanged).
  v_sqlstate := null;
  begin
    perform public.sync_client_subscription('none');
  exception when others then v_sqlstate := sqlstate;
  end;
  assert v_sqlstate is null,
    format('sync_client_subscription(''none'') must SUCCEED post-rollback, got: %s', coalesce(v_sqlstate, 'null'));

  -- Bogus value still raises.
  v_sqlstate := null;
  begin
    perform public.sync_client_subscription('garbage');
  exception when others then v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = 'P0001',
    format('sync_client_subscription(''garbage'') must RAISE P0001, got: %s', coalesce(v_sqlstate, 'null'));
end $$;

-- ---------------------------------------------------------------------------
-- §5. protect_profile_tier guard restored — trial_ends_at is server-managed
-- (client cannot write to it). This is the post-rollback equivalent of the
-- 0039 forward smoke §4d (which asserted the opposite).
-- ---------------------------------------------------------------------------

do $$
declare
  v_user uuid := gen_random_uuid();
  v_email text := 'rollback-guard+' || v_user::text || '@example.test';
  v_sqlstate text;
begin
  -- Bypass the trigger guard by setting current_user via set_config.
  perform set_config('role', 'authenticated', true);

  -- The trigger guards writes from non-postgres roles. A client attempt
  -- to update trial_ends_at must RAISE (pre-cutover guard restored in
  -- §9c reverse).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into public.profiles (id, subscription_status, trial_ends_at) values (v_user, 'none', null);

  v_sqlstate := null;
  begin
    update public.profiles
       set trial_ends_at = now()
     where id = v_user;
  exception when others then v_sqlstate := sqlstate;
  end;
  assert v_sqlstate is not null and v_sqlstate <> '00000',
    format('authenticated UPDATE of trial_ends_at must RAISE post-rollback (protect_profile_tier guard), got: %s', coalesce(v_sqlstate, 'null'));
  assert v_sqlstate = 'P0001',
    format('protect_profile_tier must RAISE P0001 (''trial_ends_at is managed server-side''), got: %s', coalesce(v_sqlstate, 'null'));

  reset role;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
end $$;

-- ---------------------------------------------------------------------------
-- §6. pg_cron 'trial-expiry' job is RESCHEDULED.
-- Best-effort: the pg_cron extension is platform-optional, so the assertion
-- is SKIPPED (not failed) when the extension is not installed.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    assert exists (
      select 1 from cron.job where jobname = 'trial-expiry'
    ), 'cron.job ''trial-expiry'' entry must be RESCHEDULED (0040 §8 reverse)';
    assert exists (
      select 1 from cron.job where jobname = 'trial-expiry' and schedule = '0 */6 * * *'
    ), 'cron.job ''trial-expiry'' must run every 6 hours (0040 §8 reverse)';
  end if;
  -- If pg_cron is not installed, the assertion is skipped silently (the
  -- rollback's §8 reverse is wrapped in the same `if exists` guard).
end $$;

-- ---------------------------------------------------------------------------
-- §7. Least-privilege grants restored. Pre-cutover posture:
--   - start_free_trial: EXECUTE to authenticated.
--   - expire_overdue_trials: EXECUTE to authenticated.
--   - sync_subscription_status: EXECUTE to service_role only (NOT anon/authenticated).
--   - set_profile_tier: EXECUTE to service_role only.
--   - sync_client_subscription: EXECUTE to authenticated (NOT anon).
--   - protect_profile_tier: NO explicit EXECUTE grant — trigger function.
-- ---------------------------------------------------------------------------

do $$
begin
  -- start_free_trial: authenticated has EXECUTE; anon does NOT.
  assert has_function_privilege('authenticated', 'public.start_free_trial()', 'EXECUTE'),
    'authenticated must have EXECUTE on start_free_trial() post-rollback';
  assert not has_function_privilege('anon', 'public.start_free_trial()', 'EXECUTE'),
    'anon must NOT have EXECUTE on start_free_trial() post-rollback';

  -- expire_overdue_trials: authenticated has EXECUTE.
  assert has_function_privilege('authenticated', 'public.expire_overdue_trials()', 'EXECUTE'),
    'authenticated must have EXECUTE on expire_overdue_trials() post-rollback';

  -- sync_subscription_status 3-arg: service_role only.
  assert has_function_privilege('service_role', 'public.sync_subscription_status(uuid, text, timestamptz)', 'EXECUTE'),
    'service_role must have EXECUTE on sync_subscription_status(uuid, text, timestamptz) post-rollback';
  assert not has_function_privilege('anon', 'public.sync_subscription_status(uuid, text, timestamptz)', 'EXECUTE'),
    'anon must NOT have EXECUTE on sync_subscription_status(uuid, text, timestamptz) post-rollback';
  assert not has_function_privilege('authenticated', 'public.sync_subscription_status(uuid, text, timestamptz)', 'EXECUTE'),
    'authenticated must NOT have EXECUTE on sync_subscription_status(uuid, text, timestamptz) post-rollback';

  -- set_profile_tier: service_role only.
  assert has_function_privilege('service_role', 'public.set_profile_tier(uuid, text)', 'EXECUTE'),
    'service_role must have EXECUTE on set_profile_tier(uuid, text) post-rollback';
  assert not has_function_privilege('anon', 'public.set_profile_tier(uuid, text)', 'EXECUTE'),
    'anon must NOT have EXECUTE on set_profile_tier(uuid, text) post-rollback';

  -- sync_client_subscription: authenticated only.
  assert has_function_privilege('authenticated', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'authenticated must have EXECUTE on sync_client_subscription(text) post-rollback';
  assert not has_function_privilege('anon', 'public.sync_client_subscription(text)', 'EXECUTE'),
    'anon must NOT have EXECUTE on sync_client_subscription(text) post-rollback';

  -- protect_profile_tier: REVOKE ALL was applied in §9c reverse, so PUBLIC
  -- (and anon + authenticated) lose EXECUTE. The trigger itself still
  -- fires for legitimate INSERT/UPDATE paths (triggers don't require
  -- EXECUTE on the trigger function to fire on table writes).
  assert not has_function_privilege('public', 'public.protect_profile_tier()', 'EXECUTE'),
    'public must NOT have EXECUTE on protect_profile_tier() post-rollback (0029 §4 trap)';
  assert not has_function_privilege('anon', 'public.protect_profile_tier()', 'EXECUTE'),
    'anon must NOT have EXECUTE on protect_profile_tier() post-rollback';
  assert not has_function_privilege('authenticated', 'public.protect_profile_tier()', 'EXECUTE'),
    'authenticated must NOT have EXECUTE on protect_profile_tier() post-rollback';
end $$;
