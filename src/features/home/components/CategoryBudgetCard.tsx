import { StyleSheet } from 'react-native';

import {
  Icon,
  Pressable,
  ProgressBar,
  Text,
  View,
  type IconName,
} from '@/components';
import { formatCurrency, formatPercentLabel } from '@/lib/format';
import { radii, spacing, typography } from '@/theme';

import { getCategoryColor } from '../categories';

export interface CategoryBudgetCardProps {
  categoryKey: string;
  name: string;
  amount: number;
  percent: number;
  icon: IconName;
  currency?: string;
  /**
   * Number of items bought in the category during the shown month. When
   * present, renders a small "{n} artículos" line under the percent.
   */
  itemCount?: number;
  /** Optional per-category budget limit; when set, renders a progress bar. */
  limit?: number;
  onPress?: () => void;
}

/**
 * Full-width colored category card for the Home "Categorías de gastos"
 * section and the History month view. Background and foreground are driven
 * by the stable category color registry so the card identity is consistent
 * across the home, analytics, and chart segments.
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
  itemCount,
  limit,
  onPress,
}: CategoryBudgetCardProps) {
  const color = getCategoryColor(categoryKey);

  /** Color based on spend vs limit ratio. */
  const progressColor =
    typeof limit === 'number' && limit > 0
      ? amount / limit >= 1
        ? '#EF4444'
        : amount / limit >= 0.7
        ? '#F59E0B'
        : '#10B981'
      : undefined;

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
        <View style={styles.metaRow}>
          <Text style={[styles.percent, { color: color.foreground }]}>
            {formatPercentLabel(percent)} del gasto
          </Text>
          {itemCount !== undefined && itemCount > 0 ? (
            <Text style={[styles.itemCount, { color: color.foreground }]}>
              {itemCount === 1 ? '1 artículo' : `${itemCount} artículos`}
            </Text>
          ) : null}
        </View>
        {typeof limit === 'number' && limit > 0 ? (
          <View style={styles.budgetSection}>
            <Text style={[styles.limitText, { color: color.foreground }]}>
              {formatCurrency(amount, currency)} de{' '}
              {formatCurrency(limit, currency)}
            </Text>
            <View style={styles.progressTrack}>
              <ProgressBar
                value={Math.min(1, amount / limit)}
                color={progressColor}
                height={4}
                trackColor={`${color.foreground}33`}
              />
            </View>
          </View>
        ) : null}
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
  metaRow: {
    // Same transparent requirement as `body`: the themed `View` atom paints
    // `backgroundColor: theme['background']` by default, which would draw a
    // white box over the colored card and hide the foreground-colored text.
    backgroundColor: 'transparent',
    // Keep the percent + item count on one baseline; the card stays one
    // line taller than the old Home-only variant when the count renders.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    top: 10,
  },
  name: {
    ...typography.headlineMd,
    fontSize: 18,
  },
  percent: {
    ...typography.labelSm,
    opacity: 0.9,
  },
  itemCount: {
    // ...typography.labelSm,
    fontSize: 14,
    fontWeight: '900',
    opacity: 0.9,
  },
  budgetSection: {
    gap: 2,
    backgroundColor: 'transparent',
  },
  limitText: {
    ...typography.labelSm,
    opacity: 0.8,
  },
  progressTrack: {
    marginTop: 2,
  },
  amount: {
    ...typography.headlineMd,
    fontSize: 20,
  },
});
