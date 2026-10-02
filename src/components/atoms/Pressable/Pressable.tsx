import { Pressable as RNPressable, type PressableProps as RNPressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '@/theme';

export type PressableProps = RNPressableProps & {
  /** When true, dims to `motion.pressDim` on press. Default: true. */
  pressedDim?: boolean;
  /** Custom style applied on the `pressed` state. */
  pressedStyle?: StyleProp<ViewStyle>;
  /**
   * Scale factor applied on the `pressed` state, or `false` to opt out of
   * the scale animation entirely. Defaults to `motion.pressScale` (0.98).
   *
   * Set `false` when a scale reads as a defect rather than feedback: a
   * floating action button whose drop shadow the transform clips, or an
   * invisible full-screen backdrop whose shrink is visible as a seam.
   */
  pressScale?: number | false;
};

/**
 * Themed Pressable. Adds an opacity-dimmed, slightly scaled pressed state so
 * we don't have to repeat the `({ pressed }) => [...]` pattern across screens.
 * Falls back to react-native's stock Pressable for everything else.
 *
 * Style-array order is load-bearing (react-native resolves an array
 * left-to-right, LAST entry wins for a given property):
 *
 *   1. the press scale goes FIRST, so a caller's own `transform` — or a
 *      `pressedStyle` that supplies one — always wins over the default sink.
 *      The reverse order silently dead-codes every explicit scale a screen
 *      declares.
 *   2. the caller's style, then the default dim, then `pressedStyle`. The dim
 *      lands after the caller's style so an explicitly-pressed opacity in
 *      `style` cannot defeat the system feedback.
 *   3. `disabled` last, so the disabled dim is never overridden.
 */
export function Pressable({
  style,
  pressedDim = true,
  pressedStyle,
  pressScale = motion.pressScale,
  disabled,
  ...rest
}: PressableProps) {
  return (
    <RNPressable
      disabled={disabled}
      style={(state) => [
        state.pressed && pressScale
          ? { transform: [{ scale: pressScale }] }
          : null,
        typeof style === 'function' ? style(state) : style,
        state.pressed && pressedDim ? motion.pressDim : null,
        state.pressed && pressedStyle ? pressedStyle : null,
        disabled ? motion.disabledDim : null,
      ]}
      {...rest}
    />
  );
}