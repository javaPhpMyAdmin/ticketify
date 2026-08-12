-- ============================================================================
-- Ticketify — pro subscription: tier-aware scan quota + atomic tier transition
-- (M1 of the pro-subscription change; WU-M1.1).
--
-- Follows `0010_monthly_purchases_total.sql`. Sibling to `0012_webhook_events.sql`.
--
-- Why this migration exists
-- -------------------------
-- The pre-0011 system had three intertwined gaps that all surface as
-- "Pro users still see 'Sin escaneos disponibles' + upgrade CTA" or worse:
--
--   1. CRITICAL-1 — A REVOKE never normalizes scan_usage.scans_limit. After a
--      webhook sets `profiles.tier = 'free'`, the previously-NULL scan_limit
--      (the Pro marker) stays NULL forever. The RPC guard at the time was
--      `scans_limit is null or scans_used < scans_limit`, so a free user with
--      a NULL row evaluated as unlimited. A canceled subscriber keeps scanning
--      forever.
--
--   2. CRITICAL-2 — Nothing ever writes `scans_limit = NULL`. The column is
--      NOT NULL, the default is 100 (now 15), the RPC INSERT hardcodes 15,
--      and `set_profile_tier` was never deployed. So even when the
--      webhook granted Pro, the row's scans_limit stayed numeric. The NULL
--      branch in the old guard was dead code; meters with stale numeric
--      limits showed "Sin escaneos disponibles" + upgrade CTA to paying
--      users (the original CRITICAL-2 finding).
--
--   3. The `protect_profile_tier` trigger (0002:141-166) fires for every
--      role, including `service_role`, so a plain service_role UPDATE of
--      `profiles.tier` would be rejected — and so would every other write.
--      A future tier-management path needs a SECURITY DEFINER escape hatch
--      that the trigger recognizes. The only role the trigger can never
--      legitimately see in client traffic is `postgres` itself.
--
-- What this migration does
-- ------------------------
--   §1  scan_usage.scans_limit — drop NOT NULL, default = 15, backfill to 15.
--       REQ-QUOTA-3 (column accepts NULL + backfills 15) and the free-cap
--       invariant (REQ-QUOTA-1).
--
--   §2  try_consume_scan — tier-driven guard. Reads `profiles.tier`, inserts
--       the new-month row with `case when v_tier = 'pro' then null else 15
--       end` (the W1 fix: Pro's new-month row stores NULL — the Pro marker
--       — not a hardcoded 15), and the guarded UPDATE accepts the row when
--       `v_tier = 'pro' OR su.scans_used < coalesce(su.scans_limit, 15)`.
--       The coalesce is defensive: D2.5 (the GRANT/REVOKE pair in §3)
--       normalizes current + future month rows to NULL on grant and 15 on
--       revoke, but the RPC must self-protect against any row that drifts
--       out of that invariant (ops mistake, future migration, deployment
--       without §3). Without the coalesce, free + NULL evaluates as NULL
--       (false in WHERE) and silently rejects the user — better to evaluate
--       against the free cap and fail loudly.
--       Signature UNCHANGED so parse-ticket stays untouched in M1.
--
--   §3  set_profile_tier — atomic transition. SECURITY DEFINER, owned by
--       `postgres` (the W3 fix: `alter function … owner to postgres` runs
--       BEFORE the `create or replace`, so SECURITY DEFINER switches the
--       effective role to `postgres` and the trigger guard's
--       `current_user = 'postgres'` short-circuit fires exactly for this
--       RPC). On GRANT, profiles.tier = 'pro' AND every current/future
--       month row's scans_limit = NULL; on REVOKE, profiles.tier = 'free'
--       AND scans_limit = 15. Past months are historical snapshots — they
--       are NOT rewritten. Raises `P0002` (specific SQLSTATE, not message
--       text catch — the S3 fix) when the profile row is missing, so the
--       webhook handler can pattern-match the error code reliably.
--       revoke all … from public, anon, authenticated; grant execute to
--       service_role (matches the least-privilege pattern at 0003:74-75).
--
--   §4  protect_profile_tier — definer-path escape hatch (D1). The function
--       OID is preserved by `create or replace function`, so the existing
--       trigger (`profiles_protect_tier`, 0002:168-179) keeps firing the new
--       body without reattachment. The new top-of-function short-circuit
--       recognizes the SECURITY DEFINER role and lets the write through;
--       every existing INSERT/UPDATE/DELETE guard stays intact for every
--       other role (anon/authenticated/service_role direct writes are
--       still rejected).
--
-- What this migration does NOT do
-- -------------------------------
--   * No client / edge function code change. parse-ticket is untouched in
--     M1; the pre-check NULL branch and the `SCANS_LIMIT = 100` constant
--     are M3 work (see design D2 + REQ-QUOTA-5).
--   * No webhook edge function. The webhook reads/writes through these RPCs
--     and the `webhook_events` ledger (0012) — M2 work.
--   * No D3 settings-store tier cleanup; that is the parallel WU-D3.
--
-- Rollback
-- --------
--   §1  restore NOT NULL on scan_usage.scans_limit (COALESCE NULL rows to
--       15 FIRST — the Pro-marker NULLs must be re-materialized before the
--       constraint is re-added or the ALTER fails).
--   §2  revert try_consume_scan to the numeric-only guard (0004's body).
--   §3  `drop function public.set_profile_tier(uuid, text)`.
--   §4  revert protect_profile_tier to the 0002 body (no postgres check).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. scan_usage.scans_limit — nullable + default 15 + backfill to 15
-- ---------------------------------------------------------------------------

-- Drop NOT NULL: the column is now a tri-state (NULL = unlimited Pro,
-- numeric = free cap). REQ-QUOTA-3, REQ-QUOTA-2.
alter table public.scan_usage alter column scans_limit drop not null;

-- Column default = 15 (REQ-QUOTA-1 free cap). New free rows pick up 15
-- automatically; new Pro rows are written explicitly by the RPC (§2) with
-- NULL so the Pro marker is preserved.
alter table public.scan_usage alter column scans_limit set default 15;

-- Backfill existing rows: any non-NULL value that's not already 15 becomes
-- 15. NULL rows are left as-is — they are either (a) the Pro marker that
-- §3 will keep in lockstep with profiles.tier, or (b) a freshly-inserted
-- row whose scans_limit is genuinely null (defensive; rare).
update public.scan_usage
   set scans_limit = 15
 where scans_limit is not null
   and scans_limit <> 15;

-- ---------------------------------------------------------------------------
-- §2. try_consume_scan — tier-driven guard (CRITICAL-1, CRITICAL-2)
-- ---------------------------------------------------------------------------

create or replace function public.try_consume_scan(p_user_id uuid, p_year_month text)
returns table (ok boolean, scans_used int, scans_limit int)
language plpgsql
security invoker
volatile
set search_path = public
as $$
declare
  v_used  int;
  v_limit int;
  v_tier  text;
begin
  -- Server-side tier read. `security invoker` + `auth.uid()` does not apply
  -- here (this RPC is service-role only, see grants below); the tier is
  -- a server-authoritative value, not the caller's claim.
  select tier into v_tier from public.profiles where id = p_user_id;
  v_tier := coalesce(v_tier, 'free');

  -- Ensure a row exists for the month (the composite PK dedupes concurrent
  -- first-scans). The column list is bound to the target table, so the OUT
  -- parameters of `returns table` cannot shadow it.
  --
  -- W1 fix: Pro's new-month row stores `scans_limit = null` — the Pro
  -- marker — NOT a hardcoded 15. A hardcoded 15 would mean the stored
  -- data diverges from D2.5's invariant and the RPC's RETURNING would
  -- report `scans_limit = 15` to a user whose cap is actually unlimited.
  -- The free path keeps the default-15 invariant in one place.
  insert into public.scan_usage (user_id, year_month, scans_used, scans_limit)
  values (p_user_id, p_year_month, 0,
          case when v_tier = 'pro' then null else 15 end)
  on conflict (user_id, year_month) do nothing;

  -- Atomic guarded increment: the row lock plus WHERE re-evaluation
  -- serialize concurrent scans — at most one request per free slot
  -- succeeds. The tier-driven guard accepts the row when the user is
  -- Pro (regardless of the stored limit) OR the user is free with room
  -- remaining. `coalesce(su.scans_limit, 15)` defends against any row
  -- that drifted out of D2.5's invariant — without it, free + NULL
  -- would evaluate as NULL (false in WHERE) and silently reject the
  -- user. The table alias is required: `returns table` declares OUT
  -- params named after the columns, which would otherwise shadow them
  -- in PL/pgSQL.
  update public.scan_usage su
     set scans_used = su.scans_used + 1
   where su.user_id = p_user_id
     and su.year_month = p_year_month
     and (
       v_tier = 'pro'
       or su.scans_used < coalesce(su.scans_limit, 15)
     )
   returning su.scans_used, su.scans_limit
   into v_used, v_limit;

  if found then
    return query select true, v_used, v_limit;
    return;
  end if;

  -- No slot left (or the row vanished): report the current state so the
  -- edge function can answer with a quota_exceeded payload. coalesce the
  -- limit to 15 to match the free cap — a NULL row that should not have
  -- existed under D2.5 is reported as a numeric cap, not a NULL that
  -- would render as "Ilimitado" on the meters.
  select su.scans_used, su.scans_limit into v_used, v_limit
    from public.scan_usage su
   where su.user_id = p_user_id and su.year_month = p_year_month;

  return query select false, coalesce(v_used, 0), coalesce(v_limit, 15);
end;
$$;

-- Least privilege (matches 0003:74-75). Public/anon/authenticated cannot
-- consume or burn another user's quota.
revoke all on function public.try_consume_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.try_consume_scan(uuid, text) to service_role;

comment on function public.try_consume_scan(uuid, text) is
  'Atomically consumes one monthly scan slot for (user_id, year_month). Tier-driven: Pro is unlimited, free is capped at the row scans_limit (15). Returns (ok, scans_used, scans_limit); ok=false when the limit is reached. Service-role only.';

-- ---------------------------------------------------------------------------
-- §3. set_profile_tier — atomic transition (CRITICAL-1, CRITICAL-2, D2.5)
-- ---------------------------------------------------------------------------

-- W3 fix: the function MUST be owned by `postgres` BEFORE the
-- `create or replace` so SECURITY DEFINER switches `current_user` to
-- `'postgres'` (the trigger guard's discriminator in §4). If the
-- migration runs under a non-postgres role and the function is owned
-- by that role, `current_user` would equal that role inside the RPC,
-- the trigger would reject every call, and the webhook entitlement
-- flow breaks entirely. The `create or replace` would otherwise default
-- to the migration role as owner; this `alter` makes the invariant
-- explicit and resilient to future migration roles.
--
-- Idempotent: `alter function … owner to X` is a no-op when the current
-- owner is already X, so reruns of this migration are safe.
alter function public.set_profile_tier(uuid, text) owner to postgres;

create or replace function public.set_profile_tier(p_user_id uuid, p_tier text)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_limit     int;
  v_now_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
begin
  -- Validate the tier value up front. Anything outside the allow-list is
  -- an invalid input and MUST NOT touch either table (REQ-SYNC-5
  -- "invalid input rejected").
  if p_tier not in ('free', 'pro') then
    raise exception 'invalid tier: %', p_tier;
  end if;

  -- Update profiles.tier. The `protect_profile_tier` trigger (§4)
  -- recognizes the SECURITY DEFINER role and allows this exact write.
  -- `if not found` catches the case where the profile row does not
  -- exist (REVOKE of a never-signed-in user — WARNING-2 / REQ-SYNC-7
  -- "ignored events MUST NOT surface as errors"). The S3 fix: use a
  -- specific SQLSTATE (P0002) instead of relying on the message text;
  -- the webhook handler can pattern-match the code reliably, and a
  -- future translation of the message won't break the catch.
  update public.profiles set tier = p_tier where id = p_user_id;
  if not found then
    raise exception 'profile not found: %', p_user_id using errcode = 'P0002';
  end if;

  -- Atomic scans_limit normalization (CRITICAL-1 + CRITICAL-2):
  --   grant  (p_tier = 'pro')  → scans_limit = null  (unlimited marker)
  --   revoke (p_tier = 'free') → scans_limit = 15    (free cap)
  --
  -- Only the current + future month rows are touched: past months are
  -- historical snapshots and MUST NOT be rewritten (a Pro user who
  -- downgraded last month still owns the receipts from that month, and
  -- their scan_usage row from then must remain intact).
  v_limit := case when p_tier = 'pro' then null else 15 end;

  update public.scan_usage
     set scans_limit = v_limit
   where user_id = p_user_id
     and (year_month = v_now_month or year_month > v_now_month);
end;
$$;

-- Least privilege (matches 0003:74-75). The webhook is the only caller —
-- service_role via the edge function's service client.
revoke all on function public.set_profile_tier(uuid, text) from public, anon, authenticated;
grant execute on function public.set_profile_tier(uuid, text) to service_role;

comment on function public.set_profile_tier(uuid, text) is
  'Atomically transitions a profile to free|pro and normalizes scan_usage.scans_limit (null on grant, 15 on revoke) for the current and future months. SECURITY DEFINER, owned by postgres; the protect_profile_tier trigger allows this write by recognizing current_user = postgres. Service-role only.';

-- ---------------------------------------------------------------------------
-- §4. protect_profile_tier — definer-path escape hatch (D1, REQ-SYNC-5)
-- ---------------------------------------------------------------------------

-- The trigger's function OID is preserved by `create or replace function`
-- (verified at 0002:168-179: the existing trigger `profiles_protect_tier`
-- fires the same function OID before and after the replacement, so the
-- trigger keeps firing the new body without reattachment). No trigger
-- recreation is needed.
--
-- New top-of-function short-circuit: the SECURITY DEFINER owner is
-- `postgres` (§3). During its execution the trigger fires with
-- `current_user = 'postgres'` (definer-switched) — which no client role
-- and no raw service_role UPDATE ever reaches. `session_user` stays
-- `service_role`, so the discriminator cannot be spoofed via session
-- context. The original INSERT/UPDATE/DELETE guards from 0002 stay
-- intact for every other role — anon/authenticated/service_role direct
-- writes remain rejected.
--
-- SUGGESTION-1 invariant: `set_profile_tier` MUST remain the ONLY
-- postgres-owned SECURITY DEFINER writer of `profiles.tier`. The DB-level
-- regression in WARNING-7 (a future migration) pins this contract — a
-- new definer writer of `tier` would break the test, not the trigger.
create or replace function public.protect_profile_tier() returns trigger
language plpgsql
as $$
begin
  -- Sanctioned writer: set_profile_tier (SECURITY DEFINER, owner postgres)
  -- runs this trigger with current_user = 'postgres'. No client role and
  -- no raw service_role UPDATE ever executes as postgres, so this pins
  -- the RPC path exactly (REQ-SYNC-5).
  if TG_OP in ('INSERT', 'UPDATE') and current_user = 'postgres' then
    return new;
  end if;

  -- Existing INSERT/UPDATE/DELETE guards from 0002_auth_fixes.sql:141-166
  -- unchanged — verbatim so a future regression scan can diff the bodies.

  if TG_OP = 'INSERT' then
    -- 0001's default is `tier text not null default 'free'`; by the time a
    -- before-insert trigger fires the default is already applied, so a legit
    -- insert that omits `tier` carries 'free' here and passes. Only an
    -- explicitly non-default tier (e.g. 'pro') is refused.
    if new.tier is distinct from 'free' then
      raise exception 'tier is managed server-side';
    end if;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    -- Any tier change from the client — including a downgrade — is rejected.
    if new.tier is distinct from old.tier then
      raise exception 'tier is managed server-side';
    end if;
    return new;
  end if;

  -- DELETE (defensive: the trigger is only attached to insert/update; keep
  -- the function total so attaching it to delete later stays safe).
  return old;
end;
$$;
