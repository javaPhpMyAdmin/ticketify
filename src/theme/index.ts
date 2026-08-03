/**
 * Single import surface for the design system.
 * Prefer `import { colors, spacing, typography, radii } from '@/theme'`.
 */
import { light, dark, colors, palette, defaultColors, type Colors } from './colors';
import { typography, type TypographyKey } from './typography';
import { spacing, type SpacingKey } from './spacing';
import { radii, type RadiusKey } from './radii';

export { light, dark, colors, palette, defaultColors, typography, spacing, radii };
export type { Colors, TypographyKey, SpacingKey, RadiusKey };

export const theme = {
  colors: light,
  spacing,
  radii,
  typography,
} as const;

export type Theme = typeof theme;
