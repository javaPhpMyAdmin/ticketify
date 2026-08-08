-- ============================================================================
-- Ticketify — expand category taxonomy to 13 canonical slugs
--
-- The client registry (src/features/home/categories.ts) and the edge
-- function vocabulary (CATEGORY_SLUGS in parse-ticket) both describe 13
-- categories, but 0001 only seeded 8 and used the edge's descriptive slugs
-- ('frutas-verduras', 'carnes') instead of the client keys ('verduleria',
-- 'carniceria').
--
-- Canon: the edge slugs win ('frutas-verduras', 'carnes' stay). This
-- migration adds the 5 missing rows so every slug the client can pick or
-- the parser can emit has a matching DB row with the same slug, icon, and
-- color. Idempotent: safe to re-run.
-- ============================================================================

insert into public.categories (slug, name, kind, icon, color, sort_order) values
  ('bebidas',    'Bebidas',    'want', 'waterbottle.fill', '#38BDF8',   5),
  ('alimentos',  'Alimentos',  'need', 'cart.fill',        '#F97316',  15),
  ('higiene',    'Higiene',    'need', 'soap.fill',        '#A855F7',  35),
  ('farmacia',   'Farmacia',   'need', 'pills.fill',       '#14B8A6',  80),
  ('servicios',  'Servicios',  'need', 'bolt.fill',        '#FACC15',  90)
on conflict (slug) do nothing;
