import {
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Icon, Pressable, Text, View, type IconName } from '@/components';
import { colors, radii, spacing } from '@/theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  /** When set, the pill renders as a Pressable and calls this on tap. */
  onPress?: () => void;
  /** Optional leading icon rendered in a small bubble. */
  icon?: IconName;
  /** Bubble background when `icon` is set. Defaults to `colors.chipBg`. */
  iconBg?: string;
  /** Icon tint when `icon` is set. Defaults to `colors.primary`. */
  iconColor?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const selectedBg = colors.primaryContainer;
const unselectedBg = colors.chipBg;
const selectedColor = colors.primaryDark;
const unselectedColor = colors.textSecondary;

/**
 * Tiny pill used for category tags. Always renders in `label-caps`
 * typography — uppercase 12/16 with +0.05em tracking. Optionally
 * renders a leading icon bubble and / or acts as a pressable.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  iconBg = colors.chipBg,
  iconColor = colors.primary,
  style,
  textStyle,
}: ChipProps) {
  const bg = selected ? selectedBg : unselectedBg;
  const color = selected ? selectedColor : unselectedColor;
  const content = (
    <>
      {icon ? (
        <View style={[styles.iconBubble, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={12} color={iconColor} />
        </View>
      ) : null}
      <Text style={[styles.label, { color }, textStyle]}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={[styles.base, { backgroundColor: bg }, style]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.base, { backgroundColor: bg }, style]}>{content}</View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'red',
  },
  iconBubble: {
    width: 18,
    height: 18,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'green',
  },
  label: {
    // ...typography.labelCaps,
    fontSize: 15,
    fontWeight: '900',
    color: colors.textSecondary,
  },
});
