/**
 * Profile feature — Supabase calls for the current user, scan usage
 * counters, and household sharing preferences.
 *
 * TODO: replace the stubs with real reads/writes once auth is wired.
 */
import type { ScanUsage, User } from '@/types';
import { demoScanUsage, demoUser } from '@/lib/fixtures/demo';

export async function fetchProfile(_userId: string): Promise<User | null> {
  // TODO: Supabase call.
  // const { data, error } = await supabase
  //   .from('profiles')
  //   .select('*')
  //   .eq('id', _userId)
  //   .single();
  // if (error) return null;
  // return data;
  return demoUser;
}

export async function fetchScanUsage(
  _userId: string,
  _yearMonth: string,
): Promise<ScanUsage | null> {
  // TODO: Supabase call.
  return demoScanUsage;
}

export async function setHouseholdSharing(
  _userId: string,
  _enabled: boolean,
): Promise<void> {
  // TODO: Supabase call.
}
