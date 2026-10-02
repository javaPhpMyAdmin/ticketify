/**
 * Single import surface for the design system.
 * Prefer `import { colors, spacing, typography, radii, motion } from '@/theme'`.
 */
import { light, dark, colors, palette, defaultColors, type Colors } from './colors';
import { typography, type TypographyKey } from './typography';
import { spacing, type SpacingKey } from './spacing';
import { radii, type RadiusKey } from './radii';
import { motion, type MotionTokens } from './motion';

export {
  light,
  dark,
  colors,
  palette,
  defaultColors,
  typography,
  spacing,
  radii,
  motion,
};
export type { Colors, TypographyKey, SpacingKey, RadiusKey, MotionTokens };

export const theme = {
  colors: light,
  spacing,
  radii,
  typography,
  motion,
} as const;

export type Theme = typeof theme;
