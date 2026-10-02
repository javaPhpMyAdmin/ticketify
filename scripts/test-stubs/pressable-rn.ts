/**
 * Test double for `react-native` — press-feedback harness ONLY
 * (scripts/test-pressable-pins.mjs).
 *
 * The shared `scripts/test-stubs/react-native.ts` deliberately drops `style`
 * on the host element, which is fine for harnesses that only assert press
 * HANDLERS. This harness has to assert the RESOLVED STYLE, so the double
 * resolves the style callback the atom hands react-native and publishes both
 * states as flat props:
 *
 *   styleRest    the style with `pressed: false`
 *   stylePressed the style with `pressed: true`
 *
 * Calling the callback twice is safe — react-native's own Pressable calls it
 * once per state, and the atom's callback is pure (it only reads `state` and
 * closed-over props). The harness therefore never has to simulate a touch:
 * reading the two props IS the observable behavior.
 */
import React from 'react';

// ── Style types ────────────────────────────────────────────────────────────
// Structural stand-ins for the real react-native style types. The index
// signatures are deliberate: the atom and the theme tokens touch a handful of
// known properties, but re-declaring react-native's full surface here would
// make this double rot the first time a consumer uses a new one. `opacity` and
// `transform` are spelled out because those ARE the properties under test —
// they must stay `number` / array-shaped so the atom's arithmetic is checked
// against real types instead of `unknown`.

export interface ViewStyle {
  opacity?: number;
  transform?: ReadonlyArray<{ scale?: number; translateX?: number; translateY?: number }>;
  [property: string]: unknown;
}

export interface TextStyle {
  fontSize?: number;
  fontWeight?: string;
  [property: string]: unknown;
}

export type StyleProp<T> = T | ReadonlyArray<StyleProp<T>> | null | undefined | false;

export interface PressableStateCallbackType {
  pressed: boolean;
}

export interface PressableProps {
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  hitSlop?: number | ViewStyle;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  testID?: string;
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
}

export function Pressable(props: PressableProps): React.ReactElement {
  const resolve = (pressed: boolean): StyleProp<ViewStyle> =>
    typeof props.style === 'function'
      ? props.style({ pressed })
      : props.style;
  return React.createElement(
    'Pressable',
    {
      onPress: props.onPress,
      disabled: Boolean(props.disabled),
      styleRest: resolve(false),
      stylePressed: resolve(true),
    },
    props.children,
  );
}

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
};

export const Platform = {
  OS: 'ios',
  select: <T>(spec: Record<string, T> & { default?: T }): T | undefined =>
    spec[Platform.OS] ?? spec.default,
};

export const View = 'View';
export const Text = 'Text';
export const PressableState = { pressed: false };