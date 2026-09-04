/**
 * Per-store totals for the selected month (pro-subscription spec —
 * REQ-CHART-4), rendered as legible rows instead of a raw axis chart:
 * each row shows the FULL store name, the spend amount, and a
 * proportional bar so the dominant store is visually obvious. Sorted
 * longest → shortest (the aggregator already returns that order; the
 * component just renders whatever it's given).
 *
 * The row is the tap target: pressing it fires `onRowPress` so the
 * screen can route to `/stores/[name]?month=...`. The parent decides
 * whether a given store is drillable (e.g. receipts without a store
 * name are inert).
 *
 * Empty state: when `data` is empty, renders a placeholder rather than
 * an empty chart — an empty axis is hard to read on mobile and the user
 * can't tell whether the screen is broken or genuinely has no spend.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

import { CHART_PALETTE } from '../constants';

export interface StoreBar {
  /** Stable identifier (lowercased store name fallback). */
  storeId: string;
  /** Display name shown on the row. */
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
  /** Currency code for the per-store amount. */
  currency?: string;
  /** Minimum pixel height of the empty state. */
  emptyHeight?: number;
}

export function StoreBars({
  data,
  onRowPress,
  currency = 'UYU',
  emptyHeight = 120,
}: StoreBarsProps) {
  if (data.length === 0) {
    return (
      <View style={[styles.empty, { minHeight: emptyHeight }]}>
        <Text style={styles.emptyText}>Sin compras en este mes</Text>
      </View>
    );
  }

  const maxTotal = data.reduce((max, store) => Math.max(max, store.total), 0);

  return (
    <View style={styles.container}>
      {data.map((store) => {
        const ratio = maxTotal > 0 ? store.total / maxTotal : 0;
        // Keep a sliver of fill even for tiny totals so the row never
        // looks empty.
        const fillPct = `${Math.max(ratio, 0.03) * 100}%` as `${number}%`;
        return (
          <Pressable
            key={store.storeId}
            onPress={() => onRowPress?.(store)}
            accessibilityRole="button"
            accessibilityLabel={`${store.storeName}, ${formatCurrency(store.total, currency)}`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowHeader}>
              <Text style={styles.storeName} numberOfLines={2}>
                {store.storeName}
              </Text>
              <Text style={styles.storeTotal}>
                {formatCurrency(store.total, currency)}
              </Text>
            </View>
            <View style={styles.track}>
              <View
                style={[styles.fill, { width: fillPct }]}
                accessibilityElementsHidden
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
  },
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  storeName: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    flex: 1,
  },
  storeTotal: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  track: {
    height: 10,
    borderRadius: radii.full,
    backgroundColor: colors.chipBg,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: CHART_PALETTE[0],
  },
  empty: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chipBg,
    borderRadius: radii.md,
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
});
