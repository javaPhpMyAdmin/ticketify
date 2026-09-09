/**
 * Minimal test double for `@/lib/format` used by the run-rate hook harness
 * (scripts/test-run-rate-hook.mjs).
 *
 * The hook's compiled graph needs only `todayLocalISO`; stubbing it with a
 * controllable value keeps the MTD/baseline/projection math deterministic
 * (no real clock, no midnight-rollover flakiness).
 */

let _todayISO = '2026-09-08';

export function __setTodayISO(isoDate: string): void {
  _todayISO = isoDate;
}

export function todayLocalISO(): string {
  return _todayISO;
}