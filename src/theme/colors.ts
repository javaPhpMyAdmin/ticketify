/**
 * Kinetic Finance color tokens.
 * Mirrors the Stitch `DESIGN.md` palette plus the raw Material-3 tokens
 * shipped with the design (so we can opt into deeper variants later).
 *
 * The "Tailwind" palette is the primary one referenced by the spec.
 * The Material-3 palette is kept for parity with the source design.
 */

export const palette = {
  emerald500: '#10B981',
  emerald200: '#6FFFBE',
  emeraldDark: '#006C49',
  emeraldDarkContainer: '#00422B',
  charcoal: '#111827',
  coral: '#EF4444',
  coralDark: '#BA1A1A',
  offWhite: '#F8F9FA',
  white: '#FFFFFF',
  surfaceDim: '#D9DADB',
  border: '#E5E7EB',
  chipBg: '#F3F4F6',
  divider: '#1118271A',
  textSecondary: '#6C7A71',
  textSecondaryAlt: '#3C4A42',
  textOnPrimary: '#FFFFFF',
} as const;

export interface Colors {
  background: string;
  surface: string;
  surfaceDim: string;
  text: string;
  textPrimary: string;
  textSecondary: string;
  textSecondaryAlt: string;
  textInverse: string;
  primary: string;
  primaryDark: string;
  primaryContainer: string;
  onPrimary: string;
  danger: string;
  onDanger: string;
  border: string;
  divider: string;
  chipBg: string;
  inverseSurface: string;
  inverseOnSurface: string;
  /** Dark hero card background (Analytics insights hero). */
  heroBackground: string;
  /** Hero card primary text color. */
  heroText: string;
  /** Hero line chart stroke color. */
  heroLine: string;
  outline: string;
  outlineVariant: string;
}

export const light: Colors = {
  background: palette.offWhite,
  surface: palette.white,
  surfaceDim: palette.surfaceDim,
  text: palette.charcoal,
  textPrimary: palette.charcoal,
  textSecondary: palette.textSecondary,
  textSecondaryAlt: palette.textSecondaryAlt,
  textInverse: palette.white,
  primary: palette.emerald500,
  primaryDark: palette.emeraldDark,
  primaryContainer: palette.emerald200,
  onPrimary: palette.textOnPrimary,
  danger: palette.coral,
  onDanger: palette.white,
  border: palette.border,
  divider: palette.divider,
  chipBg: palette.chipBg,
  inverseSurface: '#2E3132',
  inverseOnSurface: '#F0F1F2',
  heroBackground: '#2E3132',
  heroText: '#F0F1F2',
  heroLine: palette.white,
  outline: '#6C7A71',
  outlineVariant: '#BBCABF',
};

export const dark: Colors = {
  // Dark mode is intentionally a low-effort mirror — the spec only ships
  // a light palette. We keep the same tokens so a future dark theme can
  // override without code changes in screens.
  background: '#0F1115',
  surface: '#16191F',
  surfaceDim: '#1E2229',
  text: '#F8F9FA',
  textPrimary: '#F8F9FA',
  textSecondary: '#B0B4BA',
  textSecondaryAlt: '#9AA1AB',
  textInverse: '#0F1115',
  primary: palette.emerald500,
  primaryDark: palette.emerald200,
  primaryContainer: palette.emeraldDark,
  onPrimary: '#0F1115',
  danger: palette.coral,
  onDanger: palette.white,
  border: '#2A2F38',
  divider: '#FFFFFF1A',
  chipBg: '#1E2229',
  inverseSurface: '#F0F1F2',
  inverseOnSurface: '#2E3132',
  heroBackground: '#F0F1F2',
  heroText: '#2E3132',
  heroLine: '#2E3132',
  outline: '#9AA1AB',
  outlineVariant: '#3A4049',
};

/** Convenience aggregate — `colors.primary` reads better than `light.primary` at call sites. */
export const colors: Colors = light;

export const defaultColors: Colors = light;
