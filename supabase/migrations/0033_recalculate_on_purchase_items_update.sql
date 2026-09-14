-- ============================================================================
-- Ticketify — recalculate monthly totals on purchase_items UPDATE
--
-- `monthly_user_totals` is materialized and maintained ONLY by
-- `trg_monthly_totals_recalculate` on `purchases` INSERT/UPDATE/DELETE
-- (0015 §5). The category reassign/delete picker seam re-points
-- `purchase_items.category_id` — a write that NEVER touches `purchases` — so
-- the materialized `category_totals` jsonb stayed stale (the old slug kept
-- its name + pre-reassign figures in Analytics/History/run-rate) until the
-- next purchases write. The client invalidation alone made the staleness
-- deterministic: it refetched and RE-VALIDATED the stale row as fresh
-- (re-review CRITICAL).
--
-- Invariant this migration closes: an UPDATE on `purchase_items` that
-- re-points a line's category MUST recalculate the affected month server-side,
-- so the materialized cache reflects the reassignment/deletion IMMEDIATELY
-- and the client invalidation refetches a genuinely fresh row.
--
-- What this migration does
-- ------------------------
--   §1  Trigger function `trigger_recalculate_monthly_totals_on_item()`:
--       AFTER UPDATE ON purchase_items, FOR EACH ROW, when the line's
--       category actually changed (`IS DISTINCT FROM` — no-op updates stay
--       free), resolve the affected user + month via the `purchases` join
--       (OLD and NEW share the same purchase row → a single month) and
--       recalculate through the existing 0015 §3 RPC (confirmed-only,
--       single-user; household semantics flow through 0031). `NEW` is
--       returned so the row write proceeds normally.
--   §2  Trigger on `purchase_items`.
--
-- Restore path (documented; no down migration in this repo, see 0009/0029)
-- --------------------------------
--   drop trigger trg_monthly_totals_recalculate_on_item on public.purchase_items;
--   drop function public.trigger_recalculate_monthly_totals_on_item();
-- ============================================================================

-- §1. Trigger function
create or replace function public.trigger_recalculate_monthly_totals_on_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_ym text;
begin
  if NEW.category_id is distinct from OLD.category_id then
    select p.user_id, to_char(p.purchase_date, 'YYYY-MM')
      into v_user_id, v_ym
      from public.purchases p
      where p.id = NEW.purchase_id;

    perform public.recalculate_monthly_totals(v_user_id, v_ym);
  end if;

  return NEW;
end;
$$;

-- §2. Trigger
create trigger trg_monthly_totals_recalculate_on_item
  after update on public.purchase_items
  for each row
  execute function public.trigger_recalculate_monthly_totals_on_item();