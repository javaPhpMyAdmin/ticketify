import { StyleSheet, View } from 'react-native';

import { Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

export interface TopItemsRow {
  name: string;
  amount: number;
}

export interface TopItemsBreakdownProps {
  /** Top items, already sorted by amount descending. */
  rows: TopItemsRow[];
  /** Monthly total the bars are measured against. */
  total: number;
  currency: string;
  /** Optional section title. */
  title?: string;
}

/**
 * Renders the "top items" rows in the analytics tab: one horizontal bar per
 * item whose width is the item's share of the month total — the mockup's
 * "en qué se me fue la plata" lens, product by product. Pure presentational
 * component: the caller owns derivation (e.g. `aggregateItemsByMonth`),
 * sorting, and the top-N slice.
 */
export function TopItemsBreakdown({
  rows,
  total,
  currency,
  title,
}: TopItemsBreakdownProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {rows.length === 0 ? (
          <Text style={styles.empty}>Sin artículos este mes.</Text>
        ) : (
          rows.map((row) => {
            const pct = total > 0 ? (row.amount / total) * 100 : 0;
            return (
              <View key={row.name} style={styles.row}>
                <View style={styles.rowHeader}>
                  <Text style={styles.name} numberOfLines={1}>
                    {row.name.charAt(0).toUpperCase() + row.name.slice(1)}
                  </Text>
                  <View style={styles.rowMeta}>
                    <Text style={styles.amount}>
                      {formatCurrency(row.amount, currency)}
                    </Text>
                    <Text style={styles.percent}>{Math.round(pct)} %</Text>
                  </View>
                </View>
                <View style={styles.track}>
                  <View
                    style={[styles.fill, { width: `${Math.min(pct, 100)}%` }]}
                  />
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  title: {
    // ...typography.headlineMd,
    fontWeight: '800',
    fontSize: 19,
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  row: {
    gap: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 17.5,
    fontWeight: '500',
    flex: 1,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  amount: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '900',
  },
  percent: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '900',
  },
  track: {
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceDim,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
