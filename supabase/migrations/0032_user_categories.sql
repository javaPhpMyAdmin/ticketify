-- ============================================================================
-- Ticketify — user-scoped custom categories (user_id on categories)
--
-- Layers user-scoped custom categories over the canonical taxonomy: the
-- same `public.categories` table keeps the 13 canonical rows (user_id NULL)
-- and gains per-user rows (user_id = auth.uid()). Mirrors the stores
-- pattern (0001 L47-56). The parser vocabulary, the canonical rows and the
-- `EXPENSE_CATEGORIES` fallback stay untouched; custom assignment is always
-- post-parse.
--
-- What this migration does
-- ------------------------
--   §1  categories.user_id uuid NULL REFERENCES profiles(id) ON DELETE
--       CASCADE. NULL = global canonical row; non-NULL = user-scoped row.
--       Additive: no backfill, no data rewrite, no cascade deletes.
--   §2  Replace the global UNIQUE(slug) (`categories_slug_key`) with two
--       partial unique indexes:
--         - categories_global_slug_idx  UNIQUE (slug) WHERE user_id IS NULL
--         - categories_user_slug_idx    UNIQUE (user_id, slug)
--                                      WHERE user_id IS NOT NULL
--       (one 'delivery' per user + one canonical 'delivery' globally) plus a
--       small (user_id, sort_order) index for picker/rollover ordering.
--   §3  RLS write policies (select-all `categories_select_auth` stays from
--       0002): INSERT/UPDATE/DELETE restricted to rows the caller owns
--       (auth.uid() = user_id). Global rows (user_id NULL) are seed-only:
--       no client can insert/update/delete them.
--   §4  Block-delete backstop: `purchase_items.category_id` FK switches
--       from ON DELETE SET NULL to ON DELETE RESTRICT, so a category in use
--       can never be deleted (raw SQL / service-role delete included) and
--       items are NEVER silently re-bucketed to 'otros'. The app refuses
--       with UX + reassignment BEFORE this fires; RESTRICT is the DB
--       guarantee (design D1).
--   §2.5 Categories user-first sort floor CHECK (user_id is null or
--        sort_order >= 100). All 13 canonical rows sort < 100 (0001 max 99
--        'otros', 0005 max 90), so `order(sort_order, slug)` places every
--        global row before ANY user row — the caller's own row
--        DETERMINISTICALLY wins a same-slug collision in the client slug
--        map (user-first by construction, no tie, no row-order accident).
--   §3.5 purchase_items INSERT/UPDATE policies additionally verify the line
--        category: NULL, a global row (user_id IS NULL) or the caller's own
--        row. The direct PostgREST write path (updateReceipt item PATCH) is
--        NOT definer-scoped, so its RLS checks are the ONLY line-level
--        guard there — the category subquery closes the cross-user uuid
--        reference hole in 0001 (review gate CRITICAL).
--   §5   save_receipt() — the 7-param signature from 0029 is kept EXACTLY,
--        only its body is redefined to validate every line's category
--        SERVER-SIDE and fail-closed. RLS write policies do NOT fire inside
--        SECURITY DEFINER, so an unvalidated definer copy of category_id was
--        a cross-user reference hole (review gate BLOCKER); grants are
--        re-stated for defense-in-depth (0029 §4 / 0031 §4 convention).
--
-- What this migration does NOT do
-- --------------------------------
--   - No change to the kind CHECK (0001: kind in ('need','want')) — the
--     creation UI requires an explicit need/want choice, and the CHECK is
--     the backstop (design D5).
--   - No change to the 13 canonical rows, the seed data, the parser
--     vocabulary, or the `categories_select_auth` policy.
--   - save_receipt's 7-param signature is unchanged (0029): 0032 only
--     redefines its body with server-side category ownership validation and
--     re-states grants. The 6-param overload from 0023 is CLOSED as a
--     round-2 review-gate BLOCKER (§5b): its unvalidated definer body is
--     replaced by a delegate to the validated 7-param (p_is_manual => false).
--   - uuid-FK aggregations (monthly_category_totals,
--     get_household_category_items) still carry custom slugs/labels via
--     their existing joins — nothing to change there.
--
-- Restore path (documented; no down migration in this repo, see 0009/0029)
-- --------------------------------
--   1. Decide custom rows first: they are user-owned data. Either keep the
--      column (harmless, nullable, unused by old clients) or delete custom
--      rows explicitly before reverting.
--   2. `alter table public.purchase_items drop constraint
--      purchase_items_category_id_fkey;` then re-add with ON DELETE SET
--      NULL (0001 posture).
--   3. `drop index categories_user_sort_idx; drop index
--      categories_user_slug_idx; drop index categories_global_slug_idx;`
--      then `alter table public.categories add constraint
--      categories_slug_key unique (slug);` — fails while custom duplicate
--      slugs exist, which is the point (revert is a data decision).
--   4. `alter table public.categories drop column user_id;`
--   5. `alter table public.categories drop constraint
--      categories_user_sort_order_floor;` and restore the purchase_items
--      policies to the 0001 definitions (drop + recreate
--      purchase_items_insert_own / purchase_items_update_own WITHOUT the
--      category subquery) when rolling back the review-gate hardening.
--   6. save_receipt 7-param: 0032 replaced the 0029 body in place. Reverting
--      the validation means re-applying 0029 §3 on the downgraded snapshot
--      (this repo keeps no down migrations).
--   7. save_receipt 6-param (0023): 0032 §5b redefined its body as a
--      delegate. Reverting means re-applying 0023 §1-§3 on the downgraded
--      snapshot (restores the standalone body + grants).
--
-- Operational notes
-- -----------------
--   §4 takes an ACCESS EXCLUSIVE lock on purchase_items while the FK is
--   rebuilt (drop + re-add); run during low traffic. The lock is
--   documented in the design risks and covered by the SQL smoke suite
--   (supabase/tests/user-categories.sql, CI db-smoke job).
--
--   Rerunning the PRE-0032 seed files (0001 and 0005 `on conflict (slug)`)
--   on this migration's schema fails with SQLSTATE 42P10 ("there is no
--   unique or exclusion constraint matching the ON CONFLICT specification"):
--   after §2, slug uniqueness lives in two PARTIAL indexes, which ON
--   CONFLICT cannot infer. Expected and harmless — the restore path above
--   handles reverts, and a fresh `supabase db reset` applies all migrations
--   in order (seeds are never re-run). Local iteration that applies
--   individual files must keep 0032 AFTER 0001/0005/0009.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. user-scoped ownership (mirrors stores)
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. replace global UNIQUE(slug) with partial unique indexes
-- ---------------------------------------------------------------------------
alter table public.categories drop constraint if exists categories_slug_key;

