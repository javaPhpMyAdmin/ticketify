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
  MonthlyTotalsCacheRow,
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
 * The month's IMPULSE (snacks/microgastos) total via the
 * `monthly_impulse_total(p_year_month)` RPC — the SUM of
 * `purchase_items.total_price` WHERE `is_impulse = true` across confirmed
 * purchases. Server-side aggregation so the snacks callout loads instantly,
 * not page-by-page via infinite scroll.
 * An empty result is a valid month (no impulse purchases), resolving to
 * `ok` with an empty array.
 */
export async function readMonthlyImpulseTotal(
  yearMonth: string,
  householdId?: string | null,
): Promise<FeatureReadResult<{ total: number }[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const params: Record<string, string> = { p_year_month: yearMonth };
  if (householdId) params.p_household_id = householdId;
  const { data, error } = await supabase.rpc('monthly_impulse_total', params);
  if (error) {
    console.warn('[read] monthly impulse total failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as { total: number }[] };
}

/**
 * Per-item impulse breakdown for a month via the
 * `monthly_impulse_items(p_year_month)` RPC — grouped by normalized name,
 * sorted by amount desc. Server-side so the snacks breakdown modal loads
 * all items instantly, not just those loaded via infinite scroll.
 */
export async function readMonthlyImpulseItems(
  yearMonth: string,
): Promise<FeatureReadResult<{ name: string; amount: number }[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('monthly_impulse_items', {
    p_year_month: yearMonth,
  });
  if (error) {
    console.warn('[read] monthly impulse items failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as { name: string; amount: number }[] };
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
 * User-safe copy shown when a free/expired user tries to create a
 * household (the create_household RPC requires Pro or an active trial).
 */
const CREATE_HOUSEHOLD_PRO_MESSAGE =
  'Necesitás una suscripción PRO (o un trial activo) para crear un hogar.';

/**
 * User-safe copy shown when the caller already belongs to a household (the
 * create_household RPC raises 'already in a household', migration 0017 §1).
 * Actionable: the user is blocked from creating a second household until they
 * leave their current one — telling them why unblocks the confusion instead
 * of the dead-end generic read-error copy.
 */
const ALREADY_IN_HOUSEHOLD_MESSAGE =
  'Ya pertenecés a un hogar. Salí del hogar actual para poder crear uno nuevo.';

/**
 * Create a new household. Calls the `create_household` RPC which inserts
 * the household row, adds the caller as owner, and sets `profiles.household_id`.
 * The RPC requires Pro (or an active trial); a free/expired user gets a
 * dedicated message instead of the generic read-error copy.
 */
export async function createHousehold(
  name: string,
): Promise<FeatureReadResult<Household>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('create_household', {
    p_name: name,
  });
  if (error) {
    // Log the FULL detail (code + message) for debugging — the RPC's
    // `raise exception` surfaces code P0001 with the message text, which is
    // what we key the known cases on below.
    console.error(
      '[write] create household failed:',
      error.code,
      error.message,
    );
    const message = error.message ?? '';
    if (/pro subscription required/i.test(message)) {
      return { status: 'error', message: CREATE_HOUSEHOLD_PRO_MESSAGE };
    }
    if (/already in a household/i.test(message)) {
      return { status: 'error', message: ALREADY_IN_HOUSEHOLD_MESSAGE };
    }
    // Catch-all: instead of collapsing every unknown cause into the generic
    // READ_ERROR_MESSAGE (which misled users — e.g. a transport/RPC/RLS
    // failure read as "no se pudieron cargar los datos"), surface a friendly
    // Spanish prefix WITH the underlying reason so the real cause is visible.
    const detail = message.trim() || (error.code ? `código ${error.code}` : 'error desconocido');
    return {
      status: 'error',
      message: `No se pudo crear el hogar. ${detail}`,
    };
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

// ---------------------------------------------------------------------------
// Subscription trial (migration 0016)
// ---------------------------------------------------------------------------

/**
 * Activate the user's one-time free trial. Calls the `start_free_trial`
 * RPC which sets `trial_ends_at = now() + 5 days` and
 * `subscription_status = 'trial'`. The RPC validates one-trial-per-user:
 * if `trial_ends_at IS NOT NULL`, the RPC rejects with an error.
 */
export async function startFreeTrial(): Promise<FeatureReadResult<void>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { error } = await supabase.rpc('start_free_trial');
  if (error) {
    console.warn('[write] start_free_trial failed:', error.code, error.message);
    return { status: 'error', message: error.message };
  }
  return { status: 'ok', data: undefined };
}

/**
 * Optimistically sync subscription_status to the DB after a purchase,
 * restore, or trial activation. Calls `sync_client_subscription` which
 * uses `auth.uid()` to scope the update to the caller's own profile.
 *
 * This runs BEFORE the RevenueCat webhook arrives so the local store
 * reflects the new state immediately. The webhook is the authoritative
 * sync path — this helper is a UX optimization.
 */
export async function syncSubscriptionStatus(
  status: string,
): Promise<FeatureReadResult<void>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { error } = await supabase.rpc('sync_client_subscription', {
    p_status: status,
  });
  if (error) {
    console.warn('[syncSubscriptionStatus] failed:', error.code, error.message);
    return { status: 'error', message: error.message };
  }
  return { status: 'ok', data: undefined };
}

/**
 * Materialize any overdue trial to the expired/free state, resetting the
 * current-month scan quota for affected users. Calls `expire_overdue_trials`
 * (migration 0020) — SECURITY DEFINER so it can transition tier/status and
 * reset scans even though those columns are server-managed. Idempotent:
 * users already expired are skipped. Returns the number of profiles expired.
 *
 * This is the client-side safety net on app open; the server cron runs the
 * same RPC every 6 hours for users who never open the app again.
 */
export async function expireOverdueTrials(): Promise<FeatureReadResult<number>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase.rpc('expire_overdue_trials');
  if (error) {
    console.warn('[expireOverdueTrials] failed:', error.code, error.message);
    return { status: 'error', message: error.message };
  }
  return { status: 'ok', data: (data ?? 0) as number };
}

// ---------------------------------------------------------------------------
// Monthly totals cache (migration 0015)
// ---------------------------------------------------------------------------

/**
 * Read the materialized monthly cache row for a user and month. Returns
 * null when no row exists yet (cache miss — the hook triggers a recalc).
 */
export async function readMonthlyCacheRow(
  userId: string,
  yearMonth: string,
): Promise<FeatureReadResult<MonthlyTotalsCacheRow | null>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { data, error } = await supabase
    .from('monthly_user_totals')
    .select('*')
    .eq('user_id', userId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (error) {
    console.warn('[read] monthly cache failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data as MonthlyTotalsCacheRow | null) ?? null };
}

/**
 * Batch-read cache rows for multiple year-months in a single query.
 * Used by the 6-month spend trend chart to replace the paginated
 * store aggregation with a single indexed read per month.
 */
export async function readMonthlyCacheRows(
  userId: string,
  yearMonths: string[],
): Promise<FeatureReadResult<MonthlyTotalsCacheRow[]>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  if (yearMonths.length === 0) return { status: 'ok', data: [] };
  const { data, error } = await supabase
    .from('monthly_user_totals')
    .select('*')
    .eq('user_id', userId)
    .in('year_month', yearMonths);
  if (error) {
    console.warn('[read] monthly cache batch failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: (data ?? []) as MonthlyTotalsCacheRow[] };
}

/**
 * Trigger a one-time recalculation of the monthly cache row via the
 * `recalculate_monthly_totals` RPC. Used by the hook on cache miss — the
 * hook then refetches the read to pick up the freshly computed row.
 */
export async function triggerMonthlyRecalc(
  userId: string,
  yearMonth: string,
): Promise<FeatureReadResult<void>> {
  if (!isSupabaseConfigured) return { status: 'unconfigured' };
  const { error } = await supabase.rpc('recalculate_monthly_totals', {
    p_user_id: userId,
    p_year_month: yearMonth,
  });
  if (error) {
    console.warn('[write] trigger monthly recalc failed:', error.code, error.message);
    return { status: 'error', message: READ_ERROR_MESSAGE };
  }
  return { status: 'ok', data: undefined };
}
