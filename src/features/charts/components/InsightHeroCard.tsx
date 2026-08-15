import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { Icon, Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

import type { DailySpendPoint } from '../aggregate';

export interface InsightHeroCardProps {
  /** Display label for the selected month, e.g. "Agosto 2026". */
  monthLabel: string;
  /** Total spent in the selected month. */
  total: number;
  /** Month-over-month percentage change; null hides the delta chip. */
  deltaPct: number | null;
  /** Label of the comparison month, e.g. "Julio 2026" — shown in the chip. */
  previousMonthLabel?: string | null;
  /**
   * One point per day of the selected month (1..days-in-month, zero-filled
   * by `aggregateDailySpend`) — the white line chart's x-axis.
   */
  dailyData: DailySpendPoint[];
  /** Currency code used for the total and chip. */
  currency?: string;
  /** Pixel height of the line chart canvas. */
  chartHeight?: number;
}

/**
 * Dark hero card for the Pro trends screen.
 *
 * Shows "Gastado este mes", the selected-month total, a white victory-native
 * line chart of the daily spend curve (30/31 daily points for the selected
 * month, day-of-month on the x-axis), and a previous-month delta chip. The
 * chip is hidden when there is no previous-month base (`deltaPct === null`),
 * matching the spec edge case for a missing comparison.
 *
 * The line chart is intentionally minimal: no grid, no tooltip — the only
 * axis is the numeric day-of-month x-axis. It exists to give a quick visual
 * trend; detail is available on the Pro charts screen.
 */
export function InsightHeroCard({
  monthLabel,
  total,
  deltaPct,
  previousMonthLabel,
  dailyData,
  currency = 'UYU',
  chartHeight = 80,
}: InsightHeroCardProps) {
  const hasChange = deltaPct !== null;
  const isUp = hasChange && deltaPct >= 0;

  // First-mount draw-in animation for the line; cleared after the initial
  // paint so month swaps do not re-trigger it.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setHasMounted(true), 0);
    return () => clearTimeout(handle);
  }, []);

  const hasData = dailyData.some((point) => point.total > 0);
  const maxTotal = dailyData.reduce(
    (max, point) => Math.max(max, point.total),
    0,
  );
  const yDomain: [number, number] = [0, maxTotal * 1.2 || 1];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Gastado este mes</Text>
          <Text style={styles.month}>{monthLabel}</Text>
          <Text style={styles.total}>{formatCurrency(total, currency)}</Text>
        </View>
        {hasChange ? (
          <View
            style={[
              styles.chip,
              { backgroundColor: isUp ? '#fbe3e3' : colors.primaryContainer },
            ]}
          >
            <Icon
              name={isUp ? 'arrow.up.right' : 'arrow.down.right'}
              size={14}
              color={isUp ? colors.danger : colors.primary}
            />
            <Text
              style={[
                styles.chipText,
                { color: isUp ? colors.danger : colors.primary },
              ]}
            >
              {isUp ? '+' : ''}
              {Math.round(deltaPct)}% vs{' '}
              {previousMonthLabel?.split(' ')[0] ?? ''}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.chart, { height: chartHeight }]}>
        {hasData ? (
          <CartesianChart
            data={dailyData}
            xKey="day"
            yKeys={['total']}
            domain={{ y: yDomain }}
            domainPadding={{ left: spacing.sm, right: spacing.sm, top: spacing.sm }}
            xAxis={{
              lineColor: colors.outlineVariant,
              labelColor: colors.heroText,
              tickCount: 7,
              formatXLabel: (value) => String(value),
            }}
          >
            {({ points }) => (
              <Line
                points={points.total}
                color={colors.heroLine}
                strokeWidth={2.5}
                curveType="linear"
                animate={
                  hasMounted ? undefined : { type: 'timing', duration: 600 }
                }
              />
            )}
          </CartesianChart>
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyText}>Sin gastos este mes</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.heroBackground,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.heroText,
    opacity: 0.7,
  },
  month: {
    ...typography.headlineMd,
    color: colors.heroText,
    marginTop: spacing.xs,
  },
  total: {
    ...typography.displayCurrency,
    color: colors.heroText,
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  chipText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
  chart: {
    width: '100%',
  },
  emptyChart: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.heroText,
    opacity: 0.6,
  },
});
