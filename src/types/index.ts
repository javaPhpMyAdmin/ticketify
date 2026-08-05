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

/** Card kind detected on a receipt (matches the parse-ticket edge function). */
export type CardType = 'debit' | 'credit';

export type PurchaseStatus = 'pending' | 'parsed' | 'confirmed' | 'failed';

export type CategoryKind = 'need' | 'want';

export type ScanTier = 'free' | 'pro';

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

/** Mirrors `public.scan_usage`. Composite key (user_id, year_month). */
export interface ScanUsage {
  user_id: string;
  year_month: string; // '2026-08'
  scans_used: number;
  scans_limit: number;
}

// ---------------------------------------------------------------------------
// Joined / derived types used by the UI
// ---------------------------------------------------------------------------

export interface PurchaseWithItems extends Purchase {
  store: Store | null;
  items: Array<PurchaseItem & { category: Category | null }>;
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

/** Aggregated total for the analytics screen. */
export interface CategoryMonthlyTotal {
  category_id: string;
  category_name: string;
  category_slug: string;
  total: number;
  item_count: number;
  percent_of_total: number;
}
