import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { View } from '@/components/atoms';
import { colors, radii, spacing } from '@/theme';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Override the default 16px padding (e.g. 0 for tight list rows). */
  padding?: number;
  /** Override the default 1px border color. */
  borderColor?: string;
}

/**
 * White card with 16px radius, 1px border, 16px padding.
 * Matches the "Tonal Layering" pattern from DESIGN.md — pure white
 * cards on the off-white background, no shadow.
 */
export function Card({ children, style, padding = spacing.lg, borderColor }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        { padding, borderColor: borderColor ?? colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    // Cross-platform soft elevation (RN 0.76+ boxShadow works on both
    // iOS and Android without platform-specific shadow props).
    // Light from top-left, so the shadow falls bottom-right only.
    // Small offsets + tight blur keep it subtle; alpha 0.3 reads as a
    // real shadow instead of a gray smudge.
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
  },
});
