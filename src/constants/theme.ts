/**
 * Re-export the design system from `@/theme`.
 * Kept as a thin façade so legacy imports (`@/constants/theme`) keep working
 * during the transition from the template scaffold.
 */
import { light, dark, colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { radii } from '@/theme/radii';

export {
  light,
  dark,
  colors,
  palette,
  defaultColors,
  typography,
  spacing,
  radii,
  theme,
} from '@/theme';
export type { TypographyKey, SpacingKey, RadiusKey, Theme } from '@/theme';

export const Colors = { light, dark } as const;
export const Fonts = typography;
export const Spacing = spacing;
export const Radii = radii;

/**
 * Backwards-compat: the original template components typed their
 * `type` prop as a key of the active palette. The new design system
 * exposes the same keys under `colors`, so we re-export the union.
 */
export type ThemeColor = keyof typeof colors;

export const BottomTabInset = 88;
export const MaxContentWidth = 800;
