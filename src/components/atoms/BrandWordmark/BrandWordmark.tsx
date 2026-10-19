import { Text, type StyleProp, type TextStyle } from 'react-native';

export interface BrandWordmarkProps {
  /** Typography / colour for the wordmark at the call site. */
  style?: StyleProp<TextStyle>;
}

/**
 * The product wordmark as rendered text ("Ticketify"), shared by every
 * cold-boot surface — the `<BootSplash>` headline and the
 * `<BootSplashErrorBoundary>` fallback both show it. Both must carry the same
 * clip workaround, so it lives here ONCE instead of being copy-pasted.
 *
 * Text-only counterpart of `<SplashBrandMark>` / `<Logo>`, which bake the
 * wordmark into SVG. This one stays live text precisely so it can carry the
 * clip slack. It imports RN `Text` directly (not the themed `Text` atom) to
 * keep the first paint of the cold-boot path free of `useTheme`.
 *
 * The trailing space is DELIBERATE layout slack, not a typo. Fabric on Android
 * (this app runs `newArchEnabled`) clips the final glyph of a `<Text>` whose
 * mounted node width equals the measured advance width — Android 15 turned on
 * `useBoundsForWidth`, which measures visual glyph bounds that can exceed the
 * advance (RN #53286 / #53017). RN 0.81.0 ships WITHOUT the upstream fix, and
 * `padding` cannot help: it grows the view bounds OUTSIDE the content box
 * without re-measuring the ink overhang. Widening the MEASURED text with a
 * trailing space gives the "y" room so it is never cropped. Do NOT trim it.
 *
 * Two consequences this atom owns:
 *   - The trailing space adds a hair of width before whatever follows in the
 *     row (in the headline row, the pulse dot). Accepted: a sub-pixel gap reads
 *     far better than a missing glyph.
 *   - `accessibilityLabel` keeps that layout-only slack out of what a screen
 *     reader announces — it hears "Ticketify", not "Ticketify ".
 *
 * The durable fix is native (RN #54721, `useBoundsForWidth = false`); once the
 * app ships an RN with it, the space — and this comment — can go.
 */
export function BrandWordmark({ style }: BrandWordmarkProps) {
  return (
    <Text style={style} accessibilityLabel="Ticketify">
      Ticketify{' '}
    </Text>
  );
}