create unique index if not exists categories_global_slug_idx
  on public.categories (slug) where user_id is null;

create unique index if not exists categories_user_slug_idx
  on public.categories (user_id, slug) where user_id is not null;

create index if not exists categories_user_sort_idx
  on public.categories (user_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2.5 User-first sort floor (review gate CRITICAL #3)
--
-- Custom rows live at sort_order >= 100; canonical rows all sort < 100
-- (0001 max 99 'otros', 0005 max 90), so `order(sort_order, slug)` — the
-- exact ordering the client sends — places every global row before any user
-- row. The client's `map[row.slug] = row.id` then DETERMINISTICALLY ends
-- with the caller's own row when a global and a custom row share a slug:
-- the same-slug winner is user-first BY CONSTRUCTION, never a tie, never an
-- accident of PostgREST row order. INSERTs below the floor are rejected.
--
-- Canonical-slug shadowing stays possible at the DB level (a user may
-- create their own 'otros'/'lacteos' row, e.g. sort_order 100+): unique
-- per scope, RLS-scoped to the creator, and self-inflicted — the only UI
-- gate will be the category picker (PR3). Documented limitation, not a
-- defect.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'categories'
      and c.conname = 'categories_user_sort_order_floor'
  ) then
    alter table public.categories
      add constraint categories_user_sort_order_floor
      check (user_id is null or sort_order >= 100);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS: add write policies (select-all policy already exists from 0002)
-- ---------------------------------------------------------------------------
drop policy if exists "categories_insert_own" on public.categories;
create policy "categories_insert_own" on public.categories
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "categories_update_own" on public.categories;
create policy "categories_update_own" on public.categories
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_delete_own" on public.categories
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3.5 purchase_items write policies: category ownership (review gate
-- CRITICAL #2)
--
-- 0001 allowed INSERT/UPDATE of purchase_items based ONLY on parent
-- purchase ownership — a crafted client could attach ANY category uuid to a
-- line, including another user's custom row. The definer-scoped
-- save_receipt is not the only write path: updateReceipt PATCHes
-- purchase_items directly through PostgREST, whose RLS policies are the
-- ONLY guard there. Both policies are rebuilt with an added invoker-scoped
-- category subquery — the line's category must be NULL, a GLOBAL canonical
-- row (user_id is null), or a row owned by the caller (auth.uid()):
--
--   category_id is null
--   or exists (select 1 from public.categories c
--               where c.id = category_id
--                 and (c.user_id is null or c.user_id = auth.uid()))
--
-- UPDATE additionally gets WITH CHECK with the same category predicate AND
-- parent-ownership re-stated. This is the PRIMARY new-row guard (round-2
-- CRITICAL): per CREATE POLICY semantics, once an UPDATE policy defines a
-- WITH CHECK expression, that expression — and only that expression —
-- validates the NEW row (USING filters the OLD row). A category-only
-- WITH CHECK would therefore allow re-parenting an item into another
-- user's purchase while the old-row USING check still passes. The new row
-- must keep the caller's own parent (purchase_id → purchases.user_id =
-- auth.uid()) AND a legal category, stated explicitly in the policy text.
-- Moving items between the caller's OWN purchases stays legal (0001
-- posture).
-- ---------------------------------------------------------------------------

