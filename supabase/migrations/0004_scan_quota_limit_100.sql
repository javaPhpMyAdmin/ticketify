-- ============================================================================
-- Ticketify — raise monthly scan quota to 100 (testing phase)
--
-- Follows `0003_scan_quota_try_consume.sql`.
--
-- During product testing the 10-scan monthly cap blocks real usage, so the
-- limit moves to 100. Three places must agree (the DB is authoritative):
--
--   1. Column default: new rows get 100 (0001 hardcoded 10).
--   2. Existing rows: scan_usage rows created before this migration still
--      hold scans_limit = 10 — the RPC guards on the row value, so they
--      must be raised too.
--   3. try_consume_scan: its INSERT (new rows) and coalesce fallback (rows
--      that vanish between reads) both hardcode 10 — recreated with 100.
--
-- The edge function's SCANS_LIMIT constant is a client-side fallback only
-- (used when the RPC returns no row); it is raised to match in the same
-- deploy that ships this migration's sibling code change.
-- ============================================================================

alter table public.scan_usage
  alter column scans_limit set default 100;

update public.scan_usage
   set scans_limit = 100
 where scans_limit <> 100;

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
  values (p_user_id, p_year_month, 0, 100)
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

  return query select false, coalesce(v_used, 0), coalesce(v_limit, 100);
end;
$$;

revoke all on function public.try_consume_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.try_consume_scan(uuid, text) to service_role;

comment on function public.try_consume_scan(uuid, text) is
  'Atomically consumes one monthly scan slot for (user_id, year_month). Returns (ok, scans_used, scans_limit); ok=false when the limit is reached. Service-role only.';
