/**
 * Minimal test double for `@/features/home/hooks/useHomeFeed` used by the
 * run-rate hook harness (scripts/test-run-rate-hook.mjs).
 *
 * The real module pulls the whole home-feed graph and reads the wall clock;
 * this stub exposes only the two helpers the run-rate graph needs, with a
 * controllable `currentMonthKey` so the REQ-5a gate is deterministic (no
 * real clock, no month-rollover flakiness).
 */

let _currentMonthKey = '2026-09';

export function __setCurrentMonthKey(monthKey: string): void {
  _currentMonthKey = monthKey;
}

export function currentMonthKey(): string {
  return _currentMonthKey;
}

/**
 * Previous month bucket (`YYYY-MM`) — verbatim copy of the real
 * useHomeFeed.ts helper: string math only, December rolls to January of the
 * previous year, so the trailing-keys window stays December-safe.
 */
export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}