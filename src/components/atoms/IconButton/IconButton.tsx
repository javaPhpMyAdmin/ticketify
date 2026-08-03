import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/atoms/Pressable';
import { Icon, type IconName } from '@/components/atoms/Icon';
import { colors } from '@/theme';

export interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Icon size in px. Defaults to 22. */
  iconSize?: number;
  /** Icon tint. Defaults to `colors.textPrimary`. */
  color?: string;
  /** Circle background. Defaults to `colors.chipBg`. */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * 40x40 circular icon button on a chip-colored circle. Used for the
 * dismiss / flash actions on the ticket screens. Pressing dims the
 * circle via the themed Pressable.
 */
export function IconButton({
  icon,
  onPress,
  disabled,
  accessibilityLabel,
  iconSize = 22,
  color,
  backgroundColor,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      style={[styles.button, backgroundColor ? { backgroundColor } : null, style]}
    >
      <Icon name={icon} size={iconSize} color={color ?? colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chipBg,
  },
});
