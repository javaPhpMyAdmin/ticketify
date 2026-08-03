import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Text, View, type IconName } from '@/components';
import { colors, spacing, typography } from '@/theme';

export interface ListItemProps {
  /** Optional leading icon (e.g. avatar / category glyph). */
  leadingIcon?: IconName;
  leadingIconColor?: string;
  leadingIconBg?: string;
  /** Optional custom element rendered on the left (overrides the icon). */
  leading?: ReactNode;
  /** Main text. Truncates with ellipsis on a single line. */
  title: string;
  /** Optional supporting text rendered below the title. */
  subtitle?: string;
  /** Optional element rendered on the right (badge, amount, etc.). */
  trailing?: ReactNode;
  /** Override outer container style. */
  style?: StyleProp<ViewStyle>;
  /** Vertical padding override. */
  paddingVertical?: number;
}

/**
 * Generic list row: optional leading icon/bubble, title, optional
 * subtitle, and a trailing slot. Used by receipts, history entries,
 * settings rows, and the profile section.
 */
export function ListItem({
  leadingIcon,
  leadingIconColor,
  leadingIconBg,
  leading,
  title,
  subtitle,
  trailing,
  style,
  paddingVertical = spacing.md,
}: ListItemProps) {
  return (
    <View style={[styles.row, { paddingVertical }, style]}>
      {leading ? (
        leading
      ) : leadingIcon ? (
        <View style={[styles.iconCircle, { backgroundColor: leadingIconBg ?? colors.chipBg }]}>
          <Icon name={leadingIcon} size={18} color={leadingIconColor ?? colors.textPrimary} />
        </View>
      ) : null}
      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyLg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
});