drop policy if exists "purchase_items_insert_own" on public.purchase_items;
create policy "purchase_items_insert_own" on public.purchase_items
  for insert to authenticated with check (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id
          and (c.user_id is null or c.user_id = auth.uid())
      )
    )
  );

drop policy if exists "purchase_items_update_own" on public.purchase_items;
create policy "purchase_items_update_own" on public.purchase_items
  for update to authenticated
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id
          and (c.user_id is null or c.user_id = auth.uid())
      )
    )
  )
  with check (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id
          and (c.user_id is null or c.user_id = auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. block-delete guarantee: category_id FK → ON DELETE RESTRICT
--
-- Rebuilt rerunnably (0002 convention): drop with IF EXISTS, add inside an
-- existence guard so local iteration never double-applies.
-- ---------------------------------------------------------------------------
alter table public.purchase_items drop constraint if exists purchase_items_category_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'purchase_items'
      and c.conname = 'purchase_items_category_id_fkey'
  ) then
    alter table public.purchase_items
      add constraint purchase_items_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. save_receipt(): server-side category ownership validation
--    (review gate BLOCKER)
--
-- This function is SECURITY DEFINER, so the RLS write policies above NEVER
-- fire for its writes — a crafted client could copy ANY category uuid into
-- a line (including another user's custom row) and 0029's body would accept
-- it. The 7-param signature from 0029 is kept EXACTLY (same name, params,
-- defaults, return type, volatility); only the body is redefined to
-- validate every line's category and fail closed:
--
--     category_id  null                      → legal ("sin categoría")
--     category_id  references a GLOBAL row   → legal (user_id is null)
--     category_id  references the caller's   → legal (user_id = v_user)
--     anything else (other users' rows,      → raise exception (P0001),
--     unknown uuids)                            full rollback incl. the
--                                                scan-slot increment
--
-- The validation reuses the existing item loop index (v_i) and runs BEFORE
-- the purchases INSERT, inside the single implicit transaction: one failed
-- line rejects the whole receipt and leaves no partial state. The 6-param
-- overload from 0023 is CLOSED in §5b as a delegate to this function
-- (round-2 review-gate BLOCKER).
-- ---------------------------------------------------------------------------

create or replace function public.save_receipt(
  p_store_id       uuid,
  p_purchase_date  date,
  p_total          numeric,
  p_payment_method text,
  p_image_url      text,
  p_items          public.purchase_item_input[],
  p_is_manual      boolean default false
)
returns table (
  ok         boolean,
  purchase_id uuid,
  scans_used  int,
  scans_limit int
)
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_tier  text;
  v_used  int;
  v_limit int;
  v_pid   uuid;
  v_i     int;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  -- Read tier for the initial scan_usage seed (same pattern as 0021 §3).
  select tier into v_tier from public.profiles where id = v_user;
  v_tier := coalesce(v_tier, 'free');

  -- Seed the row if it does not exist yet (first save of the month).
  insert into public.scan_usage (user_id, year_month, scans_used, scans_limit)
  values (v_user, v_month, 0,
          case when v_tier = 'pro' then null else 15 end)
  on conflict (user_id, year_month) do nothing;

  -- Guarded atomic increment: re-reads profiles.tier inside the UPDATE via
  -- FROM to close the TOCTOU window between the seed read and the decision.
  -- Pro users always pass; free users must be under the cap.
  update public.scan_usage su
     set scans_used = su.scans_used + 1
    from public.profiles pr
   where su.user_id = v_user
     and su.year_month = v_month
     and pr.id = v_user
     and (pr.tier = 'pro' or su.scans_used < coalesce(su.scans_limit, 15))
   returning su.scans_used, su.scans_limit into v_used, v_limit;

  if not found then
    -- Cap reached: read the current counts for the caller (ok=false, no raise).
    select su.scans_used, su.scans_limit
      into v_used, v_limit
      from public.scan_usage su
     where su.user_id = v_user
       and su.year_month = v_month;

    ok         := false;
    purchase_id := null;
    scans_used  := coalesce(v_used, 0);
    scans_limit := coalesce(v_limit, 15);
    return next;
    return;
  end if;

  -- Guard: receipt must have at least one item, and cap the array size so a
  -- malicious/greedy client cannot send a huge array and exhaust resources.
  if p_items is null or array_length(p_items, 1) is null or array_length(p_items, 1) = 0 then
    raise exception 'receipt requires at least one item';
  end if;
  if array_length(p_items, 1) > 500 then
    raise exception 'too many items (max 500)';
  end if;

  -- Monetary validation (per user decision 2026-08-31): conservative, data
  -- hygiene not total exactness. Enforce hard, non-fixable invariants — a
  -- line with quantity <= 0 or a negative unit price is broken data and the
  -- save is rejected (everything rolls back). The month total is only checked
  -- to be non-negative: receipts carry end-of-receipt discounts (debit/card
  -- promo, "descuento de ley", coupons) that are NOT line items, so the sum
  -- of line totals does not have to equal the final total-to-pay.
  if p_total is null or p_total < 0 then
    raise exception 'invalid receipt total';
  end if;
  for v_i in 1 .. array_length(p_items, 1) loop
    if p_items[v_i].quantity is null or p_items[v_i].quantity <= 0 then
      raise exception 'invalid item quantity';
    end if;
    if p_items[v_i].unit_price is null or p_items[v_i].unit_price < 0 then
      raise exception 'invalid item unit price';
    end if;
  end loop;

  -- Category ownership validation (0032 §5): RLS does not fire here (SECURITY
  -- DEFINER), so ownership is enforced server-side, fail-closed, per line.
  -- NULL passes (legal uncategorized line); any non-NULL id must exist AND be
  -- a global canonical row or a row owned by the caller. Rejects happen
  -- BEFORE the purchases INSERT — the implicit transaction rolls everything
  -- back (scan-slot increment included) on any failure.
  for v_i in 1 .. array_length(p_items, 1) loop
    if p_items[v_i].category_id is not null then
      if not exists (
        select 1 from public.categories c
         where c.id = p_items[v_i].category_id
           and (c.user_id is null or c.user_id = v_user)
      ) then
        raise exception 'invalid item category';
      end if;
    end if;
  end loop;

  -- Insert the purchase row (status 'confirmed' as the client sets it).
  -- `is_manual` is set HERE from p_is_manual — the ONLY writer of origin.
  insert into public.purchases (
    user_id, store_id, purchase_date, total, payment_method, image_url, status, is_manual
  ) values (
    v_user, p_store_id, p_purchase_date, p_total, p_payment_method, p_image_url, 'confirmed', p_is_manual
  )
  returning id into v_pid;

  -- Insert all purchase_items rows from the input array. `x` is of the named
  -- composite type purchase_item_input, so no column definition list is
  -- allowed (and none is needed — the field names come from the type).
  --
  -- total_price is FORCED to quantity * unit_price (per user decision
  -- 2026-08-31): a line where the sent total_price disagrees (dirty OCR /
  -- tampered client) is corrected to the consistent value instead of
  -- rejecting the whole receipt.
  insert into public.purchase_items (
    purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order
  )
  select
    v_pid,
    x.name,
    x.quantity,
    x.unit_price,
    x.quantity * x.unit_price,
    x.category_id,
    x.is_impulse,
    x.sort_order
  from unnest(p_items) as x;

  ok         := true;
  purchase_id := v_pid;
  scans_used  := v_used;
  scans_limit := v_limit;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5b. CLOSE the 6-param compat overload (round-2 review-gate BLOCKER)
--
-- The 6-param signature from 0023 is SECURITY DEFINER with the OLD body: it
-- copied category_id into purchase_items with NO ownership validation.
-- PostgREST selects overloads BY ARGUMENT COUNT ("Overloaded functions can
-- be called by providing the appropriate arguments"), so a 6-key HTTP RPC
-- call — no p_is_manual key, NO old client needed — lands on this overload
-- and its unvalidated definer body would accept ANY category uuid (0229-era
-- vector reopened inside the 0023 body). Raw SQL cannot execute a 6-arg call
-- while the 7-param default exists (42P03 ambiguous_function on PG 16/17 —
-- there is NO fewest-defaults tie-break), so the threat surface is exactly
-- the PostgREST count-based route.
--
-- The fix: redefine the 6-param body as a pure DELEGATE to the validated
-- 7-param (single implementation of the truth), loading p_is_manual => false
-- (this signature predates the origin param — those "old clients" can only
-- mean manual entry). Same name, params, return type, volatility, definer
-- ownership, search_path; only the body changes. The inner named-notation
-- call (6 positional + p_is_manual => false) resolves to the 7-param
-- UNAMBIGUOUSLY (the 6-param has no p_is_manual argument name). If the
-- 7-param were ever dropped, this delegate fails loudly — fail-closed.
-- NOT a thin pass-through: validation is executed (and it raises on a
-- foreign category uuid), it is just not re-implemented here.
-- ---------------------------------------------------------------------------
create or replace function public.save_receipt(
  p_store_id       uuid,
  p_purchase_date  date,
  p_total          numeric,
  p_payment_method text,
  p_image_url      text,
  p_items          public.purchase_item_input[]
)
returns table (
  ok         boolean,
  purchase_id uuid,
  scans_used  int,
  scans_limit int
)
language sql
security definer
volatile
set search_path = public
as $$
  select ok, purchase_id, scans_used, scans_limit
    from public.save_receipt(
      p_store_id,
      p_purchase_date,
      p_total,
      p_payment_method,
      p_image_url,
      p_items,
      p_is_manual => false
    );
$$;

-- Grants re-stated (0023 §3 house style): the 0023 revoke/grant still holds,
-- but keeping them here makes this file self-sufficient and marks the
-- overload as reviewed-closed.
revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) to authenticated;

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[]) is
  'Transactional receipt save, 6-param compat overload (0023): CLOSED by 0032 §5b — pure delegate to the validated 7-param with p_is_manual => false (single implementation of the truth; origin false, this signature predates the param). SECURITY DEFINER, authenticated-role callable. Raw SQL 6-arg calls are ambiguous (42P03) while the 7-param default exists; PostgREST count-based routing lands 6-key calls here, hence the closure.';

-- Grants re-stated for defense-in-depth (0029 §4 / 0031 §4 house style).
-- CREATE OR REPLACE on the EXISTING 7-param signature preserves EXECUTE
-- privileges, but re-stating keeps the file self-sufficient and guards
-- against partial-stack applies where 0029's grants never ran.
revoke all on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) from public, anon;

grant execute on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) to authenticated;

comment on function public.save_receipt(uuid, date, numeric, text, text, public.purchase_item_input[], boolean) is
  'Transactional receipt save with origin: checks monthly scan cap, validates every line category server-side (NULL, global canonical, or owned by the caller — fail-closed, 0032 §5), inserts purchases + purchase_items atomically (is_manual from p_is_manual), increments scan slot. SECURITY DEFINER, authenticated-role callable. Returns (ok, purchase_id, scans_used, scans_limit); ok=false when the free-tier cap is reached (never raises). 7-param overload — the 6-param signature from 0023 is closed (0032 §5b) as a delegate to this validated body.';