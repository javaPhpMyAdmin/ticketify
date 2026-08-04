/**
 * Profile feature — Supabase calls for the current user, scan usage
 * counters, and household sharing preferences (data-access spec).
 *
 * Reads are authenticated-only: they read the real rows
 * for the signed-in user and surface a defensive error state on failure.
 * `setHouseholdSharing` stays a no-op: the household-sharing switch must
 * remain non-functional in this change.
 */
import {
  readProfileRow,
  readScanUsageRow,
  type FeatureReadResult,
} from '@/lib/supabase/feature-access';
import type { ScanUsage, User } from '@/types';

export type ProfileReadResult = FeatureReadResult<User>;
export type ScanUsageReadResult = FeatureReadResult<ScanUsage | null>;

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
