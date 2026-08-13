import { StyleSheet, View } from 'react-native';

import { Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

import type { WeeklySpendPoint } from '../aggregate';

export interface WeeklyBarChartProps {
  /** Seven daily spend points produced by `aggregateWeeklySpend`. */
  data: WeeklySpendPoint[];
  /** Currency code used for the amount labels. */
  currency?: string;
  /** Fixed pixel height of each bar. Defaults to 96. */
  barHeight?: number;
}

/**
 * Seven-day capsule bar chart ("This week" lens on the Analytics tab).
 *
 * Each day renders as a rounded vertical bar in muted gray; the highest-
 * spend day is highlighted in red so the weekly pattern is scannable at a
 * glance. Day initials and amounts are rendered as labels above/below the
 * bars. When every day is $0 the bars keep a minimal gray height so the
 * layout does not collapse, but no day is highlighted.
 *
 * Built with React Native Views instead of `victory-native` Bar because the
 * design calls for rounded capsule bars with per-bar labels — styling that
 * is simpler and more predictable with plain Views.
 */
export function WeeklyBarChart({
  data,
  currency = 'UYU',
  barHeight = 96,
}: WeeklyBarChartProps) {
  const maxAmount = data.reduce((max, point) => Math.max(max, point.amount), 0);
  const hasSpend = maxAmount > 0;
  const trackColor = colors.border;

  return (
    <View style={styles.container}>
      {data.map((point) => {
        const isMax = hasSpend && point.amount === maxAmount;
        const fillColor = isMax ? colors.danger : trackColor;
        const fillHeight = hasSpend
          ? Math.max((point.amount / maxAmount) * barHeight, 4)
          : 4;

        return (
          <View key={point.initial} style={styles.dayColumn}>
            <Text style={[styles.amount, isMax && styles.amountHighlight]}>
              {formatCurrency(point.amount, currency)}
            </Text>
            <View style={[styles.barTrack, { height: barHeight }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    height: fillHeight,
                    backgroundColor: fillColor,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.initial,
                isMax && styles.initialHighlight,
                !hasSpend && styles.initialMuted,
              ]}
            >
              {point.initial}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    width: '100%',
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  amount: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  amountHighlight: {
    color: colors.danger,
    fontWeight: '700',
  },
  barTrack: {
    width: '60%',
    justifyContent: 'flex-end',
    borderRadius: radii.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: radii.full,
  },
  initial: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  initialHighlight: {
    color: colors.danger,
    fontWeight: '700',
  },
  initialMuted: {
    opacity: 0.6,
  },
});
