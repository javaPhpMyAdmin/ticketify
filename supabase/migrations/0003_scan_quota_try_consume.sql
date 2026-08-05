-- ============================================================================
-- Ticketify — atomic scan quota consumption (post-review)
--
-- Follows `0001_initial_schema.sql` and `0002_auth_fixes.sql`.
--
-- The parse-ticket edge function previously enforced the monthly scan quota
-- with a read-modify-write (SELECT the row, then UPDATE scans_used + 1). That
-- race allowed concurrent requests to read the same counter and oversell the
-- monthly limit. This migration replaces that flow with a single atomic RPC:
--
--   public.try_consume_scan(p_user_id, p_year_month)
--
-- The function ensures the month row exists (INSERT ON CONFLICT against the
-- composite PK (user_id, year_month) built in 0002), then runs ONE guarded
-- UPDATE that increments scans_used only while scans_used < scans_limit.
-- Under READ COMMITTED, a concurrent transaction that blocked on the row
-- re-checks the guard against the committed value, so the limit is never
-- oversold and no lost update is possible (the increment reads the live
-- counter, not a client-supplied value).
--
-- Least privilege: the default PUBLIC execute grant is revoked and execution
-- is limited to the service role (the edge function's quota client). Client
-- roles (anon/authenticated) cannot call it, so no caller can consume or
-- burn another user's quota. As defense in depth the body is `security
-- invoker` — if the grant were ever widened, RLS still scopes every write to
-- the caller's own rows.
-- ============================================================================

create or replace function public.try_consume_scan(p_user_id uuid, p_year_month text)
returns table (ok boolean, scans_used int, scans_limit int)
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_used int;
  v_limit int;
begin
  -- Ensure a row exists for the month (the composite PK dedupes concurrent
  -- first-scans). The column list is bound to the target table, so the OUT
  -- parameters of `returns table` cannot shadow it.
  insert into public.scan_usage (user_id, year_month, scans_used, scans_limit)
  values (p_user_id, p_year_month, 0, 10)
  on conflict (user_id, year_month) do nothing;

  -- Atomic guarded increment: the row lock plus WHERE re-evaluation serialize
  -- concurrent scans — at most one request per free slot succeeds. The table
  -- alias is required: `returns table` declares OUT params named after the
  -- columns, which would otherwise shadow them in PL/pgSQL.
  update public.scan_usage su
     set scans_used = su.scans_used + 1
   where su.user_id = p_user_id
     and su.year_month = p_year_month
     and su.scans_used < su.scans_limit
   returning su.scans_used, su.scans_limit
   into v_used, v_limit;

  if found then
    return query select true, v_used, v_limit;
    return;
  end if;

  -- No slot left (or the row vanished): report the current state so the edge
  -- function can answer with a quota_exceeded payload.
  select su.scans_used, su.scans_limit into v_used, v_limit
    from public.scan_usage su
   where su.user_id = p_user_id and su.year_month = p_year_month;

  return query select false, coalesce(v_used, 0), coalesce(v_limit, 10);
end;
$$;

revoke all on function public.try_consume_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.try_consume_scan(uuid, text) to service_role;

comment on function public.try_consume_scan(uuid, text) is
  'Atomically consumes one monthly scan slot for (user_id, year_month). Returns (ok, scans_used, scans_limit); ok=false when the limit is reached. Service-role only.';
