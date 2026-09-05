/**
 * Loading skeleton for the "Gasto del hogar" card on the Home screen.
 *
 * Mirrors the `HouseholdCard` geometry (card shell with the primary
 * borderLeft accent, 44pt icon circle, info column, right-aligned amount
 * area) so the layout does not jump when the monthly household total
 * lands. Pure placeholder: no props, no press handler — it renders only
 * while the household-total read is in flight.
 *
 * Follows the composed-skeleton convention of `MonthlyBudgetCardSkeleton`
 * (`src/components/molecules/Skeletons/Skeletons.tsx`): same shell token
 * (surface + border + radii) with neutral `Skeleton` bars.
 */
import { StyleSheet } from 'react-native';

import { View } from '@/components/atoms';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Card } from '@/components/molecules/Card';
import { colors, spacing } from '@/theme';

export function HouseholdCardSkeleton() {
  return (
    <Card style={styles.card}>
      <View style={styles.iconCircle}>
        <Skeleton width={44} height={44} radius={22} />
      </View>
      <View style={styles.info}>
        <Skeleton width={110} height={14} />
        <Skeleton width={140} height={16} />
        <Skeleton width={76} height={12} />
      </View>
      <View style={styles.amount}>
        <Skeleton width={86} height={24} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // Mirrors the real card's accent border (same BudgetCard family as the
  // sibling MonthlyBudgetCardSkeleton).
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  iconCircle: {
    width: 44,
    height: 44,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  amount: {
    alignItems: 'flex-end',
  },
});