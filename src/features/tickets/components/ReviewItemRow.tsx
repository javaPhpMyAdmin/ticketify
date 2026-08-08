import { StyleSheet, Switch } from 'react-native';

import { Chip, Text, View } from '@/components';
import { getExpenseCategory } from '@/features/home/categories';
import { formatCurrency } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';
import type { ReviewItem } from '@/types';

export interface ReviewItemRowProps {
  item: ReviewItem;
  /** ISO 4217 code for the line price (defaults to the settings default, UYU). */
  currency?: string;
  /** Called when the user taps the category chip to edit it. */
  onPressCategory: () => void;
  /** Called when the user toggles the "impulse" switch. */
  onToggleImpulse: (isImpulse: boolean) => void;
}

/**
 * One row inside the receipt review list. Top half: name + qty on
 * the left, line price on the right. Bottom half: the effective
 * category chip (user-picked when set, else AI-suggested, else
 * SIN CATEGORÍA) which opens the category picker on tap, plus the
 * impulse-buy switch.
 */
export function ReviewItemRow({
  item,
  currency,
  onPressCategory,
  onToggleImpulse,
}: ReviewItemRowProps) {
  const categoryId = item.category_id ?? item.ai_suggested_category_id;
  const category = categoryId ? getExpenseCategory(categoryId) : null;

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={styles.left}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.qty}>Cant. {item.quantity}</Text>
        </View>
        <Text style={styles.price}>
          {formatCurrency(item.total_price, currency)}
        </Text>
      </View>
      <View style={styles.bottom}>
        <Chip
          label={category?.label ?? 'SIN CATEGORÍA'}
          icon={category?.icon}
          selected={!!category}
          onPress={onPressCategory}
        />
        <View style={styles.impulseWrap}>
          <Text style={styles.impulseLabel}>Compra impulsiva</Text>
          <Switch
            value={item.is_impulse}
            onValueChange={onToggleImpulse}
            trackColor={{ true: colors.primary, false: colors.divider }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  left: {
    flex: 1,
  },
  name: {
    ...typography.bodyLg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  qty: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  price: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  impulseWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  impulseLabel: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
