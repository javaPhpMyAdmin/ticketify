-- ============================================================================
-- Ticketify — seed demo purchases for the first profile user
--
-- Mirrors MOCK_RECEIPTS (src/lib/mock-data.ts): the same 9 stores, relative
-- purchase dates, totals, line items, impulse flags, and photo placeholders
-- the offline feed renders. Seeding them server-side gives the real
-- authenticated reads (Home feed, History, Analytics) the same demo content
-- a fresh user would see in mock mode.
--
-- Scope: the FIRST profile row only (`select id from public.profiles limit
-- 1`). A brand-new database with no profiles row is a no-op: the `where
-- exists (select 1 from public.profiles)` guard on every insert prevents
-- foreign-key violations and pointless writes.
--
-- Idempotency: purchases and items use deterministic uuids
-- (a…=purchases, b…=items, c…=stores) with `on conflict (id) do nothing`, so
-- re-running the migration never duplicates rows. Categories keep their
-- gen_random_uuid() ids from 0001/0005 and are resolved by slug.
--
-- Dates: current-month receipts clamp their day offset to the month start
-- (greatest(local_today - n, month_start), computed in America/Montevideo so
-- the calendar matches the app's local month bucketing) — same trick as
-- currentMonthDaysAgoISO in the mock. The
-- Mercado Central receipt (0009) lands on the 15th of the PREVIOUS month so
-- History always has an older month to navigate to. `created_at` mirrors the
-- mock's `scanned_at` (the "Recibos recientes" ordering stamp): Almacén 0007
-- was scanned "now", the rest at their day offsets.
--
-- Item search (approved option B): purchase_items gets an accent-insensitive
-- generated column plus a trigram GIN index, so the client's ilike search
-- matches "menu" against "Menú del día" and stays indexed at scale.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Global stores (user_id null → visible to every authenticated user)
-- ---------------------------------------------------------------------------
insert into public.stores (id, user_id, name, chain) values
  ('c0000000-0000-0000-0000-000000000001', null, 'Supermercado Don Pedro',    null),
  ('c0000000-0000-0000-0000-000000000002', null, 'Farmacity',                 null),
  ('c0000000-0000-0000-0000-000000000003', null, 'Starbucks',                 null),
  ('c0000000-0000-0000-0000-000000000004', null, 'Coto Hipermercado',         null),
  ('c0000000-0000-0000-0000-000000000005', null, 'Panadería La Central',      null),
  ('c0000000-0000-0000-0000-000000000006', null, 'Librería El Ateneo',        null),
  ('c0000000-0000-0000-0000-000000000007', null, 'Almacén Barrio Norte',      null),
  ('c0000000-0000-0000-0000-000000000008', null, 'Multiservicios del Barrio', null),
  ('c0000000-0000-0000-0000-000000000009', null, 'Mercado Central',           null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Purchases for the first profile user
--
-- `days_ago` feeds the clamped current-month date; 0009 instead carries an
-- explicit previous-month date (15th). `created_at` mirrors the mock's
-- `scanned_at` so "Recibos recientes" orders identically in real mode.
--
-- Timezone note: the app buckets months on the LOCAL calendar (currentMonthKey
-- uses getFullYear/getMonth), so the seed must too — a UTC slice drifts a day
-- on month edges and Home renders empty on the 1st in UTC-x zones. The demo is
-- UYU, so the seed calendar is pinned to America/Montevideo (UTC-3).
-- ---------------------------------------------------------------------------
with seed_calendar as (
  select (now() at time zone 'America/Montevideo')::date as local_today
),
purchases_seed (id, store_id, days_ago, purchase_date, total, payment_method, image_url, created_at) as (
  values
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1,  null::date, 12800.5, 'card', null::text, now() - interval '1 day'),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 2,  null::date, 5420.3,  'card', null::text, now() - interval '2 days'),
    ('a0000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000003'::uuid, 9,  null::date, 3150,    'card', null::text, now() - interval '9 days'),
    ('a0000000-0000-0000-0000-000000000004'::uuid, 'c0000000-0000-0000-0000-000000000004'::uuid, 5,  null::date, 8975.1,  'card', null::text, now() - interval '5 days'),
    ('a0000000-0000-0000-0000-000000000005'::uuid, 'c0000000-0000-0000-0000-000000000005'::uuid, 7,  null::date, 2100.75, 'cash', null::text, now() - interval '7 days'),
    ('a0000000-0000-0000-0000-000000000006'::uuid, 'c0000000-0000-0000-0000-000000000006'::uuid, 11, null::date, 4850,    'cash', null::text, now() - interval '11 days'),
    ('a0000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000007'::uuid, 4,  null::date, 15600,   'card', 'https://picsum.photos/seed/ticketify-almacen/800/1200', now()),
    ('a0000000-0000-0000-0000-000000000008'::uuid, 'c0000000-0000-0000-0000-000000000008'::uuid, 3,  null::date, 15900,   'cash', 'https://picsum.photos/seed/ticketify-servicios/800/1200', now() - interval '3 days'),
    ('a0000000-0000-0000-0000-000000000009'::uuid, 'c0000000-0000-0000-0000-000000000009'::uuid, null,
     (date_trunc('month', (select local_today from seed_calendar))::date - interval '1 month' + interval '14 days')::date,
     10110, 'card', null::text,
     (date_trunc('month', (select local_today from seed_calendar))::date - interval '1 month' + interval '14 days')::timestamptz)
)
insert into public.purchases (id, user_id, store_id, purchase_date, total, payment_method, image_url, status, created_at)
select
  s.id,
  (select id from public.profiles limit 1),
  s.store_id,
  coalesce(s.purchase_date, greatest(c.local_today - s.days_ago, date_trunc('month', c.local_today)::date)),
  s.total,
  s.payment_method,
  s.image_url,
  'confirmed',
  s.created_at
