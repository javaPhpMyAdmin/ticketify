/**
 * Donut chart legend: one row per category slice — color swatch, label,
 * percentage, absolute amount. A row is pressable: tap → highlights the
 * matching slice in the donut (the donut owns the slice-press wiring and
 * uses the index to look up which slice to bump). Tap again to deselect.
 *
 * Layout is a vertical stack of one-row-tall entries. When there are more
 * than 8 rows, the legend caps at a `maxHeight` (240 px) inside a
 * `ScrollView` so the screen stays usable on small phones with deep data.
 *
 * The legend is purely visual — it doesn't compute its own percentages,
 * and it doesn't fetch data. The parent screen passes in the items with
 * pre-computed `pct` and absolute `amount`, and the legend renders them
 * in the order received (the donut sorts by amount desc, so the dominant
 * slice is always at the top).
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components';
import { colors, radii, spacing } from '@/theme';

import { CHART_PALETTE } from '../constants';

export interface ChartLegendItem {
  /** Stable identifier (matches the slice's index in the donut's data array). */
  id: string;
  /** Display name. */
  name: string;
  /** Absolute amount (the same number the donut slice is sized by). */
  amount: number;
  /** Percentage of the donut total (e.g. `32`, integer — no decimals). */
  pct: number;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  /** Currency code for the amount formatting (e.g. `'UYU'`). */
  currency?: string;
  /**
   * Hard cap on rendered rows before the legend flips into scroll mode.
   * Defaults to 8 — anything more is suspect (10+ categories is rare,
   * and a scrolling list inside a card fights with the screen's own
   * ScrollView in unpleasant ways).
   */
  visibleBeforeScroll?: number;
  /**
   * Fired when the user taps a legend row. Argument is the index of
   * the tapped slice in the original `items` array (matches
   * `CHART_PALETTE[index]` so the donut can light up the right color).
   * Tapping the same row twice fires `null`, so the donut knows to
   * clear its highlight.
   */
  onSelect?: (index: number | null) => void;
  /** Pre-selected index (lets the parent own the highlight state). */
  selectedIndex?: number | null;
  /** The currently selected index (controlled). */
  selectedIndexOverride?: number | null;
}

const DEFAULT_VISIBLE_BEFORE_SCROLL = 8;
const MAX_HEIGHT_PX = 240;
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
  // Thousands-separator formatting that doesn't pull Intl into the
  // chart dependency graph (Hermes is still inconsistent there).
  const fixed = Math.abs(value).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${symbol}${withSeparators}.${decPart}`;
}

export function ChartLegend({
  items,
  currency = 'UYU',
  visibleBeforeScroll = DEFAULT_VISIBLE_BEFORE_SCROLL,
  onSelect,
  selectedIndex,
  selectedIndexOverride,
}: ChartLegendProps) {
  // Uncontrolled fallback when the parent doesn't own the state — keeps
  // the legend usable as a standalone component in tests / Storybook.
  const [internal, setInternal] = useState<number | null>(null);
  const activeIndex =
    selectedIndexOverride !== undefined
      ? selectedIndexOverride
      : selectedIndex !== undefined
        ? selectedIndex
        : internal;

  const shouldScroll = items.length > visibleBeforeScroll;

  const handlePress = (index: number) => {
    const next = activeIndex === index ? null : index;
    if (selectedIndexOverride === undefined && selectedIndex === undefined) {
      setInternal(next);
    }
    onSelect?.(next);
  };

  const rows = items.map((item, index) => {
    const isSelected = activeIndex === index;
    const color = CHART_PALETTE[index % CHART_PALETTE.length];
    return (
      <Pressable
        key={item.id ?? `${item.name}-${index}`}
        onPress={() => handlePress(index)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.pct}%`}
        accessibilityState={{ selected: isSelected }}
        style={({ pressed }) => [
          styles.row,
          isSelected && styles.rowSelected,
          pressed && styles.rowPressed,
        ]}
      >
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <Text style={styles.label} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.pct}>{item.pct}%</Text>
        <Text style={styles.amount}>{formatAmount(item.amount, currency)}</Text>
      </Pressable>
    );
  });

  if (shouldScroll) {
    return (
      <ScrollView
        style={{ maxHeight: MAX_HEIGHT_PX }}
        showsVerticalScrollIndicator={false}
      >
        {rows}
      </ScrollView>
    );
  }
  return <View style={styles.list}>{rows}</View>;
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: 'transparent',
  },
  rowSelected: {
    backgroundColor: colors.chipBg,
  },
  rowPressed: {
    opacity: 0.85,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  pct: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    minWidth: 36,
    textAlign: 'right',
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 88,
    textAlign: 'right',
  },
});
