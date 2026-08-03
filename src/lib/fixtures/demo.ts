/**
 * Single source of truth for all demo / mock data.
 *
 * Every feature stub (see `src/features`) and the settings store
 * import from here so the app renders the same numbers everywhere.
 * Swap these values once the real Supabase wiring lands.
 */
import type { CategoryMonthlyTotal, ScanTier, ScanUsage, User } from '@/types';

/** The four analytics categories shared by the analytics hooks. */
export const categoryBreakdownRows: CategoryMonthlyTotal[] = [
  { category_id: '1', category_name: 'Groceries', category_slug: 'groceries', total: 450, item_count: 24, percent_of_total: 0.5 },
  { category_id: '2', category_name: 'Drinks', category_slug: 'refrescos', total: 85, item_count: 18, percent_of_total: 0.094 },
  { category_id: '3', category_name: 'Snacks', category_slug: 'snacks', total: 142, item_count: 32, percent_of_total: 0.158 },
  { category_id: '4', category_name: 'Cleaning', category_slug: 'limpieza', total: 64, item_count: 5, percent_of_total: 0.071 },
];

/** The demo user's monthly budget. Mirrors profiles.monthly_budget. */
export const monthlyBudget: { amount: number; currency: string } = {
  amount: 1200,
  currency: 'USD',
};

/** The demo user profile. Mirrors public.profiles. */
export const demoUser: User = {
  id: 'demo',
  full_name: 'Alex',
  avatar_url: null,
  monthly_budget: 1200,
  currency: 'USD',
  tier: 'free',
  created_at: '2026-01-01T00:00:00.000Z',
};

/** The demo user's scan usage for the current month. */
export const demoScanUsage: ScanUsage = {
  user_id: 'demo',
  year_month: '2026-08',
  scans_used: 8,
  scans_limit: 10,
};

/** Defaults for the settings store. */
export const settingsDefaults: {
  monthly_budget: number;
  currency: string;
  tier: ScanTier;
  household_sharing: boolean;
} = {
  monthly_budget: 1200,
  currency: 'USD',
  tier: 'free',
  household_sharing: false,
};
