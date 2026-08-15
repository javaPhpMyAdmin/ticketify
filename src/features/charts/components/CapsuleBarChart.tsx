import { StyleSheet, View } from 'react-native';

import { Pressable, Text } from '@/components';
import { formatCurrencyWhole } from '@/lib/format';
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
 * Vertical space above the tallest bar reserved for the amount label: two
 * lines of `labelSm` (36px) plus the column gap, so a wrapped "$12,345"
 * never clips or shifts the bars. Amounts pack at the bottom of this space
 * (just above their bar), exactly like the reference mockup.
 */
const AMOUNT_SPACE = 42;

/**
 * Generic capsule bar chart ("This week / last 6 months / by year" lens on
 * the Pro charts screen).
 *
 * Layout mirrors the reference mockup: a FIXED day axis at the bottom —
 * the labels row is a separate row that never moves — and above it a fixed
 * bars area where only the capsule height varies with the amount. Amounts
 * float above their bar; the highlighted bucket (today, the current month,
 * or the current year) is drawn in the rose `colors.secondary` accent so
 * the active bucket is scannable at a glance. When every value is $0 the
 * bars keep a minimal gray height so the layout does not collapse, but
 * nothing is highlighted.
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
      <View style={[styles.barsRow, { height: barHeight + AMOUNT_SPACE }]}>
        {items.map((item, index) => {
          const fillColor = item.highlight ? colors.secondary : BAR_MUTED;
          const fillHeight = hasSpend
            ? Math.max((item.value / maxValue) * barHeight, 4)
            : 4;
          const amountLabel = formatCurrencyWhole(item.value, currency);
          const content = (
            <>
              <Text
                style={[styles.amount, item.highlight && styles.amountHighlight]}
              >
                {amountLabel}
              </Text>
              <View
                style={[
                  styles.bar,
                  { height: fillHeight, backgroundColor: fillColor },
                ]}
              />
            </>
          );

          if (!onPressItem) {
            return (
              <View key={`${item.label}-${index}`} style={styles.columnWrap}>
                {content}
              </View>
            );
          }
          return (
            <Pressable
              key={`${item.label}-${index}`}
              onPress={() => onPressItem(item, index)}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}: ${amountLabel}`}
              style={styles.columnWrap}
            >
              {content}
            </Pressable>
          );
        })}
      </View>
      {/* Fixed day axis: a separate row so the labels sit on one baseline
          and never shift with the bar heights. `labelWrap` is a content-
          sized cell — it must NOT reuse `columnWrap`, whose `height: '100%'`
          collapses to zero inside this height-less row. */}
      <View style={styles.labelsRow}>
        {items.map((item, index) => (
          <View key={`${item.label}-${index}`} style={styles.labelWrap}>
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
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  barsRow: {
    flexDirection: 'row',
  },
  labelsRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  columnWrap: {
    flex: 1,
    height: '100%',
    // Content packs at the BOTTOM of the fixed-height column: the bar
    // grows upward from the day axis (never hangs from the top), and the
    // amount floats just above its bar like the reference mockup.
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Day-axis cell: centered under its bar, content-sized (no `height:
  // '100%'` — that would collapse inside the height-less labels row).
  labelWrap: {
    flex: 1,
    alignItems: 'center',
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
