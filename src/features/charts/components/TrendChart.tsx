/**
 * Spend trend line chart (pro-subscription spec — REQ-CHART-1, REQ-CHART-2).
 *
 * victory-native XL render driven by `@shopify/react-native-skia`. Renders
 * a per-month spend line on top of a CartesianChart frame with month labels
 * on the x-axis (Spanish short names, via `formatYearMonth({full:false})`)
 * and a dollar-formatted y-axis. The chart is intentionally presentation-
 * only — the parent decides which months to plot via the `data` prop
 * (zero-fill is the aggregator's job, not the chart's).
 *
 * Empty state: when `data` is empty or every point is zero, renders a
 * placeholder rather than a flat line — a flat line at zero would tell a
 * misleading story ("you spent $0 every month") when the truth is "we have
 * no data". The placeholder text matches the empty state copy used in the
 * History tab so the UI feels coherent.
 *
 * `referencePoints` (optional) plots a faded copy of the trend overlaid
 * on the SAME x-positions — e.g. last year's monthly totals behind this
 * year's, so the user can compare year-over-year at a glance. Both lines
 * share the `Line.animate` API (a 600 ms draw-in on first mount).
 *
 * The line-draw animation only runs ONCE per chart mount, not per data
 * change (changing the selected month shouldn't re-trigger the entry
 * animation — that's annoying for Pro users toggling months often).
 *
 * Tooltip v1: tap the canvas to inspect any single month on the main
 * line. We map `locationX` → `month` index by linear ratio over the
 * measured canvas width (`xScale` is stable across renders because the
 * data shape is monotonic).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { Text } from '@/components';
import { monthKeyToLabel } from '@/features/home/hooks/useHomeFeed';
import { colors, spacing } from '@/theme';

import { ChartTooltip } from './ChartTooltip';
import { useChartTooltip } from '../hooks/useChartTooltip';

export interface TrendPoint {
  month: string;
  total: number;
}

export interface TrendChartProps {
  data: TrendPoint[];
  /**
   * Optional muted line plotted underneath the main line. Same length
   * and same x-axis alignment as `data` — used for year-over-year
   * comparisons. A `null` entry yields an empty point on the reference
   * line so a missing month from one year doesn't drag the line to zero.
   */
  referencePoints?: (TrendPoint | null)[];
  /** Pixel height of the chart canvas. Defaults to 200. */
  height?: number;
}

/** Stable palette so re-renders don't change the visual identity of the line. */
const LINE_COLOR = colors.primary;
const AXIS_COLOR = colors.outlineVariant;
const LABEL_COLOR = colors.textSecondary;

/** Muted gray for the reference (previous) line at ~50% opacity. */
const REFERENCE_COLOR = colors.outlineVariant;
const ANIMATION_MS = 600;

interface ChartRow extends Record<string, unknown> {
  month: string;
  total: number;
  /** Same x as `total`; null when there's no reference datapoint here. */
  referenceTotal: number | null;
}

/**
 * Spanish short month label (`ago`) used on the x-axis. `monthKeyToLabel`
 * returns "agosto 2026" — the year is implied by the chart context, so we
 * strip it for readability. Splitting on space and taking [0] is safe
 * because the formatter always emits "name year".
 */
