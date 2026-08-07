import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Pressable, Text, View, type IconName } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

export interface CategoryCardProps {
  icon: IconName;
  name: string;
  amount: number;
  currency?: string;
  iconBg?: string;
  iconColor?: string;
  /** Navigate to the category detail when set; card renders as a button. */
  onPress?: () => void;
  /** Extra card styles (e.g. stretch full width in a vertical list). */
  style?: StyleProp<ViewStyle>;
  /**
   * Layout: 'grid' for the horizontal "Spending Categories" strip on the
   * dashboard (default), 'list' for the History tab's vertical list — a
   * full-width row (pair with `style={{ width: '100%' }}`). Only the
   * layout-relevant style lines change.
   */
  layout?: 'grid' | 'list';
}

/**
 * White card for a spending category. `layout="grid"` renders the square-ish
 * card used in the horizontal "Spending Categories" strip on the dashboard;
 * `layout="list"` switches to the row layout of the History tab. Big number,
 * label-caps name. Pressable when `onPress` is set — cards scale to 98% on
 * press (DESIGN.md, "Active States").
 */
export function CategoryCard({
  icon,
  name,
  amount,
  currency = 'UYU',
  iconBg = colors.chipBg,
  iconColor = colors.primary,
  onPress,
  style,
  layout = 'grid',
}: CategoryCardProps) {
  const isList = layout === 'list';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.card,
        isList && styles.cardList,
        style,
        pressed && styles.pressed,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm - 5,
    width: 150,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // List layout (History tab): row with the name and amount pushed to the
  // edges. The card's own `width: 150` is overridden by the caller's style
  // (`width: '100%'`) when used as a full-width row.
  cardList: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    padding: spacing.sm - 5,
  },
  name: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  amount: {
    // Deliberately smaller than headlineMd (20pt): the amount sits next
    // to a labelCaps name inside a 150px card, so 16pt/600 keeps the pair
    // balanced without the card growing.
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
});
