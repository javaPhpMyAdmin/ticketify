import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { Icon, Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

import type { DailySpendPoint } from '../aggregate';
import { buildVisibleDailySeries, weekdayInitialsForMonth } from '../aggregate';

/**
 * Horizontal space allotted to each day of the month, in dp. The chart is a
 * horizontally scrollable strip (one fixed-width slot per day) so every day
 * gets room for its bar AND its label: the number plus the weekday initial
 * sit centered under the bar instead of being crammed into a squeezed
 * month-wide axis (the old full-width layout drifted the labels away from
 * the bars — days 13-14 read as 15-16 and days 10-11 looked empty).
 */
const DAY_SLOT_WIDTH = 44;

/** Floating legend shown when a bar is tapped; fixed box for positioning. */
const TOOLTIP_WIDTH = 104;
const TOOLTIP_HEIGHT = 36;

/** Full Spanish weekday names, indexed by `Date.prototype.getDay()`. */
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

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

  // Tap-to-inspect: the selected day (null = legend hidden). Tapping a bar
  // toggles its legend; tapping anywhere else (chart background, empty slots,
  // the label row) dismisses it. Hit targets are the bars themselves — a
  // Pressable per non-zero bar over the chart, with a dismiss Pressable
  // underneath — so the legend closes exactly when the touch is "outside
  // the bar", and scrolling is untouched (native drag beats the Pressables).
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // A new month clears any lingering legend.
  useEffect(() => {
    setActiveIndex(null);
  }, [dailyData]);

  const hasData = dailyData.some((point) => point.total > 0);
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
  const BAR_WIDTH = DAY_SLOT_WIDTH * 0.75;

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

  // Tap legend: the selected day's label (e.g. "Sáb 13") and its real spend.
  const activeDay =
    activeIndex !== null ? activeIndex + 1 : null;
  const activePoint =
    activeIndex !== null && barAnchors ? barAnchors[activeIndex] : null;
  const activeTotal =
    activeIndex !== null && dailyData[activeIndex]
      ? dailyData[activeIndex].total
      : 0;
  const [activeYear, activeMonth] = monthKey
    .split('-')
    .map((part) => Number(part));
  const activeWeekday =
    activeDay !== null && activeYear && activeMonth
      ? WEEKDAY_SHORT[new Date(activeYear, activeMonth - 1, activeDay).getDay()]
      : '';
  const tooltipLeft = activePoint
    ? Math.min(
        Math.max(activePoint.x - TOOLTIP_WIDTH / 2, 6),
        totalWidth - TOOLTIP_WIDTH - 6,
      )
    : 0;
  const tooltipTop = activePoint
    ? Math.max(activePoint.y - TOOLTIP_HEIGHT - 8, 4)
    : 0;

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

      {hasData ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chartScroll}
          contentContainerStyle={styles.chartScrollContent}
          onScrollBeginDrag={() => setActiveIndex(null)}
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
              {/* Tap handling: a full-area dismiss layer, with one Pressable
                  per non-zero bar on top. Tapping a bar toggles its legend;
                  tapping anywhere else (background, empty days, above the
                  bars) dismisses it. */}
              <Pressable
                style={styles.tapDismissLayer}
                onPress={() => setActiveIndex(null)}
              />
              {barAnchors && baselineY !== null
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
                            left: anchor.x - BAR_WIDTH / 2,
                            top: barTop,
                            width: BAR_WIDTH,
                            height: barHeight,
                          },
                        ]}
                        onPress={() =>
                          setActiveIndex((prev) =>
                            prev === index ? null : index,
                          )
                        }
                      />
                    );
                  })
                : null}
              {activePoint ? (
                <View
                  style={[
                    styles.tooltip,
                    { left: tooltipLeft, top: tooltipTop },
                  ]}
                >
                  <Text style={styles.tooltipDay}>
                    {activeWeekday} {activeDay}
                  </Text>
                  <Text style={styles.tooltipAmount}>
                    {formatCurrency(activeTotal, currency)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable onPress={() => setActiveIndex(null)}>
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
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.emptyChart}>
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
  // Invisible full-area tap target: any touch outside a bar dismisses the
  // legend. Sits below the per-bar Pressables so bars win on top.
  tapDismissLayer: {
    ...StyleSheet.absoluteFillObject,
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
  // Floating legend shown above the tapped bar. Red chip (the app's danger
  // color) with white text so it pops against the dark card.
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_WIDTH,
    backgroundColor: colors.danger,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  tooltipDay: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onPrimary,
    opacity: 0.9,
    lineHeight: 13,
  },
  tooltipAmount: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onPrimary,
    lineHeight: 15,
  },
  emptyChart: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.heroText,
    opacity: 0.6,
  },
});
