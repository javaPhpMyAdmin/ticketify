import { StyleSheet, View } from 'react-native';

import { Pressable, Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

export interface CapsuleBarChartItem {
  /** Label rendered below the bar (day initial, short month, or year). */
  label: string;
  /** Numeric value driving the bar height and the amount label. */
  value: number;
  /** When true, the bar renders in the rose accent color. */
  highlight?: boolean;
}

export interface CapsuleBarChartProps {
  /** Bars to render, left → right in render order. */
  items: CapsuleBarChartItem[];
  /** Currency code used for the amount labels. */
  currency?: string;
  /** Pixel height of the tallest bar. Defaults to 96. */
  barHeight?: number;
  /**
   * When provided, each bar becomes a button that reports the tapped item
   * and its index (e.g. "tap the Monday bar → day detail sheet"). Without
   * it the chart renders as before, plain and non-interactive.
   */
  onPressItem?: (item: CapsuleBarChartItem, index: number) => void;
}

/**
 * Muted gray of the reference mockup's inactive capsule bars
 * (Tailwind `surface-container-highest`, #D1D5DB) — the palette has no
 * dedicated token for it, so it lives here next to the only consumer.
 */
const BAR_MUTED = '#D1D5DB';

/**
 * Generic capsule bar chart ("This week / last 6 months / by year" lens on
 * the Pro charts screen).
 *
 * Each item renders as a rounded vertical bar in muted gray; the item
 * marked `highlight` (today, the current month, or the current year) is
 * drawn in the rose `colors.secondary` accent so the active bucket is
 * scannable at a glance. Amounts and labels are rendered above/below the
 * bars. When every value is $0 the bars keep a minimal gray height so the
 * layout does not collapse, but nothing is highlighted.
 *
 * Built with React Native Views instead of `victory-native` Bar because the
 * design calls for rounded capsule bars with per-bar labels — styling that
 * is simpler and more predictable with plain Views.
 */
export function CapsuleBarChart({
  items,
  currency = 'UYU',
  barHeight = 96,
  onPressItem,
}: CapsuleBarChartProps) {
  const maxValue = items.reduce((max, item) => Math.max(max, item.value), 0);
  const hasSpend = maxValue > 0;

  return (
    <View style={styles.container}>
      {items.map((item, index) => {
        const fillColor = item.highlight ? colors.secondary : BAR_MUTED;
        const fillHeight = hasSpend
          ? Math.max((item.value / maxValue) * barHeight, 4)
          : 4;

        const column = (
          <View style={styles.column}>
            <Text
              style={[styles.amount, item.highlight && styles.amountHighlight]}
            >
              {formatCurrency(item.value, currency)}
            </Text>
            <View
              style={[
                styles.bar,
                { height: fillHeight, backgroundColor: fillColor },
              ]}
            />
            <Text
              style={[
                styles.label,
                item.highlight && styles.labelHighlight,
                !hasSpend && styles.labelMuted,
              ]}
            >
              {item.label}
            </Text>
          </View>
        );

        if (!onPressItem) {
          return (
            <View key={`${item.label}-${index}`} style={styles.columnWrap}>
              {column}
            </View>
          );
        }
        return (
          <Pressable
            key={`${item.label}-${index}`}
            onPress={() => onPressItem(item, index)}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${formatCurrency(item.value, currency)}`}
            style={styles.columnWrap}
          >
            {column}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    width: '100%',
  },
  columnWrap: {
    flex: 1,
  },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  amount: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  amountHighlight: {
    color: colors.secondary,
    fontWeight: '700',
  },
  bar: {
    width: '60%',
    maxWidth: 32,
    borderRadius: radii.full,
  },
  label: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  labelHighlight: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  labelMuted: {
    opacity: 0.6,
  },
});
