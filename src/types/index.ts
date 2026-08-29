/**
 * Domain types for Ticketify.
 *
 * These mirror the PostgreSQL schema in `supabase/migrations/0001_initial_schema.sql`
 * but are also usable in client code where `jsonb` becomes `unknown` and
 * `numeric` becomes `number` (we never need sub-cent precision client-side).
 *
 * Naming convention: snake_case fields match the DB columns. The few joined
 * types (e.g. `PurchaseWithItems`) are derived shapes used by the UI layer.
 */

// ---------------------------------------------------------------------------
// Enums (match CHECK constraints in the DB)
// ---------------------------------------------------------------------------

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'apple_pay'
  | 'google_pay'
  | 'transfer'
  | 'other';

/**
 * Spanish display labels for each payment method. Single source shared by
 * the review screen's picker (`app/ticket/review/[id]`) and the export
 * builders (`features/export/normalize`) so the copy can never drift.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  transfer: 'Transferencia',
  other: 'Otro',
};

/** Card kind detected on a receipt (matches the parse-ticket edge function). */
export type CardType = 'debit' | 'credit';

export type PurchaseStatus = 'pending' | 'parsed' | 'confirmed' | 'failed';

export type CategoryKind = 'need' | 'want';

export type ScanTier = 'free' | 'pro';

/**
 * Business lifecycle of the subscription. Mirrors the DB CHECK constraint
 * in `profiles.subscription_status` (migration 0016).
 *
 * - `'none'`    — free user, no trial
 * - `'trial'`   — trial active (tier is 'pro' while trial_ends_at > now)
 * - `'active'`  — paid subscriber
 * - `'expired'` — trial expired (tier reverts to 'free', data visible, writes blocked)
 */
export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired';

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

/** Mirrors `public.profiles`. Linked 1:1 to `auth.users`. */
export interface User {
  id: string; // uuid, same as auth.users.id
  full_name: string | null;
  avatar_url: string | null;
  monthly_budget: number;
  currency: string; // ISO 4217 — 'USD', 'EUR', 'ARS'
  tier: ScanTier;
  created_at: string;
  /** Household FK — set by migration 0014 when the user joins a household. */
  household_id: string | null;
  /**
   * Business lifecycle of the subscription (migration 0016).
   * `tier` is the access-control primitive; this tracks the lifecycle.
   */
  subscription_status: SubscriptionStatus;
  /**
   * Trial expiry timestamp (migration 0016). Set on trial start, null otherwise.
   * Used for client-side offline expiry checks.
   */
  trial_ends_at: string | null;
  /**
   * Monotonic flag: true once the user has EVER made a real paid purchase
   * (migration 0021). Set server-side only (mark_ever_paid). A former paid
   * user can never start a free trial again.
   */
  ever_paid: boolean;
}

/** Mirrors `public.categories`. Global taxonomy, readable by all auth users. */
export interface Category {
  id: string;
  slug: string; // 'refrescos', 'snacks', 'limpieza'
  name: string; // 'Refrescos'
  kind: CategoryKind;
  icon: string; // SF Symbol on iOS, Material name on Android
  color: string; // hex
  sort_order: number;
}

/** Mirrors `public.stores`. `user_id === null` means a global chain. */
export interface Store {
  id: string;
  user_id: string | null;
  name: string;
  chain: string | null;
}

/** Mirrors `public.purchases`. */
export interface Purchase {
  id: string;
  user_id: string;
  store_id: string | null;
  purchase_date: string; // ISO date (YYYY-MM-DD)
  total: number;
  payment_method: PaymentMethod;
  image_url: string | null; // Supabase Storage URL
  status: PurchaseStatus;
  ai_confidence: number | null; // 0..1
  raw_ocr: unknown | null; // jsonb
  created_at: string;
}

/** Mirrors `public.purchase_items`. */
export interface PurchaseItem {
  id: string;
  purchase_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  category_id: string | null;
  is_impulse: boolean;
  sort_order: number;
}

/**
 * Mirrors `public.scan_usage`. Composite key (user_id, year_month).
 *
 * `scans_limit` is `number | null` after migration 0011 (pro-subscription
 * spec — REQ-QUOTA-2, REQ-QUOTA-3): NULL marks the row as Pro-unlimited
 * (set_profile_tier writes NULL on GRANT, 15 on REVOKE). UI consumers
 * MUST go through `computeQuotaState` so the NULL-vs-Pro distinction is
 * resolved in one place rather than scattered across components.
 */
export interface ScanUsage {
  user_id: string;
  year_month: string; // '2026-08'
  scans_used: number;
  scans_limit: number | null;
}

// ---------------------------------------------------------------------------
// Joined / derived types used by the UI
// ---------------------------------------------------------------------------

export interface PurchaseWithItems extends Purchase {
  store: Store | null;
  items: Array<PurchaseItem & { category: Category | null }>;
}

/**
 * One line item in the home-feed row shape. `category` is the category
 * SLUG (the app's item-level identity); `quantity` / `unit_price` are
 * optional because they are only present when the source provides them
 * (price-alert comparisons need the unit price).
 * `is_impulse` marks impulse purchases — the Home "snacks" callout sums
 * their line totals.
 */
export interface HomeFeedItemRow {
  /**
   * The underlying `purchase_items.id`. Optional because some producers
   * (the review flow's optimistic row, the offline test fixtures) don't
   * carry it; consumers that need to target a single row server-side
   * (e.g. `useRenameItem` on the post-scan detail screen) treat its
   * absence as "can't write".
   */
  id?: string;
  name: string;
  /** Line total (amount = quantity × unit_price when both exist). */
  amount: number;
  quantity?: number;
  unit_price?: number;
  /** Category slug, e.g. 'lacteos'. */
  category: string;
  is_impulse?: boolean;
}

