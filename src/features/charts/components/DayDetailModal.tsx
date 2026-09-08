import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';

import { BottomSheet, Divider, EmptyState, Text } from '@/components';
import { formatCurrency, formatCurrencyWhole } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';

import type { DayItemGroup } from '../aggregate';

export interface DayDetailModalProps {
  visible: boolean;
  /** ISO date (`YYYY-MM-DD`) of the tapped day. */
  isoDate: string;
  /** Header label for the tapped day, e.g. "Lunes 11". */
  dayLabel: string;
  /** Merged line items for that day, amount desc (see `aggregateDayItems`). */
  items: DayItemGroup[];
  /**
   * Effective day total from the caller — the SAME number the weekly bar
   * showed for this day (`aggregateDayTotal`: receipt totals minus excluded
   * categories, clamped at 0). The item list alone can't reproduce it:
   * items are pre-discount lines while `receipt.total` is the final
   * discounted amount. When omitted (no caller-provided value) the modal
   * falls back to summing the item list.
   */
  total?: number;
  currency?: string;
  onClose: () => void;
}

/**
 * Bottom-sheet modal with the per-item breakdown of a single day, opened by
 * tapping a bar in the weekly capsule chart.
 *
 * Shares the `BottomSheet` shell (transparent backdrop so the chart stays
 * visible, slides up via `animationType="slide"`, dismisses on backdrop tap
 * or the close button). The rows come pre-aggregated from
 * `aggregateDayItems` (pure, testable) — this component only renders them:
 * display name with ` ×quantity` when the day bought more than one unit,
 * amount on the right, and the day total pinned under the header. The
 * pinned total comes from the caller (`total` prop) so it always matches
 * the tapped bar's amount; without it, the sum of the item list is shown.
 */
export function DayDetailModal({
  visible,
  dayLabel,
  items,
  total,
  currency = 'UYU',
  onClose,
}: DayDetailModalProps) {
  const itemsTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const displayedTotal = total ?? itemsTotal;

  // When the caller reports a non-zero total but aggregation produced no
  // line items (e.g. purchase_items weren't hydrated by the Supabase join
  // or all items belong to excluded categories), surface a single generic
  // entry so the modal never shows "Sin gastos" for a day that clearly
  // had spending.
  const displayItems =
    items.length > 0
      ? items
      : displayedTotal > 0
        ? [{ name: 'Ticket', quantity: 1, amount: displayedTotal }]
        : [];

  const renderItem: ListRenderItem<DayItemGroup> = ({ item, index }) => (
    <View>
      {index > 0 ? <Divider /> : null}
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={2}>
            {item.name}
            {item.quantity > 1 ? ` ×${item.quantity}` : ''}
          </Text>
          {item.store ? (
            <Text style={styles.rowStore} numberOfLines={1}>
              {item.store}
            </Text>
          ) : null}
        </View>
        <Text style={styles.rowAmount}>
          {formatCurrency(item.amount, currency)}
        </Text>
      </View>
    </View>
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      kicker={dayLabel}
      title="Detalle del día"
      backdropLabel="Cerrar detalle del día"
    >
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total del día</Text>
        <Text style={styles.totalAmount}>
          {/* Whole currency to match the bar the user tapped — the
              chart shows "$812", so the modal must not add cents. */}
          {formatCurrencyWhole(displayedTotal, currency)}
        </Text>
      </View>
      <Divider />
      {displayItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="doc.text"
            title="Sin gastos este día."
            body="Escaneá un ticket con gastos este día para ver el detalle acá."
          />
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  totalLabel: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  totalAmount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  rowStore: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  rowAmount: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  emptyWrap: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
});
