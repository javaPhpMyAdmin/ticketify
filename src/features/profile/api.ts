/**
 * Profile feature — Supabase calls for the current user, scan usage
 * counters, and household sharing preferences (data-access spec).
 *
 * Reads are authenticated-only: they read the real rows
 * for the signed-in user and surface a defensive error state on failure.
 * `setProfileCurrency` writes the user's `profiles.currency` through the
 * existing `profiles_update_own` RLS policy (scoped to `auth.uid()`).
 * `setHouseholdSharing` stays a no-op: the household-sharing switch must
 * remain non-functional in this change.
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  readProfileRow,
  readScanUsageRow,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';
import type { ScanUsage, User } from '@/types';

export type ProfileReadResult = FeatureReadResult<User>;
export type ScanUsageReadResult = FeatureReadResult<ScanUsage | null>;

/**
 * User-safe copy when a profile write fails (real mode). Raw backend text
 * never reaches the user (same posture as the auth and read paths).
 */
export const WRITE_ERROR_MESSAGE = 'No se pudo guardar el cambio. Inténtalo de nuevo.';

/**
 * Discriminated result every profile write returns: `ok` on success, or
 * `error` with a user-safe message (never raw PostgREST text). The
 * `unconfigured` read status collapses into `error` here — for a write the
 * user cannot act differently on it, so one generic retry message covers
 * both an unconfigured client and a failed request.
 */
export type ProfileWriteResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

/**
 * Persists the signed-in user's `profiles.currency` (ISO 4217). Gated on
 * `isSupabaseConfigured` like the reads: an unconfigured client reports the
 * user-safe error without touching the network. The write is scoped to the
 * user's own row via `eq('id', userId)` — `profiles_update_own` enforces
 * `auth.uid() = id` server-side.
 */
export async function setProfileCurrency(
  userId: string,
  currency: string,
): Promise<ProfileWriteResult> {
  if (!isSupabaseConfigured) {
    return { status: 'error', message: WRITE_ERROR_MESSAGE };
  }
  const { error } = await supabase
    .from('profiles')
    .update({ currency })
    .eq('id', userId);
  if (error) {
    console.warn('[write] profile currency failed:', error.code, error.message);
    return { status: 'error', message: WRITE_ERROR_MESSAGE };
  }
  return { status: 'ok' };
}

/**
 * Persists the signed-in user's `profiles.monthly_budget`. Same posture as
 * `setProfileCurrency`: scoped to `auth.uid() = id` via RLS, unconfigured
 * clients return the generic `WRITE_ERROR_MESSAGE`, raw PostgREST errors
 * never reach the UI. The value is rounded to a non-negative integer before
 * sending — the home budget bar treats `monthly_budget` as a whole-number
 * cap and the input on `/settings/budget` already constrains it.
 */
export async function setProfileBudget(
  userId: string,
  amount: number,
): Promise<ProfileWriteResult> {
  if (!isSupabaseConfigured) {
    return { status: 'error', message: WRITE_ERROR_MESSAGE };
  }
  const sanitized = Math.max(0, Math.round(amount));
  const { error } = await supabase
    .from('profiles')
    .update({ monthly_budget: sanitized })
    .eq('id', userId);
  if (error) {
    console.warn('[write] profile budget failed:', error.code, error.message);
    return { status: 'error', message: WRITE_ERROR_MESSAGE };
  }
  return { status: 'ok' };
}

/** The authenticated user's `profiles` row. */
export async function fetchProfile(userId: string): Promise<ProfileReadResult> {
  return readProfileRow(userId);
}

/** The user's `scan_usage` row for a month (null when the month has none). */
export async function fetchScanUsage(
  userId: string,
  yearMonth: string,
): Promise<ScanUsageReadResult> {
  return readScanUsageRow(userId, yearMonth);
}

/**
 * Non-functional for now. A real write is out of scope for this change.
 */
export async function setHouseholdSharing(
  _userId: string,
  _enabled: boolean,
): Promise<void> {
  // TODO: real write once household sharing ships.
}
