/**
 * Feature data-access seam (ADR-7 — data-access spec).
 *
 * Every feature read API (profile, budget, analytics) funnels through this
 * module so the "never crash on a failed read" policy lives in exactly one
 * place. Reads are authenticated-only (scope amendment 2026-08-03): there is
 * no mode branch and no fallback data — a read either returns real data for
 * the signed-in user or a detectable error state. The `read*` helpers gate on
 * `isSupabaseConfigured`, never throw on PostgREST errors, and report a
 * discriminated status the hooks map to UI state (missing profile, read
 * failure, unconfigured).
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { CategoryBudget, CategoryMonthlyTotal, ScanUsage, User } from '@/types';

/**
 * User-safe copy shown when an authenticated read fails. Raw PostgREST text
 * must never reach the UI (same posture as the auth screens).
 */
export const READ_ERROR_MESSAGE = 'No se pudieron cargar los datos. Inténtalo de nuevo.';

/**
 * Discriminated result every feature read returns:
 *   - `ok`              — the read succeeded (`data` may be null when the row
 *                         legitimately does not exist, e.g. scan usage for a
 *                         fresh month),
 *   - `missing-profile` — the signed-in user has no `profiles` row yet,
 *   - `unconfigured`    — no real URL/anon key, reads are impossible,
 *   - `error`           — the request failed; `message` is user-safe.
 */
export type FeatureReadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'missing-profile' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

/** The signed-in user's `profiles` row (or its absence). */
export async function readProfileRow(
  userId: string,
): Promise<FeatureReadResult<User>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[read] profile failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  if (!data) return { status: 'missing-profile' };
  return { status: 'ok', data: data as User };
}

/**
 * The user's `scan_usage` row for a month. A missing row is NORMAL (a fresh
 * month has no usage yet), so it resolves to `ok` with null data instead of
 * `missing-profile`.
 */
export async function readScanUsageRow(
  userId: string,
  yearMonth: string,
): Promise<FeatureReadResult<ScanUsage | null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('scan_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (error) {
    console.warn('[read] scan usage failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as ScanUsage | null) ?? null };
}

/** The user's `profiles.monthly_budget` + `currency` (or no profile row). */
export async function readMonthlyBudgetRow(
  userId: string,
): Promise<FeatureReadResult<{ monthly_budget: number; currency: string }>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('profiles')
    .select('monthly_budget, currency')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[read] monthly budget failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  if (!data) return { status: 'missing-profile' };
  return {
    status: 'ok',
    data: data as { monthly_budget: number; currency: string },
  };
}

/**
 * The month's category totals via the `monthly_category_totals(p_year_month)`
 * RPC (ADR-7). The RPC is scoped to `auth.uid()` server-side — the client only
 * passes the year-month, never a user id. An empty result is a valid month
 * (no spending), so it resolves to `ok` with an empty array.
 */
export async function readCategoryTotals(
  yearMonth: string,
): Promise<FeatureReadResult<CategoryMonthlyTotal[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('monthly_category_totals', {
    p_year_month: yearMonth,
  });
  if (error) {
    console.warn('[read] category totals failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as CategoryMonthlyTotal[] };
}

/**
 * The month's TOTAL PAID via the `monthly_purchases_total(p_year_month)`
 * RPC — the SUM of `purchases.total` (what the user was actually charged,
 * after payment-method discounts). This is the single-total counterpart to
 * `readCategoryTotals`: the category RPC sums gross line items and cannot
 * answer "cuánto pagué" without double-counting multi-category receipts.
 * Scoped to `auth.uid()` server-side. An empty result is a valid month (no
 * confirmed purchases), so it resolves to `ok` with an empty array.
 */
export async function readMonthlyPurchasesTotal(
  yearMonth: string,
): Promise<FeatureReadResult<{ total: number }[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('monthly_purchases_total', {
    p_year_month: yearMonth,
  });
  if (error) {
    console.warn('[read] monthly purchases total failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as { total: number }[] };
}

/**
 * Read the user's category budget limits for a month. Returns an array
 * (possibly empty) — an empty array means no budgets are configured.
 */
export async function readCategoryBudgets(
  userId: string,
  yearMonth: string,
): Promise<FeatureReadResult<CategoryBudget[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('category_budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('month', yearMonth);
  if (error) {
    console.warn('[read] category budgets failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as CategoryBudget[] };
}

/**
 * Upsert category budget amounts for a month. Items with amount > 0 are
 * inserted or updated; items with amount <= 0 are deleted (clearing the
 * budget for that category). Returns `ok` on success or `error` on failure.
 */
export async function upsertCategoryBudgets(
  budgets: Array<{ category_slug: string; amount: number }>,
  yearMonth: string,
  userId: string,
): Promise<FeatureReadResult<null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };

  const toUpsert = budgets.filter((b) => b.amount > 0);
  const toDelete = budgets.filter((b) => b.amount <= 0);

  // Delete budgets that are being cleared
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('category_budgets')
      .delete()
      .eq('user_id', userId)
      .eq('month', yearMonth)
      .in(
        'category_slug',
        toDelete.map((b) => b.category_slug),
      );
    if (deleteError) {
      console.warn('[upsert] category budgets delete failed:', deleteError.code, deleteError.message);
      return { status: 'error', message: READ_ERROR_MESSAGE };
    }
  }

  // Upsert budgets with amount > 0
  if (toUpsert.length > 0) {
    const rows = toUpsert.map((b) => ({
      user_id: userId,
      category_slug: b.category_slug,
      month: yearMonth,
      amount: b.amount,
    }));
    const { error: upsertError } = await supabase
      .from('category_budgets')
      .upsert(rows, { onConflict: 'user_id,category_slug,month' });
    if (upsertError) {
      console.warn('[upsert] category budgets upsert failed:', upsertError.code, upsertError.message);
      return { status: 'error', message: READ_ERROR_MESSAGE };
    }
  }

  return { status: 'ok', data: null };
}
