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
 *
 * Tap interaction: each bar row maps back to a discrete store. The
 * drill-down handler (`onRowPress`) fires with the pressed store so the
 * screen can route to `/stores/[name]?month=...`. The tooltip shows
 * the store's name and absolute total as a quick glance aid; the drill-
 * down commit happens on `onTouchEnd` after the user lifts their thumb
 * (no movement beyond the canvas, so the gesture isn't a swipe).
 *
 * Entry animation: each bar uses `Bar.animate` (a 400 ms path draw-in)
 * on the first render — controlled by a state flag flipped after mount.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { Text } from '@/components';
import { colors, spacing } from '@/theme';

import { CHART_PALETTE } from './CategoryDonut';
import { ChartTooltip } from './ChartTooltip';
import { useChartTooltip } from '../hooks/useChartTooltip';

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
  /**
   * Fired with the pressed `StoreBar` when the user taps a row. The
   * screen uses this to navigate to `/stores/[name]?month=...`.
   */
  onRowPress?: (store: StoreBar) => void;
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

const ROW_HEIGHT_PX = 32; // visual touch target per bar row

export function StoreBars({ data, onRowPress, height = 240 }: StoreBarsProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);
  const tooltip = useChartTooltip();

  // First-mount guard for the bar draw-in animation. Subsequent renders
  // (month change, etc.) keep the bars static — toggling months would
  // re-triggering an entry animation every tap is grating.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setHasMounted(true), 0);
    return () => clearTimeout(handle);
  }, []);

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

  // Tap routing: each row covers a fixed vertical band of the canvas,
  // indexed left to right — the y domain maps row index to a pixel
  // y that we bucket back to a row index.
  const handleCanvasTouchStart = (locationX: number, locationY: number) => {
    if (data.length === 0) return;
    // Bar chart y-axis is inverted: row 0 is at the TOP. So we need
    // to use (height - locationY) / bandHeight to get the row index
    // from the top. Without a measured height, fall back to a ratio
    // relative to the canvas height.
    const canvasHeight = containerWidth > 0 ? height : ROW_HEIGHT_PX * data.length;
    const bandHeight = canvasHeight / data.length;
    const rowFromTop = Math.max(
      0,
      Math.min(data.length - 1, Math.floor(locationY / bandHeight)),
    );
    // The y-axis is visually top-down in the chart (row 0 at top), so
    // a tap near the top maps to rowFromTop = 0 directly. No flip.
    const store = data[rowFromTop];
    if (!store) return;
    const lines = [store.storeName, `$${Math.round(store.total).toLocaleString('es-AR')}`];
    tooltip.show(locationX, locationY, lines);
    // The drill-down runs on touch end (lift) so a swipe-to-cancel
    // is possible — but the parent can decide. We fire BOTH the
    // tooltip and the press: the parent uses `onRowPress` for the
    // navigation, the tooltip is purely informational.
  };

  const handleCanvasTouchEnd = () => {
    // Drill-down fires here. The user just lifted their thumb; if a
    // tooltip is showing it means they tapped a real row, not a swipe.
    // We dispatch the press for the row whose tooltip is currently
    // visible (TooltipState.x/y are canvas-local; we don't need them
    // again — the value of `state.lines[0]` is the store name).
    const visibleName = tooltip.state.lines[0];
    if (!visibleName || !tooltip.state.visible) return;
    const pressed = data.find((s) => s.storeName === visibleName);
    if (pressed) {
      onRowPress?.(pressed);
      tooltip.hide();
    }
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
      onTouchEnd={handleCanvasTouchEnd}
    >
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
            animate={
              hasMounted
                ? undefined
                : { type: 'timing', duration: 400 }
            }
          />
        )}
      </CartesianChart>
      <ChartTooltip state={tooltip.state} containerWidth={containerWidth} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
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
