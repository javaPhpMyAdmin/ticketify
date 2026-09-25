import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { SplashBrandMark } from '@/components/atoms/SplashBrandMark';
import { colors, radii, spacing, typography } from '@/theme';

import { bootSplashState, type BootSplashState } from './boot-splash-state';
import { pickStatusIndex } from './status-cycle';
import { useBootAnimations } from './useBootAnimations';

// Minimum display time BEFORE the booted state is honored: ~7 s so the
// branded animation reads ("the user wants ~7 s"). The fade-out then
// runs on top (FADE_OUT_MS). Per-tick visual refresh (status cycle,
// scan beam, bob, sweep) lives on independent Animated loops so the
// timing budget never starves the native driver.
const MIN_DISPLAY_MS = 7000;
const FADE_OUT_MS = 250;

// Status message cycle slot length — INDEPENDENT from the min-display
// timer. The cycle keeps ticking even after `booted` fires; it just
// stops being visible once the overlay fades.
const STATUS_SLOT_MS = 2400;

// App version surfaced in the top-right pill. `nativeAppVersion` works
// in both dev (binary version) and prod (EAS-built) because it reads
// the bundled native metadata rather than `app.json`, which is unset
// in dev. Fall back to `expoConfig.version` when the native value is
// missing (Expo Go or bare RN w/ `expo` not installed).
const APP_VERSION =
  Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '';

/**
 * Branded animated overlay shown at cold start above the app so there
 * is no blank flash between the native splash and the first painted
 * screen.
 *
 * Animation contract (verified by `scripts/test-boot-splash.mjs`):
 *
 *   - Pure RN core `Animated` only — no `reanimated` worklet
 *     runtime, no Lottie. The brand mark is a static `<SplashBrandMark>`
 *     SVG (also free of worklet hooks) so the very first JS frame
 *     carries zero JSI runtime setup cost.
 *   - Every loop on the native driver (`useNativeDriver: true`),
 *     `isInteraction: false`.
 *   - Every loop early-returns when the reducer reaches `done`,
 *     so a missing `onFinish` can never leave native-driver loops
 *     alive forever (A5).
 *   - Status cycle reads the current index through a ref to dodge
 *     a stale-closure / dep-bug class that pinned `statusIndex` in
 *     the cycle effect's deps array — once caught, twice not.
 *
 * Session ownership: NONE. `_layout` still calls
 * `SplashScreen.preventAutoHideAsync()` and reconciles its own
 * `booted` state. This component only hides the native splash,
 * honors the min-display time, and fades itself out.
 */
