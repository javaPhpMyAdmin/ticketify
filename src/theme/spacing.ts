/**
 * Spacing scale. Named semantically rather than by t-shirt size
 * so the intent at the call site is obvious (e.g. `spacing.lg` vs `spacing.xxl`).
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  safeBottom: 34,
} as const;

export type SpacingKey = keyof typeof spacing;
