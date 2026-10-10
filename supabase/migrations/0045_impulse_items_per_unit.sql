-- ============================================================================
-- Ticketify — 0045_impulse_items_per_unit.sql
--
-- Change: issue #166 (money-integrity cross-unit follow-ups, PR2)
-- Phase:  snacks/microgastos breakdown per recorded unit
--
-- What this migration does
-- ------------------------
--   `monthly_impulse_items(text)` (0019 §2) summed `purchase_items.total_price`
--   across ALL currencies and returned one row per normalized name. On a month
--   that spans two units — e.g. the viewer switched currency mid-month, or a
--   legacy receipt carries no unit — that single row MIXED units, which the
--   money-integrity invariant forbids (amounts in different units are NEVER
--   summed).
--
--   The RPC is re-keyed to subtotal PER RECORDED UNIT, exactly like 0044 §1:
--         effective unit = coalesce(row.currency, RECORDER profile currency, 'USD')
--   — the recorder (profiles of p.user_id), NEVER the caller/viewer and NEVER
--   households.currency. The breakdown therefore returns one row per
--   (normalized name, unit), each carrying its own `currency` label, and the
--   client renders each figure with ITS unit (`SnacksBreakdownModal`).
--
--   The return TYPE gains a `currency` column (2→3), which PostgreSQL refuses
--   under `create or replace` (42P13) — so the function is DROPPED and
--   recreated, and §2 re-pins owner + grants (the drop wipes both). The
--   personal-scope contract is unchanged: `security invoker`, `p.user_id =
--   auth.uid()`, confirmed purchases only.
--
--   `monthly_impulse_total(text)` is deliberately NOT touched: it keeps its
--   0019 shape (a single-series surface the client binds viewer-only, accepted
--   under-report) and has no caller on this branch — the home snacks total is
--   derived client-side from the month rows (`useHomeFeed`), not this RPC.
--
-- 42P13 note: this migration DROPs monthly_impulse_items (return-type change)
-- instead of create-or-replace. impulse-items-per-unit.sql pins the 3-column
-- shape, owner postgres and least-privilege EXECUTE (authenticated only).
--
-- Reversal: `drop function public.monthly_impulse_items(text)` and restore the
-- 0019 §2 body (2 columns). A reversed call mixes units again — the pre-0045
-- behavior the invariant rejects.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1. Per-(name, unit) impulse breakdown (0019 §2 re-keyed per unit)
-- ---------------------------------------------------------------------------

-- Return-type change: 42P13 forbids create-or-replace swapping the columns, so
-- the function is dropped first. §2 re-pins owner + grants.
drop function public.monthly_impulse_items(text);

create or replace function public.monthly_impulse_items(
  p_year_month text
)
returns table (name text, amount numeric, currency text)
language sql
security invoker
stable
set search_path = public
as $$
  with item_rows as (
    select pi.total_price,
           lower(trim(pi.name)) as name,
           -- Effective unit: the row's own currency, else the RECORDER profile
           -- currency (pr.id = p.user_id), else 'USD'. Identical coalesce rule
           -- to 0044 §1 — never the caller/viewer, never households.currency.
           coalesce(
             nullif(upper(btrim(p.currency)), ''),
             nullif(upper(btrim(pr.currency)), ''),
             'USD'
           ) as unit
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    left join public.profiles pr on pr.id = p.user_id
    where p.user_id = auth.uid()
      and p.status = 'confirmed'
      and pi.is_impulse = true
      and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  )
  select ir.name,
         sum(ir.total_price)::numeric(12, 2) as amount,
         ir.unit as currency
  from item_rows ir
  group by ir.name, ir.unit
  order by amount desc, ir.name asc, ir.unit asc
$$;

comment on function public.monthly_impulse_items(text) is
  'Per-item impulse (snacks/microgastos) breakdown for a month, grouped by normalized name PER RECORDED UNIT: one row per (name, effective unit), each labelled with coalesce(purchases.currency, recorder profile currency, ''USD''). Never sums across units.';

-- ---------------------------------------------------------------------------
-- §2. Owner + least-privilege execution (0044 §4 verbatim)
--
-- The DROP in §1 wiped the owner and grants. Re-pin owner to postgres and
-- restrict EXECUTE to authenticated so the recreated RPC cannot be executed by
-- anon or public.
-- ---------------------------------------------------------------------------

alter function public.monthly_impulse_items(text) owner to postgres;

revoke all on function public.monthly_impulse_items(text) from public, anon;

grant execute on function public.monthly_impulse_items(text) to authenticated;
