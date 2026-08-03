import { Platform, type TextStyle } from 'react-native';

/**
 * Inter is the brand font. It's not pre-loaded by `expo-font` in this
 * project, so we explicitly request `Inter` and fall back to the
 * platform system font. The OS will simply render with the default
 * family if Inter is not installed — no crash, no missing-glyph boxes.
 */
const fontFamily = Platform.select({
  ios: 'Inter',
  android: 'Inter',
  default: 'Inter',
});

const fontFamilyBold = Platform.select({
  ios: 'Inter',
  android: 'Inter',
  default: 'Inter',
});

/**
 * Type-safe style helper so consumers get RN's TextStyle type.
 */
const make = (style: TextStyle): TextStyle => style;

export const typography = {
  displayCurrency: make({
    fontFamily: fontFamilyBold,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -0.02 * 16, // -0.02em -> px
  }),
  headlineLg: make({
    fontFamily: fontFamilyBold,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.01 * 16,
  }),
  headlineLgMobile: make({
    fontFamily: fontFamilyBold,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  }),
  headlineMd: make({
    fontFamily: fontFamily,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  }),
  bodyLg: make({
    fontFamily: fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400',
  }),
  bodyMd: make({
    fontFamily: fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  }),
  labelCaps: make({
    fontFamily: fontFamilyBold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.05 * 16,
    textTransform: 'uppercase',
  }),
  labelSm: make({
    fontFamily: fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  }),
} as const;

export type TypographyKey = keyof typeof typography;