export function BootSplash({
  booted,
  onFinish,
}: {
  booted: boolean;
  onFinish?: () => void;
}) {
  const { t } = useTranslation('bootSplash');
  const [state, dispatch] = useReducer(
    bootSplashState,
    'visible' satisfies BootSplashState,
  );

  // ── Fade-out Animated.Value (stays at the component level because
  // it pairs with the reducer's `fading` state). ────────────────────
  const fade = useRef(new Animated.Value(1)).current;

  // ── 5 decorative loops encapsulated by the hook. ──────────────────
  const anim = useBootAnimations(state);

  // ── Status cycle state ────────────────────────────────────────────
  const statusFade = useRef(new Animated.Value(1)).current;
  const [statusIndex, setStatusIndex] = useState(0);
  // Cycle start captured at mount + on locale flip. The interval
  // callback reads the current index via a ref (`statusIndexRef`)
  // so its closure doesn't capture a stale value.
  const statusCycleStartRef = useRef<number>(0);
  const statusIndexRef = useRef(0);
  // Mirror `statusIndex` into the ref via a tiny useEffect so the
  // interval callback below reads the latest committed value without
  // re-creating the interval (see dep-bug regression in
  // scripts/test-boot-splash.mjs).
  useEffect(() => {
    statusIndexRef.current = statusIndex;
  }, [statusIndex]);

  const statusMessages = useMemo(
    () => [t('statusLoadingFinancial'), t('statusSyncingTickets'), t('statusReadyToScan')],
    [t],
  );

  // ── onFinish ref (parent callback stability) ──────────────────────
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // ── Hide the native splash once the first frame is on screen ─────
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      // safe to ignore — already hidden or interrupted by another call
    });
  }, []);

  // ── Status cycle timer (independent from the boot gate timer) ─────
  // Critical: `statusIndex` is NOT a dep — the interval reads the
  // current index via `statusIndexRef.current`, so re-renders driven
  // by `setStatusIndex` never re-create the interval (and never
  // reset `statusCycleStartRef.current`).
  useEffect(() => {
    if (state === 'done') return;
    statusCycleStartRef.current = Date.now();
    statusIndexRef.current = 0;
    setStatusIndex(0);
    const interval = setInterval(() => {
      const next = pickStatusIndex(
        statusCycleStartRef.current,
        Date.now(),
        STATUS_SLOT_MS,
        statusMessages.length,
      );
      if (next === statusIndexRef.current) return;
      // 250ms fade-out → swap → 250ms fade-in (single Animated.value).
      Animated.timing(statusFade, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
        isInteraction: false,
      }).start(({ finished }) => {
        if (!finished) return;
        statusIndexRef.current = next;
        setStatusIndex(next);
        Animated.timing(statusFade, {
          toValue: 1,
          duration: FADE_OUT_MS,
          useNativeDriver: true,
          isInteraction: false,
        }).start();
      });
    }, STATUS_SLOT_MS);
    return () => clearInterval(interval);
  }, [statusMessages, statusFade, state]); // statusIndex intentionally OMITTED (see comment + regression pin)

  // ── Minimum-display timer → dispatches `booted` with elapsed flag ──
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'booted', minDisplayElapsed: true });
    }, MIN_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [booted]);

  // ── Fade-out when state transitions to fading ───────────────────────
  // Defensive cleanup: if the component unmounts mid-fade, stop the
  // Animated.Value so we don't leak a finished-then-unmounted timing.
  useEffect(() => {
    if (state !== 'fading') return;
    const timing = Animated.timing(fade, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    });
    timing.start(({ finished: fin }) => {
      dispatch({ type: 'fadeCompleted', finished: fin });
    });
    return () => timing.stop();
  }, [state, fade]);

  // ── Call onFinish when we reach done (exactly once by construction) ─
  useEffect(() => {
    if (state === 'done') onFinishRef.current?.();
  }, [state]);

  // ── Render ──────────────────────────────────────────────────────────
  if (state === 'done') return null;

  // Allow touches beneath the overlay during the fade-out so the app
  // underneath becomes tappable immediately (A4).
  const isFading = state === 'fading';

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      accessibilityRole="progressbar"
      accessibilityLabel={t('loadingA11y')}
      pointerEvents={isFading ? 'none' : 'auto'}
    >
      {/* Version badge — top-right, label-caps tiny, 60% opacity. */}
      <View style={styles.versionBadge}>
        <Text style={styles.versionBadgeText}>
          {t('versionBadge')}
          {APP_VERSION}
        </Text>
      </View>

      <View style={styles.brandColumn}>
        <Animated.View
          style={[
            styles.brandCard,
            {
              opacity: anim.logoOpacity,
              transform: [
                { translateY: anim.bobTranslateY },
                { scale: anim.bobScale },
              ],
            },
          ]}
        >
          <View style={styles.brandCardInner}>
            {/* Translucent white shimmer that sweeps over the emerald
                ticket (matches the reference HTML's
                `via-white/45` gradient strip on the dark surface). */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.scanBeam,
                {
                  transform: [{ translateY: anim.scanTranslateY }],
                  opacity: anim.scanOpacity,
                },
              ]}
            />
            <SplashBrandMark size={104} />
          </View>
        </Animated.View>

        <View style={styles.headlineRow}>
          <Text style={styles.headline}>Ticketify</Text>
          <Animated.View
            style={[styles.pulseDot, { opacity: anim.pulseDot }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
        <Text style={styles.tagline}>{t('tagline')}</Text>
      </View>

      <View style={styles.statusBlock}>
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                transform: [{ translateX: anim.sweepTranslateX }],
                opacity: anim.sweepLeadingFade,
              },
            ]}
          />
        </View>
        <Animated.Text
          style={[styles.statusText, { opacity: statusFade }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {statusMessages[statusIndex]}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

// Shimmer highlight for the scan-beam (translucent white over the
// emerald ticket body). Single-use token — defined here, not promoted
// to `colors.ts`, because no other component animates this exact
// surface. Mirrors the reference HTML's `via-white/45` gradient.
const SCAN_BEAM_TINT = 'rgba(255, 255, 255, 0.45)';
// Lighter emerald edges sandwiching the brand gradient fill — fakes
// the multi-stop `from-primary via-lighter to-primary` sweep from
// the reference. RN core doesn't interpolate CSS
// `linear-gradient(...)` backgrounds on the native driver, so we
// emulate with two soft side-borders.
const GRADIENT_LIGHT = 'rgba(110, 255, 190, 0.55)';

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
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  versionBadge: {
    alignSelf: 'flex-end',
    opacity: 0.6,
  },
  versionBadgeText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  brandColumn: {
    alignItems: 'center',
    gap: spacing.md,
  },
  brandCard: {
    width: 128,
    height: 128,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  brandCardInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  scanBeam: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '50%',
    backgroundColor: SCAN_BEAM_TINT,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: -0.01,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  tagline: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  statusBlock: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  track: {
    width: '100%',
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  fill: {
    width: '40%',
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    borderColor: GRADIENT_LIGHT,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  statusText: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 12,
  },
});
