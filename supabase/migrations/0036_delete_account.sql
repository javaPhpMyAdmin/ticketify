-- ============================================================================
-- 0036_delete_account.sql
-- Ticketify — user-account deletion (the destructive primitive).
--
-- Change: delete-account  (SDD change id)
-- Phase:  PR1 (SQL migration + smoke test + test runner wiring)
-- Cross-refs: REQ-ACCTDEL-6 (Storage sweep), REQ-ACCTDEL-7
--             (parse_attempts scrub), REQ-ACCTDEL-8 (auth.users delete),
--             REQ-ACCTDEL-9 (idempotency), REQ-ACCTDEL-11 (privilege
--             grants), REQ-HOUSE-DEL-1 (owner pre-flight). See
--             openspec/specs/user-account-deletion/spec.md and the deltas
--             under openspec/changes/delete-account/specs/.
--
-- Compliance driver: Google Play Data Deletion policy + GDPR Art. 17.
--
-- What this migration does
-- ------------------------
--   Adds a single RPC `public.delete_user_account(p_user_id uuid)` that
--   hard-deletes a user account and every byte of personal data attached
--   to it inside ONE transaction:
--
--     §1. Idempotency — if `auth.users` row is gone on entry, return
--         `'already_deleted'`. A double-tap / network retry / admin rerun
--         all collapse to a 200 no-op (mirrors the revenuecat-webhook 200
--         no-op envelope, design §2).
--     §2. Household-owner pre-flight — refuses to delete an owner that
--         still has at least one OTHER active member in
--         `household_members`. Raising
--         `'owner_must_disband_first'` with a unique SQLSTATE
--         (`P0001` = `raise_exception` from PostgreSQL error codes)
--         makes the contract explicit at the SQLSTATE level (the edge
--         function will map this to the
--         `household_owner_with_members` error code in its 409 envelope).
--         Rationale: silently cascading the household delete would eject
--         the other members with no UI signal and erase their shared
--         totals history — a destructive action on a third party that the
--         design (Decision 1) refuses to take without an explicit disband.
--     §3. Storage sweep — deletes every `storage.objects` row in the
--         `receipts` bucket whose first folder segment matches
--         `p_user_id::text`. The `receipts` bucket has NO ON DELETE
--         CASCADE from `auth.users` (Storage is decoupled from GoTrue),
--         so without this sweep the user's receipt photos would survive
--         the account deletion — a GDPR leak.
--     §4. parse_attempts scrub — deletes every row in `public.parse_attempts`
--         for the user. The table has NO FK to `profiles`/`auth.users`
--         (0022 §1), so a profile delete leaves its parse_attempts rows
--         orphaned otherwise (cosmetic but a paper trail the user might
--         consider personal data; Decision 6 in the proposal says scrub).
--     §5. Final destructive step — `DELETE FROM auth.users WHERE id =
--         p_user_id`. Existing ON DELETE CASCADE chains in 0001, 0012,
--         0014, 0032 handle every per-user table (profiles → stores,
--         purchases → purchase_items, scan_usage, monthly_user_totals,
--         category_budgets, webhook_events, household_members,
--         invite_codes, user-scoped categories).
--
--   Then pins the definer owner to `postgres` and applies the LEAST
--   PRIVILEGE grants — service_role only (0022 §2 / 0034 §3 style).
--   Postgres grants EXECUTE to PUBLIC by default for every new function,
--   so an explicit REVOKE is REQUIRED; without it this SECURITY DEFINER
--   RPC would be a public oracle (the 0029 §4 trap).
--
-- DO NOT ROLLBACK WITHOUT REVIEW (design §13 step 6).
-- --------------------------------------
--   This migration touches `auth.users` cascades and the `receipts`
--   Storage bucket. Rolling it forward without the corresponding edge
--   function (`supabase/functions/delete-account/`, PR2) leaves Storage
--   objects orphaned on the next manual admin delete via the Supabase
--   dashboard. If the rollout must be reverted, leave the migration in
--   place and disable the function (delete its `config.toml` block +
--   undeploy) instead of dropping this RPC.
--
--   If a hard drop is unavoidable (data decision required):
--     1. Confirm there are no in-flight delete-account edge function
--        calls (queue should be drained).
--     2. `drop function if exists public.delete_user_account(uuid);`
--     3. Run a manual Storage sweep for any historical orphans if the
--        edge function was already in production:
--        `delete from storage.objects where bucket_id = 'receipts' and
--         (storage.foldername(name))[1] = '<deleted-user-uuid>';`
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1-§5. delete_user_account(p_user_id uuid)
-- ---------------------------------------------------------------------------

