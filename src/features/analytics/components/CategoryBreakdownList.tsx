import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, EmptyState, Text, View } from '@/components';
import { formatCurrency, formatPercentLabel } from '@/lib/format';
import { colors, spacing } from '@/theme';
import type { CategoryMonthlyTotal } from '@/types';

export interface CategoryBreakdownListProps {
  rows: CategoryMonthlyTotal[];
  /** Optional section title. */
  title?: string;
  /**
   * ISO 4217 currency code (`formatCurrency(value, currency)` requires it
   * since the hybrid policy — see `src/lib/format.ts`). Defaults to
   * `UYU` so a consumer that omits it still renders.
   */
  currency?: string;
}

/**
 * Renders the per-category breakdown rows in the analytics tab.
 * Each row is a `Card` with the category kicker, total, percent of
 * the monthly total, and item count. An empty month renders an
 * `EmptyState` instead of a blank section.
 */
export function CategoryBreakdownList({
  rows,
  title,
  currency = 'UYU',
}: CategoryBreakdownListProps) {
  // The percent row reads the localized "of spending" phrase from the
  // `analytics` namespace; the item count below uses its plural keys.
  const { t } = useTranslation('analytics');
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {rows.length === 0 ? (
        <EmptyState title={t('noCategories')} />
      ) : (
        rows.map((row) => (
          <Card key={row.category_id}>
            <View style={styles.row}>
              <View style={{ backgroundColor: colors.surface }}>
                <Text style={styles.kicker}>{row.category_slug.toUpperCase()}</Text>
                <Text style={styles.total}>{formatCurrency(row.total, currency)}</Text>
              </View>
              <View style={styles.right}>
                <Text style={styles.percent}>
                  {t('percentOfSpending', {
                    percent: formatPercentLabel(row.percent_of_total),
                  })}
                </Text>
                <Text style={styles.items}>
                  {t('categoryItemCount', { count: row.item_count })}
                </Text>
              </View>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
  },
  kicker: {
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    fontSize: 17,
    fontWeight: '900',
  },
  total: {
    color: colors.textPrimary,
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    fontSize: 19,
    fontWeight: '700',
  },
  right: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
  },
  percent: {
    color: colors.primary,
    fontSize: 19,
    fontWeight: '600',
  },
  items: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
