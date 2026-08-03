/**
 * Border radius scale. Mirrors the Tailwind `rounded` tokens from DESIGN.md.
 */
export const radii = {
  sm: 4,
  DEFAULT: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export type RadiusKey = keyof typeof radii;
