import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

export type DividerProps = {
  /** Override the line color. Defaults to `colors.divider`. */
  color?: string;
  /** Override the line height. Defaults to 1. */
  thickness?: number;
  /** Optional extra vertical spacing on each side. */
  spacing?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * 1px hairline divider. Useful between list rows or under section
 * headers. Renders transparent when `thickness` is 0.
 */
export function Divider({
  color,
  thickness = 1,
  spacing: extra,
  style,
}: DividerProps) {
  return (
    <View
      style={[
        styles.base,
        {
          height: thickness,
          backgroundColor: color ?? colors.divider,
          marginVertical: extra ?? 0,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
  },
});
