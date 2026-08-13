/**
 * Floating tooltip popover for the Pro charts. Positioned absolutely
 * over its parent (the chart canvas wrapper, which measures itself via
 * `onLayout`). The wrapper passes in `containerWidth` so the tooltip can
 * clamp horizontally — a tooltip flush against the right edge would
 * clip, and a long single line should never overflow the canvas.
 *
 * Animation mirrors `ToastHost`: a single `useSharedValue` drives opacity
 * with `withTiming`; the popover stays mounted during the fade-out so
 * the last `lines[]` reads as a clean disappearance instead of
 * snapping to empty.
 *
 * `pointerEvents="none"` is critical — without it the tooltip itself
 * would receive taps and re-trigger the chart's `onTouchStart`, which
 * would either re-show the same tooltip or dismiss it depending on
 * timing. The chart parent owns all tap routing.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components';
import { colors, radii, spacing } from '@/theme';

import type { TooltipState } from '../hooks/useChartTooltip';

const FADE_IN_MS = 150;
const FADE_OUT_MS = 150;
const TOOLTIP_WIDTH = 160;
const TOOLTIP_OFFSET_Y = 8;

export interface ChartTooltipProps {
  state: TooltipState;
  /** Pixel width of the parent chart wrapper — used for horizontal clamping. */
  containerWidth: number;
}

export function ChartTooltip({ state, containerWidth }: ChartTooltipProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (state.visible) {
      opacity.value = withTiming(1, {
        duration: FADE_IN_MS,
        easing: Easing.out(Easing.ease),
      });
    } else {
      opacity.value = withTiming(0, {
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.ease),
      });
    }
  }, [state.visible, state.lines, state.x, state.y, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Horizontal clamp: tooltip centers on `state.x`, but keeps at least
  // half its width inside the canvas on each side. Falls back to 0
  // when `containerWidth` hasn't been measured yet — without a real
  // width the clamp would clamp to a meaningless edge.
  const safeWidth = Math.max(containerWidth, TOOLTIP_WIDTH);
  const halfWidth = TOOLTIP_WIDTH / 2;
  const clampedLeft = Math.max(
    halfWidth,
    Math.min(safeWidth - halfWidth, state.x),
  );

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      style={[
        styles.tooltip,
        // `top: state.y - 8` lifts the tooltip above the touch point —
        // tapping a bar's center should pop the tooltip above (not on)
        // the bar so the value remains readable.
        { top: state.y - TOOLTIP_OFFSET_Y, left: clampedLeft - halfWidth },
        animatedStyle,
      ]}
    >
      <View style={styles.inner}>
        {state.lines.map((line, idx) => (
          <Text
            key={`${idx}-${line}`}
            style={[
              styles.line,
              idx === 0 ? styles.lineHeader : styles.lineBody,
            ]}
            numberOfLines={1}
          >
            {line}
          </Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_WIDTH,
    alignItems: 'center',
  },
  inner: {
    backgroundColor: colors.inverseSurface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    // `gap` works on `View` in RN 0.81+, but per-row Text spacing also
    // reads cleanly via `lineHeight` so both render predictably.
    gap: 2,
    maxWidth: TOOLTIP_WIDTH,
  },
  line: {
    color: colors.inverseOnSurface,
    textAlign: 'center',
  },
  lineHeader: {
    fontSize: 13,
    fontWeight: '700',
  },
  lineBody: {
    fontSize: 13,
    fontWeight: '500',
  },
});
