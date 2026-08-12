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
 */
import { StyleSheet, View } from 'react-native';
import { Pie, PolarChart } from 'victory-native';

import { Text } from '@/components';
import { colors, spacing } from '@/theme';

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
}

/**
 * Accessible 8-color palette ordered for visual differentiation (a single
 * hue ramps poorly on small screens). Each color passes a basic
 * light-background contrast check against `colors.textPrimary`.
 */
export const CHART_PALETTE: readonly string[] = [
  '#10B981', // emerald (primary)
  '#3B82F6', // blue
  '#F59E0B', // amber
  '#EF4444', // coral (danger)
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#84CC16', // lime
];

interface DonutDatum extends Record<string, unknown> {
  /** Pre-resolved color (skia takes a Color, not a key). */
  color: string;
  /** Display label passed to the chart's label slot. */
  label: string;
  /** Numeric value the slice is sized by. */
  value: number;
}

export function CategoryDonut({ data, size = 200 }: CategoryDonutProps) {
  if (data.length === 0) {
    return (
      <View style={[styles.empty, { height: size }]}>
        <Text style={styles.emptyText}>Sin gastos en este mes</Text>
      </View>
    );
  }

  const total = data.reduce((sum, slice) => sum + slice.amount, 0);
  const donutData: DonutDatum[] = data.map((slice, index) => ({
    color: CHART_PALETTE[index % CHART_PALETTE.length],
    label: slice.name,
    value: slice.amount,
  }));

  // Inner radius is given as a number of PIXELS (the lib interprets it
  // relative to the canvas's drawn radius). 28% of the size keeps the
  // donut hole readable without crowding the center text.
  const innerRadius = Math.round(size * 0.28);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      <PolarChart
        data={donutData}
        colorKey="color"
        labelKey="label"
        valueKey="value"
        containerStyle={styles.container}
      >
        <Pie.Chart innerRadius={innerRadius}>
          {() => <Pie.Slice />}
        </Pie.Chart>
      </PolarChart>
      <View style={styles.centerOverlay} pointerEvents="none">
        <Text style={styles.centerKicker}>TOTAL</Text>
        <Text style={styles.centerAmount} numberOfLines={1} adjustsFontSizeToFit>
          ${Math.round(total).toLocaleString('es-AR')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  container: {
    flex: 1,
  },
  // Centered text overlay. The PolarChart's canvas fills the wrapper, so
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
