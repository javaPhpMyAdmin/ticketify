-- 0035_trial_freeze_guard.sql
-- ---------------------------------------------------------------------------
-- Security fix: close the trial-freeze vector on sync_client_subscription.
--
-- Background (adversarial follow-up review of 0034)
-- -------------------------------------------------
--   0034 narrowed sync_client_subscription's allow-list to
--   ('none','trial','expired') and gated create_household on tier='pro'
--   ONLY, but left a RESIDUAL CRITICAL hole: 'none' is still a
--   client-claimable status, and claiming it during a trial freezes the
--   expiry materialization:
--
--     1. User starts a trial: start_free_trial sets
--        subscription_status='trial', tier='pro', trial_ends_at=now()+5d.
--     2. Client calls sync_client_subscription('none') → status='none',
--        tier untouched (SECURITY DEFINER bypasses protect_profile_tier).
--     3. expire_overdue_trials (0020) keys its transition on
--        WHERE subscription_status='trial' — with status='none' the row
--        no longer matches, so expiry NEVER materializes.
--     4. Result: tier stays 'pro' FOREVER past trial_ends_at. The user
--        keeps unlimited scans and household creation (both gated only on
--        tier) with no RevenueCat event ever firing — unpaid Pro forever.
--
--   The 0034 comment's claim that "remaining claims cannot freeze expiry
--   (this RPC never writes trial_ends_at)" is FALSE: the freeze needs no
--   trial_ends_at write. The materializer keys on subscription_status, and
--   ANY client move off 'trial' makes the overdue row unfindable — the
--   freeze is complete with status='none' alone.
--
-- Fix (two layers, A + B)
-- -----------------------
--   §1 (A — guard the claim): sync_client_subscription REJECTS any move
--       off an ACTIVE trial. A profile with subscription_status='trial'
--       AND trial_ends_at IS NOT NULL AND tier='pro' is an active trial
--       (start_free_trial is the only writer of trial_ends_at); moving it
--       to 'none'/'expired' raises a clear exception. Self-claiming
--       'trial' stays allowed (harmless no-op), and claims for profiles
--       with no active trial are unchanged (free lifecycle preserved).
--       expire_overdue_trials remains the SINGLE authority for the
--       trial→expired transition.
--   §2 (B — make the materializer status-independent): expire_overdue_trials
--       keys on the trial window itself (trial_ends_at <= now() AND
--       tier='pro') instead of subscription_status='trial', so any row
--       whose Pro window has passed is expired regardless of its lifecycle
--       status. This self-heals rows corrupted BEFORE this fix (already
--       frozen to 'none') and is immune to future client status claims.
--       Real paid subscribers are excluded on two signals
--       (subscription_status='active' AND ever_paid=true): for a genuine
--       payer, trial_ends_at may be a stale or RevenueCat-synced timestamp
--       that is NOT the authority on paid access — B must never downgrade
--       a paying user to free.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- §1. sync_client_subscription — guard: no client moves off an active trial
--
-- Old (0034): allow-list ('none','trial','expired'), unconditional UPDATE.
-- New: same allow-list, but a profile in an ACTIVE trial
-- (status='trial' AND trial_ends_at IS NOT NULL AND tier='pro') may only
-- self-claim 'trial'. Moves to 'none'/'expired' raise
-- 'cannot change subscription status during active trial'.
-- ---------------------------------------------------------------------------

