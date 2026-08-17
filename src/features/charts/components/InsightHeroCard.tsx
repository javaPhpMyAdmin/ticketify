import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { Icon, Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

import type { DailySpendPoint } from '../aggregate';
import {
  buildDailyInsight,
  buildVisibleDailySeries,
  weekdayInitialsForMonth,
} from '../aggregate';

/**
 * Horizontal space allotted to each day of the month, in dp. The chart is a
 * horizontally scrollable strip (one fixed-width slot per day) so every day
 * gets room for its bar AND its label: the number plus the weekday initial
 * sit centered under the bar instead of being crammed into a squeezed
 * month-wide axis (the old full-width layout drifted the labels away from
 * the bars — days 13-14 read as 15-16 and days 10-11 looked empty).
 */
const DAY_SLOT_WIDTH = 44;

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
   * by `aggregateDailySpend`) — the hero bars' x-axis.
   */
  dailyData: DailySpendPoint[];
  /** Currency code used for the total and chip. */
  currency?: string;
  /** Pixel height of the chart canvas. */
  chartHeight?: number;
  /**
   * Called when a non-zero bar is tapped. The argument is the 0-based day
   * index (0 = day 1). When omitted, taps are no-ops (read-only mode).
   */
  onDayPress?: (dayIndex: number) => void;
}

