import { StyleSheet } from 'react-native';

import { Card, Text, View } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';
import type { CategoryMonthlyTotal } from '@/types';

export interface CategoryBreakdownListProps {
  rows: CategoryMonthlyTotal[];
  /** Optional section title. */
  title?: string;
}

/**
 * Renders the per-category breakdown rows in the analytics tab.
 * Each row is a `Card` with the category kicker, total, percent of
 * the monthly total, and item count.
 */
export function CategoryBreakdownList({ rows, title }: CategoryBreakdownListProps) {
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {rows.map((t) => (
        <Card key={t.category_id}>
          <View style={styles.row}>
            <View>
              <Text style={styles.kicker}>{t.category_slug.toUpperCase()}</Text>
              <Text style={styles.total}>{formatCurrency(t.total)}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.percent}>{Math.round(t.percent_of_total * 100)}%</Text>
              <Text style={styles.items}>{t.item_count} artículos</Text>
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  total: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  right: {
    alignItems: 'flex-end',
  },
  percent: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  items: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
});
