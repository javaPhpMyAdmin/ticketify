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
import type { CategoryMonthlyTotal, ScanUsage, User } from '@/types';

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
