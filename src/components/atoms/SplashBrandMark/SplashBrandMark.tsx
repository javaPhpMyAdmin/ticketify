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

import { colors } from '@/theme';

export interface SplashBrandMarkProps {
  /**
   * Outer box size in points. The SVG scales the 512 viewBox down to the
   * requested size; the inner geometry (ticket + monogram + wordmark)
   * stays identical. Defaults to 128, which is the brief's center-card
   * width.
   */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Statically-rendered brand mark for the boot splash.
 *
 * This is the cold-boot sibling of the pre-auth `<Logo>` atom: both
 * share the ticket + wordmark identity, but the splash version NEVER
 * animates (it lives behind the Bob + Scan-Beam + Sweep loops on the
 * native driver, so the inner SVG must be a frozen snapshot) and
 * NEVER pulls in a JSI worklet runtime (the splash is the very first
 * thing the JS thread paints — no worklet setup cost can land before
 * the user sees the brand).
 *
 * Visible structure:
 *   ┌──────────────────────────────────────┐
 *   │  emerald ticket body (notch cutouts)  │
 *   │   ┌──────────────────────────────┐   │
 *   │   │  white "T" monogram + QR mark│   │
 *   │   └──────────────────────────────┘   │
 *   │   · · · · perforation tear line · ·  │
 *   │     TICKETIFY (white, 900 weight)    │
 *   └──────────────────────────────────────┘
 *
 * Same path data + wordmark typography as the
 * `<Logo>` atom (`src/components/atoms/Logo/Logo.tsx`); divergence is
 * limited to (a) NO mount-time fade-in and (b) NO worklet hook —
 * keeping the boot path zero worklet-runtime.
 */
export function SplashBrandMark({ size = 128, style }: SplashBrandMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      {/* Side-notch mask: emerald ticket body punched by two circle
          cutouts at the left/right edge (cx 64 / 448, cy 220, r 28). */}
      <Mask id="splash-ticket-mask">
        <Rect x={64} y={64} width={384} height={384} rx={44} fill="#FFFFFF" />
        <Circle cx={64} cy={220} r={28} fill="#000000" />
        <Circle cx={448} cy={220} r={28} fill="#000000" />
      </Mask>
      <Rect
        x={64}
        y={64}
        width={384}
        height={384}
        fill={colors.primary}
        mask="url(#splash-ticket-mask)"
      />
      {/* "T" monogram + QR glyph, optically raised 10pt (matches the
          Logo atom's geometry so the brand reads identically). */}
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
      {/* Perforation / tear line. */}
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
      {/* TICKETIFY wordmark — middle-anchored, white, 900 weight. */}
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
  );
}
