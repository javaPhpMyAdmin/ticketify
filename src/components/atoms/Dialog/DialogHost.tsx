/**
 * Root-mounted dialog surface. Reads `useDialogStore` and renders a
 * centered card over a dimmed overlay, animated in/out with reanimated
 * (`withTiming` opacity + scale). Mounted ONCE at the root
 * (`src/app/_layout.tsx`) so it survives route navigation — a `show()`
 * call from a screen about to `router.back()` or unmount still renders.
 *
 * Rendering approach — conditional absolute overlay View (NOT `Modal`):
 * the receipt photo fullscreen made the same swap
 * (`src/app/receipts/[id].tsx`): reanimated animations inside a native
 * `Modal` window are unreliable on Android, and gesture-handler touches
 * inside Modal windows behave inconsistently. A root-level overlay View
 * avoids both. Tradeoff vs `Modal`: RN Modals render in a separate native
 * window on both platforms, so this overlay paints BELOW any open native
 * `Modal` — callers must dismiss bottom sheets BEFORE showing a dialog
 * (this is why `CreateHouseholdModal` only alerts after its dismissal
 * animation). `BackHandler` covers the Android hardware back button in
 * place of `Modal`'s `onRequestClose`.
 *
 * Button presses mirror native alerts: the host hides the dialog first,
 * then runs the button's callback (see the store docs).
 */
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useDialogStore } from '@/stores/use-dialog-store';
import { colors, radii, spacing, typography } from '@/theme';

import { Pressable } from '../Pressable';
import { Text } from '../Text';

const OVERLAY_FADE_MS = 180;
const CARD_ENTER_MS = 240;
const CARD_EXIT_MS = 160;

export function DialogHost() {
  const visible = useDialogStore((s) => s.visible);
  const options = useDialogStore((s) => s.options);
  // Whether the overlay is mounted at all. It stays mounted during the
  // fade-out (the card still renders the previous `options`), and is
  // unmounted only after the exit animation completes.
  const [rendered, setRendered] = useState(false);
  // Store-visible mirror for the exit callback: `withTiming` callbacks run
  // on the UI thread, so the unmount guard reads the ref instead of the
  // effect-closure `visible`, which would be stale.
  const visibleRef = useRef(visible);

  const overlayOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.92);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) {
      overlayOpacity.value = withTiming(
        0,
        { duration: OVERLAY_FADE_MS, easing: Easing.in(Easing.ease) },
        (finished) => {
          // Unmount only when the fade-out ran to completion AND the
          // dialog wasn't re-opened mid-animation (a new `show()` during
          // the fade interrupts it with `finished === false`).
          if (finished && !visibleRef.current) {
            runOnJS(setRendered)(false);
          }
        },
      );
      cardScale.value = withTiming(0.95, { duration: CARD_EXIT_MS });
      return;
    }
    setRendered(true);
    overlayOpacity.value = withTiming(1, {
      duration: OVERLAY_FADE_MS,
      easing: Easing.out(Easing.ease),
    });
    cardScale.value = withTiming(1, {
      duration: CARD_ENTER_MS,
      easing: Easing.out(Easing.ease),
    });
  }, [visible, overlayOpacity, cardScale]);

  // Android hardware back: dismiss the dialog like its Cancel button,
  // never the route underneath. Replaces `Modal`'s `onRequestClose`.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      useDialogStore.getState().hide();
      return true; // consumed
    });
    return () => sub.remove();
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  if (!rendered || !options) return null;

  const hideThen = (onPress?: () => void) => {
    useDialogStore.getState().hide();
    onPress?.();
  };

  return (
    <Animated.View
      style={[styles.backdrop, overlayStyle]}
      accessibilityViewIsModal={visible}
    >
      <Animated.View style={[styles.card, cardStyle]}>
        <Text style={styles.title}>{options.title}</Text>
        {options.message ? (
          <Text style={styles.message}>{options.message}</Text>
        ) : null}

        {options.secondaryLabel ? (
          <Pressable
            onPress={() => hideThen(options.onSecondary)}
            style={styles.secondaryButton}
            accessibilityRole="button"
            accessibilityLabel={options.secondaryLabel}
          >
            <Text style={styles.secondaryButtonText}>
              {options.secondaryLabel}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => hideThen(options.onPrimary)}
          style={[
            styles.primaryButton,
            options.tone === 'danger' && styles.primaryButtonDanger,
          ]}
          accessibilityRole="button"
          accessibilityLabel={options.primaryLabel}
        >
          <Text
            style={[
              styles.primaryButtonText,
              options.tone === 'danger' && styles.primaryButtonTextDanger,
            ]}
          >
            {options.primaryLabel}
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    // Above the ToastHost (zIndex 1000 / elevation 8) so nothing paints
    // over an open dialog — the dialog is interactive and blocking.
    zIndex: 1001,
    elevation: 1001,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Outlined dismiss CTA, stacked above the primary — matches the app's
  // full-width button conventions (join/create/save CTAs).
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  primaryButtonDanger: {
    backgroundColor: colors.danger,
  },
  primaryButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  primaryButtonTextDanger: {
    color: colors.onDanger,
  },
});