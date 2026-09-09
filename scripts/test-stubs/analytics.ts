/**
 * Test double for `@/features/analytics` in the budget-month-local harness.
 *
 * The settings screen imports `useCategoryBudgets` from this barrel. The
 * stub re-exports it from the REAL hook file (not the barrel, which would
 * pull in the analytics components and their heavier graphs).
 */
export { useCategoryBudgets } from '../../src/features/analytics/hooks/useCategoryBudgets';