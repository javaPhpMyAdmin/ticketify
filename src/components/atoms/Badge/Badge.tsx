import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

export type BadgeProps = {
  /** Diameter in px. Defaults to 8 (notification dot). */
  size?: number;
  /** Background color. Defaults to `colors.danger`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tiny dot used to surface a notification count or a "new" marker.
 * Renders a perfectly round filled circle.
 */
export function Badge({ size = 8, color, style }: BadgeProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? colors.danger,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
  },
});
