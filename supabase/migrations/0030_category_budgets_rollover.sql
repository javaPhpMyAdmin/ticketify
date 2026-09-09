-- ============================================================================
-- Ticketify — category budgets monthly rollover marker
--
-- The monthly rollover (category-budgets v2) copies the previous month's
-- limits into the current month once. The client needs a durable, per-month
-- record that the copy ran — including the month where there was nothing to
-- copy — so a remount or app restart never re-runs it. This migration adds
-- the column that carries that record.
--
-- What this migration does
-- ------------------------
--   1. Add `rollover_applied boolean not null default false` to
--      `public.category_budgets`. Existing rows default to false; the column
--      is additive, no data backfill needed.
--   2. RLS: unchanged. The existing per-row policies (own rows only) apply to
--      the new column automatically.
--
-- How the marker works
-- --------------------
--   The client writes the monthly copies with `rollover_applied = true` and,
--   even when there is nothing to copy, upserts a sentinel row
--   `(user_id, '__rollover__', month, amount = 0, rollover_applied = true)`.
--   The sentinel slug is not a real category — consumers either iterate
--   `EXPENSE_CATEGORIES` or filter `amount > 0`, so it never surfaces as a
--   budget.
--
-- What this migration does NOT do
-- --------------------------------
--   - No schema changes to any other table.
--   - No RPC changes (`monthly_category_totals` already LEFT JOINs
--     `category_budgets` and returns nullable `budget_limit`).
-- ============================================================================

alter table public.category_budgets
  add column rollover_applied boolean not null default false;

comment on column public.category_budgets.rollover_applied is
  'True when the row was written by the monthly rollover (copied limits or the "__rollover__" sentinel).';