create or replace function public.sync_client_subscription(
  p_status text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_profile record;
begin
  -- Validate the status value. 'active' is intentionally rejected: paid
  -- status is asserted only by the RevenueCat webhook via
  -- sync_subscription_status (service-role). (0034 behavior, kept.)
  if p_status not in ('none', 'trial', 'expired') then
    raise exception 'invalid subscription status: %', p_status;
  end if;

  -- Read the caller's current profile state BEFORE any write, so the
  -- active-trial guard below evaluates the pre-move row.
  select subscription_status, tier, trial_ends_at
    into v_profile
    from public.profiles
   where id = auth.uid();

  if v_profile is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- Active-trial guard (0035 §1). start_free_trial is the only writer of
  -- trial_ends_at, so `trial_ends_at IS NOT NULL` identifies a real trial;
  -- tier='pro' confirms the trial is still granting access. Moving such a
  -- row off 'trial' — to 'none' or 'expired' — strands tier='pro' past
  -- trial_ends_at: the expiry materializer (0020/0035 §2) would no longer
  -- find the row, freezing unpaid Pro access forever. The materializer is
  -- the SINGLE authority for trial→expired; a client whose trial window
  -- has passed must call expire_overdue_trials() (client bootstrap, 0020)
  -- instead. Self-claiming 'trial' is harmless (the row is already there).
  if v_profile.subscription_status = 'trial'
     and v_profile.trial_ends_at is not null
     and v_profile.tier = 'pro'
     and p_status <> 'trial'
  then
    raise exception 'cannot change subscription status during active trial';
  end if;

  -- Update the caller's own profile. SECURITY DEFINER bypasses the
  -- protect_profile_tier trigger. auth.uid() ensures callers cannot
  -- target other users.
  update public.profiles
     set subscription_status = p_status
   where id = auth.uid();
end;
$$;

-- Pins the definer owner (belt-and-braces, 0031 §2 / 0034 §3 style).
alter function public.sync_client_subscription(text) owner to postgres;

comment on function public.sync_client_subscription(text) is
  'Client-side subscription_status sync (auth.uid()-scoped). SECURITY DEFINER. Allow-list: none|trial|expired ONLY — ''active'' is webhook-reserved (0034). A profile in an ACTIVE trial (status=''trial'' + trial_ends_at set + tier=''pro'') may only self-claim ''trial'': moves to ''none''/''expired'' raise ''cannot change subscription status during active trial'' — expire_overdue_trials is the single authority for trial→expired (0035 §1).';

-- ---------------------------------------------------------------------------
-- §2. expire_overdue_trials — status-independent expiry materialization
--
-- Old (0020): step 1 keyed on WHERE subscription_status='trial' — a client
-- claiming 'none'/'expired' during a trial made the overdue row invisible
-- to the materializer (the 0035 freeze). New: step 1 keys on the trial
-- window itself (trial_ends_at IS NOT NULL AND trial_ends_at <= now() AND
-- tier='pro'), independent of subscription_status. Any row whose Pro trial
-- window has passed is expired — whether it still says 'trial' (0020
-- behavior) or was frozen to 'none'/'expired' (the 0035 vector). This
-- self-heals rows corrupted before the fix AND is immune to future client
-- status claims.
--
-- Real paid subscribers are excluded on BOTH signals:
--   - subscription_status = 'active'  (webhook-asserted paid state)
--   - ever_paid = true                (monotonic paid-once flag, 0021)
-- For a genuine payer, trial_ends_at may be a stale or RevenueCat-synced
-- timestamp (sync_subscription_status coalesces it) and is NOT the
-- authority on paid access — expiring such rows would downgrade a paying
-- user to free. 0020's later steps (expired→free normalization, current-
-- month scan reset) are preserved verbatim.
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
  -- 1) Materialize the lifecycle transition for overdue trials REGARDLESS
  --    of subscription_status: any profile whose trial window has passed
  --    while still Pro-accessing is expired. Real paid subscribers
  --    (status='active' or ever_paid=true) are never downgraded — for
  --    them trial_ends_at is stale/RevenueCat-synced, not the authority
  --    on paid access.
  update public.profiles
     set subscription_status = 'expired',
         tier = 'free',
         trial_ends_at = null
   where trial_ends_at is not null
     and trial_ends_at <= now()
     and tier = 'pro'
     and subscription_status is distinct from 'active'
     and ever_paid = false;

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

-- Pins the definer owner (belt-and-braces, 0031 §2 style).
alter function public.expire_overdue_trials() owner to postgres;

-- Least privilege: `create or replace function` resets EXECUTE to PUBLIC
-- (the 0029 §4 trap) — re-apply the 0020 posture: the cron (postgres) and
-- the client bootstrap (authenticated, self-heal on app open) may call it,
-- anon/public may not.
revoke all on function public.expire_overdue_trials() from public, anon;
grant execute on function public.expire_overdue_trials() to authenticated;

comment on function public.expire_overdue_trials() is
  'Materializes and normalizes the trial→expired lifecycle (0020, hardened 0035 §2): ANY profile whose trial window has passed (trial_ends_at <= now() AND tier=''pro'') is expired regardless of subscription_status — self-healing client-frozen rows — while real paid subscribers (status=''active'' or ever_paid) are never downgraded. Existing expired profiles are normalized to tier=free with trial_ends_at cleared, and the current-month scan quota is reset to a fresh 15-cap. SECURITY DEFINER, idempotent.';