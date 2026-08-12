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
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { Text } from '@/components';
import { monthKeyToLabel } from '@/features/home/hooks/useHomeFeed';
import { colors, spacing } from '@/theme';

export interface TrendPoint {
  month: string;
  total: number;
}

export interface TrendChartProps {
  data: TrendPoint[];
  /** Pixel height of the chart canvas. Defaults to 200. */
  height?: number;
}

/** Stable palette so re-renders don't change the visual identity of the line. */
const LINE_COLOR = colors.primary;
const AXIS_COLOR = colors.outlineVariant;
const LABEL_COLOR = colors.textSecondary;

interface ChartRow extends Record<string, unknown> {
  month: string;
  total: number;
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
function shortCurrencyLabel(value: number): string {
  return `$${Math.round(value).toLocaleString('es-AR')}`;
}

export function TrendChart({ data, height = 200 }: TrendChartProps) {
  const rows = useMemo<ChartRow[]>(
    () => data.map((point) => ({ month: point.month, total: point.total })),
    [data],
  );

  const hasData = data.some((point) => point.total > 0);

  if (!hasData) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Sin datos para los últimos meses</Text>
      </View>
    );
  }

  const maxTotal = data.reduce(
    (max, point) => (point.total > max ? point.total : max),
    0,
  );
  // Pad the y-axis by 10% so the line never touches the top frame and a
  // future label above the peak has room to render.
  const yDomain: [number, number] = [0, maxTotal * 1.1 || 1];

  return (
    <View style={[styles.container, { height }]}>
      <CartesianChart
        data={rows}
        xKey="month"
        yKeys={['total']}
        domain={{ y: yDomain }}
        domainPadding={{
          left: spacing.sm,
          right: spacing.sm,
          top: spacing.md,
        }}
        xAxis={{
          lineColor: AXIS_COLOR,
          labelColor: LABEL_COLOR,
          tickCount: Math.min(rows.length, 6),
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
          <Line
            points={points.total}
            color={LINE_COLOR}
            strokeWidth={2.5}
            curveType="linear"
          />
        )}
      </CartesianChart>
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
