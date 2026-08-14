import { StyleSheet } from 'react-native';

import { Card, EmptyState, Text, View } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, spacing } from '@/theme';
import type { CategoryMonthlyTotal } from '@/types';

export interface CategoryBreakdownListProps {
  rows: CategoryMonthlyTotal[];
  /** Optional section title. */
  title?: string;
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
}: CategoryBreakdownListProps) {
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {rows.length === 0 ? (
        <EmptyState title="Sin categorías este mes." />
      ) : (
        rows.map((t) => (
          <Card key={t.category_id}>
            <View style={styles.row}>
              <View style={{ backgroundColor: colors.surface }}>
                <Text style={styles.kicker}>{t.category_slug.toUpperCase()}</Text>
                <Text style={styles.total}>{formatCurrency(t.total)}</Text>
              </View>
              <View style={styles.right}>
                <Text style={styles.percent}>
                  {Math.round(t.percent_of_total)}%
                </Text>
                <Text style={styles.items}>{t.item_count} artículos</Text>
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
