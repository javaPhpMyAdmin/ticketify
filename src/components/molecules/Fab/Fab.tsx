import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Pressable, Text, type IconName } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

export interface FabProps {
  onPress: () => void;
  label?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  /** Override the emerald background (e.g. for a disabled state). */
  backgroundColor?: string;
  disabled?: boolean;
}

/**
 * Pill-shaped primary action button. Emerald background, white label.
 * Used both as the inline "Confirm & Save" CTA on the review screen
 * and as the floating scan trigger on the dashboard.
 *
 * The press handler intentionally does NOT animate scale here — the
 * "Active States" section of DESIGN.md says cards scale to 98% on press,
 * but FABs use a tonal color shift to stay readable on camera viewports.
 */
export function Fab({
  onPress,
  label,
  icon = 'plus',
  style,
  backgroundColor,
  disabled = false,
}: FabProps) {
  const bg = backgroundColor ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? colors.primaryDark : bg, opacity: disabled ? 0.5 : 1 },
        style,
      ]}
      accessibilityRole="button"
    >
      {icon ? <Icon name={icon} size={20} color={colors.textInverse} /> : null}
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
    minHeight: 48,
  },
  label: {
    ...typography.headlineMd,
    color: colors.textInverse,
  },
});
