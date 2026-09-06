/**
 * Harness alias for the `@/features/home` barrel in the drill-down render
 * harness.
 *
 * The REAL barrel re-exports feature components (ScanQuotaCard,
 * CategoryBudgetCard, SegmentedBudgetBar…) that pull in pro/profile modules
 * the plain-node harness cannot load. The screen only imports
 * `monthKeyToLabel` + `useCategoryDetail`, so this alias re-exports those
 * from the REAL compiled hook module (the same instance every other harness
 * suite loads — shares the queryClient singleton and the supabase double).
 */
export {
  monthKeyToLabel,
  useCategoryDetail,
} from '../../src/features/home/hooks/useHomeFeed';