import { useEffect } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radii } from '@/theme';

export interface SkeletonProps {
  /**
   * Block width. Numbers are points; string percents (e.g. `'60%'`)
   * are relative to the parent. Defaults to `'100%'`.
   */
  width?: number | `${number}%`;
  /** Block height in points. */
  height?: number;
  /** Corner radius. Defaults to `radii.sm`. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pulse-animated placeholder block for loading states. A shared-value
 * opacity drives a cheap `withRepeat` pulse (0.55 ↔ 1) entirely on the
 * UI thread — no JS worklet per frame. Composed skeletons
 * (`MonthlyBudgetCardSkeleton`, `ReceiptRowSkeleton`, …) mirror real card
 * geometry so the layout does not jump when data lands.
 */
export function Skeleton({
  width,
  height = 14,
  radius = radii.sm,
  style,
}: SkeletonProps) {
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(opacity);
      opacity.value = 0.55;
    };
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.base,
        { width: width ?? '100%', height, borderRadius: radius },
        animatedStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceDim,
  },
});
