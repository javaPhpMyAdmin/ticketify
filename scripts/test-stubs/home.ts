/**
 * Test double for `@/features/home` in the budget-month-local harness.
 *
 * The settings screen imports `currentMonthKey` from this barrel. The stub
 * re-exports it from the REAL `useHomeFeed.ts` (NOT the pinned test stub) —
 * the whole point of the harness is exercising the real local-time month
 * derivation under controlled TZ + clock.
 */
export { currentMonthKey } from '../../src/features/home/hooks/useHomeFeed';