create or replace function public.delete_user_account(p_user_id uuid)
returns text
language plpgsql
security definer
volatile
set search_path = public, storage
as $$
declare
  v_other_member_count int;
begin
  -- §1. Idempotency: a second call after a prior successful delete sees
  -- no auth.users row and returns the no-op signal. The edge function
  -- surfaces this as `{ ok: true, already_deleted: true }`.
  if not exists (select 1 from auth.users where id = p_user_id) then
    return 'already_deleted';
  end if;

  -- §2. Household-owner pre-flight (REQ-HOUSE-DEL-1).
  --
  -- A household owner (`households.created_by = p_user_id`) with at least
  -- one OTHER active member in `household_members` is refused with the
  -- explicit SQLSTATE `P0001` and message `'owner_must_disband_first'`.
  -- The edge function maps SQLSTATE P0001 with this exact message to the
  -- `household_owner_with_members` error code in its 409 envelope (PR2).
  --
  -- The SQLSTATE is pinned so the contract is signal-level, not just
  -- text-match — a future refactor of the message string still leaves the
  -- mapping unambiguous.
  select count(*) into v_other_member_count
    from public.households h
    join public.household_members hm on hm.household_id = h.id
   where h.created_by = p_user_id
     and hm.user_id  <> p_user_id;

  if v_other_member_count > 0 then
    raise exception 'owner_must_disband_first' using errcode = 'P0001';
  end if;

  -- §3-§5. All destructive work in ONE transaction. PL/pgSQL nests an
  -- implicit savepoint around the block below; the explicit
  -- `exception when others then raise` preserves the original error and
  -- forces ROLLBACK on any failure (no partial state survives).
  begin
    -- §3. Storage sweep — receipts bucket under <p_user_id>/...
    delete from storage.objects
     where bucket_id = 'receipts'
       and (storage.foldername(name))[1] = p_user_id::text;

    -- §4. parse_attempts scrub (no FK to profiles — 0022 §1, requires
    --     an explicit delete so the audit trail is gone with the user).
    delete from public.parse_attempts
     where user_id = p_user_id;

    -- §5. Final destructive step. ON DELETE CASCADE chains in 0001,
    --     0012, 0014, 0032 wipe every per-user table row.
    delete from auth.users where id = p_user_id;
  exception when others then
    raise;
  end;

  return 'ok';
end;
$$;

-- Pins the definer owner (required for SECURITY DEFINER to run as the
-- superuser that bypasses RLS — same belt-and-braces as 0025, 0031 §2,
-- 0034 §3, 0035 §2).
alter function public.delete_user_account(p_user_id uuid) owner to postgres;

-- Least privilege: service-role only (0022 §2 / 0034 §3 style).
--
-- Postgres grants EXECUTE to PUBLIC by default for every new function
-- (the 0029 §4 trap). An explicit REVOKE from PUBLIC, anon AND
-- authenticated is REQUIRED; otherwise an unauthenticated caller could
-- execute this SECURITY DEFINER RPC as postgres and use it as an
-- account-deletion oracle.
revoke execute on function public.delete_user_account(uuid) from public;
revoke execute on function public.delete_user_account(uuid) from anon;
revoke execute on function public.delete_user_account(uuid) from authenticated;
grant  execute on function public.delete_user_account(uuid) to service_role;

comment on function public.delete_user_account(p_user_id uuid) is
  'Hard-deletes a user account and every byte of personal data attached to it (Storage receipts sweep, parse_attempts scrub, then auth.users cascade). SECURITY DEFINER, owned by postgres, callable by service_role ONLY. Idempotent: second call returns ''already_deleted''. Household-owner pre-flight raises ''owner_must_disband_first'' (SQLSTATE P0001) when the user still owns a household with other active members — the edge function maps this to `household_owner_with_members` (409).';