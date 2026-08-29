-- ============================================================================
-- Ticketify — DB-backed per-hour parse rate limit
--
-- With scan consumption moving to SAVE time (0021), parsing is no longer
-- gated by the monthly quota — a parsed-but-discarded receipt cost nothing.
-- To keep parse cost bounded, add a per-user HOURLY rate limit on the
-- `parse-ticket` edge function: at most 30 parse permit takes per user per
-- hour. The client-side `consume_scan_on_save` (0021) remains the real
-- monthly quota; this guard only bounds Gemini invocations.
--
-- The RPC is service-role-only: `parse-ticket` calls it through its
-- service_client (bypassing RLS). auth.uid()-scoping is NOT needed because
-- the function only ever takes a permit for the caller passed in via
-- p_user_id, and only the service_role client can invoke it.
--
-- What this migration does
-- ------------------------
--   §1  parse_attempts table (composite PK user_id+hour_bucket) + index on
--        hour_bucket for pruning + RLS own-rows select policy.
--   §2  parse_try_take(p_user_id) — atomic permit take, cap 30/hour.
--   §3  pg_cron job pruning rows older than 48h (mirrors 0020's cron use).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. parse_attempts + index + RLS
-- ---------------------------------------------------------------------------

create table if not exists public.parse_attempts (
  user_id     uuid        not null,
  hour_bucket timestamptz not null,
  attempts    int         not null default 0,
  primary key (user_id, hour_bucket)
);

-- Support cheap pruning of expired buckets by the cron job.
create index if not exists parse_attempts_hour_bucket_idx
  on public.parse_attempts (hour_bucket);

comment on table public.parse_attempts is
  'Per-user per-hour parse attempt counter (rate limit for the parse-ticket edge function). Composite PK (user_id, hour_bucket) dedupes concurrent first-takes. hour_bucket is a UTC-truncated hour. Pruned by the parse-attempts-prune cron job.';

alter table public.parse_attempts enable row level security;

-- A user may read only their own attempt rows (defense-in-depth: the only
-- writer is the service_role client via parse_try_take, which bypasses RLS).
drop policy if exists "parse_attempts_select_own" on public.parse_attempts;
create policy "parse_attempts_select_own" on public.parse_attempts
  for select to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- §2. parse_try_take(p_user_id) — atomic hourly permit take
--
-- SECURITY DEFINER, service-role-only. Atomically bumps the caller's
-- attempts for the current hour bucket via INSERT..ON CONFLICT..DO UPDATE..
-- RETURNING; returns (allowed, attempts, cap). allowed=false (never raises)
-- when the cap is reached, so a rate-limited parse answers 429 and the
-- edge function must not burn a Gemini call. cap is the fixed 30/hour.
-- ---------------------------------------------------------------------------

create or replace function public.parse_try_take(p_user_id uuid)
returns table (allowed boolean, attempts int, cap int)
language plpgsql security definer volatile set search_path = public as $$
declare
  v_bucket timestamptz := date_trunc('hour', now() at time zone 'UTC');
  v_attempts int;
  v_cap int := 30;
begin
  if p_user_id is null then raise exception 'unauthenticated'; end if;

  insert into public.parse_attempts (user_id, hour_bucket, attempts)
  values (p_user_id, v_bucket, 1)
  on conflict (user_id, hour_bucket)
  do update set attempts = public.parse_attempts.attempts + 1
  returning attempts into v_attempts;

  if v_attempts <= v_cap then
    return query select true, v_attempts, v_cap;
  else
    return query select false, v_attempts, v_cap;
  end if;
end; $$;

-- Least privilege: only the edge function (service_role client) may take a
-- permit. authenticated/anon cannot self-serve unlimited parse slots.
revoke all on function public.parse_try_take(uuid) from public, anon, authenticated;
grant execute on function public.parse_try_take(uuid) to service_role;

comment on function public.parse_try_take(uuid) is
  'Atomically takes one hourly parse permit for p_user_id (cap 30/hour, UTC hour bucket). Returns (allowed, attempts, cap); allowed=false when the hourly cap is reached (never raises). SECURITY DEFINER, service-role only.';

-- ---------------------------------------------------------------------------
-- §3. Cron prune — drop rows older than 48h
--
-- `cron.schedule` with the same job name REPLACES the existing job, so this
-- both creates (first run) and realigns (re-run) the schedule. Mirrors the
-- cron usage in 0020 (trial-expiry). Requires pg_cron (Supabase default).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'parse-attempts-prune'::text,
  '0 3 * * *'::text,
  $sql$ delete from public.parse_attempts where hour_bucket < now() - interval '48 hours'; $sql$
);
