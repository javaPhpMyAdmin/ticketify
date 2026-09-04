import { StyleSheet, View } from 'react-native';

import { Icon, Pressable, ProgressBar, Text, type IconName } from '@/components';
import { formatCurrency, formatPercentLabel } from '@/lib/format';
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
  /**
   * Optional tap handler. When provided the row renders as a themed
   * Pressable (role "button", labeled with name + amount); without it the
   * row stays a plain non-interactive View (byte-identical output).
   */
  onPress?: () => void;
}

/**
 * Progress bar color based on spend vs. limit ratio:
 * - green (<70%): on track
 * - amber (70–100%): approaching limit
 * - red (>100%): over budget
 */
export function budgetProgressColor(spent: number, limit: number): string {
  if (limit <= 0) return colors.primary;
  const ratio = spent / limit;
  if (ratio >= 1) return '#EF4444'; // red
  if (ratio >= 0.7) return '#F59E0B'; // amber
  return '#10B981'; // green
}

/**
 * Colored category row for the Analytics tab breakdown.
 *
 * Shows the category icon on a colored circle, the category name, the
 * percent of total spend, and the amount. When a per-category budget limit
 * exists it also shows "$X of $Y"; the limit line is omitted when no limit
 * is provided, matching the spec (per-category budgets do not exist yet).
 * With `onPress` the whole row becomes a themed Pressable for drill-down;
 * without it the output is a plain View, so non-interactive consumers
 * (the analytics tab) stay byte-identical.
 */
export function CategoryBudgetRow({
  categoryKey,
  name,
  amount,
  percent,
  icon,
  limit,
  currency = 'UYU',
  onPress,
}: CategoryBudgetRowProps) {
  const color = getCategoryColor(categoryKey);

  const rowContent = (
    <>
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
        <Text style={styles.percent}>{formatPercentLabel(percent)} del gasto</Text>
        {typeof limit === 'number' ? (
          <>
            <Text style={styles.limit}>
              {formatCurrency(amount, currency)} de{' '}
              {formatCurrency(limit, currency)}
            </Text>
            <ProgressBar
              value={Math.min(1, amount / limit)}
              color={budgetProgressColor(amount, limit)}
              height={4}
            />
          </>
        ) : null}
      </View>
      <View style={styles.amountColumn}>
        <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
      </View>
    </>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${formatCurrency(amount, currency)}`}
      style={styles.row}
    >
      {rowContent}
    </Pressable>
  ) : (
    <View style={styles.row}>{rowContent}</View>
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