/**
 * Dark hero card for the Pro trends screen.
 *
 * Shows "Gastado este mes", the selected-month total, a white victory-native
 * bar chart of the daily spend (30/31 daily bars for the selected month,
 * day-of-month on the x-axis), and a previous-month delta chip. The chip is
 * hidden when there is no previous-month base (`deltaPct === null`), matching
 * the spec edge case for a missing comparison.
 *
 * Each day is its own bar so the height under a day label is EXACTLY that
 * day's scaled spend: a connecting line made day 14 read as a tall peak
 * (it sat on the descending slope from the day-13 spike) even though $812
 * and $560 are near-equal in cbrt space, and days without receipts made a
 * flat trace across the future that read as phantom spending. Zero days
 * simply have no bar.
 *
 * The month is a horizontally scrollable strip: one fixed-width slot per
 * day, so every bar is wide enough to read and the day number plus weekday
 * initial (L M M J V S D) fit centered under their own bar. Tapping a bar
 * toggles a small red legend with the day name and that day's real spend
 * (e.g. "Sáb 13 · $5.862"); tapping anywhere outside the bar dismisses it.
 * The chart is intentionally minimal: no grid, no persistent tooltip — the
 * only axis is this manual day-of-month row.
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
  onDayPress,
}: InsightHeroCardProps) {
  const hasChange = deltaPct !== null;
  const isUp = hasChange && deltaPct >= 0;

  // First-mount draw-in animation for the bars; cleared after the initial
  // paint so month swaps do not re-trigger it.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setHasMounted(true), 0);
    return () => clearTimeout(handle);
  }, []);

  const hasData = dailyData.some((point) => point.total > 0);

  // Highest-spend day + "Nx tu promedio" for the insight line. Pure
  // function of the card's own props; null on all-zero months, so a
  // no-spend month hides BOTH the line and the chart consistently.
  const insight = useMemo(
    () => buildDailyInsight(dailyData, monthKey),
    [dailyData, monthKey],
  );

  // Cbrt-scale the daily totals (see `buildVisibleDailySeries`) so small
  // days stay visible next to outliers; each bar keeps its day's real
  // scaled value.
  const { points: scaledData, yMax } = buildVisibleDailySeries(dailyData);
  const yDomain: [number, number] = [0, yMax];
  // One day per fixed slot: `DAY_SLOT_WIDTH` dp each. The scroll strip is
  // exactly `daysInMonth` slots wide, and the chart's x domain is
  // [0.5, daysInMonth + 0.5] so day N's bar is centered in slot N — the
  // label row below uses the same slots, so numbers land under their bars.
  const daysInMonth = dailyData.length || 1;
  const totalWidth = daysInMonth * DAY_SLOT_WIDTH;
  const xDomain: [number, number] = [0.5, daysInMonth + 0.5];
  // Drawn bar width inside a slot: `innerPadding` is 0.25, so each bar
  // occupies 75% of its 44dp slot, centered.
  const barWidth = DAY_SLOT_WIDTH * 0.75;

  // Real x/y position of every day's bar, reported by victory-native's
  // `points.total` (canvas coordinates == dp). The manual day labels are
  // centered on these EXACT x values as a safety net: even if the canvas
  // measures a slightly different width than the slots, the numbers follow
  // the bars wherever they actually land. The y values anchor the tap
  // legend just above the tapped bar.
  const [barAnchors, setBarAnchors] = useState<
    { x: number; y: number }[] | null
  >(null);
  const dayX = barAnchors ? barAnchors.map((anchor) => anchor.x) : null;
  const hasDayX = dayX !== null && dayX.length > 0;
  // Chart baseline (bottom of the bars), used to size each bar's tap target.
  const [baselineY, setBaselineY] = useState<number | null>(null);

  // Day labels rendered manually below the chart — victory-native's own
  // axis labels proved unreliable here (they didn't render on device), so
  // we draw the numbers ourselves. EVERY day of the month is labeled,
  // one per slot, with the weekday initial (L M M J V S D) under it.
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

      {insight ? (
        <Text
          style={styles.insight}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {`Tu día más caro fue el ${insight.weekday} ${insight.day} (${formatCurrency(insight.amount, currency)} · ${insight.multiple}x tu promedio)`}
        </Text>
      ) : null}

      {hasData ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chartScroll}
          contentContainerStyle={styles.chartScrollContent}
        >
          <View style={{ width: totalWidth }}>
            <View style={[styles.chart, { height: chartHeight }]}>
              <CartesianChart
                data={scaledData}
                xKey="day"
                yKeys={['total']}
                domain={{ x: xDomain, y: yDomain }}
                domainPadding={{
                  left: 0,
                  right: 0,
                  // Room for the tallest bar's rounded top inside the
                  // canvas (it reaches the y-domain top by design).
                  top: spacing.sm,
                }}
              >
                {({ points, chartBounds }) => {
                  // Capture the real per-day bar x/y positions once (and
                  // whenever they change) so the labels can be pinned to
                  // the bars. Setting the same values bails out, so this
                  // does not loop.
                  const anchors = points.total.map((point) => ({
                    x: point.x,
                    y: point.y ?? 0,
                  }));
                  if (
                    !barAnchors ||
                    anchors.length !== barAnchors.length ||
                    anchors.some(
                      (anchor, index) =>
                        Math.abs(anchor.x - barAnchors[index].x) > 0.5 ||
                        Math.abs(anchor.y - barAnchors[index].y) > 0.5,
                    )
                  ) {
                    setBarAnchors(anchors);
                  }
                  if (baselineY === null || Math.abs(baselineY - chartBounds.bottom) > 0.5) {
                    setBaselineY(chartBounds.bottom);
                  }
                  return (
                    <Bar
                      points={points.total}
                      chartBounds={chartBounds}
                      color={colors.heroLine}
                      // Each day is its own bar so the height under a day
                      // label is EXACTLY that day's scaled spend. A
                      // connecting line made day 14 read as tall (it sat on
                      // the descending slope from the day-13 spike) and day
                      // 10 as a valley, even though $812 and $560 are
                      // near-equal in cbrt space.
                      roundedCorners={{ topLeft: 3, topRight: 3 }}
                      innerPadding={0.25}
                      animate={
                        hasMounted
                          ? undefined
                          : { type: 'timing', duration: 600 }
                      }
                    />
                  );
                }}
              </CartesianChart>
              {/* Tap handling: one Pressable per non-zero bar that opens
                  the day detail modal via onDayPress. */}
              {barAnchors && baselineY !== null && onDayPress
                ? dayTicks.map((day, index) => {
                    const total = dailyData[index]?.total ?? 0;
                    const anchor = barAnchors[index];
                    if (!anchor || total <= 0) return null;
                    const barTop = anchor.y;
                    const barHeight = baselineY - barTop;
                    if (barHeight <= 0) return null;
                    return (
                      <Pressable
                        key={day}
                        style={[
                          styles.tapBar,
                          {
                            left: anchor.x - barWidth / 2,
                            top: barTop,
                            width: barWidth,
                            height: barHeight,
                          },
                        ]}
                        onPress={() => onDayPress(index)}
                      />
                    );
                  })
                : null}
            </View>
            <View style={styles.dayAxis}>
                {dayTicks.map((day, index) => {
                  // Prefer the bar's real anchor (`points.total`); fall back
                  // to the slot center before the chart reports positions.
                  const center =
                    hasDayX && dayX[index] !== undefined
                      ? dayX[index]
                      : DAY_SLOT_WIDTH * (index + 0.5);
                  return (
                    <View
                      key={day}
                      style={[
                        styles.daySlot,
                        { left: center - DAY_SLOT_WIDTH / 2 },
                      ]}
                    >
                      <Text style={styles.dayTick}>{day}</Text>
                      <Text style={styles.weekdayTick}>
                        {weekdayInitials[day - 1] ?? ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
        </ScrollView>
      ) : (
        <View style={[styles.emptyChart, { height: chartHeight }]}>
          <Text style={styles.emptyText}>Sin gastos este mes</Text>
        </View>
      )}
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
  // Single-line daily-spend insight ("Tu día más caro fue el Lunes 3
  // ($20,289.51 · 15x tu promedio)"). Shrinks to fit on narrow screens
  // instead of wrapping — one line, per spec.
  insight: {
    ...typography.bodyMd,
    color: colors.heroText,
    opacity: 0.7,
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
  chartScroll: {
    marginHorizontal: -spacing.lg,
  },
  chartScrollContent: {
    paddingHorizontal: spacing.lg,
  },
  chart: {
    width: '100%',
  },
  // Invisible tap target exactly over a drawn bar. No visual — the bar
  // itself is the affordance.
  tapBar: {
    position: 'absolute',
  },
  // Day-number row under the bars. Each day is a fixed `DAY_SLOT_WIDTH`
  // column centered on its bar's x, so the number + weekday initial sit
  // exactly under the bar they describe.
  dayAxis: {
    position: 'relative',
    height: 24,
    marginTop: spacing.xs,
  },
  daySlot: {
    position: 'absolute',
    width: DAY_SLOT_WIDTH,
    alignItems: 'center',
  },
  dayTick: {
    fontSize: 10,
    color: colors.heroText,
    opacity: 0.6,
    // Keep the baseline of two-digit and one-digit labels aligned.
    lineHeight: 13,
  },
  weekdayTick: {
    fontSize: 9,
    color: colors.heroText,
    opacity: 0.4,
    lineHeight: 11,
  },
  // Empty-state box mirrors the chart canvas height: the inline
  // `{ height: chartHeight }` on the usage keeps it coupled to the
  // `chartHeight` prop (default 120) instead of a hardcoded duplicate.
  emptyChart: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.heroText,
    opacity: 0.6,
  },
});
