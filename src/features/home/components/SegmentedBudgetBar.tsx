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
 * Horizontal budget bar split into colored segments proportional to each
 * category's share of total spend. The segment colors are taken from the
 * stable category color registry so the bar matches the category cards.
 *
 * A single category renders as one full-width rounded bar; an empty or
 * zero-total input renders a muted track so the layout does not collapse.
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
      {categories.map((category, index) => {
        const color = getCategoryColor(category.key);
        const isFirst = index === 0;
        const isLast = index === categories.length - 1;
        const width = `${(category.amount / total) * 100}%` as `${number}%`;

        return (
          <View
            key={category.key}
            style={[
              styles.segment,
              {
                width,
                backgroundColor: color.background,
                borderTopLeftRadius: isFirst ? radii.full : 0,
                borderBottomLeftRadius: isFirst ? radii.full : 0,
                borderTopRightRadius: isLast ? radii.full : 0,
                borderBottomRightRadius: isLast ? radii.full : 0,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: colors.border,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
  },
});
