-- ---------------------------------------------------------------------------
-- 10. monthly_purchases_total(p_year_month) — total pagado del mes
--
-- The "total gastado" surfaces (Home budget card, Analytics overview) must
-- answer "cuánto pagué realmente este mes" — the SUM of `purchases.total`
-- (what the card/account was charged, AFTER any payment-method discount like
-- "Desc. de ley 19210"). The existing `monthly_category_totals` RPC sums
-- `purchase_items.total_price` (gross line totals) and, because it returns
-- per-category rows, must NOT be reused for the overall total: a receipt
-- with items in two categories would double-count its full total across
-- both rows. This RPC is the single-total counterpart, scoped to
-- `auth.uid()` server-side like the category RPC.
--
-- Same security posture as the other functions: security invoker, stable,
-- set search_path = public, auth.uid()-scoped. Only `confirmed` purchases
-- are counted (drafts never reach the DB today, but the filter keeps the
-- read consistent with the home feed query).
-- ---------------------------------------------------------------------------
create or replace function public.monthly_purchases_total(p_year_month text)
returns table (total numeric)
language sql security invoker stable set search_path = public as $$
  select sum(p.total)::numeric(12, 2)
  from public.purchases p
  where p.user_id = auth.uid()
    and p.status = 'confirmed'
    and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
$$;