function shortMonthLabel(label: string): string {
  const first = monthKeyToLabel(String(label)).split(' ')[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

/** Compact currency used on the y-axis ticks (no decimals). */
function shortCurrencyLabel(value: number | null): string {
  if (value === null) return '';
  return `$${Math.round(value).toLocaleString('es-AR')}`;
}

export function TrendChart({
  data,
  referencePoints,
  height = 200,
}: TrendChartProps) {
  const tooltip = useChartTooltip();
  // Measured width of the chart canvas — written by `onLayout`, read by
  // the touch handler so we can map `locationX` → month index by linear
  // ratio. Without a real width (very first frame before layout), the
  // handler bails; the next tap, after layout, always has it.
  const [containerWidth, setContainerWidth] = useState(0);
  const containerWidthRef = useRef(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    containerWidthRef.current = width;
    setContainerWidth(width);
  }, []);

  // First-mount guard for the line-draw animation. The lib treats each
  // mount as a fresh draw; we hand in a stable animation config on the
  // first render and on the next re-renders we clear it (controlled by
  // a state flag that flips after the first paint). Done this way
  // because `<Line>` only reads `animate` on mount — passing `undefined`
  // later is a no-op.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    // One microtask after the first commit; clears `animate` so the
    // next re-render (and every subsequent one) skips the draw-in.
    const handle = setTimeout(() => setHasMounted(true), 0);
    return () => clearTimeout(handle);
  }, []);

  const rows = useMemo<ChartRow[]>(() => {
    return data.map((point, idx) => {
      const ref = referencePoints?.[idx] ?? null;
      return {
        month: point.month,
        total: point.total,
        referenceTotal: ref ? ref.total : null,
      };
    });
  }, [data, referencePoints]);

  const hasData = data.some((point) => point.total > 0);
  const hasReference =
    !!referencePoints &&
    referencePoints.some((p) => p !== null && p.total > 0);

  if (!hasData) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Sin datos para los últimos meses</Text>
      </View>
    );
  }

  // Domain covers both lines so the muted reference never punches
  // through the upper bound.
  const maxTotal = rows.reduce(
    (max, row) => {
      if (row.total > max) max = row.total;
      if (row.referenceTotal !== null && row.referenceTotal > max) {
        max = row.referenceTotal;
      }
      return max;
    },
    0,
  );
  const yDomain: [number, number] = [0, maxTotal * 1.1 || 1];

  // Tap routing: linear-ratio the touch x over the canvas width to
  // pick the nearest month index. `xScale` is monotonic so this maps
  // cleanly even though the chart's domainPadding adds margins on both
  // sides (we shift the ratio into the same padded range visually).
  const handleCanvasTouchStart = (locationX: number, locationY: number) => {
    if (data.length === 0) return;
    const width = containerWidthRef.current;
    if (width <= 0) return;
    // Account for the chart's left/right domainPadding by clamping to
    // [padding, 1-padding] before mapping to the row index — the
    // padding is small (spacing.sm = 8 px), but ignoring it would
    // route edge taps to the wrong month.
    const PADDING_PX = spacing.sm;
    const usableWidth = Math.max(1, width - PADDING_PX * 2);
    const shiftedX = Math.min(usableWidth, Math.max(0, locationX - PADDING_PX));
    const ratio = shiftedX / usableWidth;
    const index = Math.min(
      data.length - 1,
      Math.max(0, Math.round(ratio * (data.length - 1))),
    );
    const point = data[index];
    if (!point) return;
    const monthLabel = monthKeyToLabel(point.month);
    const sharedTotal = data.reduce((sum, p) => sum + p.total, 0);
    const pct =
      sharedTotal > 0 ? Math.round((point.total / sharedTotal) * 100) : 0;
    const lines = [
      monthLabel,
      `$${Math.round(point.total).toLocaleString('es-AR')}`,
    ];
    if (pct >= 5) lines.push(`${pct}% del total`);
    tooltip.show(locationX, locationY, lines);
  };

  return (
    <View
      style={[styles.container, { height }]}
      onLayout={handleLayout}
      onTouchStart={(event) =>
        handleCanvasTouchStart(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        )
      }
    >
      <CartesianChart
        data={rows}
        xKey="month"
        yKeys={hasReference ? ['total', 'referenceTotal'] : ['total']}
        domain={{ y: yDomain }}
        domainPadding={{
          left: spacing.sm,
          right: spacing.sm,
          top: spacing.md,
        }}
        xAxis={{
          lineColor: AXIS_COLOR,
          labelColor: LABEL_COLOR,
          tickCount: Math.min(data.length, 6),
          formatXLabel: shortMonthLabel,
        }}
        yAxis={[
          {
            lineColor: AXIS_COLOR,
            labelColor: LABEL_COLOR,
            tickCount: 4,
            formatYLabel: shortCurrencyLabel,
          },
        ]}
      >
        {({ points }) => (
          <>
            {hasReference ? (
              <Line
                points={points.referenceTotal ?? []}
                color={REFERENCE_COLOR}
                strokeWidth={1.5}
                curveType="linear"
                opacity={0.5}
              />
            ) : null}
            <Line
              points={points.total}
              color={LINE_COLOR}
              strokeWidth={2.5}
              curveType="linear"
              animate={hasMounted ? undefined : { type: 'timing', duration: ANIMATION_MS }}
            />
          </>
        )}
      </CartesianChart>
      <ChartTooltip state={tooltip.state} containerWidth={containerWidth} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  empty: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chipBg,
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
