import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components';
import { colors, radii, spacing } from '@/theme';

/**
 * Loading placeholder for `CategoryBudgetCard`. Mirrors the geometry of
 * the real card (icon circle, two-line body, amount) so the Home categories
 * section does not jump when the feed resolves.
 */
export function CategoryBudgetCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton width={44} height={44} radius={22} />
      <View style={styles.body}>
        <Skeleton width={120} height={18} />
        <Skeleton width={80} height={14} />
      </View>
      <Skeleton width={80} height={20} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.border,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
});
