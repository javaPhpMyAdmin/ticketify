import { StyleSheet } from 'react-native';

import { Icon, Pressable, Text, View, type IconName } from '@/components';
import { formatCurrency } from '@/lib/format';
import { radii, spacing, typography } from '@/theme';

import { getCategoryColor } from '../categories';

export interface CategoryBudgetCardProps {
  categoryKey: string;
  name: string;
  amount: number;
  percent: number;
  icon: IconName;
  currency?: string;
  onPress?: () => void;
}

/**
 * Full-width colored category card for the Home "Categorías de gastos"
 * section. Background and foreground are driven by the stable category
 * color registry so the card identity is consistent across the home,
 * analytics, and chart segments.
 *
 * Per-category budget limits do not exist yet, so the card only shows the
 * percent of total monthly spend; the limit line is omitted per the spec.
 */
export function CategoryBudgetCard({
  categoryKey,
  name,
  amount,
  percent,
  icon,
  currency = 'UYU',
  onPress,
}: CategoryBudgetCardProps) {
  const color = getCategoryColor(categoryKey);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: color.background },
        pressed && styles.pressed,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name}: ${formatCurrency(amount, currency)}`}
    >
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: `${color.foreground}26` },
        ]}
      >
        <Icon name={icon} size={22} color={color.foreground} />
      </View>
      <View style={styles.body}>
        <Text
          style={[styles.name, { color: color.foreground }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text style={[styles.percent, { color: color.foreground }]}>
          {percent.toFixed(0)}% del gasto
        </Text>
      </View>
      <Text style={[styles.amount, { color: color.foreground }]}>
        {formatCurrency(amount, currency)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: spacing.xs,
    // The themed `View` from `@/components` paints `backgroundColor:
    // theme['background']` by default. This container sits ON TOP of the
    // colored card, so it must stay transparent or it would cover the card
    // and hide the foreground-colored text below it.
    backgroundColor: 'transparent',
  },
  name: {
    ...typography.headlineMd,
    fontSize: 18,
  },
  percent: {
    ...typography.labelSm,
    opacity: 0.9,
  },
  amount: {
    ...typography.headlineMd,
    fontSize: 20,
  },
});
