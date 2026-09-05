import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

import { bootSplashState, type BootSplashState } from './boot-splash-state';

const MIN_DISPLAY_MS = 900;
const FADE_OUT_MS = 250;

/**
 * Branded animated overlay shown at cold start above the app so there is no
 * blank flash between the native splash and the first painted screen.
 *
 * It intentionally owns NOTHING about the session: `_layout` still calls
 * `SplashScreen.preventAutoHideAsync()` and reconciles its own `booted`
 * state. This component only:
 *
 * 1. Hides the NATIVE splash once its own first frame is on screen
 *    (`SplashScreen.hideAsync` on mount) — closing the native/JS gap.
 * 2. Stays visible for a minimum display time so the branding reads.
 * 3. Fades itself out via `onFinish` once `booted` flips true, and the
 *    parent then unmounts it.
 *
 * Animation is RN core `Animated` only (no reanimated, no Lottie on the
 * boot path to keep native launch light).
 */
export function BootSplash({
  booted,
  onFinish,
}: {
  booted: boolean;
  onFinish?: () => void;
}) {
  const [state, dispatch] = useReducer(bootSplashState, 'visible' satisfies BootSplashState);

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const barX = useRef(new Animated.Value(-80)).current;

  // Marching dots, same pattern as the review screen labels: the dots are
  // separate native text siblings so opacity animates on the native driver
  // (nested <Text> would flatten into a single node and not animate).
  const dotOpacity = useMemo(
    () => [
      new Animated.Value(0),
      new Animated.Value(0),
      new Animated.Value(0),
    ],
    [],
  );

  // ── onFinish ref ────────────────────────────────────────────────────
  // Read through a ref so the effect fires ONCE when `booted` flips:
  // an inline parent callback would otherwise reset the min-display
  // timer on every parent re-render.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // ── Hide the native splash ──────────────────────────────────────────
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      // safe to ignore — already hidden or interrupted by another call
    });
  }, []);

  // ── Minimum-display timer → dispatches `booted` with elapsed flag ──
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'booted', minDisplayElapsed: true });
    }, MIN_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [booted]);

  // ── Fade-out when state transitions to fading ───────────────────────
  useEffect(() => {
    if (state !== 'fading') return;
    Animated.timing(fade, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(({ finished: fin }) => {
      dispatch({ type: 'fadeCompleted', finished: fin });
    });
  }, [state, fade]);

  // ── Call onFinish when we reach done (exactly once by construction) ─
  useEffect(() => {
    if (state === 'done') onFinishRef.current?.();
  }, [state]);

  // ── Decorative animation loops ──────────────────────────────────────
  // Early-return when `done` so a missing onFinish can't leave
  // native-driver loops alive forever (A5).

  // Gentle scale pulse on the logo.
  useEffect(() => {
    if (state === 'done') return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.03,
          duration: 600,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [logoScale, state]);

  // Softly fade the logo in.
  useEffect(() => {
    if (state === 'done') return;
    Animated.timing(logoOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  }, [logoOpacity, state]);

  // Marching dots loop.
  useEffect(() => {
    if (state === 'done') return;
    const loop = Animated.loop(
      Animated.stagger(220, [
        Animated.timing(dotOpacity[0], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(dotOpacity[1], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(dotOpacity[2], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(dotOpacity[0], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(dotOpacity[1], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(dotOpacity[2], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dotOpacity, state]);

  // Indeterminate loading bar: sweep forward; resetBeforeIteration rewinds
  // to the initial value (-80) automatically — no duration:0 snap-back
  // needed (A1).
  useEffect(() => {
    if (state === 'done') return;
    const sweep = Animated.loop(
      Animated.timing(barX, {
        toValue: 160,
        duration: 900,
        useNativeDriver: true,
        isInteraction: false,
      }),
      { resetBeforeIteration: true },
    );
    sweep.start();
    return () => sweep.stop();
  }, [barX, state]);

  // ── Render ──────────────────────────────────────────────────────────
  // After the fade completes, render nothing but keep the component
  // mounted until the parent unmounts it (the parent reads
  // `bootSplashVisible`). Once `done` the reducer is terminal — no
  // further state changes are possible.
  if (state === 'done') return null;

  // Allow touches beneath the overlay during the fade-out so the app
  // underneath becomes tappable immediately (A4).
  const isFading = state === 'fading';

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Cargando"
      pointerEvents={isFading ? 'none' : 'auto'}
    >
      <Animated.View
        style={[
          styles.logoWrap,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <Image
          source={require('@/../assets/images/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
      <View
        style={styles.captionRow}
        accessible
        accessibilityLabel="Cargando"
      >
        <Text style={styles.caption}>Cargando</Text>
        {/* Decorative dots: hidden from AT on both platforms. The caption
            row above announces "Cargando" as a single grouped element. */}
        <Animated.Text
          style={[styles.dot, { opacity: dotOpacity[0] }]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          .
        </Animated.Text>
        <Animated.Text
          style={[styles.dot, { opacity: dotOpacity[1] }]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          .
        </Animated.Text>
        <Animated.Text
          style={[styles.dot, { opacity: dotOpacity[2] }]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          .
        </Animated.Text>
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[styles.fill, { transform: [{ translateX: barX }] }]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // zIndex 1002: above ToastHost (1000) AND DialogHost (1001) so
    // nothing paints above the boot overlay (A6).
    zIndex: 1002,
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  logoWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  caption: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dot: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: 1,
  },
  track: {
    width: 160,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  fill: {
    width: 80,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
});
