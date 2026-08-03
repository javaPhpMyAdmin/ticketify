import { Pressable as RNPressable, type PressableProps as RNPressableProps, type StyleProp, type ViewStyle } from 'react-native';

export type PressableProps = RNPressableProps & {
  /** When true, dims to 70% opacity on press. Default: true. */
  pressedDim?: boolean;
  /** Custom style applied on the `pressed` state. */
  pressedStyle?: StyleProp<ViewStyle>;
};

/**
 * Themed Pressable. Adds an opacity-dimmed pressed state so we don't
 * have to repeat the `({ pressed }) => [...]` pattern across screens.
 * Falls back to react-native's stock Pressable for everything else.
 */
export function Pressable({
  style,
  pressedDim = true,
  pressedStyle,
  disabled,
  ...rest
}: PressableProps) {
  return (
    <RNPressable
      disabled={disabled}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && pressedDim ? { opacity: 0.7 } : null,
        state.pressed && pressedStyle ? pressedStyle : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
      {...rest}
    />
  );
}
