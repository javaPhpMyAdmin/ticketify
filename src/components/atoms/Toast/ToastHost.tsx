/**
 * Root-mounted toast surface. Reads `useToastStore.current` and renders a
 * reanimated fade in/out when the message changes. Mounted ONCE at the
 * root (`src/app/_layout.tsx`) so it survives route navigation — a
 * `show()` call from the review screen right before `router.back()`
 * keeps the toast visible on the destination screen.
 *
 * Animation mirrors the `Skeleton` atom: a single `useSharedValue` for
 * opacity drives a `withTiming` on the UI thread (no JS per frame).
 *
 * `accessibilityLiveRegion="polite"` so screen readers announce new
 * messages without interrupting the current read.
 */
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToastStore } from '@/stores/use-toast-store';
import { colors, radii, spacing, typography } from '@/theme';

import { Text } from '../Text';

const FADE_IN_MS = 180;
const FADE_OUT_MS = 180;

export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  // The last non-null message: during the fade-out (`current === null`)
  // the label still renders the previous text so the animation doesn't
  // collapse onto an empty string mid-fade.
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (current) {
      setLastMessage(current);
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
  }, [current, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityElementsHidden={!current}
      style={[
        styles.host,
        { top: insets.top + spacing.md },
        animatedStyle,
      ]}
    >
      <Text style={styles.label} numberOfLines={2}>
        {current ?? lastMessage ?? ''}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.inverseSurface,
    // `zIndex` keeps the toast above the Stack navigator content even
    // when the current route is a modal (presentation: 'modal').
    zIndex: 1000,
    elevation: 8,
  },
  label: {
    ...typography.labelSm,
    color: colors.inverseOnSurface,
    fontWeight: '600',
    textAlign: 'center',
  },
});