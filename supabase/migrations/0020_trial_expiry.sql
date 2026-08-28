-- ============================================================================
-- Ticketify — Trial Expiry Materialization + Scan Reset (frozen → free)
--
-- Centralizes the "trial expired" transition into a single SECURITY DEFINER
-- RPC so every expiry path (cron, client bootstrap, manual) behaves the same
-- way. On expiry the user becomes a free tier with a fresh monthly scan
-- quota: scans_used resets to 0 so they do NOT carry a lossy "20/15" against
-- a cap that only applies after they were downgraded (previously their Pro
-- scans counted toward the free limit — see conversation with maintainer).
--
-- Lifecycle transition applied (trial → expired):
--   profiles.subscription_status = 'expired'
--   profiles.tier               = 'free'
--   profiles.trial_ends_at      = null
--   scan_usage.scans_limit      = 15   (free cap)
--   scan_usage.scans_used       = 0    (reset only the current month row)
--
-- The cron job (Supabase pg_cron) calls this RPC every 6 hours so the DB
-- (source of truth) stays consistent even for users who never open the app
-- again. The client bootstrap is an additional safety net on app open.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- expire_overdue_trials() — SECURITY DEFINER RPC
--
-- Flips any profile whose trial has passed trial_ends_at to the expired/free
-- state and resets the current-month scan quota for those users.
--
-- SECURITY DEFINER + owned by postgres → bypasses protect_profile_tier so the
-- tier/subscription_status/scan_usage writes are allowed. Idempotent: rows
-- already expired are skipped (WHERE trial) so reruns are safe.
-- ---------------------------------------------------------------------------
create or replace function public.expire_overdue_trials()
returns int
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_now_month text := to_char(now(), 'YYYY-MM');
  v_affected  int;
begin
  -- 1) Materialize the lifecycle transition for overdue trials still marked
  --    'trial': trial has passed trial_ends_at → expired + free + clear.
  update public.profiles
     set subscription_status = 'expired',
         tier = 'free',
         trial_ends_at = null
   where subscription_status = 'trial'
     and trial_ends_at <= now();

  -- 2) Normalize ANY profile already in the 'expired' lifecycle state so the
  --    access tier, trial timestamp, and per-month scan quota reflect that
  --    they are no longer Pro. This repairs rows that reached 'expired'
  --    through an older/mixed path (e.g. a manual set_profile_tier revoke or
  --    an earlier direct update) which may still carry tier='pro',
  --    a stale trial_ends_at, and scans_limit=NULL from their Pro era.
  update public.profiles
     set tier = 'free',
         trial_ends_at = null
   where subscription_status = 'expired'
     and (tier is distinct from 'free' or trial_ends_at is not null);

  -- 3) Reset the current-month scan quota to the free cap for every expired
  --    (now free) user, so their Pro-era scans do not eat into the fresh
  --    monthly allowance. Older months are historical snapshots and are left
  --    untouched.
  update public.scan_usage su
     set scans_used  = 0,
         scans_limit = 15
    from public.profiles p
   where su.user_id = p.id
     and p.subscription_status = 'expired'
     and su.year_month = v_now_month;

  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;

-- Least privilege: only the cron (postgres) and the client (via the
-- authenticated path on its own profile) should trigger expiry. We grant to
-- authenticated so the app can self-heal on open; auth.uid() scoping is
-- NOT needed here because this function only ever touches *overdue* rows,
-- not a caller-chosen user.
grant execute on function public.expire_overdue_trials() to authenticated;

comment on function public.expire_overdue_trials() is
  'Materializes and normalizes the trial→expired lifecycle: overdue trials are flipped to expired+free, any existing expired profile is normalized to tier=free with trial_ends_at cleared, and the current-month scan quota is reset to a fresh 15-cap. SECURITY DEFINER, idempotent.';

-- ---------------------------------------------------------------------------
-- Cron job — fleet every 6 hours
--
-- `cron.schedule` with the same job name REPLACES the existing job, so this
-- both creates (first run) and realigns (re-run) the schedule to call the
-- RPC instead of the old direct UPDATE. Requires pg_cron (Supabase default).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'trial-expiry'::text,
  '0 */6 * * *'::text,
  'select public.expire_overdue_trials();'::text
);