from purchases_seed s
cross join seed_calendar c
where exists (select 1 from public.profiles)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Line items, resolved by category slug
--
-- Items the mock marks as impulse (Papas fritas x3 on 0001, Latte grande on
-- 0003) keep `is_impulse = true` so the Home "snacks" callout renders the
-- same total it does offline. Items without an explicit quantity/unit price
-- in the mock get quantity 1 with unit_price = line total.
-- ---------------------------------------------------------------------------
with items_seed (id, purchase_id, name, quantity, unit_price, total_price, category_slug, is_impulse, sort_order) as (
  values
    -- 0001 Supermercado Don Pedro
    ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Leche entera 1L',         1, 1200,   1200,   'lacteos',        false, 0),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Manteca 200g',            1, 1200,   1200,   'lacteos',        false, 1),
    ('b0000000-0000-0000-0000-000000000003'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Bizcochos de grasa x6',   1, 2100,   2100,   'panaderia',      false, 2),
    ('b0000000-0000-0000-0000-000000000004'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Papas fritas x3',         3, 1050,   3150,   'snacks',         true,  3),
    ('b0000000-0000-0000-0000-000000000005'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Gaseosa 2L',              1, 2750.5, 2750.5, 'refrescos',      false, 4),
    ('b0000000-0000-0000-0000-000000000006'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Bananas 1kg',             1, 1200,   1200,   'frutas-verduras', false, 5),
    ('b0000000-0000-0000-0000-000000000007'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'Tomates 1kg',             1, 1200,   1200,   'frutas-verduras', false, 6),
    -- 0002 Farmacity
    ('b0000000-0000-0000-0000-000000000008'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, 'Ibuprofeno 600 x20',      1, 3200,   3200,   'farmacia',       false, 0),
    ('b0000000-0000-0000-0000-000000000009'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, 'Shampoo 400ml',           1, 2220.3, 2220.3, 'higiene',        false, 1),
    -- 0003 Starbucks
    ('b0000000-0000-0000-0000-000000000010'::uuid, 'a0000000-0000-0000-0000-000000000003'::uuid, 'Latte grande',            1, 3150,   3150,   'bebidas',        true,  0),
    -- 0004 Coto Hipermercado
    ('b0000000-0000-0000-0000-000000000011'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Arroz 1kg',               1, 1200,   1200,   'alimentos',      false, 0),
    ('b0000000-0000-0000-0000-000000000012'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Fideos 500g',             1, 900,    900,    'alimentos',      false, 1),
    ('b0000000-0000-0000-0000-000000000013'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Yerba 1kg',               1, 1100,   1100,   'alimentos',      false, 2),
    ('b0000000-0000-0000-0000-000000000014'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Milanesas de pollo',      1, 1600,   1600,   'carnes',         false, 3),
    ('b0000000-0000-0000-0000-000000000015'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Carne picada',            1, 1000,   1000,   'carnes',         false, 4),
    ('b0000000-0000-0000-0000-000000000016'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Yogur entero',            1, 800,    800,    'lacteos',        false, 5),
    ('b0000000-0000-0000-0000-000000000017'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Leche chocolatada',       1, 600,    600,    'lacteos',        false, 6),
    ('b0000000-0000-0000-0000-000000000018'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid, 'Gaseosa cola 1.5L',       1, 1775.1, 1775.1, 'refrescos',      false, 7),
    -- 0005 Panadería La Central
    ('b0000000-0000-0000-0000-000000000019'::uuid, 'a0000000-0000-0000-0000-000000000005'::uuid, 'Comida del día',          1, 1400,   1400,   'panaderia',      false, 0),
    ('b0000000-0000-0000-0000-000000000020'::uuid, 'a0000000-0000-0000-0000-000000000005'::uuid, 'Ojitos con crema x6',     1, 700.75, 700.75, 'panaderia',      false, 1),
    -- 0006 Librería El Ateneo
    ('b0000000-0000-0000-0000-000000000021'::uuid, 'a0000000-0000-0000-0000-000000000006'::uuid, 'Cuadernos x3',            1, 2400,   2400,   'otros',          false, 0),
    ('b0000000-0000-0000-0000-000000000022'::uuid, 'a0000000-0000-0000-0000-000000000006'::uuid, 'Novela',                  1, 2450,   2450,   'otros',          false, 1),
    -- 0007 Almacén Barrio Norte
    ('b0000000-0000-0000-0000-000000000023'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Arroz 1kg',               1, 1200,   1200,   'alimentos',      false, 0),
    ('b0000000-0000-0000-0000-000000000024'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Fideos 500g',             1, 900,    900,    'alimentos',      false, 1),
    ('b0000000-0000-0000-0000-000000000025'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Caldo de verduras x6',    1, 500,    500,    'alimentos',      false, 2),
    ('b0000000-0000-0000-0000-000000000026'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Salsa de tomate x2',      1, 700,    700,    'alimentos',      false, 3),
    ('b0000000-0000-0000-0000-000000000027'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Fiambre (paleta cocida)', 1, 1100,   1100,   'alimentos',      false, 4),
    ('b0000000-0000-0000-0000-000000000028'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Pizzas congeladas x2',    1, 1600,   1600,   'alimentos',      false, 5),
    ('b0000000-0000-0000-0000-000000000029'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Yerba 500g',              1, 1300,   1300,   'alimentos',      false, 6),
    ('b0000000-0000-0000-0000-000000000030'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Detergente 750ml',        1, 800,    800,    'limpieza',       false, 7),
    ('b0000000-0000-0000-0000-000000000031'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Suavizante 1L',           1, 1200,   1200,   'limpieza',       false, 8),
    ('b0000000-0000-0000-0000-000000000032'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Jabón líquido ropa 3L',   1, 2000,   2000,   'limpieza',       false, 9),
    ('b0000000-0000-0000-0000-000000000033'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Servilletas x2',          1, 400,    400,    'limpieza',       false, 10),
    ('b0000000-0000-0000-0000-000000000034'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Papel higiénico x4',      1, 1500,   1500,   'higiene',        false, 11),
    ('b0000000-0000-0000-0000-000000000035'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Bidón de agua 12L',       1, 1500,   1500,   'bebidas',        false, 12),
    ('b0000000-0000-0000-0000-000000000036'::uuid, 'a0000000-0000-0000-0000-000000000007'::uuid, 'Agua con gas x6',         1, 900,    900,    'bebidas',        false, 13),
    -- 0008 Multiservicios del Barrio
    ('b0000000-0000-0000-0000-000000000037'::uuid, 'a0000000-0000-0000-0000-000000000008'::uuid, 'Luz (factura mensual)',   1, 8500,   8500,   'servicios',      false, 0),
    ('b0000000-0000-0000-0000-000000000038'::uuid, 'a0000000-0000-0000-0000-000000000008'::uuid, 'Agua (factura mensual)',  1, 3200,   3200,   'servicios',      false, 1),
    ('b0000000-0000-0000-0000-000000000039'::uuid, 'a0000000-0000-0000-0000-000000000008'::uuid, 'Teléfono (factura mensual)', 1, 4200, 4200,   'servicios',      false, 2),
    -- 0009 Mercado Central (previous month)
    ('b0000000-0000-0000-0000-000000000040'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Harina 0000 1kg',         1, 900,    900,    'alimentos',      false, 0),
    ('b0000000-0000-0000-0000-000000000041'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Azúcar 1kg',              1, 1100,   1100,   'alimentos',      false, 1),
    ('b0000000-0000-0000-0000-000000000042'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Aceite de girasol 1L',    1, 1500,   1500,   'alimentos',      false, 2),
    ('b0000000-0000-0000-0000-000000000043'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Detergente lavaplatos',   1, 950,    950,    'limpieza',       false, 3),
    ('b0000000-0000-0000-0000-000000000044'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Agua mineral 2L x6',      1, 1500,   1500,   'bebidas',        false, 4),
    -- Price-alert pair with 0001: Leche 1100 (prev) vs 1200 (now) → +9.1%
    ('b0000000-0000-0000-0000-000000000045'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Leche entera 1L',         1, 1100,   1100,   'lacteos',        false, 5),
    -- Papas fritas 1020/unit (prev) vs 1050/unit (now) → +2.9%, below the 5% threshold
    ('b0000000-0000-0000-0000-000000000046'::uuid, 'a0000000-0000-0000-0000-000000000009'::uuid, 'Papas fritas x3',         3, 1020,   3060,   'snacks',         false, 6)
)
insert into public.purchase_items (id, purchase_id, name, quantity, unit_price, total_price, category_id, is_impulse, sort_order)
select
  i.id, i.purchase_id, i.name, i.quantity, i.unit_price, i.total_price,
  c.id, i.is_impulse, i.sort_order
from items_seed i
left join public.categories c on c.slug = i.category_slug
where exists (select 1 from public.profiles)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Item search support (approved option B)
--
-- Accent-insensitive generated column + trigram GIN index: the client runs
-- `ilike` on `name_search` with an accent-stripped query, so "menu" matches
-- "Menú del día" and the leading-wildcard lookup stays indexed.
-- ---------------------------------------------------------------------------
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- `unaccent(text)` is STABLE, but generated columns require IMMUTABLE
-- expressions. Wrap the dictionary form (which IS immutable) so the
-- generated column is legal and the leading-wildcard lookup stays indexed.
create or replace function public.f_unaccent(input text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select public.unaccent('public.unaccent'::regdictionary, input)
$$;

alter table public.purchase_items
  add column if not exists name_search text
  generated always as (public.f_unaccent(name)) stored;

create index if not exists purchase_items_name_search_trgm_idx
  on public.purchase_items using gin (name_search gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5) The seeded user's profile currency → UYU (the demo budget is UYU now)
-- ---------------------------------------------------------------------------
update public.profiles
set currency = 'UYU'
where id = (select id from public.profiles limit 1)
  and currency is distinct from 'UYU';
