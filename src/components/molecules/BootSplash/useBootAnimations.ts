import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import type { BootSplashState } from './boot-splash-state';

// Animation durations (per the kinetic-finance reference timing).
// Three loops + the bob + the pulse dot stay on the native driver
// (`useNativeDriver: true`) with `isInteraction: false` so the boot
// path is never blocked by a JS-thread callback.
const SWEEP_DURATION_MS = 2200;
const FLOAT_DURATION_MS = 3600;
const SCAN_BEAM_DURATION_MS = 2800;
const PULSE_DOT_DURATION_MS = 1000; // ~0.5 s on + ~0.5 s off ≈ 1 s round trip
const LOGO_FADE_IN_MS = 400;

export interface BootAnimations {
  // Raw values — kept around for any consumer-side interpolation.
  logoOpacity: Animated.Value;
  bob: Animated.Value;
  scan: Animated.Value;
  sweep: Animated.Value;
  pulseDot: Animated.Value;
  // Interpolated outputs the JSX layer consumes directly.
  bobTranslateY: Animated.AnimatedInterpolation<number>;
  bobScale: Animated.AnimatedInterpolation<number>;
  scanTranslateY: Animated.AnimatedInterpolation<number>;
  scanOpacity: Animated.AnimatedInterpolation<number>;
  sweepTranslateX: Animated.AnimatedInterpolation<number>;
  sweepLeadingFade: Animated.AnimatedInterpolation<number>;
}

/**
 * Cold-boot animation bundle for `<BootSplash>`.
 *
 * Encapsulates the 5 decorative loops (logo fade-in, float bob,
 * scan-beam shimmer, sweep gradient, pulse dot) so the component
 * body stays focused on the reducer + the status cycle wiring. Every
 * loop is `useNativeDriver: true` + `isInteraction: false`; the
 * `state === 'done'` early-return on `state` lets each effect
 * self-clean via the cleanup return when the splash finishes.
 *
 * Cleanup contract: every loop owns its own `return () => loop.stop()`
 * (or `return () => timing.stop()` for the one-shot fade-in). The
 * hook intentionally does NOT expose a top-level `cleanup()` — the
 * lifecycle is managed by each individual `useEffect`'s cleanup
 * return (which fires on unmount or dep change). A previous review
 * flagged a stale `cleanup` field on this hook that no caller
 * invoked; we dropped it and added defensive `.stop()` to the
 * logo fade-in one-shot so a torn-down BootSplash never leaks an
 * in-flight timing into the bridge.
 *
 * The status cycle effect (owning `setStatusIndex` + the i18n
 * messages) lives in `BootSplash` itself — it depends on local
 * React state, not just an Animated value, so it doesn't belong in
 * this hook.
 */
export function useBootAnimations(state: BootSplashState): BootAnimations {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  // Float bob — single Animated.Value drives both translateY (0..-8)
  // and scale (1..1.015) via two interpolations off the same loop
  // (one value, two mapped outputs — keeps the loop atomic).
  const bob = useRef(new Animated.Value(0)).current;
  const bobTranslateY = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });
  const bobScale = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.015],
  });
  // Scan-beam shimmer — translateY -110% → 220% with a 4-stop opacity
  // ramp (0 → 0.9 @15% → 0.9 @50% → 0). All four lanes produced from
  // one progress value so the animation stays native-driver compatible.
  const scan = useRef(new Animated.Value(0)).current;
  const scanTranslateY = scan.interpolate({
    inputRange: [0, 1],
    outputRange: [-110, 220],
  });
  const scanOpacity = scan.interpolate({
    inputRange: [0, 0.15, 0.5, 1],
    outputRange: [0, 0.9, 0.9, 0],
  });
  // Progress sweep — fixed 40% fill, translateX -100% → 280% on a
  // cubic-bezier with a soft leading-edge opacity ride.
  const sweep = useRef(new Animated.Value(0)).current;
  const sweepTranslateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 280],
  });
  const sweepLeadingFade = sweep.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.7, 1, 0.7],
  });
  // Pulsing emerald dot beside the headline.
  const pulseDot = useRef(new Animated.Value(1)).current;

  // Float bob — translateY + scale via a single Easing.inOut sequence.
  useEffect(() => {
    if (state === 'done') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: FLOAT_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: FLOAT_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, state]);

  // Scan-beam shimmer — cubic-bezier(0.4, 0, 0.2, 1).
  useEffect(() => {
    if (state === 'done') return;
    const loop = Animated.loop(
      Animated.timing(scan, {
        toValue: 1,
        duration: SCAN_BEAM_DURATION_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
        isInteraction: false,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [scan, state]);

  // Sweep gradient bar — cubic-bezier(0.65, 0, 0.35, 1).
  useEffect(() => {
    if (state === 'done') return;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_DURATION_MS,
        easing: Easing.bezier(0.65, 0, 0.35, 1),
        useNativeDriver: true,
        isInteraction: false,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, state]);

  // Pulsing emerald dot — opacity 1 → 0.4 → 1 round trip.
  useEffect(() => {
    if (state === 'done') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseDot, {
          toValue: 0.4,
          duration: PULSE_DOT_DURATION_MS / 2,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(pulseDot, {
          toValue: 1,
          duration: PULSE_DOT_DURATION_MS / 2,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseDot, state]);

  // Soft logo fade-in on first mount — one-shot. The `.stop()` on
  // cleanup is defensive: an in-flight timing that's later cancelled
  // (e.g. splash torn down before the 400 ms fade completes) won't
  // leak a callback into the bridge.
  useEffect(() => {
    if (state === 'done') return;
    const timing = Animated.timing(logoOpacity, {
      toValue: 1,
      duration: LOGO_FADE_IN_MS,
      useNativeDriver: true,
      isInteraction: false,
    });
    timing.start();
    return () => timing.stop();
  }, [logoOpacity, state]);

  return {
    logoOpacity,
    bob,
    scan,
    sweep,
    pulseDot,
    bobTranslateY,
    bobScale,
    scanTranslateY,
    scanOpacity,
    sweepTranslateX,
    sweepLeadingFade,
  };
}
