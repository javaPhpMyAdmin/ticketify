import { type TextStyle } from 'react-native';

/**
 * No font asset is bundled here, so these tokens inherit the platform
 * system font. Naming a family we do not ship would render differently on
 * a machine that happens to have it installed than on a user's device, so
 * we name none.
 */

/**
 * Type-safe style helper so consumers get RN's TextStyle type.
 */
const make = (style: TextStyle): TextStyle => style;

export const typography = {
  displayCurrency: make({
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -0.02 * 16, // -0.02em -> px
  }),
  headlineLg: make({
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.01 * 16,
  }),
  headlineLgMobile: make({
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  }),
  headlineMd: make({
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  }),
  bodyLg: make({
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400',
  }),
  bodyMd: make({
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  }),
  labelCaps: make({
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.05 * 16,
    textTransform: 'uppercase',
  }),
  labelSm: make({
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  }),
} as const;

export type TypographyKey = keyof typeof typography;
