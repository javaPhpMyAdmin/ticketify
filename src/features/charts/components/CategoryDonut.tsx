/**
 * Category donut chart (pro-subscription spec — REQ-CHART-3).
 *
 * Victory-native XL donut driven by `@shopify/react-native-skia` via the
 * `PolarChart` + `Pie.Chart` + `Pie.Slice` composition. One slice per
 * category, sized by its total, with an inner ring (donut hole) carrying
 * the month-total in absolute-positioned text overlay. The overlay is
 * rendered in React Native (not in skia) because skia text in this lib
 * needs a `SkFont`; a real-text overlay reads cleaner and scales with
 * device text size without extra font assets.
 *
 * The component is dumb about data shape — it just needs each row to
 * expose `{ name, amount, color }`. The screen maps the aggregator
 * output (`HomeCategory`) onto this shape and assigns colors by index.
 *
 * Tooltip v1 limitation (documented): the donut is a skia surface and
 * `Pie.Slice` in victory-native v42 does NOT expose per-slice `onPress`.
 * We can't reliably hit-test a slice on tap without a custom skia hit-
 * test. The v1 simplification is: tapping anywhere on the donut canvas
 * shows the legend entry for the LARGEST slice — honest about the
 * hit-test gap rather than guessing which slice the user meant. Per-
 * slice hit-test is a follow-up once the lib exposes that prop.
 *
 * Animation: each slice fades in with a 60 ms stagger. The lib supports
 * `animate` on `Pie.Slice` so we use it directly (no reanimated wrapper).
 * Entry animation runs once per mount via a `useRef`-tracked guard
 * (changing the selected month shouldn't re-trigger the fade).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Pie, PolarChart } from 'victory-native';

import { Text } from '@/components';
import { getCategoryColor } from '@/features/home/categories';
import { colors, spacing } from '@/theme';

import { CHART_PALETTE } from '../constants';
import { ChartLegend, type ChartLegendItem } from './ChartLegend';
import { ChartTooltip } from './ChartTooltip';
import { useChartTooltip } from '../hooks/useChartTooltip';

export interface CategorySlice {
  /** Stable identifier (category key). */
  id: string | null;
  /** Display name, e.g. "Supermercado". */
  name: string;
  /** Sum of line-item amounts for this category. */
  amount: number;
}

export interface CategoryDonutProps {
  data: CategorySlice[];
  /** Pixel size of the square canvas. Defaults to 200. */
  size?: number;
  /**
   * Currency code used by the legend amounts. The donut's center label
   * uses `formatCurrency` internally; the legend reuses the same
   * formatter so both numbers stay in lockstep.
   */
  currency?: string;
}

interface DonutDatum extends Record<string, unknown> {
  /** Pre-resolved color (skia takes a Color, not a key). */
  color: string;
  /** Display label passed to the chart's label slot. */
  label: string;
  /** Numeric value the slice is sized by. */
  value: number;
}

/**
 * Currency symbols — a tiny mirror of the helpers in `lib/format.ts` so
 * the legend can format without a second dep on the chart feature. The
 * formats must stay in lockstep with `formatCurrency` or the donut's
 * center number and the legend rows will read differently.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  ARS: '$',
  GBP: '£',
  BRL: 'R$',
  MXN: 'MX$',
  UYU: '$',
};

function formatAmount(value: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const fixed = Math.abs(value).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${symbol}${withSeparators}.${decPart}`;
}

export function CategoryDonut({
  data,
  size = 200,
  currency = 'UYU',
}: CategoryDonutProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);
  const tooltip = useChartTooltip();

  // Track "first mount" so the staggered slice fade-in only runs once.
  // The animation guard is a state flag flipped to `true` after the
  // first paint — passing `undefined` to `Pie.Slice.animate` on the
  // NEXT render keeps the canvas quiet while the data swaps underneath.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setHasMounted(true), 0);
    return () => clearTimeout(handle);
  }, []);

  // All Hooks above are unconditional. Derived values can safely sit
  // below the early return — we just compute them lazily via useMemo
  // so we don't break rules-of-hooks.
  const total = useMemo(
    () => data.reduce((sum, slice) => sum + slice.amount, 0),
    [data],
  );
  const donutData = useMemo<DonutDatum[]>(
    () =>
      data.map((slice, index) => {
        const categoryColor = getCategoryColor(slice.id).background;
        const isKnown = slice.id && categoryColor !== getCategoryColor('otros').background;
        return {
          color: isKnown ? categoryColor : CHART_PALETTE[index % CHART_PALETTE.length],
          label: slice.name,
          value: slice.amount,
        };
      }),
    [data],
  );
  const legendItems: ChartLegendItem[] = useMemo(
    () =>
      data.map((slice, index) => ({
        id: slice.id ?? `cat-${index}`,
        name: slice.name,
        amount: slice.amount,
        pct: total > 0 ? Math.round((slice.amount / total) * 100) : 0,
      })),
    [data, total],
  );

  if (data.length === 0) {
    return (
      <View style={[styles.empty, { height: size }]}>
        <Text style={styles.emptyText}>Sin gastos en este mes</Text>
      </View>
    );
  }

  // Inner radius is given as a number of PIXELS (the lib interprets it
  // relative to the canvas's drawn radius). 28% of the size keeps the
  // donut hole readable without crowding the center text.
  const innerRadius = Math.round(size * 0.28);

  // Tap the canvas → show the LARGEST slice as the highlighted entry.
  // We deliberately don't try to hit-test slices on tap (the lib
  // doesn't expose `Pie.Slice.onPress` in v41) — see the file header.
  const handleCanvasTouchStart = (locationX: number, locationY: number) => {
    if (data.length === 0) return;
    let largestIndex = 0;
    for (let i = 1; i < data.length; i += 1) {
      if (data[i].amount > data[largestIndex].amount) largestIndex = i;
    }
    const largest = data[largestIndex];
    const pct =
      total > 0 ? Math.round((largest.amount / total) * 100) : 0;
    tooltip.show(locationX, locationY, [
      largest.name,
      formatAmount(largest.amount, currency),
      `${pct}% del mes`,
    ]);
  };

  return (
    <View
      style={styles.wrapper}
      onLayout={handleLayout}
      onTouchStart={(event) =>
        handleCanvasTouchStart(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        )
      }
    >
      <View style={[styles.donutHolder, { width: size, height: size }]}>
        <PolarChart
          data={donutData}
          colorKey="color"
          labelKey="label"
          valueKey="value"
          containerStyle={styles.container}
        >
          <Pie.Chart innerRadius={innerRadius}>
            {() => (
              <Pie.Slice
                animate={
                  hasMounted
                    ? undefined
                    : {
                        type: 'timing',
                        duration: 400,
                      }
                }
              />
            )}
          </Pie.Chart>
        </PolarChart>
        <View style={styles.centerOverlay} pointerEvents="none">
          <Text style={styles.centerKicker}>TOTAL</Text>
          <Text
            style={styles.centerAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatAmount(total, currency)}
          </Text>
        </View>
        <ChartTooltip state={tooltip.state} containerWidth={containerWidth} />
      </View>
      <View style={styles.legendHolder}>
        <ChartLegend items={legendItems} currency={currency} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    gap: spacing.md,
  },
  donutHolder: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  // Centered text overlay. The PolarChart's canvas fills the holder, so
  // `position: absolute` with all four edges set lands dead-center on top
  // of the donut hole.
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  centerKicker: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.05 * 16,
    textTransform: 'uppercase',
  },
  centerAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
    marginTop: 2,
  },
  legendHolder: {
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
