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
  const variant = useToastStore((s) => s.variant);
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  // The last non-null message + variant: during the fade-out
  // (`current === null`) the label still renders the previous text (and the
  // pill keeps its previous color) so the animation doesn't collapse onto
  // an empty string or snap to the dark pill mid-fade.
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [lastVariant, setLastVariant] = useState<'default' | 'success'>(
    'default',
  );

  useEffect(() => {
    if (current) {
      setLastMessage(current);
      setLastVariant(variant);
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
  }, [current, opacity, variant]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Fade-out renders with the last shown variant; an in-flight toast uses
  // the store's current variant.
  const activeVariant = current !== null ? variant : lastVariant;
  const isSuccess = activeVariant === 'success';

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityElementsHidden={!current}
      style={[
        styles.host,
        { top: insets.top + spacing.md },
        isSuccess && styles.hostSuccess,
        animatedStyle,
      ]}
    >
      <Text
        style={[styles.label, isSuccess && styles.labelSuccess]}
        numberOfLines={2}
      >
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
  // Success variant: emerald pill so a confirmed save reads as positive
  // feedback at a glance (same primary pairing as the FAB and CTA buttons).
  hostSuccess: {
    backgroundColor: colors.primary,
  },
  label: {
    ...typography.labelSm,
    color: colors.inverseOnSurface,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelSuccess: {
    color: colors.onPrimary,
  },
});