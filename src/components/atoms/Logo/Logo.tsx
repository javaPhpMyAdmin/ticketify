import { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Mask,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

export interface LogoProps {
  /**
   * Logo box size in points (the mark is a 512x512 square). Defaults to 132,
   * inside the 120-160pt band the ticket mark reads best at.
   */
  size?: number;
  /**
   * Mount-time entrance animation (fade 0->1, scale 0.9->1, gentle rise).
   * Set to `false` to render statically, e.g. when embedding in a
   * non-animated context. Reduced motion is honored automatically, so
   * callers never need to toggle this for accessibility. Defaults to `true`.
   */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Brand logo for pre-auth headers. Purely decorative: it is hidden from
 * screen readers (`accessible={false}`) and intentionally carries no label
 * — the kicker wordmark right below it already announces the brand.
 *
 * Mark: a faithful react-native-svg port of `assets/ticketify.svg` — the
 * ticket with side notches (mask), white bold "T" monogram, white QR glyph,
 * perforation line and the TICKETIFY wordmark — recolored EMERALD
 * (`colors.primary`): the source design's orange brand color clashes with
 * the app palette. The wordmark moves with the mark (the screens' standalone
 * kicker was removed so the brand text appears exactly once).
 *
 * Entrance: a reanimated `withTiming` fade + scale + small translateY,
 * ~600ms ease-out. Reduced motion is honored two ways: `ReduceMotion.System`
 * on the animations (live setting), and `useReducedMotion()` seeding the
 * shared values at their resting state so the first painted frame is never a
 * transparent logo under reduced motion.
 */
export function Logo({ size = 132, animate = true, style }: LogoProps) {
  // Stable for the app lifetime (module-load read). When reduced motion is
  // on, start at rest so the first frame shows the fully visible logo
  // instead of a opacity-0 flash before the effect lands.
  const systemPrefersReducedMotion = useReducedMotion();
  const canAnimate = animate && !systemPrefersReducedMotion;
  const opacity = useSharedValue(canAnimate ? 0 : 1);
  const scale = useSharedValue(canAnimate ? 0.9 : 1);
  const translateY = useSharedValue(canAnimate ? 8 : 0);

  useEffect(() => {
    if (!canAnimate) return;
    const entrance = {
      duration: 600,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    };
    opacity.value = withTiming(1, entrance);
    scale.value = withTiming(1, entrance);
    translateY.value = withTiming(0, entrance);
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(scale);
      cancelAnimation(translateY);
    };
  }, [canAnimate, opacity, scale, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[{ width: size, height: size }, animatedStyle, style]}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* Side-notch mask: the ticket body is a rounded rect; two circles at
            the left/right edge (cx 64 / 448, cy 220, r 28) punch the
            "bitten" cutouts — faithful port of the source `ticket-orange-mask`. */}
        <Mask id="logo-ticket-mask">
          <Rect x={64} y={64} width={384} height={384} rx={44} fill="#FFFFFF" />
          <Circle cx={64} cy={220} r={28} fill="#000000" />
          <Circle cx={448} cy={220} r={28} fill="#000000" />
        </Mask>

        {/* Ticket body — EMERALD (`colors.primary`): the source design's
            orange brand color is replaced to match the app palette. */}
        <Rect
          x={64}
          y={64}
          width={384}
          height={384}
          fill={colors.primary}
          mask="url(#logo-ticket-mask)"
        />

        {/* Monogram "T" + QR glyph + wordmark, optically raised 10pt like
            the source (`transform="translate(0, -10)"`). */}
        <G transform="translate(0, -10)">
          <Path
            d="M 200 130 H 312 C 321 130 328 137 328 146 V 162 C 328 171 321 178 312 178 H 276 V 250 C 276 259 269 266 260 266 H 252 C 243 266 236 259 236 250 V 178 H 200 C 191 178 184 171 184 162 V 146 C 184 137 191 130 200 130 Z"
            fill="#FFFFFF"
          />
          <G transform="translate(290, 195)">
            <Path
              d="M 0 12 V 4 A 4 4 0 0 1 4 0 H 12"
              stroke="#FFFFFF"
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 28 0 H 36 A 4 4 0 0 1 40 4 V 12"
              stroke="#FFFFFF"
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 40 28 V 36 A 4 4 0 0 1 36 40 H 28"
              stroke="#FFFFFF"
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 12 40 H 4 A 4 4 0 0 1 0 36 V 28"
              stroke="#FFFFFF"
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            />
            <Rect x={13} y={13} width={14} height={14} rx={3} fill="#FFFFFF" />
          </G>
        </G>

        {/* Perforation / tear line */}
        <Line
          x1={104}
          y1={280}
          x2={408}
          y2={280}
          stroke="#FFFFFF"
          strokeWidth={4}
          strokeDasharray="8,8"
          strokeLinecap="round"
          opacity={0.45}
        />

        {/* TICKETIFY wordmark — the source `<text>` (x=256 y=360, middle
            anchored). fontSize is bumped from the source's 40 to 44: at the
            default 132pt box the 512 viewBox scales to ~0.26, so 40 units
            ≈ 10.3pt — small for a 900-weight wordmark and smaller than the
            kicker label it replaces. 44 ≈ 11.3pt, matching the removed
            kicker's visual weight while staying inside the notch-safe zone
            (~140-372 viewBox units at this size). The font family is the
            source's CSS stack; native renders resolve to the system sans
            (iOS: San Francisco, Android: Roboto). */}
        <SvgText
          x={256}
          y={360}
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
          fontWeight={900}
          fontSize={44}
          letterSpacing={2}
          fill="#FFFFFF"
        >
          TICKETIFY
        </SvgText>
      </Svg>
    </Animated.View>
  );
}