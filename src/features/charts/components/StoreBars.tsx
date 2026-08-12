/**
 * Horizontal bar chart for per-store totals (pro-subscription spec —
 * REQ-CHART-4). One row per store, the bar length encodes the total
 * spent in the selected month, the label on the left encodes the store
 * name. Bars are sorted longest → shortest so the dominant store is
 * always at the top (the aggregator already returns that order; the
 * chart just renders whatever it's given).
 *
 * Uses `CartesianChart` with `orientation: 'horizontal'` plus the
 * standard `Bar` component. The axis labels are formatted in Spanish:
 * y-axis (store names) renders raw, x-axis (dollars) renders as `$N`.
 *
 * Empty state: when `data` is empty, renders a placeholder rather than
 * an empty axis — an empty axis is hard to read on mobile and the user
 * can't tell whether the screen is broken or genuinely has no spend.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { Text } from '@/components';
import { colors, spacing } from '@/theme';
import { CHART_PALETTE } from './CategoryDonut';

export interface StoreBar {
  /** Stable identifier (lowercased store name fallback). */
  storeId: string;
  /** Display name shown on the y-axis. */
  storeName: string;
  /** Sum of receipt totals for this store. */
  total: number;
}

export interface StoreBarsProps {
  data: StoreBar[];
  /** Pixel height of the chart canvas. Defaults to 240. */
  height?: number;
}

interface BarRow extends Record<string, unknown> {
  storeId: string;
  storeName: string;
  total: number;
}

function shortCurrencyLabel(value: number): string {
  return `$${Math.round(value).toLocaleString('es-AR')}`;
}

export function StoreBars({ data, height = 240 }: StoreBarsProps) {
  const rows = useMemo<BarRow[]>(
    () =>
      data.map((store) => ({
        storeId: store.storeId,
        storeName: store.storeName,
        total: store.total,
      })),
    [data],
  );

  if (rows.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Sin compras en este mes</Text>
      </View>
    );
  }

  const maxTotal = rows.reduce(
    (max, row) => (row.total > max ? row.total : max),
    0,
  );
  const xDomain: [number, number] = [0, maxTotal * 1.1 || 1];

  return (
    <View style={[styles.container, { height }]}>
      <CartesianChart
        data={rows}
        xKey="storeName"
        yKeys={['total']}
        domain={{ x: xDomain }}
        domainPadding={{ left: spacing.sm, right: spacing.xl, top: spacing.sm }}
        orientation="horizontal"
        xAxis={{
          lineColor: colors.outlineVariant,
          labelColor: colors.textSecondary,
          tickCount: 4,
          formatXLabel: shortCurrencyLabel,
        }}
        yAxis={[
          {
            lineColor: colors.outlineVariant,
            labelColor: colors.textSecondary,
            // Truncate long store names so the axis stays readable; the full
            // name lives in the donut legend / tap target elsewhere.
            formatYLabel: (label: string | number) => {
              const text = String(label);
              return text.length > 12 ? `${text.slice(0, 11)}…` : text;
            },
          },
        ]}
      >
        {({ points, chartBounds }) => (
          <Bar
            points={points.total}
            chartBounds={chartBounds}
            color={CHART_PALETTE[0]}
            innerPadding={0.35}
            roundedCorners={{
              topLeft: 4,
              topRight: 4,
              bottomLeft: 4,
              bottomRight: 4,
            }}
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
