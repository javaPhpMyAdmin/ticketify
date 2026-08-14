import { StyleSheet, View } from 'react-native';

import { colors, radii } from '@/theme';

import { getCategoryColor } from '../categories';

export interface SegmentedBudgetBarSegment {
  key: string;
  amount: number;
}

export interface SegmentedBudgetBarProps {
  categories: SegmentedBudgetBarSegment[];
  height?: number;
}

/**
 * Horizontal budget bar split into rounded capsule segments, one per
 * category, following the reference in `capturas/barras_de_colores_home`.
 *
 * Unlike the old contiguous block (one bar with only the outer corners
 * rounded), each segment keeps its own full radius plus a 4px gap between
 * neighbors, so every category color reads as an independent capsule. The
 * segment widths are proportional to each category's share of total spend
 * (computed as flex weights so the gap does not overflow the track) and the
 * vivid colors come from the stable category registry so the bar matches
 * the category cards. An empty or zero-total input renders a muted track
 * so the layout does not collapse.
 */
export function SegmentedBudgetBar({
  categories,
  height = 12,
}: SegmentedBudgetBarProps) {
  const total = categories.reduce((sum, c) => sum + c.amount, 0);

  if (total === 0 || categories.length === 0) {
    return <View style={[styles.track, { height }]} />;
  }

  return (
    <View style={[styles.track, { height }]}>
      {categories.map((category) => (
        <View
          key={category.key}
          style={[
            styles.segment,
            {
              flex: category.amount,
              backgroundColor: getCategoryColor(category.key).background,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    gap: 4,
    backgroundColor: colors.chipBg,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
    borderRadius: radii.full,
  },
});
