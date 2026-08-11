import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/atoms/Skeleton';
import { Card } from '@/components/molecules/Card';
import { colors, radii, spacing } from '@/theme';

/**
 * Composed loading skeletons that mirror the geometry of their real
 * counterparts (same paddings and radii; borders approximated with the
 * token border instead of each row's exact values), so the layout does
 * not jump when the data lands. Pure placeholders: no props, no press
 * handlers, no accessibility roles — they render only while a read is in
 * flight and are removed when it resolves.
 */

/** Mirrors `MonthlyBudgetCard` (+ the snacks callout on the Home screen). */
export function MonthlyBudgetCardSkeleton() {
  return (
    <View style={styles.wrap}>
      <Card style={styles.budgetShell}>
        <View style={styles.row}>
          <View style={styles.colLeft}>
            <Skeleton width={180} height={14} />
            <Skeleton width={130} height={28} />
          </View>
          <View style={styles.colRight}>
            <Skeleton width={86} height={12} />
            <Skeleton width={74} height={12} />
            <Skeleton width={64} height={12} />
          </View>
        </View>
        <Skeleton height={8} radius={radii.full} style={styles.track} />
      </Card>
      <Card style={styles.calloutShell}>
        <Skeleton width={120} height={16} />
        <Skeleton width={72} height={18} />
      </Card>
    </View>
  );
}

/** Mirrors the ~150px grid `CategoryCard` of the Home strip. */
export function CategoryCardSkeleton() {
  return (
    <View style={styles.categoryShell}>
      <Skeleton width={40} height={40} radius={20} />
      <Skeleton width={86} height={14} />
      <Skeleton width={62} height={16} />
    </View>
  );
}

/**
 * Approximates a `ReceiptRow` ("Tickets recientes"): same paddings and
 * radii, but the real row's 2.5px `#d8d7d7` border is approximated with
 * the 1px token border (layout still holds; only the hairline differs).
 */
export function ReceiptRowSkeleton() {
  return (
    <View style={styles.receiptShell}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={styles.receiptBody}>
        <Skeleton width={180} height={16} />
        <View style={styles.receiptMeta}>
          <Skeleton width={90} height={12} />
          <Skeleton width={70} height={16} />
        </View>
      </View>
    </View>
  );
}

/** Mirrors a `CategoryBreakdownList` row (Analytics). */
export function BreakdownRowSkeleton() {
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.colLeft}>
          <Skeleton width={92} height={13} />
          <Skeleton width={76} height={18} />
        </View>
        <View style={styles.colRight}>
          <Skeleton width={44} height={14} />
          <Skeleton width={64} height={12} />
        </View>
      </View>
    </Card>
  );
}

/** Mirrors a History tab item-search result row. */
export function SearchRowSkeleton() {
  return (
    <View style={styles.searchShell}>
      <Skeleton height={15} style={styles.searchName} />
      <Skeleton width={64} height={15} />
    </View>
  );
}

// Shared card-like shell: the three row skeletons (category, receipt,
// search) only differ in layout — they all sit on a surface card with the
// token border and radii.
const shell = {
  borderRadius: radii.lg,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  budgetShell: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  calloutShell: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  colLeft: {
    gap: spacing.sm,
  },
  colRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  track: {
    marginTop: spacing.lg,
  },
  categoryShell: {
    ...shell,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm - 5,
    width: 150,
    padding: spacing.lg,
  },
  receiptShell: {
    ...shell,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  receiptBody: {
    flex: 1,
    gap: spacing.sm,
  },
  receiptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchShell: {
    ...shell,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchName: {
    flex: 1,
  },
});
