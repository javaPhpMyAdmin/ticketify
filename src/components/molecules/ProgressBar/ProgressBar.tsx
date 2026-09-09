import { StyleSheet } from 'react-native';

import { View } from '@/components/atoms';
import { colors, radii } from '@/theme';

export interface ProgressBarProps {
  /** 0..1. Values outside the range are clamped. */
  value: number;
  color?: string;
  height?: number;
  trackColor?: string;
  /**
   * Accessibility label describing the progress (e.g. "Gastaste $50.000 de
   * $100.000 en Supermercado"). When provided the bar becomes an accessible
   * element for screen readers; without it the bar stays invisible to them.
   */
  accessibilityLabel?: string;
}

/**
 * Thick (8px) progress bar with a 10%-opacity charcoal track and an
 * emerald fill. The fill is implemented as a flex child so it animates
 * smoothly with `LayoutAnimation` if the parent wraps it. When an
 * `accessibilityLabel` is provided, the fill carries it (accessible element
 * on the fill, whose width encodes the value being described).
 */
export function ProgressBar({
  value,
  color,
  height = 8,
  trackColor,
  accessibilityLabel,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const fill = color ?? colors.primary;
  const track = trackColor ?? colors.divider;
  return (
    <View
      style={[
        styles.track,
        { height, borderRadius: height / 2, backgroundColor: track },
      ]}
    >
      <View
        accessibilityLabel={accessibilityLabel}
        accessible={accessibilityLabel !== undefined}
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
});
