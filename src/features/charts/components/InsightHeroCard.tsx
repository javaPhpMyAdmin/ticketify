import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { Icon, Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

import type { DailySpendPoint } from '../aggregate';
import { buildVisibleDailySeries, weekdayInitialsForMonth } from '../aggregate';

export interface InsightHeroCardProps {
  /** Display label for the selected month, e.g. "Agosto 2026". */
  monthLabel: string;
  /** `YYYY-MM` of the selected month; drives the weekday initials row. */
  monthKey: string;
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
  monthKey,
  total,
  deltaPct,
  previousMonthLabel,
  dailyData,
  currency = 'UYU',
  chartHeight = 120,
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
  // Sqrt-scale the daily totals (see `buildVisibleDailySeries`) so small
  // days stay visible next to outliers; the plot draws straight lines
  // between days so the height under each label is exactly that day's
  // value — no smooth interpolation that invents heights on zero days.
  const { points: scaledData, yMax } = buildVisibleDailySeries(dailyData);
  const yDomain: [number, number] = [0, yMax];
  // Explicit day-of-month domain: without it victory-native infers a
  // continuous range, shifting where each day lands. With [1, daysInMonth]
  // the curve maps day N to the same spot regardless of the month length.
  const daysInMonth = dailyData.length || 1;
  const xDomain: [number, number] = [1, daysInMonth];
  // Day labels rendered manually below the chart — victory-native's own
  // axis labels proved unreliable here (they didn't render on device), so
  // we draw the numbers ourselves. EVERY day of the month is labeled
  // (1..31), spreading evenly across the row; the first and last tick
  // match the chart's domainPadding (spacing.sm). The weekday initial
  // under each number (L M M J V S D) lets the user correlate curve
  // bumps with real calendar days.
  const dayTicks = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekdayInitials = weekdayInitialsForMonth(monthKey);

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
            data={scaledData}
            xKey="day"
            yKeys={['total']}
            domain={{ x: xDomain, y: yDomain }}
            domainPadding={{ left: spacing.sm, right: spacing.sm, top: spacing.sm }}
          >
            {({ points }) => (
              <Line
                points={points.total}
                color={colors.heroLine}
                strokeWidth={2.5}
                // Smooth wavy curve like the product mockups. The sqrt
                // scale (see `buildVisibleDailySeries`) keeps small days
                // visible AND flattens the spikes, so the monotone spline
                // no longer inflates a neighbor of a spike (day 14 used
                // to look tall because day 13 peaked at 83% of a linear
                // axis; in sqrt space day 13 is ~49% so its fall is
                // gentle and day 14 sits near its own real value).
                curveType="monotoneX"
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
      {hasData ? (
        <View style={styles.dayAxis}>
          {dayTicks.map((day) => (
            <View key={day} style={styles.dayTickCol}>
              <Text style={styles.dayTick}>{day}</Text>
              <Text style={styles.weekdayTick}>
                {weekdayInitials[day - 1] ?? ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
  // Day-number row under the curve. Horizontal padding matches the
  // chart's domainPadding (spacing.sm) so the first/last tick line up
  // with the plot edges; the remaining ticks spread evenly between them.
  dayAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginTop: -spacing.xs,
  },
  dayTickCol: {
    alignItems: 'center',
  },
  dayTick: {
    fontSize: 9,
    color: colors.heroText,
    opacity: 0.6,
    // Keep the baseline of two-digit and one-digit labels aligned.
    lineHeight: 12,
  },
  weekdayTick: {
    fontSize: 8,
    color: colors.heroText,
    opacity: 0.4,
    lineHeight: 10,
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
