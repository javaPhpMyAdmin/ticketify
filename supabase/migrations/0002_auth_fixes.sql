-- ============================================================================
-- Ticketify — auth & schema fixes (post-review)
--
-- Follows `0001_initial_schema.sql` (already applied / pushed with the
-- initial schema). Four fixes:
--
--   1. Enable RLS on `categories` (CRITICAL): 0001 deliberately shipped the
--      table without RLS, but Supabase's default grants let the anon key
--      (embedded in the app binary) write to it. The seed in 0001 runs as the
--      migration role (which bypasses RLS), so a SELECT-only policy for
--      authenticated users is the whole story — no write policy needed.
--
--   2. Composite PK on `scan_usage (user_id, year_month)` (CRITICAL): 0001
--      declared a single-column `user_id` PK, but the row key is the user +
--      month (the app reads/writes one row per user per month). Safe to run
--      against a populated table: duplicates are detected and deduped first
--      (keeping the row with the highest `scans_used`), then the constraint
--      is rebuilt. The remote project is EMPTY, so the dedupe is a no-op
--      there — the statements are written to be safe either way.
--
--   3. `monthly_category_totals(p_year_month)` RPC (ADR-7): the analytics
--      read. `security invoker` so it respects the existing RLS policies on
--      `purchases` / `purchase_items` / `categories`; scoped to `auth.uid()`
--      server-side (the client never passes a user id).
--
--   4. `profiles.tier` write protection (risk): 0001's policies let any user
--      set `tier = 'pro'` on their own row. Nothing consumes `tier` yet, so
--      there is no exploit today — but it is a future entitlement, so the
--      client is locked out of changing it now. Future tier management MUST
--      go through an edge function / service-role write.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. categories — RLS for a global taxonomy
-- ---------------------------------------------------------------------------

-- The table is a shared reference set (no owner column): every authenticated
-- user may read every row. The anon role gets nothing (no policy targets it),
-- and there is deliberately no insert/update/delete policy — categories are
-- seeded by migrations only.
alter table public.categories enable row level security;

drop policy if exists "categories_select_auth" on public.categories;
create policy "categories_select_auth" on public.categories
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. scan_usage — composite PK (user_id, year_month)
-- ---------------------------------------------------------------------------

-- 2a. Detect duplicates (the design's manual pre-flight check, kept in the
-- migration so a populated table is migrated safely in one step).
--     Reference check (documentation only):
--       select user_id, year_month, count(*)
--       from scan_usage group by 1, 2 having count(*) > 1;

-- 2b. Dedupe: keep the row with the highest `scans_used` per (user_id,
-- year_month); when two rows tie on scans_used, keep the physically first
-- one (smallest ctid). A no-op on an empty table.
delete from public.scan_usage su
using public.scan_usage su2
where su.user_id = su2.user_id
  and su.year_month = su2.year_month
  and (
    su.scans_used < su2.scans_used
    or (su.scans_used = su2.scans_used and su.ctid > su2.ctid)
  );

-- 2c. Rebuild the PK. The constraint-name guard makes the step rerunnable
-- during local iteration (a one-shot `drop constraint` would fail on a
-- second run; `add primary key` has no IF NOT EXISTS).
do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'scan_usage'
      and c.conname = 'scan_usage_pkey'
  ) then
    alter table public.scan_usage drop constraint scan_usage_pkey;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'scan_usage'
      and c.conname = 'scan_usage_pkey'
  ) then
    alter table public.scan_usage
      add constraint scan_usage_pkey primary key (user_id, year_month);
  end if;
end $$;

-- The composite key requires both columns to be NOT NULL (already true from
-- 0001; restated explicitly so the migration documents the invariant and
-- stays correct if 0001 ever changes).
alter table public.scan_usage alter column year_month set not null;

-- ---------------------------------------------------------------------------
-- 3. monthly_category_totals(p_year_month) — analytics RPC (ADR-7)
-- ---------------------------------------------------------------------------

create or replace function public.monthly_category_totals(p_year_month text)
returns table (category_id uuid, category_name text, category_slug text,
               total numeric, item_count bigint, percent_of_total numeric)
language sql security invoker stable set search_path = public as $$
  select c.id, c.name, c.slug,
         sum(pi.total_price)::numeric(12,2), count(*)::bigint,
         round(100.0 * sum(pi.total_price) / nullif(sum(sum(pi.total_price)) over (), 0), 1)
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  join public.categories c on c.id = pi.category_id
  where p.user_id = auth.uid() and to_char(p.purchase_date, 'YYYY-MM') = p_year_month
  group by c.id, c.name, c.slug
$$;

-- ---------------------------------------------------------------------------
-- 4. profiles.tier — client-writable privilege claim (risk fix)
-- ---------------------------------------------------------------------------

-- Any tier change from the client — including a downgrade — is rejected:
-- `tier` is not user-manageable in this change. Future tier management MUST
-- go through an edge function / the service role, which bypasses the trigger
-- only when it needs to write tier directly.
create or replace function public.protect_profile_tier() returns trigger
language plpgsql as $$
begin
  if new.tier is distinct from old.tier then
    raise exception 'tier is managed server-side';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_protect_tier'
      and tgrelid = 'public.profiles'::regclass
  ) then
    create trigger profiles_protect_tier
      before update on public.profiles
      for each row execute function public.protect_profile_tier();
  end if;
end $$;