/**
 * One receipt row the Home feed and the History/Analytics screens consume.
 * Shared by the receipts store list and the real read
 * (`features/home/api`), which derives the aggregates
 * from the DB rows (`category_totals` / `wants_snacks_total` are sums over
 * the line items; `scanned_at` is `purchases.created_at`).
 */
export interface HomeFeedReceiptRow {
  id: string;
  store_name: string;
  purchase_date: string; // ISO date (YYYY-MM-DD)
  /** When the ticket was captured (ISO). Orders "Recibos recientes". */
  scanned_at: string | null;
  total: number;
  image_url: string | null;
  status: PurchaseStatus;
  /**
   * Payment method, present when the read provides it (`features/home/api`
   * surfaces it from `purchases.payment_method`); producers that do not
   * carry it (e.g. the review flow's optimistic row) can omit it.
   */
  payment_method?: PaymentMethod;
  /** Impulse-items total for the receipt, when the source provides it. */
  wants_snacks_total?: number;
  /** Per-category totals (slug -> amount), when the source provides them. */
  category_totals?: Record<string, number>;
  items?: HomeFeedItemRow[];
}

/**
 * Locally-built receipt the user reviews before committing to Supabase.
 * Lives in the `useReceiptsStore` zustand store during the scan flow.
 */
export interface ReceiptDraft {
  store_name: string;
  purchase_date: string;
  total: number;
  payment_method: PaymentMethod;
  image_url: string;
  /**
   * Card network detected on the receipt (Visa, OCA, …). Optional so drafts
   * created before card detection existed still type-check; null when the
   * receipt shows no card or the brand is unknown.
   */
  card_brand?: string | null;
  /** Card kind detected on the receipt. Null when unknown/absent. */
  card_type?: CardType | null;
  items: ReviewItem[];
}

/**
 * One line item in a receipt draft. `temp_id` is a local uuid used as
 * a stable React list key — the server assigns the real id on insert.
 */
export interface ReviewItem {
  temp_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  category_id: string | null;
  is_impulse: boolean;
  ai_suggested_category_id: string | null;
}

/**
 * Per-category monthly budget limit. One row per (user, category, month).
 * Mirrors `public.category_budgets`.
 */
export interface CategoryBudget {
  user_id: string;
  category_slug: string;
  month: string; // 'YYYY-MM'
  amount: number;
}

/** Aggregated total for the analytics screen. */
export interface CategoryMonthlyTotal {
  category_id: string;
  category_name: string;
  category_slug: string;
  total: number;
  item_count: number;
  percent_of_total: number;
  /** Per-category budget limit for the month; null when no budget is set. */
  budget_limit: number | null;
}

/**
 * Price alert: a product whose unit price moved beyond the 5% threshold
 * between the previous and current month (feature-gating spec — REQ-GATE-2).
 * `receiptId` is the id of the receipt in the **current month** that hosts
 * the changed item — picked deterministically by the S2 rule in
 * `features/analytics/price-alerts.ts` (latest `purchase_date`; tie-break
 * `id` ascending). The analytics banner carries this id so a Pro tap
 * navigates straight to the receipt detail (`/receipts/:receiptId`); the
 * free path shows a Pro lock instead and pushes the paywall.
 */
export interface PriceAlert {
  /** Display name from the current-month receipt (original casing). */
  name: string;
  category: string;
  /** Unit price this month. */
  currentPrice: number;
  /** Unit price last month. */
  previousPrice: number;
  /** Signed percentage change, e.g. 9.1 for +9.1%, -3.2 for -3.2%. */
  changePct: number;
  /** Source receipt id (current month) — see S2 deterministic rule. */
  receiptId: string;
}

// ---------------------------------------------------------------------------
// Household sharing (migration 0014)
// ---------------------------------------------------------------------------

export type HouseholdRole = 'owner' | 'member';

/** Mirrors `public.households`. */
export interface Household {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

/** Mirrors `public.household_members` with denormalized profile fields. */
export interface HouseholdMember {
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  joined_at: string;
  // Denormalized from profiles for display:
  full_name?: string;
  avatar_url?: string;
}

/** Mirrors `public.invite_codes`. */
export interface InviteCode {
  id: string;
  household_id: string;
  code: string;
  created_by: string;
  expires_at: string;
  consumed_by: string | null;
  consumed_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Monthly totals cache (migration 0015)
// ---------------------------------------------------------------------------

/**
 * Materialized monthly spend totals maintained by a Postgres trigger on
 * `purchases`. Client reads a single row per (user, month) for all
 * month-scoped analytics.
 */
export interface MonthlyTotalsCacheRow {
  user_id: string;
  year_month: string;
  total: number;
  category_totals: Record<string, { total: number; count: number; name: string }>;
  store_totals: Record<string, { total: number; count: number }>;
  daily_totals: Record<string, number>; // { "2026-08-15": 1234.56 }
  items_count: number;
  updated_at: string;
}

/**
 * Level B household receipt feed item (get_household_feed RPC).
 * Totals + category breakdown + store name, no individual items.
 */
export interface HouseholdFeedItem {
  id: string;
  store_name: string | null;
  purchase_date: string;
  total: number;
  member_name: string | null;
  category_totals: Record<string, number> | null;
}

/** Extended profile with household linkage. */
export interface ProfileWithHousehold extends User {
  household_id: string | null;
}
