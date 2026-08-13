import { StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';
import { getCategoryColor } from '@/features/home/categories';

export interface CategoryBudgetRowProps {
  /** Stable category key; drives icon/background via the color registry. */
  categoryKey: string;
  /** Display name of the category. */
  name: string;
  /** Current-month spend for this category. */
  amount: number;
  /** Percent of total monthly spend (0-100). */
  percent: number;
  /** SF Symbol name for the category. */
  icon: IconName;
  /** Optional per-category budget limit; hidden when absent. */
  limit?: number;
  /** Currency code used for amounts. */
  currency?: string;
}

/**
 * Colored category row for the Analytics tab breakdown.
 *
 * Shows the category icon on a colored circle, the category name, the
 * percent of total spend, and the amount. When a per-category budget limit
 * exists it also shows "$X of $Y"; the limit line is omitted when no limit
 * is provided, matching the spec (per-category budgets do not exist yet).
 */
export function CategoryBudgetRow({
  categoryKey,
  name,
  amount,
  percent,
  icon,
  limit,
  currency = 'UYU',
}: CategoryBudgetRowProps) {
  const color = getCategoryColor(categoryKey);

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: color.background },
        ]}
      >
        <Icon name={icon} size={20} color={color.foreground} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.percent}>{Math.round(percent)}% del gasto</Text>
        {typeof limit === 'number' ? (
          <Text style={styles.limit}>
            {formatCurrency(amount, currency)} de{' '}
            {formatCurrency(limit, currency)}
          </Text>
        ) : null}
      </View>
      <View style={styles.amountColumn}>
        <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  percent: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  limit: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  amountColumn: {
    alignItems: 'flex-end',
  },
  amount: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
});
