import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon, Pressable, ProgressBar, Text, type IconName } from '@/components';
import { formatCurrency, formatPercentLabel } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';
import { getCategoryColor } from '@/features/home/categories';
import { budgetProgressColor } from '../category-budget-progress';

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
 * Colored category row for the Analytics tab breakdown.
 *
 * Shows the category icon on a colored circle, the category name, the
 * percent of total spend, and the amount. When a per-category budget limit
 * exists it also shows "$X of $Y" and a progress bar colored by the shared
 * `budgetProgressColor` (spec NFR-4: identical thresholds in every
 * consumer); the limit line is omitted when no limit is provided.
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
  // PR 3 (`app-i18n` cleanup, W2): the "of spending" suffix after the
  // percent token is localized via the `analytics` namespace.
  const { t } = useTranslation('analytics');
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
        <Text style={styles.percent}>
          {t('percentOfSpending', { percent: formatPercentLabel(percent) })}
        </Text>
        {/* Gate: only a positive limit renders the budget line (Correction 3).
            A 0/negative limit is a delete-on-zero artifact — it must never
            surface a limit, a ratio, or a progress bar. */}
        {typeof limit === 'number' && limit > 0 ? (
          <>
            <Text style={styles.limit}>
              {formatCurrency(amount, currency)} de{' '}
              {formatCurrency(limit, currency)}
            </Text>
            <ProgressBar
              value={Math.min(1, amount / limit)}
              color={budgetProgressColor(amount / limit)}
              height={4}
              accessibilityLabel={`Gastaste ${formatCurrency(amount, currency)} de ${formatCurrency(limit, currency)} en ${name}`}
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
