import { StyleSheet } from 'react-native';

import { Icon, Text, View, type IconName } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';
import { formatCurrency } from '@/lib/format';

export interface CategoryCardProps {
  icon: IconName;
  name: string;
  amount: number;
  currency?: string;
  iconBg?: string;
  iconColor?: string;
}

/**
 * Small white card used in the horizontal "Spending Categories" strip
 * on the dashboard. Square-ish aspect, big number, label-caps name.
 */
export function CategoryCard({
  icon,
  name,
  amount,
  currency = 'USD',
  iconBg = colors.chipBg,
  iconColor = colors.primary,
}: CategoryCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 150,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
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
  },
  name: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
});
