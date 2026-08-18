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
import type {
  CategoryBudget,
  CategoryMonthlyTotal,
  Household,
  HouseholdFeedItem,
  HouseholdMember,
  InviteCode,
  ScanUsage,
  User,
} from '@/types';

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
  householdId?: string | null,
): Promise<FeatureReadResult<CategoryMonthlyTotal[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const params: Record<string, string> = { p_year_month: yearMonth };
  if (householdId) params.p_household_id = householdId;
  const { data, error } = await supabase.rpc('monthly_category_totals', params);
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
  householdId?: string | null,
): Promise<FeatureReadResult<{ total: number }[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const params: Record<string, string> = { p_year_month: yearMonth };
  if (householdId) params.p_household_id = householdId;
  const { data, error } = await supabase.rpc('monthly_purchases_total', params);
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

// ---------------------------------------------------------------------------
// Household sharing (migration 0014)
// ---------------------------------------------------------------------------

/**
 * Read the household the signed-in user belongs to. Joins `households`
 * through `profiles.household_id` → returns the household row or null.
 */
export async function readHouseholdInfo(
  userId: string,
): Promise<FeatureReadResult<Household | null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('household_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) {
    console.warn('[read] household profile failed:', profileErr.code, profileErr.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const profileRow = profile as Record<string, unknown> | null;
  if (!profileRow?.household_id) return { status: 'ok', data: null };
  const { data, error } = await supabase
    .from('households')
    .select('*')
    .eq('id', profileRow.household_id as string)
    .maybeSingle();
  if (error) {
    console.warn('[read] household info failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as Household | null) ?? null };
}

/**
 * Read the signed-in user's role in a household. Returns the role string
 * or null if the user is not a member (should not happen when household_id
 * is set, but we guard defensively).
 */
export async function readHouseholdRole(
  householdId: string,
  userId: string,
): Promise<FeatureReadResult<string | null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('household_members')
    .select('role')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[read] household role failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const row = data as Record<string, unknown> | null;
  return { status: 'ok', data: (row?.role as string | null) ?? null };
}

/**
 * Read all members of a household, joined with profile denorm fields
 * (full_name, avatar_url) for display.
 */
export async function readHouseholdMembers(
  householdId: string,
): Promise<FeatureReadResult<HouseholdMember[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, user_id, role, joined_at, profiles!inner(full_name, avatar_url)')
    .eq('household_id', householdId);
  if (error) {
    console.warn('[read] household members failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  const members = ((data as unknown as Array<Record<string, unknown>>) ?? []).map((row) => {
    const profile = row.profiles as Record<string, unknown> | null;
    return {
      household_id: row.household_id as string,
      user_id: row.user_id as string,
      role: row.role as HouseholdMember['role'],
      joined_at: row.joined_at as string,
      full_name: (profile?.full_name as string | null) ?? undefined,
      avatar_url: (profile?.avatar_url as string | null) ?? undefined,
    } satisfies HouseholdMember;
  });
  return { status: 'ok', data: members };
}

/**
 * Read the active (non-consumed) invite code for a household.
 * Returns the most recently created unconsumed code, or null.
 */
export async function readActiveInviteCode(
  householdId: string,
): Promise<FeatureReadResult<InviteCode | null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  // `.is()` is a valid PostgREST operator for NULL checks but the untyped
  // SupabaseClient doesn't expose it on QueryBuilder, so we cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qb: any = supabase.from('invite_codes').select('*')
    .eq('household_id', householdId);
  const { data, error } = await qb
    .is('consumed_by', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[read] active invite code failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as InviteCode | null) ?? null };
}

// ---------------------------------------------------------------------------
// Household write RPCs
// ---------------------------------------------------------------------------

/**
 * Create a new household. Calls the `create_household` RPC which inserts
 * the household row, adds the caller as owner, and sets `profiles.household_id`.
 */
export async function createHousehold(
  name: string,
): Promise<FeatureReadResult<Household>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('create_household', {
    p_name: name,
  });
  if (error) {
    console.warn('[write] create household failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as unknown as Household) };
}

/**
 * Generate an invite code for a household. Calls the `generate_invite_code`
 * RPC which rate-limits to 3 codes per 24h and returns the new code row.
 */
export async function generateInviteCode(
  householdId: string,
): Promise<FeatureReadResult<InviteCode>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('generate_invite_code', {
    p_household_id: householdId,
  });
  if (error) {
    console.warn('[write] generate invite code failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as unknown as InviteCode) };
}

/**
 * Join a household via invite code. Calls the `join_household` RPC which
 * validates the code, adds the caller as member, and sets profiles.household_id.
 * Returns the household_id on success.
 */
export async function joinHousehold(
  code: string,
): Promise<FeatureReadResult<{ household_id: string }>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('join_household', {
    p_code: code,
  });
  if (error) {
    console.warn('[write] join household failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as unknown as { household_id: string }) };
}

/**
 * Leave the current household. Calls the `leave_household` RPC which handles
 * ownership transfer (to longest-tenured member) or automatic disband if last.
 */
export async function leaveHousehold(): Promise<FeatureReadResult<void>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { error } = await supabase.rpc('leave_household');
  if (error) {
    console.warn('[write] leave household failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: undefined };
}

/**
 * Disband a household (owner only). Calls the `disband_household` RPC
 * which clears all member profiles and cascade-deletes the household.
 */
export async function disbandHousehold(
  householdId: string,
): Promise<FeatureReadResult<void>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { error } = await supabase.rpc('disband_household', {
    p_household_id: householdId,
  });
  if (error) {
    console.warn('[write] disband household failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: undefined };
}

/**
 * Read the household receipt feed (Level B — totals + categories + store
 * names, no individual items). Calls the `get_household_feed` RPC which
 * verifies membership server-side. Optional `yearMonth` filters by month.
 */
export async function readHouseholdFeed(
  householdId: string,
  yearMonth?: string | null,
): Promise<FeatureReadResult<HouseholdFeedItem[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const params: Record<string, string> = { p_household_id: householdId };
  if (yearMonth) params.p_year_month = yearMonth;
  const { data, error } = await supabase.rpc('get_household_feed', params);
  if (error) {
    console.warn('[read] household feed failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as HouseholdFeedItem[] };
}
