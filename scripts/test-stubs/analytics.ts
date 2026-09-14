/**
 * Test double for `@/features/analytics` in the budget-month-local harness.
 *
 * The settings screen imports `useCategoryBudgets` and the PR 7 budget-form
 * helpers from this barrel. The stub re-exports them from the REAL modules
 * (not the barrel, which would pull in the analytics components and their
 * heavier graphs).
 */
export { useCategoryBudgets } from '../../src/features/analytics/hooks/useCategoryBudgets';
export {
  budgetKeysFromCatalog,
  budgetSavePayload,
  mergeBudgetDraftSeeds,
  seedBudgetDrafts,
} from '../../src/features/analytics/category-budget-form';