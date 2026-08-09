-- ============================================================================
-- Ticketify — align profile currency with the product decision (UYU)
--
-- Follows `0001_initial_schema.sql` (currency text not null default 'USD').
--
-- The app's money flow is fixed to UYU: `useSettingsStore.currency` hardcodes
-- 'UYU' and every money screen formats through `formatCurrency(value,
-- currency)` (src/lib/format.ts). Profiles created before this migration were
-- born with 'USD' in their row while the UI showed $UYU, so the stored
-- default and the backfill below make the database agree with the product.
--
-- Scope: `public.profiles.currency` only. No other table or column touched.
-- ============================================================================

alter table public.profiles
  alter column currency set default 'UYU';

update public.profiles set currency = 'UYU' where currency = 'USD';
