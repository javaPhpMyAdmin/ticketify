/**
 * Single source of truth for all demo / mock data.
 *
 * Every feature stub (see `src/features`) and the settings store
 * import from here so the app renders the same numbers everywhere.
 * Swap these values once the real Supabase wiring lands.
 */
import type { CategoryMonthlyTotal, ScanTier, ScanUsage, User } from '@/types';

/**
 * Demo-read boundary (demo-mode spec: "no fixture leakage in authenticated
 * reads").
 *
 * INTERIM STATE (Phase 3): returns `true` unconditionally — the Supabase
 * reads are not wired yet, so every feature read (`profile`, `budget`,
 * `analytics`) returns fixtures to BOTH modes and a signed-in profile
 * currently renders the demo user. The demo harness asserts this interim
 * state; screens must NOT be assumed to render real data in authenticated
 * mode yet.
 *
 * PHASE 4 HARD REQUIREMENT (tasks 4.1-4.6): flip this seam to be mode-aware
 * (`mode === 'demo'` via `useAuthMode()`) and make the feature APIs consult
 * it before falling back to fixtures, so authenticated mode reads Supabase
 * data and never renders demo fixtures. Do not remove this seam or make it
 * return `false` before the reads are wired — that would silently promise
 * authenticated reads that do not exist yet. The mode-aware seam must also
 * honor the RESTORE mode: `restore()` keeps an explicit demo choice across
 * relaunches even with a stored session, so the seam must read the live
 * store mode (already reconciled at bootstrap), never re-derive it from
 * session presence.
 */
export function isDemoFixturesOnly(): boolean {
  return true;
}

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

// ---------------------------------------------------------------------------
// Home screen (kept demo-only by design; purchase-list reads are out of scope)
// ---------------------------------------------------------------------------

/** One entry in the home screen's "Recent Receipts" card. */
export interface ReceiptSummary {
  id: string;
  name: string;
  date: string; // ISO
  amount: number;
}

/** The demo user's recent receipts, shown on the home screen. */
export const recentReceipts: ReceiptSummary[] = [
  { id: 'r1', name: 'Whole Foods Market', date: '2026-08-02', amount: 42.18 },
  { id: 'r2', name: 'Café Martinez', date: '2026-08-01', amount: 7.5 },
  { id: 'r3', name: 'Kiosco 24hs', date: '2026-07-30', amount: 3.2 },
];

/** One spending-category card in the home screen's horizontal strip. */
export interface HomeCategory {
  name: string;
  amount: number;
  icon: 'sparkles';
}

/** The home screen's category cards. Amounts mirror `categoryBreakdownRows`. */
export const homeCategories: HomeCategory[] = [
  { name: 'Groceries', amount: 450, icon: 'sparkles' },
  { name: 'Drinks', amount: 85, icon: 'sparkles' },
  { name: 'Snacks', amount: 142, icon: 'sparkles' },
];

/** The "wants" total the budget card compares against snacks spending. */
export const wantsSnacksTotal = 142;

// ---------------------------------------------------------------------------
// History screen
// ---------------------------------------------------------------------------

/** One transaction row in the history screen. */
export interface HistoryEntry {
  id: string;
  merchant: string;
  date: string; // ISO
  category: string;
  needs: number;
  wants: number;
  income: number;
}

/** The demo user's transaction history. Mirrors `recentReceipts` amounts. */
export const historyEntries: HistoryEntry[] = [
  { id: '1', merchant: 'Whole Foods Market', date: '2026-08-03T12:30:00', category: 'Groceries', needs: 42.18, wants: 0, income: 0 },
  { id: '2', merchant: 'Café Martinez', date: '2026-08-03T09:15:00', category: 'Drinks', needs: 0, wants: 7.5, income: 0 },
  { id: '3', merchant: 'Kiosco 24hs', date: '2026-08-02T20:00:00', category: 'Snacks', needs: 0, wants: 3.2, income: 0 },
  { id: '4', merchant: 'Salary', date: '2026-08-01T08:00:00', category: 'Income', needs: 0, wants: 0, income: 2200 },
  { id: '5', merchant: 'Carrefour', date: '2026-07-31T18:30:00', category: 'Cleaning', needs: 18.4, wants: 0, income: 0 },
];
