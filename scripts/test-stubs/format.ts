/**
 * Test double for `@/lib/format` used by the run-rate hook harness
 * (scripts/test-run-rate-hook.mjs).
 *
 * This harness only needs to override ONE symbol: `todayLocalISO`, stubbed with
 * a controllable value so the MTD/baseline/projection math is deterministic (no
 * real clock, no midnight-rollover flakiness). Everything else in
 * `@/lib/format` must be the REAL module — the settings store now reads
 * `SUPPORTED_CURRENCIES` from it (D8 hydration filter), and a hand-written
 * partial catalog here would be a second, silent source of truth. So the real
 * module is star-re-exported and the clock is overridden on top: in TypeScript
 * (and ES modules) an explicit local export SHADOWS a star-exported name, so
 * the controllable clock below always wins over the real one.
 */
export * from '../../src/lib/format';

let _todayISO = '2026-09-08';

export function __setTodayISO(isoDate: string): void {
  _todayISO = isoDate;
}

export function todayLocalISO(): string {
  return _todayISO;
}
