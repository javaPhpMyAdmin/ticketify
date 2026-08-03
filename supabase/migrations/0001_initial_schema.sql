-- ============================================================================
-- Ticketify — initial schema
--
-- Tables mirror the TypeScript types in `mobile/src/types/index.ts`. Keep
-- the two in sync: when you add a column here, add it to the matching
-- interface and re-run `supabase gen types typescript`.
-- ============================================================================

-- Required for `gen_random_uuid()` (built into PG 13+, but explicit is safer).
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — extends auth.users 1:1
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  avatar_url      text,
  monthly_budget  numeric(12, 2) not null default 0,
  currency        text          not null default 'USD',
  tier            text          not null default 'free' check (tier in ('free', 'pro')),
  created_at      timestamptz   not null default now()
);

comment on table public.profiles is 'User profile, 1:1 with auth.users.';

-- ---------------------------------------------------------------------------
-- categories — global taxonomy, readable by all authenticated users
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  kind        text not null check (kind in ('need', 'want')),
  icon        text not null,
  color       text not null,
  sort_order  int  not null default 0
);

create index categories_sort_idx on public.categories (sort_order);

comment on table public.categories is 'Global category taxonomy. user_id is null for global rows.';

-- ---------------------------------------------------------------------------
-- stores — user-scoped + global chains
-- ---------------------------------------------------------------------------
create table public.stores (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid references public.profiles(id) on delete cascade,
  name     text not null,
  chain    text
);

create index stores_user_idx on public.stores (user_id);

-- ---------------------------------------------------------------------------
-- purchases
-- ---------------------------------------------------------------------------
create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  store_id        uuid references public.stores(id) on delete set null,
  purchase_date   date not null,
  total           numeric(12, 2) not null,
  payment_method  text not null,
  image_url       text,
  status          text not null default 'pending' check (status in ('pending', 'parsed', 'confirmed', 'failed')),
  ai_confidence   numeric(3, 2),
  raw_ocr         jsonb,
  created_at      timestamptz not null default now()
);

create index purchases_user_date_idx on public.purchases (user_id, purchase_date desc);
create index purchases_status_idx on public.purchases (status);

-- ---------------------------------------------------------------------------
-- purchase_items
-- ---------------------------------------------------------------------------
create table public.purchase_items (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references public.purchases(id) on delete cascade,
  name          text not null,
  quantity      numeric(10, 3) not null default 1,
  unit_price    numeric(12, 2) not null,
  total_price   numeric(12, 2) not null,
  category_id   uuid references public.categories(id) on delete set null,
  is_impulse    boolean not null default false,
  sort_order    int not null default 0
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id, sort_order);
create index purchase_items_category_idx on public.purchase_items (category_id);

-- ---------------------------------------------------------------------------
-- scan_usage — composite key (user_id, year_month)
-- ---------------------------------------------------------------------------
create table public.scan_usage (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  year_month  text not null,
  scans_used  int  not null default 0,
  scans_limit int  not null default 10
);

create index scan_usage_year_month_idx on public.scan_usage (year_month);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.stores         enable row level security;
alter table public.purchases      enable row level security;
alter table public.purchase_items enable row level security;
alter table public.scan_usage     enable row level security;

-- categories is intentionally left without RLS — it's read by all auth users
-- and only seeded via SQL migrations.

-- profiles: users can read/update their own row.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Allow a brand-new auth user to insert their own profile row on signup.
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- stores: user can CRUD their own rows + read global chains (user_id is null).
create policy "stores_select_own_or_global" on public.stores
  for select using (user_id is null or auth.uid() = user_id);

create policy "stores_insert_own" on public.stores
  for insert with check (auth.uid() = user_id);

create policy "stores_update_own" on public.stores
  for update using (auth.uid() = user_id);

create policy "stores_delete_own" on public.stores
  for delete using (auth.uid() = user_id);

-- purchases: user can only touch their own.
create policy "purchases_select_own" on public.purchases
  for select using (auth.uid() = user_id);

create policy "purchases_insert_own" on public.purchases
  for insert with check (auth.uid() = user_id);

create policy "purchases_update_own" on public.purchases
  for update using (auth.uid() = user_id);

create policy "purchases_delete_own" on public.purchases
  for delete using (auth.uid() = user_id);

-- purchase_items: parent-scoped via join.
create policy "purchase_items_select_own" on public.purchase_items
  for select using (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

create policy "purchase_items_insert_own" on public.purchase_items
  for insert with check (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

create policy "purchase_items_update_own" on public.purchase_items
  for update using (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

create policy "purchase_items_delete_own" on public.purchase_items
  for delete using (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

-- scan_usage: own row only.
create policy "scan_usage_select_own" on public.scan_usage
  for select using (auth.uid() = user_id);

create policy "scan_usage_upsert_own" on public.scan_usage
  for insert with check (auth.uid() = user_id);

create policy "scan_usage_update_own" on public.scan_usage
  for update using (auth.uid() = user_id);

-- ============================================================================
-- Storage bucket for receipt images
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Authenticated users can upload to their own folder: <user_id>/<file>
create policy "receipts_upload_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "receipts_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "receipts_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- Seed: categories
-- ============================================================================
insert into public.categories (slug, name, kind, icon, color, sort_order) values
  ('refrescos',      'Refrescos',         'want', 'cup.and.saucer', '#10B981', 10),
  ('snacks',         'Snacks / Galletas', 'want', 'popcorn',        '#F59E0B', 20),
  ('limpieza',       'Limpieza',          'need', 'sparkle',        '#3B82F6', 30),
  ('frutas-verduras','Frutas y Verduras', 'need', 'leaf',           '#10B981', 40),
  ('carnes',         'Carnes',            'need', 'fish',           '#DC2626', 50),
  ('lacteos',        'Lácteos',           'need', 'drop',           '#06B6D4', 60),
  ('panaderia',      'Panadería',         'need', 'fork.knife',     '#F59E0B', 70),
  ('otros',          'Otros',             'need', 'square.grid.2x2','#6B7280', 99)
on conflict (slug) do nothing;
