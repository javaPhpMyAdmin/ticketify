import { FlatList, Modal, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, EmptyState, Icon, Text } from '@/components';
import { formatCurrency, formatCurrencyWhole } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

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
 * Same shell as `SnacksBreakdownModal`: transparent backdrop so the chart
 * stays visible, slides up via `animationType="slide"`, dismisses on
 * backdrop tap or the close button. The rows come pre-aggregated from
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

  const renderItem: ListRenderItem<DayItemGroup> = ({ item, index }) => (
    <View>
      {index > 0 ? <Divider /> : null}
      <View style={styles.row}>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
          {item.quantity > 1 ? ` ×${item.quantity}` : ''}
        </Text>
        <Text style={styles.rowAmount}>
          {formatCurrency(item.amount, currency)}
        </Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropTouch}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar detalle del día"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>{dayLabel}</Text>
              <Text style={styles.title}>Detalle del día</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              style={styles.closeButton}
            >
              <Icon name="xmark" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total del día</Text>
            <Text style={styles.totalAmount}>
              {/* Whole currency to match the bar the user tapped — the
                  chart shows "$812", so the modal must not add cents. */}
              {formatCurrencyWhole(displayedTotal, currency)}
            </Text>
          </View>
          <Divider />
          {items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="doc.text"
                title="Sin gastos este día."
                body="Escaneá un ticket con gastos este día para ver el detalle acá."
              />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.name}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  // Pressable layer that catches taps outside the sheet — sits behind the
  // sheet visually but covers the rest of the screen so `onPress` closes
  // the modal even on the dimmed area.
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
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
  rowName: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    flex: 1,
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
